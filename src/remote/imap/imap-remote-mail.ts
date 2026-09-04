import type { RemoteBody } from '../body'
import { RemoteError } from '../errors'
import {
  validateRemoteCollectionSync,
  type RemoteCollectionSync,
  type RemoteKeywordChange,
  type RemoteMail,
  type RemoteMailboxQuery,
  type RemoteMembershipChange,
  type RemoteQueryOptions,
} from '../mail'
import { toNativeRemoteError } from '../native/error-mapper'
import type { NativeFlag, NativeMailIpcPort } from '../native/ipc'
import {
  remoteSyncStateFromString,
  type RemoteAccountId,
  type RemoteAttachment,
  type RemoteEmail,
  type RemoteEmailId,
  type RemoteIdentity,
  type RemoteIdentityId,
  type RemoteMailbox,
  type RemoteMailboxId,
  type RemoteSyncState,
} from '../types'
import {
  decodeImapEmailId,
  decodeImapMailboxId,
  imapAccountId,
  imapIdentityId,
} from './ids'
import {
  mapNativeAttachment,
  mapNativeEmail,
  mapNativeMailbox,
  roleFor,
} from './mappers'

export class ImapRemoteMail implements RemoteMail {
  readonly accountId: RemoteAccountId

  constructor(
    private readonly ipc: NativeMailIpcPort,
    private readonly sessionId: string,
    private readonly authenticatedUser: string,
    private readonly syncPolicy: 'genericImap' | 'gmailDogfood' = 'genericImap',
  ) {
    this.accountId = imapAccountId(authenticatedUser)
  }

  async syncIdentities(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>> {
    void previousState
    this.assertAccount(accountId)
    const identity: RemoteIdentity = {
      id: imapIdentityId(this.authenticatedUser),
      name: this.authenticatedUser,
      email: this.authenticatedUser,
      replyTo: null,
      bcc: null,
    }
    return {
      mode: 'replace',
      state: state('identity', [this.authenticatedUser]),
      snapshot: [identity],
    }
  }

  async syncMailboxes(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteMailbox, RemoteMailboxId>> {
    void previousState
    this.assertAccount(accountId)
    try {
      const values = this.syncMailboxesForPolicy(
        sortMailboxes(await this.ipc.listMailboxes(this.sessionId)),
      )
      const snapshot = values.map(mapNativeMailbox)
      return validateRemoteCollectionSync(
        {
          mode: 'replace',
          state: state(
            'mailboxes',
            values.map((value) => [
              value.name,
              value.uidValidity,
              value.uidNext,
              value.messages,
              value.unseen,
            ]),
          ),
          snapshot,
        },
        (mailbox) => mailbox.id,
      )
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }

  async syncEmails(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteEmail, RemoteEmailId>> {
    void previousState
    this.assertAccount(accountId)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.syncEmailsAttempt()
      } catch (error: unknown) {
        const remoteError = toNativeRemoteError(error)
        if (
          attempt === 0 &&
          remoteError.kind === 'conflict' &&
          remoteError.retry === 'safeImmediate'
        ) {
          continue
        }
        throw remoteError
      }
    }
    throw snapshotConflict()
  }

  private async syncEmailsAttempt(): Promise<
    RemoteCollectionSync<RemoteEmail, RemoteEmailId>
  > {
    const initialMailboxes = this.syncMailboxesForPolicy(
      sortMailboxes(await this.ipc.listMailboxes(this.sessionId)),
    )
    const snapshots = []
    for (const mailbox of initialMailboxes) {
      snapshots.push(
        await this.ipc.snapshotMailbox(this.sessionId, mailbox.name),
      )
    }
    const finalMailboxes = this.syncMailboxesForPolicy(
      sortMailboxes(await this.ipc.listMailboxes(this.sessionId)),
    )
    const snapshotMailboxes = sortMailboxes(
      snapshots.map((snapshot) => snapshot.mailbox),
    )
    const initialFingerprint = mailboxFingerprint(initialMailboxes)
    if (
      initialFingerprint !== mailboxFingerprint(snapshotMailboxes) ||
      initialFingerprint !== mailboxFingerprint(finalMailboxes)
    ) {
      throw snapshotConflict()
    }
    const records = snapshots.flatMap((snapshot) => snapshot.messages)
    const snapshot = records.map(mapNativeEmail)
    return validateRemoteCollectionSync(
      {
        mode: 'replace',
        state: state(
          'emails',
          records
            .map((value) => [
              value.mailbox,
              value.uidValidity,
              value.uid,
              [...value.flags].sort(),
              value.internalDate,
              value.size,
            ])
            .sort((left, right) =>
              JSON.stringify(left).localeCompare(JSON.stringify(right)),
            ),
        ),
        snapshot,
      },
      (email) => email.id,
    )
  }

  async queryMailbox(
    accountId: RemoteAccountId,
    mailboxId: RemoteMailboxId,
    filter?: unknown,
    options: RemoteQueryOptions = {},
  ): Promise<RemoteMailboxQuery> {
    this.assertAccount(accountId)
    if (filter !== undefined && filter !== null)
      throw unsupported('IMAP MVP does not support mailbox filters')
    try {
      const mailbox = decodeImapMailboxId(mailboxId)
      const snapshot = await this.ipc.snapshotMailbox(this.sessionId, mailbox)
      const emails = snapshot.messages.map(mapNativeEmail).sort(compareEmails)
      const requestedPosition = options.position ?? 0
      if (!Number.isSafeInteger(requestedPosition) || requestedPosition < 0)
        throw unsupported('Invalid mailbox position')
      let position = requestedPosition
      if (options.anchor !== undefined) {
        const anchor = decodeImapEmailId(options.anchor)
        if (anchor.mailbox !== mailbox)
          throw invalidState('Anchor belongs to another mailbox')
        const index = emails.findIndex((email) => email.id === options.anchor)
        if (index < 0) throw invalidState('Anchor is absent from mailbox')
        position = Math.max(0, index + (options.anchorOffset ?? 0))
      }
      const limit = options.limit ?? 500
      if (!Number.isSafeInteger(limit) || limit < 0)
        throw unsupported('Invalid mailbox limit')
      return {
        ids: emails.slice(position, position + limit).map((email) => email.id),
        queryState: state(
          'query',
          snapshot.messages.map((value) => [
            value.uidValidity,
            value.uid,
            value.internalDate,
          ]),
        ),
        total: emails.length,
        position,
        canCalculateChanges: false,
      }
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }

  async fetchBody(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<RemoteBody> {
    this.assertAccount(accountId)
    try {
      const body = await this.ipc.fetchBody(this.target(emailId))
      return body.kind === 'plain'
        ? body
        : {
            kind: 'boxplotE2ee',
            contentType: 'application/vnd.boxplot.e2ee+json',
            payload: body.payload,
          }
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }

  async fetchAttachments(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<readonly RemoteAttachment[]> {
    this.assertAccount(accountId)
    try {
      return (await this.ipc.fetchAttachments(this.target(emailId))).map(
        (value) => mapNativeAttachment(emailId, value),
      )
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }

  async applyKeywordChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void> {
    this.assertAccount(accountId)
    const convert = (value: string): NativeFlag => {
      if (value === '$seen') return 'seen'
      if (value === '$flagged') return 'flagged'
      throw unsupported(`Unsupported IMAP keyword ${value}`)
    }
    const add = change.add.map(convert)
    const remove = change.remove.map(convert)
    try {
      await this.ipc.storeFlags({ ...this.target(emailId), add, remove })
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }

  async applyMembershipChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void> {
    this.assertAccount(accountId)
    if (change.add.length === 0 && change.remove.length === 0) return
    const source = decodeImapEmailId(emailId)
    if (
      change.add.length !== 1 ||
      change.remove.length !== 1 ||
      decodeImapMailboxId(change.remove[0]!) !== source.mailbox
    ) {
      throw unsupported('IMAP MVP only supports one-mailbox MOVE')
    }
    try {
      await this.ipc.move({
        ...this.target(emailId),
        destinationMailbox: decodeImapMailboxId(change.add[0]!),
      })
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }

  private target(emailId: RemoteEmailId) {
    return { sessionId: this.sessionId, ...decodeImapEmailId(emailId) }
  }

  private syncMailboxesForPolicy<
    T extends { name: string; specialUse?: string | null },
  >(values: readonly T[]): T[] {
    if (this.syncPolicy !== 'gmailDogfood') return [...values]
    return values.filter((value) => {
      const role = roleFor(value.specialUse, value.name)
      return role === 'inbox' || role === 'sent' || role === 'trash'
    })
  }

  private assertAccount(accountId: RemoteAccountId): void {
    if (accountId !== this.accountId)
      throw invalidState('Remote Account does not belong to session')
  }
}

function state(kind: string, value: unknown): RemoteSyncState {
  return remoteSyncStateFromString(
    `imap-state-v1:${kind}:${JSON.stringify(value)}`,
  )
}

function sortMailboxes<T extends { name: string }>(values: readonly T[]): T[] {
  const rank = (name: string) =>
    name.toLowerCase() === 'inbox'
      ? 0
      : name.toLowerCase() === 'sent'
        ? 1
        : name.toLowerCase() === 'trash'
          ? 2
          : 3
  return [...values].sort(
    (left, right) =>
      rank(left.name) - rank(right.name) || left.name.localeCompare(right.name),
  )
}

function mailboxFingerprint(
  values: readonly {
    name: string
    uidValidity: number
    uidNext: number
    messages: number
    unseen: number
  }[],
): string {
  return JSON.stringify(
    values.map((value) => [
      value.name,
      value.uidValidity,
      value.uidNext,
      value.messages,
      value.unseen,
    ]),
  )
}

function compareEmails(left: RemoteEmail, right: RemoteEmail): number {
  return (
    right.receivedAt.localeCompare(left.receivedAt) ||
    decodeImapEmailId(right.id).uid - decodeImapEmailId(left.id).uid
  )
}

function unsupported(message: string): RemoteError {
  return new RemoteError(message, {
    kind: 'unsupported',
    retry: 'never',
    session: 'keep',
    outcome: 'knownNotApplied',
  })
}

function invalidState(message: string): RemoteError {
  return new RemoteError(message, {
    kind: 'stateInvalid',
    retry: 'never',
    session: 'keep',
    outcome: 'knownNotApplied',
  })
}

function snapshotConflict(): RemoteError {
  return new RemoteError(
    'IMAP account snapshot changed during synchronization',
    {
      kind: 'conflict',
      retry: 'safeImmediate',
      session: 'keep',
      outcome: 'knownNotApplied',
    },
  )
}

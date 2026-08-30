import { createMemoryLocalEngine } from '../../../adapters/memory'
import type { MemoryLocalEngine } from '../../../adapters/memory'
import type { AccountKey, ServiceKey } from '../../../domain/ids'
import type { RemoteBody } from '../../../remote/body'
import type {
  RemoteCollectionSync,
  RemoteMailboxQuery,
  RemoteMail,
} from '../../../remote/mail'
import type { RemoteSession } from '../../../remote/session'
import type { Submission, SubmissionResult } from '../../../remote/submission'
import {
  remoteAccountIdFromString,
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
} from '../../../remote/types'
import type { RemoteConnectionConfig } from '../../../remote/runtime'
import { DefaultRemoteApplication } from '../remote-application'

export const VERIFY_CONFIG: RemoteConnectionConfig = {
  provider: 'imapSmtp',
  host: '127.0.0.1',
  username: 'verify-user',
  password: 'verify-password',
  imapPort: 1143,
  smtpPort: 1025,
}

export class VerificationBarrier<T> {
  readonly promise: Promise<T>
  private releasePromise!: (value: T | PromiseLike<T>) => void

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.releasePromise = resolve
    })
  }

  release(value: T): void {
    this.releasePromise(value)
  }
}

export class VerificationMail implements RemoteMail {
  readonly calls: string[] = []
  identities: RemoteCollectionSync<RemoteIdentity, RemoteIdentityId> = {
    mode: 'replace',
    state: remoteSyncStateFromString('verify-identity-state'),
    snapshot: [],
  }
  mailboxes: RemoteCollectionSync<RemoteMailbox, RemoteMailboxId> = {
    mode: 'replace',
    state: remoteSyncStateFromString('verify-mailbox-state'),
    snapshot: [],
  }
  emails: RemoteCollectionSync<RemoteEmail, RemoteEmailId> = {
    mode: 'replace',
    state: remoteSyncStateFromString('verify-email-state'),
    snapshot: [],
  }
  queries = new Map<RemoteMailboxId, RemoteMailboxQuery>()
  syncFailure: unknown = null

  async syncIdentities(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>> {
    this.calls.push(`syncIdentities:${accountId}:${String(previousState)}`)
    if (this.syncFailure !== null) throw this.syncFailure
    return this.identities
  }

  async syncMailboxes(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteMailbox, RemoteMailboxId>> {
    this.calls.push(`syncMailboxes:${accountId}:${String(previousState)}`)
    if (this.syncFailure !== null) throw this.syncFailure
    return this.mailboxes
  }

  async syncEmails(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteEmail, RemoteEmailId>> {
    this.calls.push(`syncEmails:${accountId}:${String(previousState)}`)
    if (this.syncFailure !== null) throw this.syncFailure
    return this.emails
  }

  async queryMailbox(
    accountId: RemoteAccountId,
    mailboxId: RemoteMailboxId,
  ): Promise<RemoteMailboxQuery> {
    this.calls.push(`queryMailbox:${accountId}:${mailboxId}`)
    return (
      this.queries.get(mailboxId) ?? {
        ids: [],
        queryState: remoteSyncStateFromString(`query-${mailboxId}`),
        total: 0,
        position: 0,
        canCalculateChanges: true,
      }
    )
  }

  async fetchBody(): Promise<RemoteBody> {
    throw new Error('fetchBody is outside this verifier')
  }

  async fetchAttachments(): Promise<readonly RemoteAttachment[]> {
    throw new Error('fetchAttachments is outside this verifier')
  }

  async applyKeywordChange(): Promise<void> {
    throw new Error('applyKeywordChange is outside this verifier')
  }

  async applyMembershipChange(): Promise<void> {
    throw new Error('applyMembershipChange is outside this verifier')
  }
}

class VerificationSubmission implements Submission {
  async submit(): Promise<SubmissionResult> {
    throw new Error('submit is outside this verifier')
  }
}

export class VerificationSession implements RemoteSession {
  readonly submission = new VerificationSubmission()
  closeCalls = 0
  closeFailure: unknown = null

  constructor(
    readonly accountId: RemoteAccountId,
    readonly mail: VerificationMail,
    additionalAccounts: readonly RemoteAccountId[] = [],
  ) {
    this.accounts = [accountId, ...additionalAccounts].map((id) => ({
      id,
      capabilities: [],
    }))
  }

  readonly accounts: RemoteSession['accounts']

  async close(): Promise<void> {
    this.closeCalls += 1
    if (this.closeFailure !== null) throw this.closeFailure
  }
}

export type VerificationSubject = Readonly<{
  application: DefaultRemoteApplication
  local: MemoryLocalEngine
  mail: VerificationMail
  session: VerificationSession
  remoteAccountId: RemoteAccountId
  factoryCalls: { value: number }
}>

export function verificationSubject(
  accountKey: AccountKey,
  serviceKey: ServiceKey,
  remoteIdText = 'verify-remote-account',
): VerificationSubject {
  const local = createMemoryLocalEngine()
  const mail = new VerificationMail()
  const remoteAccountId = remoteAccountIdFromString(remoteIdText)
  const session = new VerificationSession(remoteAccountId, mail)
  const factoryCalls = { value: 0 }
  const application = new DefaultRemoteApplication({
    readRepository: local.readRepository,
    syncPort: local.syncPort,
    connectionFactory: () => {
      factoryCalls.value += 1
      return {
        async open(): Promise<RemoteSession> {
          return session
        },
      }
    },
  })

  void accountKey
  void serviceKey
  return { application, local, mail, session, remoteAccountId, factoryCalls }
}

import { describe, expect, it } from 'vitest'
import { createMemoryLocalEngine } from '../../adapters/memory'
import type { AccountKey, ScopedEmailId } from '../../domain/ids'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
} from '../../domain/mailbox-view'
import { MockJmapClient } from '../../jmap/mock-client'
import type {
  JmapEmail,
  JmapAttachment,
  JmapEmailsResult,
  JmapIdentitiesResult,
  JmapMailboxesResult,
  JmapQueryResult,
  QueryOptions,
} from '../../jmap/types'
import type { ReadRepository } from '../../ports/read-repository'
import { Coordinator } from '../../sync/coordinator'
import { toDomainAttachmentRefs } from '../../sync/mappers'
import { unwrapOk } from '../../tests/contracts/assertions'
import { createTestAccount } from '../../tests/contracts/fixtures'
import { localEmailId } from '../compat/domain-ids'
import { JmapRemoteMail } from '../jmap'
import { FakeRemoteMail } from '../testing'
import type {
  RemoteEmail,
  RemoteAttachment,
  RemoteIdentity,
  RemoteMailbox,
  RemoteMailboxId,
} from '../types'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
} from '../types'

const ACCOUNT_ID = remoteAccountIdFromString('account|canonical')
const IDENTITY_STATE = remoteSyncStateFromString('identity|state|1')
const MAILBOX_STATE = remoteSyncStateFromString('mailbox|state|1')
const EMAIL_STATE = remoteSyncStateFromString('email|state|1')

const rights = {
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  maySubmit: true,
} as const

const identities: readonly RemoteIdentity[] = [
  {
    id: remoteIdentityIdFromString('identity|primary'),
    name: 'Alice Example',
    email: 'alice@example.test',
    replyTo: [{ name: 'Replies', email: 'replies@example.test' }],
    bcc: null,
  },
  {
    id: remoteIdentityIdFromString('identity|team'),
    name: 'Team',
    email: 'team@example.test',
    replyTo: [],
    bcc: [{ name: null, email: 'archive@example.test' }],
  },
]

const inboxId = remoteMailboxIdFromString('folder|inbox')
const sentId = remoteMailboxIdFromString('folder|sent')
const trashId = remoteMailboxIdFromString('folder|trash')
const archiveId = remoteMailboxIdFromString('folder|archive')

const mailboxes: readonly RemoteMailbox[] = [
  {
    id: inboxId,
    name: 'Inbox',
    parent: null,
    role: 'inbox',
    sortOrder: 10,
    totalEmails: 5,
    unreadEmails: 2,
    rights,
  },
  {
    id: sentId,
    name: 'Sent',
    parent: null,
    role: 'sent',
    sortOrder: 20,
    totalEmails: 3,
    unreadEmails: 0,
    rights,
  },
  {
    id: trashId,
    name: 'Trash',
    parent: null,
    role: 'trash',
    sortOrder: 30,
    totalEmails: 1,
    unreadEmails: 1,
    rights,
  },
  {
    id: archiveId,
    name: 'Projects / Archive',
    parent: inboxId,
    role: null,
    sortOrder: 40,
    totalEmails: 2,
    unreadEmails: 1,
    rights,
  },
]

function canonicalEmail(
  token: string,
  mailboxIds: readonly RemoteMailboxId[],
  overrides: Partial<RemoteEmail> = {},
): RemoteEmail {
  const ordinal = Number(token.slice(1))
  const sender = [{ name: `Sender ${token}`, email: `${token}@example.test` }]
  return {
    id: remoteEmailIdFromString(`uid|${token}`),
    blobId: remoteBlobIdFromString(`blob/${token}`),
    threadId: remoteThreadIdFromString(`thread:${Math.ceil(ordinal / 2)}`),
    sender,
    from: sender,
    replyTo: [],
    to: [{ name: null, email: 'alice@example.test' }],
    cc: [],
    bcc: null,
    subject: `Subject ${token}`,
    sentAt: `2026-02-${String(ordinal).padStart(2, '0')}T10:00:00Z`,
    receivedAt: `2026-03-${String(ordinal).padStart(2, '0')}T10:00:00Z`,
    size: ordinal * 257,
    preview: `Preview ${token}`,
    hasAttachment: false,
    keywords: new Set<string>(),
    mailboxIds,
    ...overrides,
  }
}

const emails: readonly RemoteEmail[] = [
  canonicalEmail('e1', [inboxId], { keywords: new Set(['$seen']) }),
  canonicalEmail('e2', [sentId], { keywords: new Set(['$flagged']) }),
  canonicalEmail('e3', [inboxId, archiveId], {
    keywords: new Set(['$seen', '$flagged']),
  }),
  canonicalEmail('e4', [inboxId], {
    keywords: new Set(['project/custom:value-one']),
  }),
  canonicalEmail('e5', [sentId], { hasAttachment: true }),
  canonicalEmail('e6', [trashId], {
    sender: null,
    from: null,
    replyTo: null,
    subject: null,
    sentAt: null,
  }),
  canonicalEmail('e7', [archiveId]),
  canonicalEmail('e8', [inboxId, sentId]),
  canonicalEmail('e9', [inboxId]),
  canonicalEmail('e10', [sentId]),
]

const attachmentEmailId = remoteEmailIdFromString('uid|e5')
const attachments: readonly RemoteAttachment[] = [
  {
    blobId: remoteBlobIdFromString('blob/attachment/e5/2'),
    partId: '2',
    name: 'invoice.pdf',
    mediaType: 'application/pdf',
    size: 4_096,
    disposition: 'attachment',
    cid: null,
  },
]

function toJmapEmail(value: RemoteEmail): JmapEmail {
  return {
    id: value.id,
    blobId: value.blobId,
    threadId: value.threadId,
    sender: value.sender,
    from: value.from,
    replyTo: value.replyTo,
    to: value.to,
    cc: value.cc,
    bcc: value.bcc,
    subject: value.subject,
    sentAt: value.sentAt,
    receivedAt: value.receivedAt,
    size: value.size,
    preview: value.preview,
    hasAttachment: value.hasAttachment,
    keywords: Object.fromEntries([...value.keywords].map((key) => [key, true])),
    mailboxIds: value.mailboxIds,
  }
}

class CanonicalJmapClient extends MockJmapClient {
  override async getIdentities(): Promise<JmapIdentitiesResult> {
    return {
      state: IDENTITY_STATE,
      identities: identities.map((value) => ({
        ...value,
        htmlSignature: '',
        textSignature: '',
      })),
    }
  }

  override async getMailboxes(): Promise<JmapMailboxesResult> {
    return { state: MAILBOX_STATE, mailboxes }
  }

  override async queryEmails(
    _accountId: string,
    mailboxId: string,
    _filter?: unknown,
    options?: QueryOptions,
  ): Promise<JmapQueryResult> {
    const ordered = emails
      .filter((value) =>
        value.mailboxIds.includes(remoteMailboxIdFromString(mailboxId)),
      )
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
    const position = options?.position ?? 0
    const page = ordered.slice(
      position,
      position + (options?.limit ?? ordered.length),
    )
    return {
      ids: page.map((value) => value.id),
      queryState: EMAIL_STATE,
      total: ordered.length,
      position,
      canCalculateChanges: true,
    }
  }

  override async getEmails(
    _accountId: string,
    emailIds: string[],
  ): Promise<JmapEmailsResult> {
    const requested = new Set(emailIds)
    return {
      state: EMAIL_STATE,
      emails: emails
        .filter((value) => requested.has(value.id))
        .map(toJmapEmail),
    }
  }

  override async getEmailAttachments(
    _accountId: string,
    emailId: string,
  ): Promise<JmapAttachment[]> {
    return emailId === attachmentEmailId
      ? attachments.map((value) => ({ ...value }))
      : []
  }
}

function directRemote(): FakeRemoteMail {
  return new FakeRemoteMail({
    syncIdentities: async () => ({
      mode: 'replace',
      state: IDENTITY_STATE,
      snapshot: identities,
    }),
    syncMailboxes: async () => ({
      mode: 'replace',
      state: MAILBOX_STATE,
      snapshot: mailboxes,
    }),
    syncEmails: async () => ({
      mode: 'replace',
      state: EMAIL_STATE,
      snapshot: emails,
    }),
    queryMailbox: async (_accountId, mailboxId, _filter, options) => {
      const ordered = emails
        .filter((value) => value.mailboxIds.includes(mailboxId))
        .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      const position = options?.position ?? 0
      const page = ordered.slice(
        position,
        position + (options?.limit ?? ordered.length),
      )
      return {
        ids: page.map((value) => value.id),
        queryState: EMAIL_STATE,
        total: ordered.length,
        position,
        canCalculateChanges: true,
      }
    },
    fetchAttachments: async (_accountId, emailId) =>
      emailId === attachmentEmailId ? attachments : [],
  })
}

async function cacheCanonicalAttachment(
  remote: FakeRemoteMail | JmapRemoteMail,
  accountKey: AccountKey,
  syncPort: ReturnType<typeof createMemoryLocalEngine>['syncPort'],
): Promise<void> {
  const emailId = localEmailId(accountKey, attachmentEmailId)
  const remoteRefs = await remote.fetchAttachments(
    ACCOUNT_ID,
    attachmentEmailId,
  )
  unwrapOk(
    await syncPort.replaceAttachmentRefs(
      emailId,
      toDomainAttachmentRefs(accountKey, emailId, remoteRefs),
    ),
  )
}

function expectPresent<T>(
  value: Readonly<{ kind: 'absent' }> | Readonly<{ kind: 'present'; value: T }>,
): T {
  if (value.kind !== 'present') throw new Error('Expected present local entity')
  return value.value
}

async function projectAccountState(
  repository: ReadRepository,
  accountKey: AccountKey,
): Promise<unknown> {
  const identityRead = unwrapOk(await repository.listIdentities(accountKey))
  const mailboxRead = unwrapOk(await repository.listMailboxes(accountKey))
  if (identityRead.kind !== 'present' || mailboxRead.kind !== 'present') {
    throw new Error('Expected registered Account projections')
  }

  const projectedIdentities = identityRead.value
    .map((value) => ({
      id: value.id.jmapId,
      name: value.name,
      email: value.email,
      replyTo: value.replyTo,
      bcc: value.bcc,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  const projectedMailboxes = mailboxRead.value
    .map((value) => ({
      id: value.id.jmapId,
      name: value.name,
      parent: value.parent?.jmapId ?? null,
      role: value.role,
      sortOrder: value.sortOrder,
      totalEmails: value.totalEmails,
      unreadEmails: value.unreadEmails,
      rights: value.rights,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  const emailIds: ScopedEmailId[] = emails.map((value) =>
    localEmailId(accountKey, value.id),
  )
  const emailReads = unwrapOk(await repository.readEmails(emailIds))
  const projectedEmails = await Promise.all(
    emailReads.map(async (read) => {
      const value = expectPresent(read)
      const membershipRead = unwrapOk(
        await repository.readEmailMemberships(value.id),
      )
      if (membershipRead.kind !== 'present') {
        throw new Error('Expected Email membership snapshot')
      }
      const attachmentRead = unwrapOk(
        await repository.readAttachmentRefs(value.id),
      )
      return {
        id: value.id.jmapId,
        blobId: value.blobId.jmapId,
        threadId: value.threadId.jmapId,
        sender: value.sender,
        from: value.from,
        replyTo: value.replyTo,
        to: value.to,
        cc: value.cc,
        bcc: value.bcc,
        subject: value.subject,
        sentAt: value.sentAt,
        receivedAt: value.receivedAt,
        size: value.size,
        preview: value.preview,
        hasAttachment: value.hasAttachment,
        keywords: [...value.keywords].sort(),
        mailboxIds: membershipRead.value
          .map((membership) => membership.mailboxId.jmapId)
          .sort(),
        attachments:
          attachmentRead.kind === 'cached'
            ? attachmentRead.value.map((ref) => ({
                partId: ref.partId,
                blobId: ref.blobId.jmapId,
                name: ref.name,
                mediaType: ref.mediaType,
                size: ref.size,
                disposition: ref.disposition,
                cid: ref.cid,
              }))
            : attachmentRead.kind,
      }
    }),
  )
  projectedEmails.sort((left, right) => left.id.localeCompare(right.id))

  const views = await Promise.all(
    mailboxRead.value.map(async (mailbox) => {
      const spec = mailboxViewSpec(
        mailbox.id,
        mailboxViewFilterAll(),
        mailboxViewSort('descending'),
      )
      const read = unwrapOk(await repository.readMailboxView(spec))
      if (read.kind !== 'cached') throw new Error('Expected cached MailboxView')
      return {
        mailboxId: read.value.spec.mailboxId.jmapId,
        filter: read.value.spec.filter,
        sort: read.value.spec.sort,
        queryState: read.value.queryState,
        total: read.value.total,
        coverage: read.value.coverage,
        items: read.value.items.map((item) => ({
          position: item.position,
          emailId: item.emailId.jmapId,
        })),
      }
    }),
  )
  views.sort((left, right) => left.mailboxId.localeCompare(right.mailboxId))

  const cursors = await Promise.all(
    (['identity', 'mailbox', 'email'] as const).map(async (dataType) => {
      const read = unwrapOk(
        await repository.readCollectionSyncCursor(accountKey, dataType),
      )
      if (read.kind !== 'present')
        throw new Error(`Expected ${dataType} cursor`)
      return { dataType, state: read.value.state }
    }),
  )

  return {
    identities: projectedIdentities,
    mailboxes: projectedMailboxes,
    emails: projectedEmails,
    views,
    cursors,
  }
}

describe('TEST-DEBT-RB-01 — full metamorphic Domain projection', () => {
  it('HARD-RB01-01..06: FakeRemote and JMAP paths are exactly equivalent', async () => {
    const engineA = createMemoryLocalEngine()
    const engineB = createMemoryLocalEngine()
    try {
      const accountA = createTestAccount('metamorphic-full-A')
      const accountB = createTestAccount('metamorphic-full-B')
      unwrapOk(await engineA.syncPort.registerAccount(accountA))
      unwrapOk(await engineB.syncPort.registerAccount(accountB))

      const fakeRemote = directRemote()
      const jmapRemote = new JmapRemoteMail(new CanonicalJmapClient())
      await new Coordinator(
        fakeRemote,
        engineA.syncPort,
        engineA.readRepository,
      ).syncAccount(accountA.key, ACCOUNT_ID)
      await new Coordinator(
        jmapRemote,
        engineB.syncPort,
        engineB.readRepository,
      ).syncAccount(accountB.key, ACCOUNT_ID)
      await cacheCanonicalAttachment(fakeRemote, accountA.key, engineA.syncPort)
      await cacheCanonicalAttachment(jmapRemote, accountB.key, engineB.syncPort)

      const projectionA = await projectAccountState(
        engineA.readRepository,
        accountA.key,
      )
      const projectionB = await projectAccountState(
        engineB.readRepository,
        accountB.key,
      )

      expect(projectionA).toEqual(projectionB)
    } finally {
      await engineA.dispose()
      await engineB.dispose()
    }
  })
})

import { account, remoteAccountRef, type Account } from '../../domain/account'
import { emailAddress } from '../../domain/address'
import {
  attachmentPartIdFromString,
  attachmentRef,
  type AttachmentRef,
} from '../../domain/attachment-ref'
import { emailBody, type EmailBody } from '../../domain/email-body'
import { email, keywordSet, type Email } from '../../domain/email'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  mutationIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  scopedThreadId,
  serviceKeyFromString,
} from '../../domain/ids'
import { identity, type Identity } from '../../domain/identity'
import {
  emailMailbox,
  mailbox,
  mailboxRights,
  type EmailMailbox,
  type Mailbox,
} from '../../domain/mailbox'
import {
  mailboxView,
  mailboxViewCoverageRange,
  mailboxViewFilterAll,
  mailboxViewItem,
  mailboxViewQueryStateFromString,
  mailboxViewSort,
  mailboxViewSpec,
  type MailboxView,
  type MailboxViewSortSpec,
  type MailboxViewSpec,
} from '../../domain/mailbox-view'
import {
  keywordChange,
  keywordMutation,
  mailboxMembershipChange,
  mailboxMembershipMutation,
  mutationInstantFromString,
  sendMutation,
  type KeywordMutation,
  type MailboxMembershipMutation,
  type MutationInstant,
  type SendMutation,
} from '../../domain/pending-mutation'
import { sendIntent, type SendIntent } from '../../domain/send-intent'
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
  type CollectionDataType,
  type CollectionSyncCursor,
} from '../../domain/sync-cursor'

const TEST_CREATED_AT = '2026-01-01T00:00:00.000Z'

export type TestMailboxOptions = Readonly<{
  parent?: Mailbox | null
  role?: string | null
  sortOrder?: number
  totalEmails?: number
  unreadEmails?: number
}>

export type TestEmailOptions = Readonly<{
  subject?: string | null
  hasAttachment?: boolean
  keywords?: readonly string[]
}>

export type TestAttachmentOptions = Readonly<{
  blobToken?: string
  name?: string | null
  mediaType?: string
  size?: number
  disposition?: string | null
  cid?: string | null
}>

export type TestMailboxViewCoverageInput = Readonly<{
  start: number
  endExclusive: number
}>

export type TestMailboxViewItemInput = Readonly<{
  position: number
  email: Email
}>

export type TestMailboxViewInput = Readonly<{
  spec: MailboxViewSpec
  queryState: string
  total: number
  coverage: readonly TestMailboxViewCoverageInput[]
  items: readonly TestMailboxViewItemInput[]
}>

export type TestFixtureSet = Readonly<{
  accountA: Account
  accountB: Account
  inboxA: Mailbox
  archiveA: Mailbox
  inboxB: Mailbox
  identityA: Identity
  emailA1: Email
  emailA2: Email
  emailB1: Email
  membershipsA: readonly [EmailMailbox, EmailMailbox]
  standardBodyA1: EmailBody
  nullBodyA1: EmailBody
  emptyBodyA1: EmailBody
  attachmentsA1: readonly [AttachmentRef, AttachmentRef]
  inboxViewSpecA: MailboxViewSpec
  alternativeViewSpecA: MailboxViewSpec
  emptyInboxViewA: MailboxView
  partialInboxViewA: MailboxView
  disjointInboxViewA: MailboxView
  emailCursorA: CollectionSyncCursor
  mailboxCursorA: CollectionSyncCursor
  identityCursorA: CollectionSyncCursor
  emptyStateEmailCursorA: CollectionSyncCursor
  sendMutationA: SendMutation
  keywordMutationA: KeywordMutation
  membershipMutationA: MailboxMembershipMutation
}>

export function createTestAccount(token: string): Account {
  return account(
    accountKeyFromString(`account-${token}`),
    remoteAccountRef(
      serviceKeyFromString(`service-${token}`),
      jmapAccountIdFromString(`jmap-account-${token}`),
    ),
  )
}

export function createTestMailbox(
  owner: Account,
  token: string,
  options: TestMailboxOptions = {},
): Mailbox {
  return mailbox({
    id: scopedMailboxId(owner.key, jmapMailboxIdFromString(`mailbox-${token}`)),
    name: `mailbox-${token}`,
    parent: options.parent === undefined ? null : (options.parent?.id ?? null),
    role: options.role === undefined ? null : options.role,
    sortOrder: options.sortOrder ?? 0,
    totalEmails: options.totalEmails ?? 0,
    unreadEmails: options.unreadEmails ?? 0,
    rights: mailboxRights({
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      maySubmit: true,
    }),
  })
}

export function createTestIdentity(owner: Account, token: string): Identity {
  return identity({
    id: scopedIdentityId(
      owner.key,
      jmapIdentityIdFromString(`identity-${token}`),
    ),
    name: `Sender ${token}`,
    email: `sender-${token}@example.test`,
    replyTo: null,
    bcc: null,
  })
}

export function createTestEmail(
  owner: Account,
  token: string,
  options: TestEmailOptions = {},
): Email {
  const sender = emailAddress(`Sender ${token}`, `sender-${token}@example.test`)

  return email({
    id: scopedEmailId(owner.key, jmapEmailIdFromString(`email-${token}`)),
    blobId: scopedBlobId(
      owner.key,
      jmapBlobIdFromString(`email-blob-${token}`),
    ),
    threadId: scopedThreadId(
      owner.key,
      jmapThreadIdFromString(`thread-${token}`),
    ),
    sender: [sender],
    from: [sender],
    replyTo: null,
    to: [emailAddress(null, `recipient-${token}@example.test`)],
    cc: [],
    bcc: null,
    subject:
      options.subject === undefined ? `subject-${token}` : options.subject,
    sentAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:01:00.000Z',
    size: 1024,
    preview: `preview-${token}`,
    hasAttachment: options.hasAttachment ?? false,
    keywords: keywordSet(options.keywords ?? ['$seen', `custom-${token}`]),
  })
}

export function createTestEmailMailbox(
  ownerEmail: Email,
  ownerMailbox: Mailbox,
): EmailMailbox {
  return emailMailbox(ownerEmail.id, ownerMailbox.id)
}

export function createTestEmailBody(
  ownerEmail: Email,
  text: string | null,
  html: string | null,
): EmailBody {
  return emailBody({ emailId: ownerEmail.id, text, html })
}

export function createTestAttachmentRef(
  ownerEmail: Email,
  partId: string,
  options: TestAttachmentOptions = {},
): AttachmentRef {
  const blobToken = options.blobToken ?? partId

  return attachmentRef({
    emailId: ownerEmail.id,
    partId: attachmentPartIdFromString(partId),
    blobId: scopedBlobId(
      ownerEmail.id.accountKey,
      jmapBlobIdFromString(`attachment-blob-${blobToken}`),
    ),
    name:
      options.name === undefined ? `attachment-${partId}.bin` : options.name,
    mediaType: options.mediaType ?? 'application/octet-stream',
    size: options.size ?? 512,
    disposition:
      options.disposition === undefined ? 'attachment' : options.disposition,
    cid: options.cid === undefined ? null : options.cid,
  })
}

export function createTestMailboxViewSpec(
  ownerMailbox: Mailbox,
  direction: MailboxViewSortSpec['direction'] = 'descending',
): MailboxViewSpec {
  return mailboxViewSpec(
    ownerMailbox.id,
    mailboxViewFilterAll(),
    mailboxViewSort(direction),
  )
}

export function createTestMailboxView(
  input: TestMailboxViewInput,
): MailboxView {
  return mailboxView({
    spec: input.spec,
    queryState: mailboxViewQueryStateFromString(input.queryState),
    total: input.total,
    coverage: input.coverage.map((range) =>
      mailboxViewCoverageRange(range.start, range.endExclusive),
    ),
    items: input.items.map((item) =>
      mailboxViewItem(item.position, item.email.id),
    ),
  })
}

export function createTestCollectionSyncCursor(
  owner: Account,
  dataType: CollectionDataType,
  state: string,
): CollectionSyncCursor {
  return collectionSyncCursor({
    accountKey: owner.key,
    dataType,
    state: collectionSyncStateFromString(state),
  })
}

export function createTestMutationInstant(
  value: string = TEST_CREATED_AT,
): MutationInstant {
  return mutationInstantFromString(value)
}

export function createTestSendIntent(
  selectedIdentity: Identity,
  token: string,
): SendIntent {
  return sendIntent({
    securityMode: 'plain',
    identity: selectedIdentity,
    to: [emailAddress(`Recipient ${token}`, `recipient-${token}@example.test`)],
    cc: [],
    bcc: [],
    subject: `send-subject-${token}`,
    body: {
      text: `send-text-${token}`,
      html: `<p>send-html-${token}</p>`,
    },
  })
}

export function createTestSendMutation(
  owner: Account,
  selectedIdentity: Identity,
  token: string,
): SendMutation {
  return sendMutation({
    mutationId: mutationIdFromString(`mutation-send-${token}`),
    accountKey: owner.key,
    createdAt: createTestMutationInstant(),
    intent: createTestSendIntent(selectedIdentity, token),
  })
}

export function createTestKeywordMutation(
  owner: Account,
  ownerEmail: Email,
  token: string,
): KeywordMutation {
  return keywordMutation({
    mutationId: mutationIdFromString(`mutation-keyword-${token}`),
    accountKey: owner.key,
    createdAt: createTestMutationInstant(),
    emailId: ownerEmail.id,
    change: keywordChange({
      add: keywordSet(['$flagged']),
      remove: keywordSet(['$seen']),
    }),
  })
}

export function createTestMailboxMembershipMutation(
  owner: Account,
  ownerEmail: Email,
  token: string,
  add: readonly Mailbox[],
  remove: readonly Mailbox[],
): MailboxMembershipMutation {
  return mailboxMembershipMutation({
    mutationId: mutationIdFromString(`mutation-membership-${token}`),
    accountKey: owner.key,
    createdAt: createTestMutationInstant(),
    emailId: ownerEmail.id,
    change: mailboxMembershipChange({
      add: add.map((value) => value.id),
      remove: remove.map((value) => value.id),
    }),
  })
}

export function createTestFixtures(): TestFixtureSet {
  const accountA = createTestAccount('A')
  const accountB = createTestAccount('B')
  const inboxA = createTestMailbox(accountA, 'A-inbox', {
    role: 'inbox',
    totalEmails: 2,
    unreadEmails: 1,
  })
  const archiveA = createTestMailbox(accountA, 'A-archive', {
    role: 'archive',
    sortOrder: 1,
  })
  const inboxB = createTestMailbox(accountB, 'B-inbox', { role: 'inbox' })
  const identityA = createTestIdentity(accountA, 'A')
  const emailA1 = createTestEmail(accountA, 'E1', { hasAttachment: true })
  const emailA2 = createTestEmail(accountA, 'E2', { keywords: [] })
  const emailB1 = createTestEmail(accountB, 'E1')
  const inboxViewSpecA = createTestMailboxViewSpec(inboxA)
  const alternativeViewSpecA = createTestMailboxViewSpec(inboxA, 'ascending')

  return {
    accountA,
    accountB,
    inboxA,
    archiveA,
    inboxB,
    identityA,
    emailA1,
    emailA2,
    emailB1,
    membershipsA: [
      createTestEmailMailbox(emailA1, inboxA),
      createTestEmailMailbox(emailA2, inboxA),
    ],
    standardBodyA1: createTestEmailBody(
      emailA1,
      'body-text-A1',
      '<p>body-html-A1</p>',
    ),
    nullBodyA1: createTestEmailBody(emailA1, null, null),
    emptyBodyA1: createTestEmailBody(emailA1, '', ''),
    attachmentsA1: [
      createTestAttachmentRef(emailA1, 'part-1', {
        blobToken: 'shared-A1',
        name: 'attachment-A1-1.pdf',
        mediaType: 'application/pdf',
      }),
      createTestAttachmentRef(emailA1, 'part-2', {
        blobToken: 'shared-A1',
        name: null,
        disposition: '',
        cid: '',
      }),
    ],
    inboxViewSpecA,
    alternativeViewSpecA,
    emptyInboxViewA: createTestMailboxView({
      spec: inboxViewSpecA,
      queryState: 'view-state-empty',
      total: 10,
      coverage: [],
      items: [],
    }),
    partialInboxViewA: createTestMailboxView({
      spec: inboxViewSpecA,
      queryState: 'view-state-partial',
      total: 10,
      coverage: [{ start: 0, endExclusive: 2 }],
      items: [
        { position: 0, email: emailA1 },
        { position: 1, email: emailA2 },
      ],
    }),
    disjointInboxViewA: createTestMailboxView({
      spec: inboxViewSpecA,
      queryState: 'view-state-disjoint',
      total: 10,
      coverage: [
        { start: 0, endExclusive: 1 },
        { start: 3, endExclusive: 4 },
      ],
      items: [
        { position: 0, email: emailA1 },
        { position: 3, email: emailA2 },
      ],
    }),
    emailCursorA: createTestCollectionSyncCursor(
      accountA,
      'email',
      'email-state-1',
    ),
    mailboxCursorA: createTestCollectionSyncCursor(
      accountA,
      'mailbox',
      'mailbox-state-1',
    ),
    identityCursorA: createTestCollectionSyncCursor(
      accountA,
      'identity',
      'identity-state-1',
    ),
    emptyStateEmailCursorA: createTestCollectionSyncCursor(
      accountA,
      'email',
      '',
    ),
    sendMutationA: createTestSendMutation(accountA, identityA, 'A1'),
    keywordMutationA: createTestKeywordMutation(accountA, emailA1, 'A1'),
    membershipMutationA: createTestMailboxMembershipMutation(
      accountA,
      emailA1,
      'A1',
      [archiveA],
      [inboxA],
    ),
  }
}

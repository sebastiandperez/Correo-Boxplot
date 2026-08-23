export const IPC_PROTOCOL_VERSION = 1 as const

export type IpcScopedMailboxId = Readonly<{
  accountKey: string
  jmapMailboxId: string
}>
export type IpcScopedEmailId = Readonly<{
  accountKey: string
  jmapEmailId: string
}>
export type IpcScopedIdentityId = Readonly<{
  accountKey: string
  jmapIdentityId: string
}>
export type IpcScopedThreadId = Readonly<{
  accountKey: string
  jmapThreadId: string
}>
export type IpcScopedBlobId = Readonly<{
  accountKey: string
  jmapBlobId: string
}>

export type IpcEmailAddress = Readonly<{
  name: string | null
  email: string
}>
export type IpcEmailAddressList = readonly IpcEmailAddress[] | null

export type IpcRemoteAccountRef = Readonly<{
  serviceKey: string
  jmapAccountId: string
}>
export type IpcAccount = Readonly<{
  key: string
  remoteRef: IpcRemoteAccountRef
}>
export type IpcMailboxRights = Readonly<{
  mayReadItems: boolean
  mayAddItems: boolean
  mayRemoveItems: boolean
  maySetSeen: boolean
  maySetKeywords: boolean
  maySubmit: boolean
}>
export type IpcMailbox = Readonly<{
  id: IpcScopedMailboxId
  name: string
  parent: IpcScopedMailboxId | null
  role: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  rights: IpcMailboxRights
}>
export type IpcIdentity = Readonly<{
  id: IpcScopedIdentityId
  name: string
  email: string
  replyTo: IpcEmailAddressList
  bcc: IpcEmailAddressList
}>
export type IpcEmail = Readonly<{
  id: IpcScopedEmailId
  blobId: IpcScopedBlobId
  threadId: IpcScopedThreadId
  sender: IpcEmailAddressList
  from: IpcEmailAddressList
  replyTo: IpcEmailAddressList
  to: IpcEmailAddressList
  cc: IpcEmailAddressList
  bcc: IpcEmailAddressList
  subject: string | null
  sentAt: string | null
  receivedAt: string
  size: number
  preview: string
  hasAttachment: boolean
  keywords: readonly string[]
}>
export type IpcEmailMailbox = Readonly<{
  emailId: IpcScopedEmailId
  mailboxId: IpcScopedMailboxId
}>
export type IpcEmailBody = Readonly<{
  emailId: IpcScopedEmailId
  text: string | null
  html: string | null
}>
export type IpcAttachmentRef = Readonly<{
  emailId: IpcScopedEmailId
  partId: string
  blobId: IpcScopedBlobId
  name: string | null
  mediaType: string
  size: number
  disposition: string | null
  cid: string | null
}>

export type IpcMailboxViewFilterSpec = Readonly<{ kind: 'all' }>
export type IpcMailboxViewSortSpec = Readonly<{
  property: 'receivedAt'
  direction: 'ascending' | 'descending'
}>
export type IpcMailboxViewSpec = Readonly<{
  mailboxId: IpcScopedMailboxId
  filter: IpcMailboxViewFilterSpec
  sort: IpcMailboxViewSortSpec
}>
export type IpcMailboxViewCoverageRange = Readonly<{
  start: number
  endExclusive: number
}>
export type IpcMailboxViewItem = Readonly<{
  position: number
  emailId: IpcScopedEmailId
}>
export type IpcMailboxView = Readonly<{
  spec: IpcMailboxViewSpec
  queryState: string
  total: number
  coverage: readonly IpcMailboxViewCoverageRange[]
  items: readonly IpcMailboxViewItem[]
}>

export type IpcCollectionDataType = 'email' | 'mailbox' | 'identity'
export type IpcCollectionSyncCursor = Readonly<{
  accountKey: string
  dataType: IpcCollectionDataType
  state: string
}>
export type IpcCursorPrecondition =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'matches'; cursor: IpcCollectionSyncCursor }>

export type IpcSendBody = Readonly<{ text: string; html: string | null }>
export type IpcSendConfirmation = Readonly<{ emailId: IpcScopedEmailId }>
export type IpcSendIntent = Readonly<{
  identityId: IpcScopedIdentityId
  from: IpcEmailAddress
  replyTo: readonly IpcEmailAddress[]
  to: readonly IpcEmailAddress[]
  cc: readonly IpcEmailAddress[]
  bcc: readonly IpcEmailAddress[]
  subject: string
  body: IpcSendBody
}>
type IpcMutationLifecycleBase =
  | Readonly<{ status: 'pending'; attemptCount: 0 }>
  | Readonly<{ status: 'inFlight'; attemptCount: number }>
  | Readonly<{
      status: 'retrying'
      attemptCount: number
      nextAttemptAt: string
    }>
  | Readonly<{ status: 'failedTerminal'; attemptCount: number }>
export type IpcSendMutationLifecycle =
  | IpcMutationLifecycleBase
  | Readonly<{
      status: 'confirmed'
      attemptCount: number
      confirmation: IpcSendConfirmation
    }>
export type IpcEmailUpdateLifecycle =
  | IpcMutationLifecycleBase
  | Readonly<{ status: 'confirmed'; attemptCount: number }>
export type IpcSendMutation = Readonly<{
  kind: 'send'
  mutationId: string
  accountKey: string
  createdAt: string
  intent: IpcSendIntent
  lifecycle: IpcSendMutationLifecycle
}>
export type IpcKeywordMutation = Readonly<{
  kind: 'keyword'
  mutationId: string
  accountKey: string
  createdAt: string
  emailId: IpcScopedEmailId
  change: Readonly<{ add: readonly string[]; remove: readonly string[] }>
  lifecycle: IpcEmailUpdateLifecycle
}>
export type IpcMailboxMembershipMutation = Readonly<{
  kind: 'mailboxMembership'
  mutationId: string
  accountKey: string
  createdAt: string
  emailId: IpcScopedEmailId
  change: Readonly<{
    add: readonly IpcScopedMailboxId[]
    remove: readonly IpcScopedMailboxId[]
  }>
  lifecycle: IpcEmailUpdateLifecycle
}>
export type IpcPendingMutation =
  IpcSendMutation | IpcKeywordMutation | IpcMailboxMembershipMutation

export type IpcEmailSyncRecord = Readonly<{
  email: IpcEmail
  memberships: readonly IpcEmailMailbox[]
}>
export type IpcCollectionSyncCommit =
  | Readonly<{
      kind: 'email'
      mode: 'delta'
      expectedCursor: Extract<IpcCursorPrecondition, { kind: 'matches' }>
      nextCursor: IpcCollectionSyncCursor
      changed: readonly IpcEmailSyncRecord[]
      destroyed: readonly IpcScopedEmailId[]
    }>
  | Readonly<{
      kind: 'email'
      mode: 'replace'
      expectedCursor: IpcCursorPrecondition
      nextCursor: IpcCollectionSyncCursor
      snapshot: readonly IpcEmailSyncRecord[]
    }>
  | Readonly<{
      kind: 'mailbox'
      mode: 'delta'
      expectedCursor: Extract<IpcCursorPrecondition, { kind: 'matches' }>
      nextCursor: IpcCollectionSyncCursor
      changed: readonly IpcMailbox[]
      destroyed: readonly IpcScopedMailboxId[]
    }>
  | Readonly<{
      kind: 'mailbox'
      mode: 'replace'
      expectedCursor: IpcCursorPrecondition
      nextCursor: IpcCollectionSyncCursor
      snapshot: readonly IpcMailbox[]
    }>
  | Readonly<{
      kind: 'identity'
      mode: 'delta'
      expectedCursor: Extract<IpcCursorPrecondition, { kind: 'matches' }>
      nextCursor: IpcCollectionSyncCursor
      changed: readonly IpcIdentity[]
      destroyed: readonly IpcScopedIdentityId[]
    }>
  | Readonly<{
      kind: 'identity'
      mode: 'replace'
      expectedCursor: IpcCursorPrecondition
      nextCursor: IpcCollectionSyncCursor
      snapshot: readonly IpcIdentity[]
    }>

export type IpcLocalEntityRead<T> =
  Readonly<{ kind: 'absent' }> | Readonly<{ kind: 'present'; value: T }>
export type IpcOwnedSnapshotRead<T> =
  Readonly<{ kind: 'ownerAbsent' }> | Readonly<{ kind: 'present'; value: T }>
export type IpcOwnedOptionalRead<T> =
  | Readonly<{ kind: 'ownerAbsent' }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'present'; value: T }>
export type IpcOwnedCacheRead<T> =
  | Readonly<{ kind: 'ownerAbsent' }>
  | Readonly<{ kind: 'notCached' }>
  | Readonly<{ kind: 'cached'; value: T }>
export type IpcReadErrorKind = 'unavailable' | 'corruptState' | 'unexpected'
export type IpcWriteErrorKind = IpcReadErrorKind | 'conflict'
export type IpcResult<T, E extends string> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ kind: E }> }>
export type IpcReadResult<T> = IpcResult<T, IpcReadErrorKind>
export type IpcWriteResult = IpcResult<null, IpcWriteErrorKind>

export type IpcLocalChangeHint =
  | Readonly<{ kind: 'accounts' }>
  | Readonly<{
      kind: 'mailboxes' | 'identities' | 'emails' | 'emailMemberships'
      accountKey: string
    }>
  | Readonly<{
      kind: 'emailBody' | 'attachmentRefs'
      emailId: IpcScopedEmailId
    }>
  | Readonly<{ kind: 'mailboxView'; spec: IpcMailboxViewSpec }>
  | Readonly<{
      kind: 'syncCursor'
      accountKey: string
      dataType: IpcCollectionDataType
    }>
  | Readonly<{ kind: 'pendingMutations'; accountKey: string }>
export type IpcLocalChangeBatch = Readonly<{
  hints: readonly [IpcLocalChangeHint, ...IpcLocalChangeHint[]]
}>

export type IpcReadAccountRequest = Readonly<{ accountKey: string }>
export type IpcReadMailboxRequest = Readonly<{ mailboxId: IpcScopedMailboxId }>
export type IpcListOwnedRequest = Readonly<{ accountKey: string }>
export type IpcReadIdentityRequest = Readonly<{
  identityId: IpcScopedIdentityId
}>
export type IpcReadEmailRequest = Readonly<{ emailId: IpcScopedEmailId }>
export type IpcReadEmailsRequest = Readonly<{
  emailIds: readonly IpcScopedEmailId[]
}>
export type IpcReadMailboxViewRequest = Readonly<{
  spec: IpcMailboxViewSpec
}>
export type IpcReadCursorRequest = Readonly<{
  accountKey: string
  dataType: IpcCollectionDataType
}>
export type IpcReadMutationRequest = Readonly<{
  accountKey: string
  mutationId: string
}>
export type IpcRegisterAccountRequest = Readonly<{ account: IpcAccount }>
export type IpcApplyCollectionSyncRequest = Readonly<{
  commit: IpcCollectionSyncCommit
}>
export type IpcCacheEmailBodyRequest = Readonly<{ body: IpcEmailBody }>
export type IpcReplaceAttachmentRefsRequest = Readonly<{
  emailId: IpcScopedEmailId
  refs: readonly IpcAttachmentRef[]
}>
export type IpcReplaceMailboxViewRequest = Readonly<{
  view: IpcMailboxView
}>
export type IpcMutationRequest<T extends IpcPendingMutation> = Readonly<{
  mutation: T
}>
export type IpcReplaceMutationRequest = Readonly<{
  expected: IpcPendingMutation
  next: IpcPendingMutation
}>
export type IpcRemoveMutationRequest = IpcReadMutationRequest

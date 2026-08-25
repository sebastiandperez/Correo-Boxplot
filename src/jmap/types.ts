export type JmapEmailAddress = Readonly<{
  name: string | null
  email: string
}>

export type JmapEmailAddressList = readonly JmapEmailAddress[] | null

export type JmapMailboxRights = Readonly<{
  mayReadItems: boolean
  mayAddItems: boolean
  mayRemoveItems: boolean
  maySetSeen: boolean
  maySetKeywords: boolean
  maySubmit: boolean
}>

export type JmapMailbox = Readonly<{
  id: string
  name: string
  parent: string | null
  role: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  rights: JmapMailboxRights
}>

export type JmapEmail = Readonly<{
  id: string
  blobId: string
  threadId: string

  sender: JmapEmailAddressList
  from: JmapEmailAddressList
  replyTo: JmapEmailAddressList
  to: JmapEmailAddressList
  cc: JmapEmailAddressList
  bcc: JmapEmailAddressList

  subject: string | null
  sentAt: string | null
  receivedAt: string

  size: number
  preview: string
  hasAttachment: boolean

  keywords: Record<string, boolean>
}>

export type JmapEmailBody = Readonly<{
  emailId: string
  html: string | null
  text: string | null
}>

export type JmapAttachment = Readonly<{
  blobId: string
  partId: string | null
  name: string | null
  mediaType: string
  size: number
  disposition: string | null
  cid: string | null
}>

export type JmapQueryResult = Readonly<{
  ids: readonly string[]
  queryState: string
  total: number
  position: number
  canCalculateChanges: boolean
}>

export type QueryOptions = Readonly<{
  position?: number
  limit?: number
  anchor?: string
  anchorOffset?: number
}>

export type JmapQueryChanges = Readonly<{
  accountId: string
  oldQueryState: string
  newQueryState: string
  added: ReadonlyArray<Readonly<{ id: string; index: number }>>
  removed: readonly string[]
  total: number
}>

export type JmapDelta = Readonly<{
  accountId: string
  oldState: string
  newState: string
  hasMoreChanges: boolean
  created: readonly string[]
  updated: readonly string[]
  destroyed: readonly string[]
}>

export type JmapIdentity = Readonly<{
  id: string
  name: string
  email: string
  replyTo: readonly JmapEmailAddress[] | null
  bcc: readonly JmapEmailAddress[] | null
  htmlSignature: string
  textSignature: string
}>

export type JmapEmailDraft = Readonly<{
  from: readonly JmapEmailAddress[]
  to: readonly JmapEmailAddress[]
  cc: readonly JmapEmailAddress[]
  bcc: readonly JmapEmailAddress[]
  replyTo: readonly JmapEmailAddress[]
  subject: string
  textBody: string | null
  htmlBody: string | null
}>

export type JmapStateChange = Readonly<{
  changed: Record<string, Record<string, string>>
}>

export type JmapSession = Readonly<{
  apiUrl: string
  downloadUrl: string
  uploadUrl: string
  eventSourceUrl: string
  /**
   * WebSocket push endpoint (RFC 8887), extracted from
   * capabilities['urn:ietf:params:jmap:websocket'].url — see ADR-006.
   * null when the server does not advertise the websocket capability.
   */
  webSocketUrl: string | null
  primaryAccounts: Record<string, string>
  capabilities: Record<string, unknown>
}>

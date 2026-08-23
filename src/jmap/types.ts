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
  id: string // jmapMailboxId
  name: string
  parent: string | null
  role: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  rights: JmapMailboxRights
}>

export type JmapEmail = Readonly<{
  id: string // jmapEmailId
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

  keywords: ReadonlySet<string> | Record<string, boolean> // JMAP typically represents keywords as an object { [keyword]: true }
}>

export type JmapEmailBody = Readonly<{
  emailId: string
  html: string | null
  text: string | null
}>

export type JmapAttachment = Readonly<{
  blobId: string
  name: string | null
  type: string
  size: number
  cid: string | null
  isInline: boolean
}>

export type JmapDelta = Readonly<{
  accountId: string
  oldState: string
  newState: string
  hasMoreChanges: boolean
  created: readonly string[] // emailIds
  updated: readonly string[] // emailIds
  destroyed: readonly string[] // emailIds
}>

export type JmapStateChange = Readonly<{
  changed: Record<string, Record<string, string>> // { accountId: { type: state } }
}>

export type JmapSession = Readonly<{
  apiUrl: string
  downloadUrl: string
  uploadUrl: string
  eventSourceUrl: string
  primaryAccounts: Record<string, string> // { capability: accountId }
  capabilities: Record<string, any>
}>

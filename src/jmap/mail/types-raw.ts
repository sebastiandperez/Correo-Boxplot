export interface RawJmapMailboxRights {
  mayReadItems: boolean
  mayAddItems: boolean
  mayRemoveItems: boolean
  maySetSeen: boolean
  maySetKeywords: boolean
  maySubmit: boolean
}

export interface RawJmapMailbox {
  id: string
  name: string
  parentId: string | null
  role: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  myRights: RawJmapMailboxRights
}

export interface RawJmapEmailAddress {
  name: string | null
  email: string
}

export interface RawJmapEmail {
  id: string
  blobId: string
  threadId: string

  sender: RawJmapEmailAddress[] | null
  from: RawJmapEmailAddress[] | null
  replyTo: RawJmapEmailAddress[] | null
  to: RawJmapEmailAddress[] | null
  cc: RawJmapEmailAddress[] | null
  bcc: RawJmapEmailAddress[] | null

  subject: string | null
  sentAt: string | null
  receivedAt: string

  size: number
  preview: string
  hasAttachment: boolean

  keywords: Record<string, boolean>
}

export interface RawJmapQueryResponse {
  accountId: string
  queryState: string
  canCalculateChanges: boolean
  position: number
  ids: string[]
  total: number
  limit?: number
}

export interface RawJmapChangesResponse {
  accountId: string
  oldState: string
  newState: string
  hasMoreChanges: boolean
  created: string[]
  updated: string[]
  destroyed: string[]
}

export interface RawJmapSetError {
  type?: string
  description?: string
}

export interface RawJmapSetResponse {
  created?: Record<string, { id?: string }>
  notCreated?: Record<string, RawJmapSetError>
  notUpdated?: Record<string, RawJmapSetError>
}

export interface RawJmapEmailBodyPart {
  partId?: string
  blobId?: string
  size?: number
  name?: string
  type: string
  charset?: string
  disposition?: string
  cid?: string
  language?: string[]
  location?: string
  subParts?: RawJmapEmailBodyPart[]
}

export interface RawJmapEmailBodyValue {
  value: string
  isEncodingProblem?: boolean
  isTruncated?: boolean
}

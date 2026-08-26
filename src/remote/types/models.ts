import type {
  RemoteBlobId,
  RemoteEmailId,
  RemoteIdentityId,
  RemoteMailboxId,
  RemoteThreadId,
} from './ids'

export type RemoteAddress = Readonly<{
  name: string | null
  email: string
}>

export type RemoteAddressList = readonly RemoteAddress[] | null

export type RemoteMailboxRights = Readonly<{
  mayReadItems: boolean
  mayAddItems: boolean
  mayRemoveItems: boolean
  maySetSeen: boolean
  maySetKeywords: boolean
  maySubmit: boolean
}>

export type RemoteIdentity = Readonly<{
  id: RemoteIdentityId
  name: string
  email: string
  replyTo: RemoteAddressList
  bcc: RemoteAddressList
}>

export type RemoteMailbox = Readonly<{
  id: RemoteMailboxId
  name: string
  parent: RemoteMailboxId | null
  role: string | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  rights: RemoteMailboxRights
}>

export type RemoteEmail = Readonly<{
  id: RemoteEmailId
  blobId: RemoteBlobId
  threadId: RemoteThreadId
  sender: RemoteAddressList
  from: RemoteAddressList
  replyTo: RemoteAddressList
  to: RemoteAddressList
  cc: RemoteAddressList
  bcc: RemoteAddressList
  subject: string | null
  sentAt: string | null
  receivedAt: string
  size: number
  preview: string
  hasAttachment: boolean
  keywords: ReadonlySet<string>
  mailboxIds: readonly RemoteMailboxId[]
}>

export type RemoteAttachment = Readonly<{
  blobId: RemoteBlobId
  partId: string | null
  name: string | null
  mediaType: string
  size: number
  disposition: string | null
  cid: string | null
}>

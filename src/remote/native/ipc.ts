import type {
  OperationOutcome,
  RemoteErrorKind,
  RetryDisposition,
  SessionDisposition,
} from '../errors'

export type NativeMailErrorDto = Readonly<{
  kind: RemoteErrorKind
  retry: RetryDisposition
  session: SessionDisposition
  outcome: OperationOutcome
  code?: string
}>

export type NativeMailOpenRequest = Readonly<{
  host: string
  username: string
  password: string
  imapPort: number
  smtpPort: number
}>

export type NativeMailOpenResponse = Readonly<{
  sessionId: string
  authenticatedUser: string
}>

export type NativeAddressDto = Readonly<{ name: string | null; email: string }>
export type NativeMailboxDto = Readonly<{
  name: string
  messages: number
  unseen: number
  uidValidity: number
  uidNext: number
}>
export type NativeMessageMetadataDto = Readonly<{
  mailbox: string
  uidValidity: number
  uid: number
  flags: readonly string[]
  internalDate: string
  size: number
  sender: readonly NativeAddressDto[] | null
  from: readonly NativeAddressDto[] | null
  replyTo: readonly NativeAddressDto[] | null
  to: readonly NativeAddressDto[] | null
  cc: readonly NativeAddressDto[] | null
  bcc: readonly NativeAddressDto[] | null
  subject: string | null
  sentAt: string | null
  preview: string
  hasAttachment: boolean
}>
export type NativeMailboxSnapshotDto = Readonly<{
  mailbox: NativeMailboxDto
  messages: readonly NativeMessageMetadataDto[]
}>
export type NativeBodyDto =
  | Readonly<{ kind: 'plain'; text: string | null; html: string | null }>
  | Readonly<{ kind: 'boxplotE2ee'; payload: string }>
export type NativeAttachmentDto = Readonly<{
  partId: string
  name: string | null
  mediaType: string
  size: number
  disposition: string | null
  cid: string | null
}>
export type NativeMessageRequest = Readonly<{
  sessionId: string
  mailbox: string
  uidValidity: number
  uid: number
}>
export type NativeFindMessageIdRequest = Readonly<{
  sessionId: string
  mailbox: string
  messageId: string
}>
export type NativeFoundEmailIdDto = Readonly<{
  mailbox: string
  uidValidity: number
  uid: number
}>
export type NativeFindMessageIdResponse =
  | Readonly<{ kind: 'notFound' }>
  | Readonly<{ kind: 'found'; emailId: NativeFoundEmailIdDto }>
  | Readonly<{ kind: 'ambiguous' }>
export type NativeFlag = 'seen' | 'flagged'
export type NativeStoreFlagsRequest = NativeMessageRequest &
  Readonly<{ add: readonly NativeFlag[]; remove: readonly NativeFlag[] }>
export type NativeMoveRequest = NativeMessageRequest &
  Readonly<{ destinationMailbox: string }>
export type NativeMoveResponse = Readonly<{
  sourceMailbox: string
  sourceUidValidity: number
  sourceUid: number
  destinationMailbox: string
  destinationUid: number
}>
export type NativeSubmissionBodyDto =
  | Readonly<{ kind: 'plain'; text: string; html: string | null }>
  | Readonly<{ kind: 'boxplotE2ee'; payload: string }>
export type NativeSmtpSubmitRequest = Readonly<{
  sessionId: string
  from: NativeAddressDto
  to: readonly NativeAddressDto[]
  cc: readonly NativeAddressDto[]
  bcc: readonly NativeAddressDto[]
  replyTo: readonly NativeAddressDto[]
  subject: string
  body: NativeSubmissionBodyDto
  idempotencyKey: string
}>
export type NativeSmtpSubmitResponse = Readonly<{
  accepted: true
  receiptId: string
}>

export interface NativeMailIpcPort {
  open(request: NativeMailOpenRequest): Promise<NativeMailOpenResponse>
  close(sessionId: string): Promise<void>
  listMailboxes(sessionId: string): Promise<readonly NativeMailboxDto[]>
  snapshotMailbox(
    sessionId: string,
    mailbox: string,
  ): Promise<NativeMailboxSnapshotDto>
  fetchBody(request: NativeMessageRequest): Promise<NativeBodyDto>
  fetchAttachments(
    request: NativeMessageRequest,
  ): Promise<readonly NativeAttachmentDto[]>
  findMessageId(
    request: NativeFindMessageIdRequest,
  ): Promise<NativeFindMessageIdResponse>
  storeFlags(request: NativeStoreFlagsRequest): Promise<void>
  move(request: NativeMoveRequest): Promise<NativeMoveResponse>
  smtpSubmit(
    request: NativeSmtpSubmitRequest,
  ): Promise<NativeSmtpSubmitResponse>
}

import type { RemoteAccountId, RemoteAddress, RemoteIdentityId } from './types'

export type SubmissionBody =
  | Readonly<{
      kind: 'plain'
      text: string
      html: string | null
    }>
  | Readonly<{
      kind: 'boxplotE2ee'
      payload: string
    }>

export type SubmissionMessage = Readonly<{
  remoteAccountId: RemoteAccountId
  remoteIdentityId: RemoteIdentityId | null
  from: RemoteAddress
  to: readonly RemoteAddress[]
  cc: readonly RemoteAddress[]
  bcc: readonly RemoteAddress[]
  replyTo: readonly RemoteAddress[]
  subject: string
  body: SubmissionBody
}>

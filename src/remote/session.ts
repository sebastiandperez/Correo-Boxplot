import type { RemoteMail } from './mail'
import type { Submission } from './submission'
import type { RemoteAccountId } from './types'

export type RemoteAccountDescriptor = Readonly<{
  id: RemoteAccountId
  capabilities: readonly string[]
}>

export interface RemoteSession {
  readonly accounts: readonly RemoteAccountDescriptor[]
  readonly mail: RemoteMail
  readonly submission: Submission
  close(): Promise<void>
}

import type { RemoteSession } from './session'

export interface RemoteConnection {
  open(): Promise<RemoteSession>
}

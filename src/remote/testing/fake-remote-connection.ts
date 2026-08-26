import type { RemoteConnection } from '../connection'
import type { RemoteSession } from '../session'

export class FakeRemoteConnection implements RemoteConnection {
  constructor(private readonly session: RemoteSession) {}

  open(): Promise<RemoteSession> {
    return Promise.resolve(this.session)
  }
}

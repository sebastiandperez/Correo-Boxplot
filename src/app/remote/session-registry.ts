import type { AccountKey } from '../../domain/ids'
import type { RemoteAccountId } from '../../remote/types'
import type { RemoteSession } from '../../remote/session'
import type { Coordinator } from '../../sync/coordinator'

export type ActiveRemoteAccount = Readonly<{
  accountKey: AccountKey
  remoteAccountId: RemoteAccountId
  session: RemoteSession
  coordinator: Coordinator
  generation: number
}>

export class RemoteSessionRegistry {
  private readonly entries = new Map<AccountKey, ActiveRemoteAccount>()

  get(accountKey: AccountKey): ActiveRemoteAccount | undefined {
    return this.entries.get(accountKey)
  }

  set(entry: ActiveRemoteAccount): void {
    this.entries.set(entry.accountKey, entry)
  }

  delete(accountKey: AccountKey): ActiveRemoteAccount | undefined {
    const entry = this.entries.get(accountKey)
    this.entries.delete(accountKey)
    return entry
  }

  drain(): readonly ActiveRemoteAccount[] {
    const entries = [...this.entries.values()]
    this.entries.clear()
    return entries
  }
}

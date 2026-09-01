import type { Account } from '../domain/account'
import type { LocalState } from './stores/runtime'

export type RootViewMode = 'boot' | 'localError' | 'setup' | 'shell'

/** Local durable Accounts, rather than remote session state, own root routing. */
export function rootViewMode(
  local: LocalState,
  accounts: readonly Account[],
): RootViewMode {
  if (local === 'opening') return 'boot'
  if (local === 'error') return 'localError'
  return accounts.length === 0 ? 'setup' : 'shell'
}

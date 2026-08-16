import type { AccountKey, JmapAccountId, ServiceKey } from './ids'

export type RemoteAccountRef = Readonly<{
  serviceKey: ServiceKey
  jmapAccountId: JmapAccountId
}>

export type Account = Readonly<{
  key: AccountKey
  remoteRef: RemoteAccountRef
}>

export function remoteAccountRef(
  serviceKey: ServiceKey,
  jmapAccountId: JmapAccountId,
): RemoteAccountRef {
  return { serviceKey, jmapAccountId }
}

export function account(key: AccountKey, remoteRef: RemoteAccountRef): Account {
  return { key, remoteRef }
}

export function sameRemoteAccountRef(
  left: RemoteAccountRef,
  right: RemoteAccountRef,
): boolean {
  return (
    left.serviceKey === right.serviceKey &&
    left.jmapAccountId === right.jmapAccountId
  )
}

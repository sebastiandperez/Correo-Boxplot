import type { RuntimeState } from './stores/runtime'

export type ConnectionStatusKind =
  'local' | 'connecting' | 'online' | 'offline' | 'expired' | 'localError'

export type ConnectionStatusView = Readonly<{
  kind: ConnectionStatusKind
  label: string
  canReconnect: boolean
  reconnectLabel: string | null
}>

/** A pure presentation projection; remote capability never owns local routing. */
export function connectionStatusView(
  runtime: Pick<RuntimeState, 'local' | 'auth' | 'connectivity'>,
): ConnectionStatusView {
  if (runtime.local === 'error') {
    return {
      kind: 'localError',
      label: 'Error local',
      canReconnect: false,
      reconnectLabel: null,
    }
  }
  if (runtime.auth === 'authenticating') {
    return {
      kind: 'connecting',
      label: 'Conectando…',
      canReconnect: false,
      reconnectLabel: null,
    }
  }
  if (runtime.auth === 'expired') {
    return {
      kind: 'expired',
      label: 'Sesión vencida',
      canReconnect: true,
      reconnectLabel: 'Reconectar',
    }
  }
  if (runtime.auth === 'authenticated' && runtime.connectivity === 'online') {
    return {
      kind: 'online',
      label: 'En línea',
      canReconnect: false,
      reconnectLabel: null,
    }
  }
  if (runtime.auth === 'authenticated') {
    return {
      kind: 'offline',
      label: 'Sin conexión',
      canReconnect: false,
      reconnectLabel: null,
    }
  }
  return {
    kind: 'local',
    label: 'Local',
    canReconnect: true,
    reconnectLabel: 'Conectar para sincronizar',
  }
}

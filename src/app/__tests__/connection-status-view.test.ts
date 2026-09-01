import { describe, expect, it } from 'vitest'

import { connectionStatusView } from '../connection-status-view'

describe('connection status presentation projection', () => {
  it.each([
    [
      { local: 'error', auth: 'anonymous', connectivity: 'offline' },
      'localError',
      'Error local',
      false,
    ],
    [
      { local: 'ready', auth: 'anonymous', connectivity: 'offline' },
      'local',
      'Local',
      true,
    ],
    [
      { local: 'ready', auth: 'authenticating', connectivity: 'offline' },
      'connecting',
      'Conectando…',
      false,
    ],
    [
      { local: 'ready', auth: 'authenticated', connectivity: 'online' },
      'online',
      'En línea',
      false,
    ],
    [
      { local: 'ready', auth: 'authenticated', connectivity: 'offline' },
      'offline',
      'Sin conexión',
      false,
    ],
    [
      { local: 'ready', auth: 'expired', connectivity: 'offline' },
      'expired',
      'Sesión vencida',
      true,
    ],
  ] as const)('STATUS projects %o', (runtime, kind, label, canReconnect) => {
    expect(connectionStatusView(runtime)).toMatchObject({
      kind,
      label,
      canReconnect,
    })
  })
})

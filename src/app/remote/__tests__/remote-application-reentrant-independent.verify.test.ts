import { describe, expect, it, vi } from 'vitest'

import { createMemoryLocalEngine } from '../../../adapters/memory'
import { accountKeyFromString, serviceKeyFromString } from '../../../domain/ids'
import type { RemoteMail } from '../../../remote/mail'
import type { RemoteSession } from '../../../remote/session'
import type { Submission } from '../../../remote/submission'
import { DefaultRemoteApplication } from '../remote-application'

const ACCOUNT_KEY = accountKeyFromString('verify-reentrant-account')
const SERVICE_KEY = serviceKeyFromString('verify-reentrant-service')
const CONFIG = {
  provider: 'jmap' as const,
  sessionUrl: 'https://verify.invalid/.well-known/jmap',
}

function inertSession(onClose: () => void): RemoteSession {
  return {
    accounts: [],
    mail: {} as RemoteMail,
    submission: {} as Submission,
    async close(): Promise<void> {
      onClose()
    },
  }
}

describe('RemoteApplication independent reentrant lifecycle verification', () => {
  it('verifies remote open does not begin after an authenticating listener disconnects', async () => {
    const local = createMemoryLocalEngine()
    const timeline: string[] = []
    const close = vi.fn()
    const session = inertSession(close)
    let disconnect: Promise<void> | undefined

    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => {
        timeline.push('factory')
        return {
          async open(): Promise<RemoteSession> {
            timeline.push('open')
            return session
          },
        }
      },
    })

    application.subscribe(ACCOUNT_KEY, (status) => {
      if (status.auth !== 'authenticating') return
      timeline.push('listener-authenticating')
      disconnect = application.disconnect(ACCOUNT_KEY)
      timeline.push('listener-after-disconnect-call')
    })

    const connecting = application.connect({
      accountKey: ACCOUNT_KEY,
      serviceKey: SERVICE_KEY,
      config: CONFIG,
    })

    expect(timeline).toEqual([
      'listener-authenticating',
      'listener-after-disconnect-call',
    ])
    await expect(disconnect).resolves.toBeUndefined()
    await expect(connecting).rejects.toMatchObject({ kind: 'cancelled' })
    expect(close).not.toHaveBeenCalled()
    expect(application.getStatus(ACCOUNT_KEY)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
    await expect(
      local.readRepository.readAccount(ACCOUNT_KEY),
    ).resolves.toEqual({
      ok: true,
      value: { kind: 'absent' },
    })
  })

  it('verifies remote open does not begin after an authenticating listener disposes', async () => {
    const local = createMemoryLocalEngine()
    const timeline: string[] = []
    const close = vi.fn()
    const session = inertSession(close)
    let disposing: Promise<void> | undefined

    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => {
        timeline.push('factory')
        return {
          async open(): Promise<RemoteSession> {
            timeline.push('open')
            return session
          },
        }
      },
    })

    application.subscribe(ACCOUNT_KEY, (status) => {
      if (status.auth !== 'authenticating') return
      timeline.push('listener-authenticating')
      disposing = application.dispose()
      timeline.push('listener-after-dispose-call')
    })

    const connecting = application.connect({
      accountKey: ACCOUNT_KEY,
      serviceKey: SERVICE_KEY,
      config: CONFIG,
    })

    expect(timeline).toEqual([
      'listener-authenticating',
      'listener-after-dispose-call',
    ])
    await expect(disposing).resolves.toBeUndefined()
    await expect(connecting).rejects.toMatchObject({ kind: 'cancelled' })
    expect(close).not.toHaveBeenCalled()
    expect(application.getStatus(ACCOUNT_KEY)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
    await expect(
      application.connect({
        accountKey: ACCOUNT_KEY,
        serviceKey: SERVICE_KEY,
        config: CONFIG,
      }),
    ).rejects.toMatchObject({ kind: 'disposed' })
    await expect(
      local.readRepository.readAccount(ACCOUNT_KEY),
    ).resolves.toEqual({
      ok: true,
      value: { kind: 'absent' },
    })
  })
})

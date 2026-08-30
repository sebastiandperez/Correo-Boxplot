import { describe, expect, it } from 'vitest'

import { createMemoryLocalEngine } from '../../../adapters/memory'
import { accountKeyFromString, serviceKeyFromString } from '../../../domain/ids'
import { RemoteError } from '../../../remote/errors'
import type { RemoteSession } from '../../../remote/session'
import { remoteAccountIdFromString } from '../../../remote/types'
import { DefaultRemoteApplication } from '../remote-application'
import type { RemoteAccountStatus } from '../types'
import {
  VerificationMail,
  VerificationSession,
  VERIFY_CONFIG,
} from './independent-remote-harness'

type ModelAccount = {
  active: boolean
  status: RemoteAccountStatus
  mail: VerificationMail | null
}

const DISCONNECTED: RemoteAccountStatus = {
  auth: 'anonymous',
  connectivity: 'offline',
  lastError: null,
}

function copy(status: RemoteAccountStatus): RemoteAccountStatus {
  return { ...status }
}

describe('RemoteApplication independent deterministic model verification', () => {
  it('matches a verifier-owned two-account lifecycle model after every operation', async () => {
    const local = createMemoryLocalEngine()
    const accountKeys = [
      accountKeyFromString('model-account-a'),
      accountKeyFromString('model-account-b'),
    ] as const
    const serviceKeys = [
      serviceKeyFromString('model-service-a'),
      serviceKeyFromString('model-service-b'),
    ] as const
    const remoteIds = [
      remoteAccountIdFromString('model-remote-a'),
      remoteAccountIdFromString('model-remote-b'),
    ] as const
    const models: ModelAccount[] = accountKeys.map(() => ({
      active: false,
      status: copy(DISCONNECTED),
      mail: null,
    }))
    const sessions: VerificationSession[][] = [[], []]
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: (config) => ({
        async open(): Promise<RemoteSession> {
          const index =
            config.provider === 'imapSmtp' && config.username === 'model-a'
              ? 0
              : 1
          const mail = new VerificationMail()
          const session = new VerificationSession(remoteIds[index], mail)
          models[index].mail = mail
          sessions[index].push(session)
          return session
        },
      }),
    })

    let seed = 0x5eed1234
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed
    }

    for (let step = 0; step < 80; step += 1) {
      const index = next() % 2
      const operation = next() % 6
      const model = models[index]
      const accountKey = accountKeys[index]
      const connectRequest = {
        accountKey,
        serviceKey: serviceKeys[index],
        config: {
          ...VERIFY_CONFIG,
          username: index === 0 ? 'model-a' : 'model-b',
        },
      } as const

      switch (operation) {
        case 0:
          if (model.active) {
            await expect(
              application.connect(connectRequest),
            ).rejects.toMatchObject({
              kind: 'busy',
            })
          } else {
            await expect(application.connect(connectRequest)).resolves.toEqual({
              accountKey,
            })
            model.active = true
            model.status = {
              auth: 'authenticated',
              connectivity: 'online',
              lastError: null,
            }
          }
          break
        case 1:
          await expect(
            application.disconnect(accountKey),
          ).resolves.toBeUndefined()
          model.active = false
          model.status = copy(DISCONNECTED)
          break
        case 2:
          if (model.active) {
            model.mail!.syncFailure = null
            await expect(
              application.refreshAccount(accountKey),
            ).resolves.toBeUndefined()
            model.status = {
              auth: 'authenticated',
              connectivity: 'online',
              lastError: null,
            }
          } else {
            await expect(
              application.refreshAccount(accountKey),
            ).rejects.toMatchObject({
              kind: 'notConnected',
            })
          }
          break
        case 3:
          if (model.active) {
            model.mail!.syncFailure = new RemoteError('model network', {
              kind: 'network',
              retry: 'safeBackoff',
              session: 'keep',
              outcome: 'notApplicable',
            })
            await expect(
              application.refreshAccount(accountKey),
            ).rejects.toMatchObject({
              kind: 'network',
            })
            model.status = {
              auth: 'authenticated',
              connectivity: 'offline',
              lastError: 'network',
            }
          } else {
            await expect(
              application.refreshAccount(accountKey),
            ).rejects.toMatchObject({
              kind: 'notConnected',
            })
          }
          break
        case 4:
          if (model.active) {
            model.mail!.syncFailure = new RemoteError('model expiry', {
              kind: 'auth',
              retry: 'never',
              session: 'expire',
              outcome: 'notApplicable',
            })
            await expect(
              application.refreshAccount(accountKey),
            ).rejects.toMatchObject({
              kind: 'auth',
            })
            model.active = false
            model.status = {
              auth: 'expired',
              connectivity: 'online',
              lastError: 'auth',
            }
          } else {
            await expect(
              application.refreshAccount(accountKey),
            ).rejects.toMatchObject({
              kind: 'notConnected',
            })
          }
          break
        case 5:
          if (model.active) {
            model.mail!.syncFailure = new RemoteError('model protocol', {
              kind: 'protocol',
              retry: 'never',
              session: 'keep',
              outcome: 'notApplicable',
            })
            await expect(
              application.refreshAccount(accountKey),
            ).rejects.toMatchObject({
              kind: 'remote',
            })
            model.status = {
              auth: 'authenticated',
              connectivity: 'online',
              lastError: 'remote',
            }
          } else {
            await expect(
              application.refreshAccount(accountKey),
            ).rejects.toMatchObject({
              kind: 'notConnected',
            })
          }
          break
      }

      for (let account = 0; account < accountKeys.length; account += 1) {
        expect(
          application.getStatus(accountKeys[account]),
          `step ${step}`,
        ).toEqual(models[account].status)
      }
    }

    await application.dispose()
    expect(sessions.flat().every((session) => session.closeCalls <= 1)).toBe(
      true,
    )
    for (const key of accountKeys) {
      expect(application.getStatus(key)).toEqual(DISCONNECTED)
    }
  })
})

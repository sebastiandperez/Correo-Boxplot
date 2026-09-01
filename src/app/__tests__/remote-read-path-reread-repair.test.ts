import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadRepository } from '../../ports/read-repository'
import {
  createApplicationContext,
  createMailApplicationController,
} from '../application'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'
import { createSeededMemoryApplication } from './application-fixture'

describe('remote read path local reread repair', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('REPAIR-BODY-01 returns a local failure when materialization succeeds but P-01 cannot reread', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    let bodyReadsForA2 = 0
    const readRepository = Object.assign(Object.create(engine.readRepository), {
      readEmailBody: async (emailId: typeof fixtures.emailA2.id) => {
        if (emailId.jmapId === fixtures.emailA2.id.jmapId) {
          bodyReadsForA2 += 1
          if (bodyReadsForA2 > 1) {
            return { ok: false as const, error: { kind: 'unexpected' } }
          }
        }
        return engine.readRepository.readEmailBody(emailId)
      },
    }) as ReadRepository
    const materialize = vi.fn(async () => 'materialized' as const)
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        readRepository,
        bodyMaterializer: { materialize },
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()

    await controller.selectEmail(fixtures.emailA2.id)
    const result = await controller.materializeBody(fixtures.emailA2.id)

    expect(materialize).toHaveBeenCalledOnce()
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'local',
        message: 'No se pudo guardar o leer el contenido local.',
      },
    })
    expect(useMailStore().bodyLoadState).toBe('notCached')
    expect(useMailStore().emailBody).toBeNull()
    expect(useMailStore().bodyError).toBe(
      'No se pudo guardar o leer el contenido local.',
    )
    expect(useRuntimeStore().local).toBe('ready')
    controller.dispose()
  })
})

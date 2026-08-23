import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createApplicationContext,
  createMailApplicationController,
} from '../application'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'
import { createSeededMemoryApplication } from './application-fixture'

describe('Memory Local Engine application integration (non-A-08)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('projects the portable in-memory implementation through Application', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const controller = createMailApplicationController(
      createApplicationContext(engine),
      useMailStore(),
      useRuntimeStore(),
    )

    await controller.initialize()

    expect(useMailStore().selectedAccountKey).toBe(fixtures.accountA.key)
    expect(useMailStore().selectedMailboxId).toEqual(fixtures.inboxA.id)
    expect(useMailStore().emails).toHaveLength(2)
    expect(useMailStore().emailBody?.html).toContain('body-html-A1')
    controller.dispose()
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createApplicationContext,
  createMailApplicationController,
} from '../application'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'
import { createSeededMemoryApplication } from './application-fixture'

describe('local-first Application orchestration', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('requires and preserves explicit Port dependencies', async () => {
    const { engine } = await createSeededMemoryApplication()
    const context = createApplicationContext(engine)

    expect(context.readRepository).toBe(engine.readRepository)
    expect(context.syncPort).toBe(engine.syncPort)
    expect(context.localChangeSource).toBe(engine.localChangeSource)
  })

  it('subscribes before reading and projects the complete cached window', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const subscribe = vi.spyOn(engine.localChangeSource, 'subscribe')
    const listAccounts = vi.spyOn(engine.readRepository, 'listAccounts')
    const controller = createMailApplicationController(
      createApplicationContext(engine),
      useMailStore(),
      useRuntimeStore(),
    )

    await controller.initialize()

    expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      listAccounts.mock.invocationCallOrder[0],
    )
    expect(useRuntimeStore().local).toBe('ready')
    expect(useMailStore().accounts).toEqual([fixtures.accountA])
    expect(useMailStore().mailboxes).toEqual([
      fixtures.inboxA,
      fixtures.archiveA,
    ])
    expect(useMailStore().mailboxView?.total).toBe(10)
    expect(useMailStore().emails.map((value) => value.id)).toEqual([
      fixtures.emailA1.id,
      fixtures.emailA2.id,
    ])
    expect(useMailStore().emailBody).toEqual(fixtures.standardBodyA1)
    controller.dispose()
  })

  it('treats P-03 as invalidation and rereads committed state', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const controller = createMailApplicationController(
      createApplicationContext(engine),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()

    await controller.toggleKeyword(fixtures.emailA1, '$flagged')

    await vi.waitFor(() => {
      expect(useMailStore().emails[0].keywords.has('$flagged')).toBe(true)
    })
    controller.dispose()
  })

  it('preserves cached null/null as a complete EmailBody', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    await engine.syncPort.cacheEmailBody(fixtures.nullBodyA1)
    const controller = createMailApplicationController(
      createApplicationContext(engine),
      useMailStore(),
      useRuntimeStore(),
    )

    await controller.initialize()

    expect(useMailStore().bodyLoadState).toBe('cached')
    expect(useMailStore().emailBody).toEqual(fixtures.nullBodyA1)
    controller.dispose()
  })

  it('keeps a not-cached MailboxView distinct from an empty cached view', async () => {
    const { engine } = await createSeededMemoryApplication()
    const controller = createMailApplicationController(
      createApplicationContext(engine),
      useMailStore(),
      useRuntimeStore(),
    )

    await controller.initialize()
    await controller.selectMailbox(useMailStore().mailboxes[1].id)

    expect(useMailStore().loadState).toBe('notCached')
    expect(useMailStore().mailboxView).toBeNull()
    expect(useMailStore().emails).toEqual([])
    controller.dispose()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  createApplicationContext,
  initializeLocalFirstSync,
} from '../application'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'
import { useComposerStore } from '../stores/composer'
import { executeSend } from '../services/send-service'
import { getEngine, DEMO_IDENTITY, DEMO_ACCOUNT_KEY } from '../engine'
import { jmapMailboxIdFromString, scopedMailboxId } from '../../domain/ids'

describe('Epic A-08: Local-First Integration Smoke (Track A + B)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await getEngine()
  })

  it('executes full vertical local-first flow without remote server', async () => {
    const engine = await getEngine()
    const ctx = createApplicationContext({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      localChangeSource: engine.localChangeSource,
    })

    const mailStore = useMailStore()
    const runtimeStore = useRuntimeStore()
    const composerStore = useComposerStore()

    // 1. Initial State & Subscription
    const subscription = await initializeLocalFirstSync(
      ctx,
      mailStore,
      runtimeStore,
    )
    expect(subscription).toBeDefined()
    expect(runtimeStore.isLocalReady).toBe(true)

    // 2. Select Mailbox & Verify emails can be read from local storage
    const inboxId = scopedMailboxId(
      DEMO_ACCOUNT_KEY,
      jmapMailboxIdFromString('inbox'),
    )
    mailStore.selectAccount(DEMO_ACCOUNT_KEY)
    mailStore.selectMailbox(inboxId)

    expect(mailStore.selectedAccountKey).toBe(DEMO_ACCOUNT_KEY)
    expect(mailStore.emails.length).toBeGreaterThan(0)
    expect(mailStore.selectedEmail).not.toBeNull()

    // 3. Perform actions locally (Toggle Flag, Toggle Seen)
    const emailId = mailStore.emails[0].id
    const initialFlag = mailStore.emails[0].keywords.has('$flagged')
    mailStore.toggleFlagged(emailId)
    expect(mailStore.emails[0].keywords.has('$flagged')).toBe(!initialFlag)

    const initialSeen = mailStore.emails[0].keywords.has('$seen')
    mailStore.toggleSeen(emailId)
    expect(mailStore.emails[0].keywords.has('$seen')).toBe(!initialSeen)

    // 4. Send Email: UI Composer -> SendIntent -> SendMutation in SyncPort
    composerStore.open({
      to: 'socio@startup.com',
      subject: 'Integración Local-First completada',
      body: 'Todo el ciclo de presentación y aplicación está funcionando en local.',
    })

    const initialSentLength = mailStore.allEmailsByFolder.sent?.length ?? 0
    const sendResult = await executeSend()

    expect(sendResult.ok).toBe(true)
    expect(composerStore.isOpen).toBe(false)
    expect(composerStore.phase).toBe('idle')

    // 5. Verify local outbox / mutations in engine
    const pendingMutationsResult =
      await engine.readRepository.listPendingMutations(
        DEMO_IDENTITY.id.accountKey,
      )
    expect(pendingMutationsResult.ok).toBe(true)
    if (
      pendingMutationsResult.ok &&
      pendingMutationsResult.value.kind === 'present'
    ) {
      expect(pendingMutationsResult.value.value.length).toBeGreaterThan(0)
    }

    // 6. Verify optimistic update in sent folder
    expect(mailStore.allEmailsByFolder.sent.length).toBe(initialSentLength + 1)
    expect(mailStore.allEmailsByFolder.sent[0].subject).toBe(
      'Integración Local-First completada',
    )

    // Clean up subscription
    subscription.unsubscribe()
  })
})

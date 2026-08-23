import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  createApplicationContext,
  fetchEmailBody,
  initializeLocalFirstSync,
} from '../application'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'
import type { ReadRepository } from '../../ports/read-repository'
import type { SyncPort } from '../../ports/sync-port'
import type {
  LocalChangeBatch,
  LocalChangeListener,
  LocalChangeSource,
} from '../../ports/local-change-source'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  scopedEmailId,
  scopedMailboxId,
  serviceKeyFromString,
} from '../../domain/ids'
import { account, remoteAccountRef } from '../../domain/account'
import { mailbox } from '../../domain/mailbox'
import { emailBody } from '../../domain/email-body'

describe('Application Composition Root & Local-First Reactive Flow (A-02, A-03)', () => {
  let fakeReadRepo: Partial<ReadRepository>
  let fakeSyncPort: Partial<SyncPort>
  let fakeChangeSource: LocalChangeSource
  let changeListener: LocalChangeListener | null = null

  const testAccountKey = accountKeyFromString('acc_test_1')
  const testMailboxId = scopedMailboxId(
    testAccountKey,
    jmapMailboxIdFromString('mb_inbox'),
  )

  beforeEach(() => {
    setActivePinia(createPinia())
    changeListener = null

    fakeReadRepo = {
      listAccounts: vi.fn().mockResolvedValue({
        ok: true,
        value: [
          account(
            testAccountKey,
            remoteAccountRef(
              serviceKeyFromString('test'),
              jmapAccountIdFromString('acc_1'),
            ),
          ),
        ],
      }),
      listMailboxes: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          kind: 'present',
          value: [
            mailbox({
              id: testMailboxId,
              name: 'Inbox',
              role: 'inbox',
              sortOrder: 1,
              totalEmails: 10,
              unreadEmails: 2,
              parent: null,
              rights: {
                mayReadItems: true,
                mayAddItems: true,
                mayRemoveItems: true,
                maySetSeen: true,
                maySetKeywords: true,
                maySubmit: true,
              },
            }),
          ],
        },
      }),
      readEmailBody: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          kind: 'cached',
          value: emailBody({
            emailId: scopedEmailId(
              testAccountKey,
              jmapEmailIdFromString('msg_1'),
            ),
            text: 'Hello world',
            html: '<p>Hello world</p>',
          }),
        },
      }),
    }

    fakeSyncPort = {}

    fakeChangeSource = {
      subscribe: vi.fn().mockImplementation(async (listener) => {
        changeListener = listener
        return {
          ok: true,
          value: {
            unsubscribe: vi.fn(),
          },
        }
      }),
    }
  })

  it('initializes DI boundary without importing Tauri directly', () => {
    const ctx = createApplicationContext({
      readRepository: fakeReadRepo as ReadRepository,
      syncPort: fakeSyncPort as SyncPort,
      localChangeSource: fakeChangeSource,
    })

    expect(ctx.readRepository).toBe(fakeReadRepo)
    expect(ctx.syncPort).toBe(fakeSyncPort)
    expect(ctx.localChangeSource).toBe(fakeChangeSource)
  })

  it('performs the mandatory Local-First init order: subscribe -> read -> render', async () => {
    const ctx = createApplicationContext({
      readRepository: fakeReadRepo as ReadRepository,
      syncPort: fakeSyncPort as SyncPort,
      localChangeSource: fakeChangeSource,
    })

    const mailStore = useMailStore()
    const runtimeStore = useRuntimeStore()

    const sub = await initializeLocalFirstSync(ctx, mailStore, runtimeStore)

    expect(fakeChangeSource.subscribe).toHaveBeenCalledTimes(1)
    expect(fakeReadRepo.listAccounts).toHaveBeenCalled()
    expect(runtimeStore.local).toBe('ready')
    expect(typeof sub.unsubscribe).toBe('function')
  })

  it('triggers a store refresh when a LocalChangeSource invalidation hint arrives (P-03)', async () => {
    const ctx = createApplicationContext({
      readRepository: fakeReadRepo as ReadRepository,
      syncPort: fakeSyncPort as SyncPort,
      localChangeSource: fakeChangeSource,
    })

    const mailStore = useMailStore()
    mailStore.selectAccount(testAccountKey)

    await initializeLocalFirstSync(ctx, mailStore)
    expect(changeListener).not.toBeNull()

    // Simulate an invalidation batch from SQLite commit
    const batch: LocalChangeBatch = {
      hints: [
        {
          kind: 'mailboxes',
          accountKey: testAccountKey,
        },
      ],
    }

    changeListener!(batch)

    // Verify ReadRepository was called to reread
    expect(fakeReadRepo.listMailboxes).toHaveBeenCalledWith(testAccountKey)
  })

  it('fetches email body on demand via ReadRepository without side effects', async () => {
    const ctx = createApplicationContext({
      readRepository: fakeReadRepo as ReadRepository,
      syncPort: fakeSyncPort as SyncPort,
      localChangeSource: fakeChangeSource,
    })

    const emailId = scopedEmailId(
      testAccountKey,
      jmapEmailIdFromString('msg_1'),
    )
    const body = await fetchEmailBody(ctx, emailId)

    expect(body).not.toBeNull()
    expect(body?.text).toBe('Hello world')
    expect(body?.html).toBe('<p>Hello world</p>')
    expect(fakeReadRepo.readEmailBody).toHaveBeenCalledWith(emailId)
  })
})

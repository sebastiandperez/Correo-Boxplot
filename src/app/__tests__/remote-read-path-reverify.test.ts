// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emailBody } from '../../domain/email-body'
import type { Email } from '../../domain/email'
import type { Mailbox } from '../../domain/mailbox'
import type { ReadRepository } from '../../ports/read-repository'
import type { RemoteBodySource } from '../../remote/body-source'
import type { RemoteSession } from '../../remote/session'
import { FakeRemoteMail, FakeSubmission } from '../../remote/testing'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
  type RemoteEmail,
  type RemoteIdentity,
  type RemoteMailbox,
} from '../../remote/types'
import { DefaultBodyMaterializer } from '../../sync/body-materializer'
import { createTestEmail } from '../../tests/contracts/fixtures'
import {
  createApplicationContext,
  createMailApplicationController,
} from '../application'
import { DefaultRemoteApplication } from '../remote/remote-application'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'
import {
  applicationContextKey,
  mailApplicationControllerKey,
} from '../vue-application-context'
import MessageViewer from '../../components/message-viewer/MessageViewer.vue'
import { createSeededMemoryApplication } from './application-fixture'

type BodyReadResult = Awaited<ReturnType<ReadRepository['readEmailBody']>>

function remoteMailbox(value: Mailbox): RemoteMailbox {
  return {
    id: remoteMailboxIdFromString(String(value.id.jmapId)),
    name: value.name,
    parent:
      value.parent === null
        ? null
        : remoteMailboxIdFromString(String(value.parent.jmapId)),
    role: value.role,
    sortOrder: value.sortOrder,
    totalEmails: value.totalEmails,
    unreadEmails: value.unreadEmails,
    rights: value.rights,
  }
}

function remoteEmail(value: Email, mailbox: Mailbox): RemoteEmail {
  return {
    id: remoteEmailIdFromString(String(value.id.jmapId)),
    blobId: remoteBlobIdFromString(String(value.blobId.jmapId)),
    threadId: remoteThreadIdFromString(String(value.threadId.jmapId)),
    sender: value.sender,
    from: value.from,
    replyTo: value.replyTo,
    to: value.to,
    cc: value.cc,
    bcc: value.bcc,
    subject: value.subject,
    sentAt: value.sentAt,
    receivedAt: value.receivedAt,
    size: value.size,
    preview: value.preview,
    hasAttachment: value.hasAttachment,
    keywords: value.keywords,
    mailboxIds: [remoteMailboxIdFromString(String(mailbox.id.jmapId))],
  }
}

function remoteIdentity(value: {
  id: { jmapId: string }
  name: string
  email: string
  replyTo: RemoteIdentity['replyTo']
  bcc: RemoteIdentity['bcc']
}): RemoteIdentity {
  return {
    id: remoteIdentityIdFromString(String(value.id.jmapId)),
    name: value.name,
    email: value.email,
    replyTo: value.replyTo,
    bcc: value.bcc,
  }
}

describe('independent A2-05/A2-06 reverify', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each([
    [
      'cached',
      { ok: true as const, value: { kind: 'cached' as const } },
      true,
      null,
    ],
    [
      'notCached',
      { ok: true as const, value: { kind: 'notCached' as const } },
      false,
      'local',
    ],
    [
      'ownerAbsent',
      { ok: true as const, value: { kind: 'ownerAbsent' as const } },
      false,
      'emailAbsent',
    ],
    [
      'read failure',
      { ok: false as const, error: { kind: 'unexpected' as const } },
      false,
      'local',
    ],
  ])(
    'REVERIFY-REREAD-01 maps P-01 %s after materializer success without false success',
    async (_label, reread, expectedOk, expectedError) => {
      const { engine, fixtures } = await createSeededMemoryApplication()
      let reads = 0
      const readRepository = Object.assign(
        Object.create(engine.readRepository),
        {
          readEmailBody: async (emailId: typeof fixtures.emailA2.id) => {
            if (emailId.jmapId !== fixtures.emailA2.id.jmapId) {
              return engine.readRepository.readEmailBody(emailId)
            }
            reads += 1
            if (reads === 1) return engine.readRepository.readEmailBody(emailId)
            if (reread.ok && reread.value.kind === 'cached') {
              return {
                ok: true as const,
                value: {
                  kind: 'cached' as const,
                  value: emailBody({
                    emailId,
                    text: 'authoritative cached body',
                    html: '<p>authoritative cached body</p>',
                  }),
                },
              }
            }
            return reread as BodyReadResult
          },
        },
      ) as ReadRepository
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
      expect(result.ok).toBe(expectedOk)
      if (expectedError !== null) {
        expect(result).toMatchObject({
          ok: false,
          error: { kind: expectedError },
        })
        expect(useMailStore().emailBody).toBeNull()
        expect(useMailStore().bodyLoadState).toBe(
          expectedError === 'emailAbsent' ? 'ownerAbsent' : 'notCached',
        )
        expect(useMailStore().bodyError).toBeTruthy()
      } else {
        expect(useMailStore().bodyLoadState).toBe('cached')
        expect(useMailStore().emailBody?.text).toBe('authoritative cached body')
      }
      expect(useRuntimeStore().local).toBe('ready')
      controller.dispose()
    },
  )

  it('REVERIFY-REREAD-02 retries through Application after a local reread failure', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    let reads = 0
    let failRereads = true
    const readRepository = Object.assign(Object.create(engine.readRepository), {
      readEmailBody: async (emailId: typeof fixtures.emailA2.id) => {
        if (emailId.jmapId === fixtures.emailA2.id.jmapId) {
          reads += 1
          if (reads > 1 && failRereads) {
            return { ok: false as const, error: { kind: 'unexpected' } }
          }
        }
        return engine.readRepository.readEmailBody(emailId)
      },
    }) as ReadRepository
    const materialize = vi.fn(async () => {
      await engine.syncPort.cacheEmailBody(
        emailBody({
          emailId: fixtures.emailA2.id,
          text: 'retry body',
          html: '<p>retry body</p>',
        }),
      )
      return 'materialized' as const
    })
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

    await expect(
      controller.materializeBody(fixtures.emailA2.id),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'local' },
    })
    expect(useMailStore().bodyLoadState).toBe('notCached')
    expect(useMailStore().bodyError).toBeTruthy()

    failRereads = false
    await expect(
      controller.materializeBody(fixtures.emailA2.id),
    ).resolves.toEqual({ ok: true })
    expect(useMailStore().bodyLoadState).toBe('cached')
    expect(useMailStore().emailBody?.text).toBe('retry body')
    expect(useMailStore().bodyError).toBeNull()
    expect(materialize).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('REVERIFY-REREAD-03 keeps B untouched when A materialization completes stale', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    let release!: () => void
    const materialize = vi.fn(
      () =>
        new Promise<'materialized'>((resolve) => {
          release = () => resolve('materialized')
        }),
    )
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        bodyMaterializer: { materialize },
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    await controller.selectEmail(fixtures.emailA2.id)
    const attemptA = controller.materializeBody(fixtures.emailA2.id)
    await vi.waitFor(() => expect(materialize).toHaveBeenCalledOnce())

    await controller.selectEmail(fixtures.emailA1.id)
    release()
    await expect(attemptA).resolves.toEqual({ ok: true })
    expect(useMailStore().selectedEmailId).toEqual(fixtures.emailA1.id)
    expect(useMailStore().emailBody).toEqual(fixtures.standardBodyA1)
    expect(useMailStore().bodyError).toBeNull()
    expect(useMailStore().bodyMaterializing).toBe(false)
    controller.dispose()
  })

  it('REVERIFY-REFRESH-01 projects a real C refresh new Email only after committed local reread', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const newEmail = createTestEmail(fixtures.accountA, 'VERIFY-NEW')
    const remoteAccountId = remoteAccountIdFromString(
      String(fixtures.accountA.remoteRef.jmapAccountId),
    )
    const inboxId = remoteMailboxIdFromString(String(fixtures.inboxA.id.jmapId))
    const remoteMail = new FakeRemoteMail({
      syncIdentities: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('verify-identities-v2'),
        snapshot: [remoteIdentity(fixtures.identityA)],
      }),
      syncMailboxes: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('verify-mailboxes-v2'),
        snapshot: [
          remoteMailbox(fixtures.inboxA),
          remoteMailbox(fixtures.archiveA),
        ],
      }),
      syncEmails: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('verify-emails-v2'),
        snapshot: [
          remoteEmail(fixtures.emailA1, fixtures.inboxA),
          remoteEmail(fixtures.emailA2, fixtures.inboxA),
          remoteEmail(newEmail, fixtures.inboxA),
        ],
      }),
      queryMailbox: async (_accountId, mailboxId) => ({
        ids:
          mailboxId === inboxId
            ? [
                remoteEmailIdFromString(String(newEmail.id.jmapId)),
                remoteEmailIdFromString(String(fixtures.emailA1.id.jmapId)),
                remoteEmailIdFromString(String(fixtures.emailA2.id.jmapId)),
              ]
            : [],
        queryState: remoteSyncStateFromString('verify-inbox-v2'),
        total: mailboxId === inboxId ? 3 : 0,
        position: 0,
        canCalculateChanges: false,
      }),
    })
    const session: RemoteSession = {
      accounts: [{ id: remoteAccountId, capabilities: [] }],
      mail: remoteMail,
      submission: new FakeSubmission(async () => ({
        kind: 'accepted',
        remoteEmailId: null,
        receiptId: null,
      })),
      close: async () => undefined,
    }
    const remoteApplication = new DefaultRemoteApplication({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      connectionFactory: () => ({ open: async () => session }),
    })
    const apply = vi.spyOn(engine.syncPort, 'applyCollectionSync')
    const controller = createMailApplicationController(
      createApplicationContext({ ...engine, remoteApplication }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    expect(useMailStore().emails.map((value) => value.id)).not.toContainEqual(
      newEmail.id,
    )

    await remoteApplication.connect({
      accountKey: fixtures.accountA.key,
      serviceKey: fixtures.accountA.remoteRef.serviceKey,
      config: {
        provider: 'imapSmtp',
        host: '127.0.0.1',
        username: 'verify@boxplot.test',
        password: 'memory-only',
        imapPort: 1143,
        smtpPort: 1587,
      },
    })
    await expect(
      controller.refreshAccount(fixtures.accountA.key),
    ).resolves.toEqual({ ok: true })

    await vi.waitFor(() =>
      expect(useMailStore().emails.map((value) => value.id)).toContainEqual(
        newEmail.id,
      ),
    )
    expect(apply).toHaveBeenCalledTimes(3)
    expect(await engine.readRepository.readEmail(newEmail.id)).toMatchObject({
      ok: true,
      value: { kind: 'present', value: { id: newEmail.id } },
    })
    expect(useRuntimeStore().local).toBe('ready')
    controller.dispose()
    await remoteApplication.dispose()
  })

  it('REVERIFY-VIEWER-01 sanitizes newly materialized hostile HTML after the local commit', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const source: RemoteBodySource = {
      fetchBody: vi.fn(async () => ({
        body: {
          kind: 'plain' as const,
          text: null,
          html: '<script>alert(1)</script><img src="https://remote.invalid/x"><a href="javascript:alert(1)">x</a><form action="https://remote.invalid"></form><p>safe</p>',
        },
        assertCurrent: () => undefined,
      })),
    }
    const bodyMaterializer = new DefaultBodyMaterializer({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteBodySource: source,
      e2eePort: {} as never,
    })
    const context = createApplicationContext({ ...engine, bodyMaterializer })
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    await controller.selectEmail(fixtures.emailA2.id)
    await vi.waitFor(() => expect(useMailStore().bodyLoadState).toBe('cached'))

    const wrapper = mount(MessageViewer, {
      global: {
        provide: {
          [applicationContextKey as symbol]: context,
          [mailApplicationControllerKey as symbol]: controller,
        },
      },
    })
    const iframe = wrapper.find('iframe')
    const srcdoc = iframe.attributes('srcdoc') ?? ''
    expect(iframe.attributes('sandbox')).toBe('allow-same-origin')
    expect(srcdoc).toContain('safe')
    expect(srcdoc).not.toMatch(
      /<script|<img|<form|javascript:|remote\.invalid/i,
    )
    expect(source.fetchBody).toHaveBeenCalledWith(
      fixtures.emailA2.id.accountKey,
      fixtures.emailA2.id.jmapId,
    )
    wrapper.unmount()
    controller.dispose()
  })
})

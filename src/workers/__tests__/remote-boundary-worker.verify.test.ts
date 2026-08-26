import { describe, it, expect, vi } from 'vitest'
import { createWorkerRuntime } from '../jmap-worker'
import {
  workerRequestIdFromString,
  type WorkerToMainMessage,
} from '../protocol'
import type { SyncPort } from '../../ports/sync-port'
import type { ReadRepository } from '../../ports/read-repository'
import type { JmapClient } from '../../jmap/client'
import type { JmapSession } from '../../jmap/types'
import { accountKeyFromString, mutationIdFromString } from '../../domain/ids'

describe('V12 — Worker Composition & Remote Boundary Verification', () => {
  function setupWorker() {
    const posted: WorkerToMainMessage[] = []
    const post = (msg: WorkerToMainMessage) => {
      posted.push(msg)
    }

    const dummySyncPort = {} as SyncPort
    const dummyReadRepo = {} as ReadRepository
    const dummyResolveIpc = vi.fn()

    const fakeClient: JmapClient = {
      openSession: vi.fn(async (): Promise<JmapSession> => ({
        capabilities: {
          'urn:ietf:params:jmap:core': {},
          'urn:ietf:params:jmap:mail': {},
        },
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acc-1' },
        apiUrl: 'https://example.com/api',
        downloadUrl: 'https://example.com/d',
        uploadUrl: 'https://example.com/u',
        eventSourceUrl: 'https://example.com/e',
        webSocketUrl: null,
      })),
      getMailboxes: vi.fn(async () => ({ mailboxes: [], state: 's1' })),
      getIdentities: vi.fn(async () => ({ identities: [], state: 's1' })),
      getEmails: vi.fn(async () => ({ emails: [], state: 's1' })),
      queryEmails: vi.fn(async () => ({
        ids: [],
        total: 0,
        position: 0,
        queryState: 'q1',
        canCalculateChanges: true,
      })),
    } as unknown as JmapClient

    const runtime = createWorkerRuntime({
      post,
      syncPort: dummySyncPort,
      readRepository: dummyReadRepo,
      resolveIpcInvoke: dummyResolveIpc,
      createJmapClient: () => fakeClient,
    })

    return { runtime, posted, fakeClient }
  }

  it('V12-04: Anonymous state cannot remote-sync', async () => {
    const { runtime, posted } = setupWorker()

    runtime.handleMessage({
      type: 'SYNC_ACCOUNT',
      requestId: workerRequestIdFromString('req-anon-sync'),
      payload: {
        accountKey: accountKeyFromString('acc-anon'),
        jmapAccountId: 'jmap-acc-anon',
      },
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({
      type: 'SYNC_ERROR',
      requestId: workerRequestIdFromString('req-anon-sync'),
      payload: { error: 'No authenticated JMAP session' },
    })
  })

  it('V12-05: Anonymous state cannot send email', async () => {
    const { runtime, posted } = setupWorker()

    runtime.handleMessage({
      type: 'SEND_EMAIL',
      requestId: workerRequestIdFromString('req-anon-send'),
      payload: {
        accountKey: accountKeyFromString('acc-anon'),
        jmapAccountId: 'jmap-acc-anon',
        mutationId: mutationIdFromString('mut-anon'),
      },
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({
      type: 'SEND_ERROR',
      requestId: workerRequestIdFromString('req-anon-send'),
      payload: { error: 'No authenticated JMAP session' },
    })
  })

  it('V12-03: preserves requestId across INIT_SESSION and SESSION_READY', async () => {
    const { runtime, posted } = setupWorker()

    runtime.handleMessage({
      type: 'INIT_SESSION',
      requestId: workerRequestIdFromString('req-init-123'),
      payload: {
        sessionUrl: 'https://jmap.example.com',
        token: 'secret-token-123',
        expiresInSeconds: 3600,
      },
    })

    // Wait for connection.open() async promise resolution
    await new Promise((resolve) => setTimeout(resolve, 20))

    const readyMsg = posted.find((m) => m.type === 'SESSION_READY')
    expect(readyMsg).toBeDefined()
    expect(readyMsg?.requestId).toBe(workerRequestIdFromString('req-init-123'))
  })
})

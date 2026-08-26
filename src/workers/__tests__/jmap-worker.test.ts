import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryLocalEngine } from '../../adapters/memory'
import type { MemoryLocalEngine } from '../../adapters/memory'
import { JmapAuthError } from '../../jmap/errors'
import type { JmapClient } from '../../jmap/client'
import type { JmapSession } from '../../jmap/types'
import { unwrapOk } from '../../tests/contracts/assertions'
import {
  createTestAccount,
  createTestIdentity,
  createTestSendMutation,
} from '../../tests/contracts/fixtures'
import { createWorkerRuntime } from '../jmap-worker'
import type { WorkerRuntimeDeps } from '../jmap-worker'
import type { MainToWorkerMessage, WorkerToMainMessage } from '../protocol'

const SESSION: JmapSession = {
  apiUrl: 'https://example.test/api',
  downloadUrl: 'https://example.test/download',
  uploadUrl: 'https://example.test/upload',
  eventSourceUrl: 'https://example.test/events',
  webSocketUrl: 'wss://example.test/push',
  primaryAccounts: { 'urn:ietf:params:jmap:mail': 'remote-account' },
  capabilities: {},
}

function fakeClient(overrides: Partial<JmapClient> = {}): JmapClient {
  const unsupported = (name: string) => () => {
    throw new Error(`Unexpected JMAP call: ${name}`)
  }
  return {
    openSession: vi.fn(async () => SESSION),
    getIdentities: vi.fn(async () => ({
      identities: [],
      state: 'identity-state',
    })),
    getMailboxes: vi.fn(async () => ({
      mailboxes: [],
      state: 'mailbox-state',
    })),
    queryEmails: unsupported('queryEmails'),
    getEmails: vi.fn(async () => ({ emails: [], state: 'email-state' })),
    getEmailChanges: unsupported('getEmailChanges'),
    getEmailQueryChanges: unsupported('getEmailQueryChanges'),
    getEmailBody: unsupported('getEmailBody'),
    getEmailAttachments: unsupported('getEmailAttachments'),
    updateEmailKeywords: unsupported('updateEmailKeywords'),
    updateEmailMailboxes: unsupported('updateEmailMailboxes'),
    submitEmail: vi.fn(async () => ({
      emailId: 'sent-email',
      submissionId: 'submission-1',
    })),
    onStateChange: vi.fn(() => () => {}),
    ...overrides,
  } as JmapClient
}

describe('createWorkerRuntime recovery lifecycle', () => {
  let posted: WorkerToMainMessage[]
  let engine: MemoryLocalEngine
  let client: JmapClient
  let runtime: ReturnType<typeof createWorkerRuntime>

  beforeEach(() => {
    posted = []
    engine = createMemoryLocalEngine()
    client = fakeClient()
    const deps: WorkerRuntimeDeps = {
      post: (message) => posted.push(message),
      syncPort: engine.syncPort,
      readRepository: engine.readRepository,
      resolveIpcInvoke: vi.fn(),
      createJmapClient: () => client,
    }
    runtime = createWorkerRuntime(deps)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await engine.dispose()
  })

  function init(token = 'canary-secret', expiresInSeconds?: number): void {
    runtime.handleMessage({
      type: 'INIT_SESSION',
      requestId: 'init' as never,
      payload: {
        sessionUrl: 'https://example.test/.well-known/jmap',
        token,
        expiresInSeconds,
      },
    })
  }

  async function waitFor(type: WorkerToMainMessage['type']): Promise<void> {
    await vi.waitFor(() => {
      expect(posted.some((message) => message.type === type)).toBe(true)
    })
  }

  function messages(type: WorkerToMainMessage['type']): WorkerToMainMessage[] {
    return posted.filter((message) => message.type === type)
  }

  it('valid INIT_SESSION authenticates without starting unsafe push or emitting the token', async () => {
    init()
    await waitFor('SESSION_READY')

    expect(messages('CONNECTION_STATUS')).toEqual([
      { type: 'CONNECTION_STATUS', payload: { status: 'connecting' } },
      { type: 'CONNECTION_STATUS', payload: { status: 'authenticated' } },
    ])
    expect(client.onStateChange).not.toHaveBeenCalled()
    expect(JSON.stringify(posted)).not.toContain('canary-secret')
  })

  it('failed login clears the credential and leaves no usable remote client', async () => {
    const getIdentities = vi.fn()
    client = fakeClient({
      openSession: vi.fn(async () => {
        throw new JmapAuthError('server echoed canary-secret')
      }),
      getIdentities,
    })
    init()
    await waitFor('SESSION_ERROR')

    runtime.handleMessage({
      type: 'SYNC_ACCOUNT',
      requestId: 'sync-after-failure' as never,
      payload: { accountKey: 'account' as never, jmapAccountId: 'remote' },
    })

    expect(getIdentities).not.toHaveBeenCalled()
    expect(messages('SYNC_ERROR')).toHaveLength(1)
    expect(JSON.stringify(posted)).not.toContain('canary-secret')
  })

  it('explicit teardown clears once and reports anonymous', async () => {
    init()
    await waitFor('SESSION_READY')
    posted.length = 0

    runtime.handleMessage({
      type: 'TEARDOWN_SESSION',
      requestId: 'teardown' as never,
    })

    expect(posted).toEqual([
      { type: 'CONNECTION_STATUS', payload: { status: 'anonymous' } },
      {
        type: 'TEARDOWN_COMPLETE',
        requestId: 'teardown',
        payload: { canary: 'TOKEN_CLEARED_OK' },
      },
    ])
  })

  it('timer expiry tears down the client and prevents later remote use', async () => {
    vi.useFakeTimers()
    const getIdentities = vi.fn(async () => ({
      identities: [],
      state: 'identity-state',
    }))
    client = fakeClient({ getIdentities })
    init('expiring-secret', 60)
    await vi.advanceTimersByTimeAsync(0)
    posted.length = 0

    await vi.advanceTimersByTimeAsync(60_000)
    runtime.handleMessage({
      type: 'SYNC_ACCOUNT',
      requestId: 'expired-sync' as never,
      payload: { accountKey: 'account' as never, jmapAccountId: 'remote' },
    })

    expect(messages('SESSION_TEARDOWN')).toHaveLength(1)
    expect(messages('CONNECTION_STATUS')).toContainEqual({
      type: 'CONNECTION_STATUS',
      payload: { status: 'expired' },
    })
    expect(getIdentities).not.toHaveBeenCalled()
  })

  it('auth rejection during sync invalidates the active session', async () => {
    const getIdentities = vi.fn(async () => {
      throw new JmapAuthError()
    })
    client = fakeClient({ getIdentities })
    const account = createTestAccount('auth-sync')
    unwrapOk(await engine.syncPort.registerAccount(account))
    init()
    await waitFor('SESSION_READY')
    posted.length = 0

    runtime.handleMessage({
      type: 'SYNC_ACCOUNT',
      requestId: 'sync-auth' as never,
      payload: { accountKey: account.key, jmapAccountId: 'remote' },
    })
    await waitFor('SYNC_ERROR')

    expect(messages('SESSION_TEARDOWN')).toHaveLength(1)
    expect(messages('CONNECTION_STATUS')).toContainEqual({
      type: 'CONNECTION_STATUS',
      payload: { status: 'expired' },
    })

    runtime.handleMessage({
      type: 'SYNC_ACCOUNT',
      requestId: 'sync-after-auth' as never,
      payload: { accountKey: account.key, jmapAccountId: 'remote' },
    })
    expect(getIdentities).toHaveBeenCalledTimes(1)
  })

  it('auth rejection during send invalidates the active session', async () => {
    const account = createTestAccount('auth-send')
    const identity = createTestIdentity(account, 'auth-send')
    const mutation = createTestSendMutation(account, identity, 'auth-send')
    unwrapOk(await engine.syncPort.registerAccount(account))
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    client = fakeClient({
      submitEmail: vi.fn(async () => {
        throw new JmapAuthError()
      }),
    })
    init()
    await waitFor('SESSION_READY')
    posted.length = 0

    runtime.handleMessage({
      type: 'SEND_EMAIL',
      requestId: 'send-auth' as never,
      payload: {
        accountKey: account.key,
        jmapAccountId: 'remote',
        mutationId: mutation.mutationId,
      },
    })
    await waitFor('SEND_ERROR')

    expect(messages('SESSION_TEARDOWN')).toHaveLength(1)
  })

  it('SYNC_ACCOUNT awaits identities, mailboxes, emails and standard views in order', async () => {
    const calls: string[] = []
    const account = createTestAccount('full-sync')
    unwrapOk(await engine.syncPort.registerAccount(account))
    client = fakeClient({
      getIdentities: vi.fn(async () => {
        calls.push('identities')
        return {
          identities: [
            {
              id: 'identity-1',
              name: 'Alice',
              email: 'alice@example.test',
              replyTo: null,
              bcc: null,
              textSignature: '',
              htmlSignature: '',
            },
          ],
          state: 'identity-state',
        }
      }),
      getMailboxes: vi.fn(async () => {
        calls.push('mailboxes')
        return {
          mailboxes: [
            {
              id: 'inbox',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
              totalEmails: 0,
              unreadEmails: 0,
              rights: {
                mayReadItems: true,
                mayAddItems: true,
                mayRemoveItems: true,
                maySetSeen: true,
                maySetKeywords: true,
                maySubmit: true,
              },
            },
          ],
          state: 'mailbox-state',
        }
      }),
      queryEmails: vi.fn(async (_account, _mailbox, _filter, options) => {
        calls.push(options?.position === 0 ? 'email-query' : 'view-query')
        return {
          ids: [],
          queryState: 'query-state',
          total: 0,
          position: options?.position ?? 0,
          canCalculateChanges: true,
        }
      }),
      getEmails: vi.fn(async () => {
        calls.push('emails')
        return { emails: [], state: 'email-state' }
      }),
    })
    init()
    await waitFor('SESSION_READY')
    posted.length = 0

    runtime.handleMessage({
      type: 'SYNC_ACCOUNT',
      requestId: 'full-sync-request' as never,
      payload: { accountKey: account.key, jmapAccountId: 'remote' },
    })
    await waitFor('SYNC_SUCCESS')

    expect(calls.indexOf('identities')).toBeLessThan(calls.indexOf('mailboxes'))
    expect(calls.indexOf('mailboxes')).toBeLessThan(calls.indexOf('emails'))
    expect(calls.at(-1)).toBe('view-query')
    const identityCursor = unwrapOk(
      await engine.readRepository.readCollectionSyncCursor(
        account.key,
        'identity',
      ),
    )
    expect(identityCursor.kind).toBe('present')
  })

  it('listener failure during expiry cannot preserve the old client', async () => {
    vi.useFakeTimers()
    const getIdentities = vi.fn()
    client = fakeClient({ getIdentities })
    runtime = createWorkerRuntime({
      post: (message) => {
        if (message.type === 'SESSION_TEARDOWN') throw new Error('listener')
        posted.push(message)
      },
      syncPort: engine.syncPort,
      readRepository: engine.readRepository,
      resolveIpcInvoke: vi.fn(),
      createJmapClient: () => client,
    })
    init('secret', 1)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)

    runtime.handleMessage({
      type: 'SYNC_ACCOUNT',
      requestId: 'after-listener-failure' as never,
      payload: { accountKey: 'account' as never, jmapAccountId: 'remote' },
    })
    expect(getIdentities).not.toHaveBeenCalled()
  })

  it('forwards IPC bridge results without touching remote state', () => {
    const resolveIpcInvoke = vi.fn()
    runtime = createWorkerRuntime({
      post: (message) => posted.push(message),
      syncPort: engine.syncPort,
      readRepository: engine.readRepository,
      resolveIpcInvoke,
      createJmapClient: () => client,
    })
    const message: MainToWorkerMessage = {
      type: 'IPC_INVOKE_RESULT',
      requestId: 'ipc' as never,
      payload: { ok: false, error: { kind: 'unavailable', message: 'down' } },
    }
    runtime.handleMessage(message)
    expect(resolveIpcInvoke).toHaveBeenCalledWith(message)
  })
})

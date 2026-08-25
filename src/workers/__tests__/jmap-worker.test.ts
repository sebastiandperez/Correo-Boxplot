import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWorkerRuntime } from '../jmap-worker'
import type { WorkerRuntimeDeps } from '../jmap-worker'
import type { MainToWorkerMessage, WorkerToMainMessage } from '../protocol'
import type { SyncPort, WriteResult } from '../../ports/sync-port'
import {
  createTestAccount,
  createTestIdentity,
  createTestSendMutation,
} from '../../tests/contracts/fixtures'

function ok(): Promise<WriteResult> {
  return Promise.resolve({ ok: true, value: undefined })
}

function createFakeSyncPort(overrides: Partial<SyncPort> = {}): SyncPort {
  return {
    registerAccount: vi.fn(ok),
    applyCollectionSync: vi.fn(ok),
    cacheEmailBody: vi.fn(ok),
    replaceAttachmentRefs: vi.fn(ok),
    replaceMailboxView: vi.fn(ok),
    stageSendMutation: vi.fn(ok),
    applyOptimisticKeywordMutation: vi.fn(ok),
    applyOptimisticMailboxMembershipMutation: vi.fn(ok),
    replacePendingMutationIfCurrent: vi.fn(ok),
    removeConfirmedMutation: vi.fn(ok),
    ...overrides,
  }
}

describe('createWorkerRuntime', () => {
  let posted: WorkerToMainMessage[]
  let syncPort: SyncPort
  let resolveIpcInvoke: WorkerRuntimeDeps['resolveIpcInvoke']
  let runtime: ReturnType<typeof createWorkerRuntime>

  beforeEach(() => {
    posted = []
    syncPort = createFakeSyncPort()
    resolveIpcInvoke = vi.fn<WorkerRuntimeDeps['resolveIpcInvoke']>()
    const deps: WorkerRuntimeDeps = {
      post: (m) => posted.push(m),
      syncPort,
      resolveIpcInvoke,
    }
    runtime = createWorkerRuntime(deps)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function types(): string[] {
    return posted.map((m) => m.type)
  }

  it('INIT_SESSION success: posts connecting -> authenticated and SESSION_READY correlated by requestId', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        capabilities: { 'urn:ietf:params:jmap:mail': {} },
        accounts: { 'account-1': { name: 'test@example.com' } },
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account-1' },
        apiUrl: 'https://example.com/api',
        downloadUrl: 'https://example.com/download',
        uploadUrl: 'https://example.com/upload',
        eventSourceUrl: 'https://example.com/events',
      }),
      text: async () => '',
    } as unknown as Response)

    runtime.handleMessage({
      type: 'INIT_SESSION',
      requestId: 'm:1' as never,
      payload: {
        sessionUrl: 'https://example.com/.well-known/jmap',
        token: 'tok',
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(types()).toEqual([
      'CONNECTION_STATUS',
      'CONNECTION_STATUS',
      'SESSION_READY',
    ])
    const statuses = posted
      .filter((m) => m.type === 'CONNECTION_STATUS')
      .map(
        (m) =>
          (m as Extract<WorkerToMainMessage, { type: 'CONNECTION_STATUS' }>)
            .payload.status,
      )
    expect(statuses).toEqual(['connecting', 'authenticated'])

    const ready = posted.find((m) => m.type === 'SESSION_READY') as Extract<
      WorkerToMainMessage,
      { type: 'SESSION_READY' }
    >
    expect(ready.requestId).toBe('m:1')
    expect(ready.payload.primaryAccounts).toEqual({
      'urn:ietf:params:jmap:mail': 'account-1',
    })
  })

  it('INIT_SESSION failure: posts connecting -> error and SESSION_ERROR correlated by requestId', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    )

    runtime.handleMessage({
      type: 'INIT_SESSION',
      requestId: 'm:2' as never,
      payload: {
        sessionUrl: 'https://example.com/.well-known/jmap',
        token: 'tok',
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(types()).toEqual([
      'CONNECTION_STATUS',
      'CONNECTION_STATUS',
      'SESSION_ERROR',
    ])
    const statuses = posted
      .filter((m) => m.type === 'CONNECTION_STATUS')
      .map(
        (m) =>
          (m as Extract<WorkerToMainMessage, { type: 'CONNECTION_STATUS' }>)
            .payload.status,
      )
    expect(statuses).toEqual(['connecting', 'error'])

    const errorMsg = posted.find((m) => m.type === 'SESSION_ERROR') as Extract<
      WorkerToMainMessage,
      { type: 'SESSION_ERROR' }
    >
    expect(errorMsg.requestId).toBe('m:2')
  })

  it('TEARDOWN_SESSION posts exactly one TEARDOWN_COMPLETE and no SESSION_TEARDOWN (regression: no more double-message)', () => {
    runtime.handleMessage({
      type: 'TEARDOWN_SESSION',
      requestId: 'm:3' as never,
    })

    expect(types()).toEqual(['CONNECTION_STATUS', 'TEARDOWN_COMPLETE'])
    expect(posted.some((m) => m.type === 'SESSION_TEARDOWN')).toBe(false)

    const complete = posted.find(
      (m) => m.type === 'TEARDOWN_COMPLETE',
    ) as Extract<WorkerToMainMessage, { type: 'TEARDOWN_COMPLETE' }>
    expect(complete.requestId).toBe('m:3')
  })

  it('a token that expires on its own posts SESSION_TEARDOWN (unsolicited), not TEARDOWN_COMPLETE', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        capabilities: { 'urn:ietf:params:jmap:mail': {} },
        accounts: { 'account-1': { name: 'test@example.com' } },
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account-1' },
        apiUrl: 'https://example.com/api',
        downloadUrl: 'https://example.com/download',
        uploadUrl: 'https://example.com/upload',
        eventSourceUrl: 'https://example.com/events',
      }),
      text: async () => '',
    } as unknown as Response)

    runtime.handleMessage({
      type: 'INIT_SESSION',
      requestId: 'm:4' as never,
      payload: {
        sessionUrl: 'https://example.com/.well-known/jmap',
        token: 'tok',
        expiresInSeconds: 60,
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    posted.length = 0 // discard the init-phase messages, focus on the expiry

    await vi.advanceTimersByTimeAsync(60_000)

    expect(posted.some((m) => m.type === 'TEARDOWN_COMPLETE')).toBe(false)
    const teardown = posted.find((m) => m.type === 'SESSION_TEARDOWN')
    expect(teardown).toBeDefined()
  })

  it('SYNC_ACCOUNT succeeds against the mock client and posts SYNC_SUCCESS', async () => {
    const account = createTestAccount('W1')

    runtime.handleMessage({
      type: 'SYNC_ACCOUNT',
      requestId: 'm:5' as never,
      payload: {
        accountKey: account.key,
        jmapAccountId: 'jmap-account-w1',
        sinceState: 'state-0',
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(types()).toEqual(['SYNC_SUCCESS'])
  })

  it('SEND_EMAIL against the mock client posts SEND_SUCCESS and confirms the mutation via SyncPort', async () => {
    const account = createTestAccount('W2')
    const identity = createTestIdentity(account, 'W2')
    const mutation = createTestSendMutation(account, identity, 'W2')

    runtime.handleMessage({
      type: 'SEND_EMAIL',
      requestId: 'm:6' as never,
      payload: {
        accountKey: account.key,
        jmapAccountId: 'jmap-account-w2',
        mutation,
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(types()).toEqual(['SEND_SUCCESS'])
    expect(syncPort.removeConfirmedMutation).toHaveBeenCalledWith(
      account.key,
      mutation.mutationId,
    )
  })

  it('routes IPC_INVOKE_RESULT to resolveIpcInvoke', () => {
    const message: MainToWorkerMessage = {
      type: 'IPC_INVOKE_RESULT',
      requestId: 'w:1' as never,
      payload: { ok: true, value: { ok: true, value: null } },
    }

    runtime.handleMessage(message)

    expect(resolveIpcInvoke).toHaveBeenCalledWith(message)
  })

  it('does not throw on an unrecognized message type', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      runtime.handleMessage({
        type: 'SOMETHING_UNKNOWN',
      } as unknown as MainToWorkerMessage),
    ).not.toThrow()
    expect(errorSpy).toHaveBeenCalled()
  })
})

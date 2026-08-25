import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JmapWorkerClient } from '../worker-client'
import type { WorkerLike } from '../worker-client'
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from '../../workers/protocol'
import type { AccountKey } from '../../domain/ids'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

class FakeWorker implements WorkerLike {
  posted: MainToWorkerMessage[] = []
  terminated = false
  onmessage: ((event: MessageEvent<WorkerToMainMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(message: MainToWorkerMessage): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(message: WorkerToMainMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerToMainMessage>)
  }

  lastRequestId(): string {
    const last = this.posted[this.posted.length - 1]
    if (!last || !('requestId' in last)) {
      throw new Error('last posted message has no requestId')
    }
    return last.requestId
  }
}

describe('JmapWorkerClient', () => {
  let worker: FakeWorker
  let client: JmapWorkerClient

  beforeEach(() => {
    invokeMock.mockReset()
    worker = new FakeWorker()
    client = new JmapWorkerClient(worker)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initSession resolves with primaryAccounts on SESSION_READY correlated by requestId', async () => {
    const promise = client.initSession({
      sessionUrl: 'https://mail.test/.well-known/jmap',
      token: 'tok',
    })

    const requestId = worker.lastRequestId()
    worker.emit({
      type: 'SESSION_READY',
      requestId: requestId as never,
      payload: { primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acc1' } },
    })

    await expect(promise).resolves.toEqual({
      primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acc1' },
    })
  })

  it('initSession rejects with the error message on SESSION_ERROR', async () => {
    const promise = client.initSession({
      sessionUrl: 'https://mail.test/.well-known/jmap',
      token: 'tok',
    })

    const requestId = worker.lastRequestId()
    worker.emit({
      type: 'SESSION_ERROR',
      requestId: requestId as never,
      payload: { error: 'boom' },
    })

    await expect(promise).rejects.toThrow('boom')
  })

  it('teardownSession resolves on TEARDOWN_COMPLETE', async () => {
    const promise = client.teardownSession()
    const requestId = worker.lastRequestId()

    worker.emit({
      type: 'TEARDOWN_COMPLETE',
      requestId: requestId as never,
      payload: { canary: 'TOKEN_CLEARED_OK' },
    })

    await expect(promise).resolves.toEqual({ canary: 'TOKEN_CLEARED_OK' })
  })

  it('syncAccount resolves on SYNC_SUCCESS and rejects on SYNC_ERROR', async () => {
    const accountKey = 'acc-key-1' as AccountKey

    const okPromise = client.syncAccount(accountKey, 'jmap-acc-1', 'state-1')
    worker.emit({
      type: 'SYNC_SUCCESS',
      requestId: worker.lastRequestId() as never,
      payload: { accountKey },
    })
    await expect(okPromise).resolves.toEqual({ accountKey })

    const errPromise = client.syncAccount(accountKey, 'jmap-acc-1', 'state-1')
    worker.emit({
      type: 'SYNC_ERROR',
      requestId: worker.lastRequestId() as never,
      payload: { accountKey, error: 'network down' },
    })
    await expect(errPromise).rejects.toThrow('network down')
  })

  it('resolves concurrent requests independently, even out of order', async () => {
    const accountKey = 'acc-key-1' as AccountKey
    const first = client.syncAccount(accountKey, 'jmap-acc-1', 'state-1')
    const firstId = worker.lastRequestId()
    const second = client.syncAccount(accountKey, 'jmap-acc-2', 'state-2')
    const secondId = worker.lastRequestId()

    expect(firstId).not.toBe(secondId)

    // Reply to the second request first.
    worker.emit({
      type: 'SYNC_SUCCESS',
      requestId: secondId as never,
      payload: { accountKey },
    })
    worker.emit({
      type: 'SYNC_SUCCESS',
      requestId: firstId as never,
      payload: { accountKey },
    })

    await expect(first).resolves.toEqual({ accountKey })
    await expect(second).resolves.toEqual({ accountKey })
  })

  it('rejects a request that times out without a response', async () => {
    vi.useFakeTimers()
    const shortTimeoutClient = new JmapWorkerClient(worker, 50)

    const promise = shortTimeoutClient.teardownSession()
    const assertion = expect(promise).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(51)
    await assertion
  })

  it('onConnectionStatus/onStateChange/onSessionTeardown fire on unsolicited messages and can unsubscribe', () => {
    const statuses: string[] = []
    const changes: unknown[] = []
    const canaries: string[] = []

    const unsubStatus = client.onConnectionStatus((s) => statuses.push(s))
    client.onStateChange((c) => changes.push(c))
    client.onSessionTeardown((canary) => canaries.push(canary))

    worker.emit({
      type: 'CONNECTION_STATUS',
      payload: { status: 'connecting' },
    })
    worker.emit({
      type: 'STATE_CHANGE',
      payload: { changed: { acc1: { Email: 's1' } } },
    })
    worker.emit({
      type: 'SESSION_TEARDOWN',
      payload: { canary: 'TOKEN_CLEARED_OK' },
    })

    expect(statuses).toEqual(['connecting'])
    expect(changes).toEqual([{ acc1: { Email: 's1' } }])
    expect(canaries).toEqual(['TOKEN_CLEARED_OK'])

    unsubStatus()
    worker.emit({
      type: 'CONNECTION_STATUS',
      payload: { status: 'authenticated' },
    })
    expect(statuses).toEqual(['connecting']) // unchanged after unsubscribe
  })

  it('dispose() terminates the worker and rejects pending requests', async () => {
    const promise = client.teardownSession()
    client.dispose()

    await expect(promise).rejects.toThrow('disposed')
    expect(worker.terminated).toBe(true)
  })

  it('forwards an allowed IPC_INVOKE to the real Tauri invoke() and replies with the result', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: { kind: 'absent' } })

    worker.emit({
      type: 'IPC_INVOKE',
      requestId: 'w:1' as never,
      payload: { command: 'local_read_account', request: { accountKey: 'a1' } },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(invokeMock).toHaveBeenCalledWith('local_read_account', {
      request: { accountKey: 'a1' },
    })
    const reply = worker.posted.find(
      (m) => m.type === 'IPC_INVOKE_RESULT',
    ) as Extract<MainToWorkerMessage, { type: 'IPC_INVOKE_RESULT' }>
    expect(reply.requestId).toBe('w:1')
    expect(reply.payload).toEqual({
      ok: true,
      value: { ok: true, value: { kind: 'absent' } },
    })
  })

  it('rejects an IPC_INVOKE for a command outside the allowlist WITHOUT calling invoke()', async () => {
    worker.emit({
      type: 'IPC_INVOKE',
      requestId: 'w:2' as never,
      payload: { command: 'not_a_real_command', request: {} },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(invokeMock).not.toHaveBeenCalled()
    const reply = worker.posted.find(
      (m) => m.type === 'IPC_INVOKE_RESULT',
    ) as Extract<MainToWorkerMessage, { type: 'IPC_INVOKE_RESULT' }>
    expect(reply.payload.ok).toBe(false)
  })

  it('replies with a transport error when the real invoke() rejects', async () => {
    invokeMock.mockRejectedValue(new Error('tauri ipc failed'))

    worker.emit({
      type: 'IPC_INVOKE',
      requestId: 'w:3' as never,
      payload: { command: 'local_list_accounts', request: {} },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    const reply = worker.posted.find(
      (m) => m.type === 'IPC_INVOKE_RESULT',
    ) as Extract<MainToWorkerMessage, { type: 'IPC_INVOKE_RESULT' }>
    expect(reply.payload).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'tauri ipc failed' },
    })
  })
})

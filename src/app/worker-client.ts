import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { IPC_READ_COMMANDS, IPC_WRITE_COMMANDS } from '../ipc/commands'
import { workerRequestIdFromString } from '../workers/protocol'
import type {
  IpcBridgeInvokeResult,
  IpcInvokeMessage,
  IpcInvokeResultMessage,
  MainToWorkerMessage,
  RemoteConnectionStatus,
  RemoteSessionInput,
  WorkerRequestId,
  WorkerToMainMessage,
} from '../workers/protocol'
import type { AccountKey } from '../domain/ids'
import type { SendMutation } from '../domain/pending-mutation'

const ALLOWED_IPC_COMMANDS = new Set<string>([
  ...IPC_READ_COMMANDS,
  ...IPC_WRITE_COMMANDS,
])

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * The subset of the Worker API this client depends on. Lets tests inject a
 * fake without a real browser Worker.
 */
export interface WorkerLike {
  postMessage(message: MainToWorkerMessage): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerToMainMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

type PendingRequest = Readonly<{
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>

/**
 * Main-thread side of the JMAP Worker bridge. Owns two independent
 * responsibilities:
 *
 * 1. Requests the Worker sends to us and correlates by requestId
 *    (INIT_SESSION, TEARDOWN_SESSION, SYNC_ACCOUNT, SEND_EMAIL).
 * 2. IPC_INVOKE forwarding: the Worker has no `window`, so it cannot call
 *    @tauri-apps/api/core's invoke() itself (see workers/ipc-bridge.ts).
 *    We run the real invoke() here and post the result back.
 */
export class JmapWorkerClient {
  private readonly worker: WorkerLike
  private readonly pending = new Map<WorkerRequestId, PendingRequest>()
  private readonly timeoutMs: number
  private counter = 0

  private connectionStatusListeners = new Set<
    (status: RemoteConnectionStatus) => void
  >()
  private stateChangeListeners = new Set<
    (change: Record<string, Record<string, string>>) => void
  >()
  private sessionTeardownListeners = new Set<(canary: string) => void>()

  constructor(
    worker: WorkerLike = new Worker(
      new URL('../workers/jmap-worker.ts', import.meta.url),
      { type: 'module' },
    ),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.worker = worker
    this.timeoutMs = timeoutMs

    this.worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      this.handleMessage(event.data)
    }

    this.worker.onerror = (err) => {
      console.error('[WorkerClient] Error en el Web Worker:', err)
    }
  }

  initSession(
    input: RemoteSessionInput,
  ): Promise<{ primaryAccounts: Record<string, string> }> {
    return this.request('INIT_SESSION', { payload: input })
  }

  teardownSession(): Promise<{ canary: string }> {
    return this.request('TEARDOWN_SESSION', {})
  }

  syncAccount(
    accountKey: AccountKey,
    jmapAccountId: string,
    sinceState: string,
  ): Promise<{ accountKey: AccountKey }> {
    return this.request('SYNC_ACCOUNT', {
      payload: { accountKey, jmapAccountId, sinceState },
    })
  }

  sendEmail(
    accountKey: AccountKey,
    jmapAccountId: string,
    mutation: SendMutation,
  ): Promise<{ mutationId: string }> {
    return this.request('SEND_EMAIL', {
      payload: { accountKey, jmapAccountId, mutation },
    })
  }

  onConnectionStatus(
    listener: (status: RemoteConnectionStatus) => void,
  ): () => void {
    this.connectionStatusListeners.add(listener)
    return () => this.connectionStatusListeners.delete(listener)
  }

  /** JMAP RFC 8887 push, forwarded verbatim. */
  onStateChange(
    listener: (change: Record<string, Record<string, string>>) => void,
  ): () => void {
    this.stateChangeListeners.add(listener)
    return () => this.stateChangeListeners.delete(listener)
  }

  /** Fires only when the token expired on its own — not for an explicit teardownSession() call. */
  onSessionTeardown(listener: (canary: string) => void): () => void {
    this.sessionTeardownListeners.add(listener)
    return () => this.sessionTeardownListeners.delete(listener)
  }

  dispose(): void {
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('JmapWorkerClient disposed'))
    }
    this.pending.clear()
    this.worker.terminate()
  }

  private request<T>(
    type: 'INIT_SESSION' | 'TEARDOWN_SESSION' | 'SYNC_ACCOUNT' | 'SEND_EMAIL',
    rest: Record<string, unknown>,
  ): Promise<T> {
    const requestId = workerRequestIdFromString(`m:${++this.counter}`)

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`JmapWorkerClient: "${type}" timed out`))
      }, this.timeoutMs)

      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })

      this.worker.postMessage({
        type,
        requestId,
        ...rest,
      } as MainToWorkerMessage)
    })
  }

  private settle(requestId: WorkerRequestId, ok: true, value: unknown): void
  private settle(requestId: WorkerRequestId, ok: false, error: unknown): void
  private settle(
    requestId: WorkerRequestId,
    ok: boolean,
    valueOrError: unknown,
  ): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    clearTimeout(entry.timer)
    if (ok) {
      entry.resolve(valueOrError)
    } else {
      entry.reject(
        valueOrError instanceof Error
          ? valueOrError
          : new Error(String(valueOrError)),
      )
    }
  }

  private handleMessage(data: WorkerToMainMessage): void {
    switch (data.type) {
      case 'IPC_INVOKE':
        this.handleIpcInvoke(data)
        return

      case 'SESSION_READY':
        this.settle(data.requestId, true, data.payload)
        return
      case 'SESSION_ERROR':
        this.settle(data.requestId, false, new Error(data.payload.error))
        return
      case 'TEARDOWN_COMPLETE':
        this.settle(data.requestId, true, data.payload)
        return
      case 'SYNC_SUCCESS':
        this.settle(data.requestId, true, data.payload)
        return
      case 'SYNC_ERROR':
        this.settle(data.requestId, false, new Error(data.payload.error))
        return
      case 'SEND_SUCCESS':
        this.settle(data.requestId, true, data.payload)
        return
      case 'SEND_ERROR':
        this.settle(data.requestId, false, new Error(data.payload.error))
        return

      case 'SESSION_TEARDOWN':
        for (const listener of this.sessionTeardownListeners) {
          listener(data.payload.canary)
        }
        return
      case 'CONNECTION_STATUS':
        for (const listener of this.connectionStatusListeners) {
          listener(data.payload.status)
        }
        return
      case 'STATE_CHANGE':
        for (const listener of this.stateChangeListeners) {
          listener(data.payload.changed)
        }
        return

      default: {
        const exhaustive: never = data
        console.error('[WorkerClient] Unhandled message type', exhaustive)
      }
    }
  }

  private handleIpcInvoke(message: IpcInvokeMessage): void {
    const { command, request } = message.payload

    if (!ALLOWED_IPC_COMMANDS.has(command)) {
      this.replyIpcInvoke(message.requestId, {
        ok: false,
        error: {
          kind: 'unexpected',
          message: `command "${command}" is not in the Local Engine allowlist`,
        },
      })
      return
    }

    tauriInvoke(command, { request })
      .then((value) => {
        this.replyIpcInvoke(message.requestId, {
          ok: true,
          value: value as IpcBridgeInvokeResult,
        })
      })
      .catch((cause: unknown) => {
        this.replyIpcInvoke(message.requestId, {
          ok: false,
          error: {
            kind: 'unavailable',
            message: cause instanceof Error ? cause.message : String(cause),
          },
        })
      })
  }

  private replyIpcInvoke(
    requestId: WorkerRequestId,
    payload: IpcInvokeResultMessage['payload'],
  ): void {
    this.worker.postMessage({
      type: 'IPC_INVOKE_RESULT',
      requestId,
      payload,
    } satisfies MainToWorkerMessage)
  }
}

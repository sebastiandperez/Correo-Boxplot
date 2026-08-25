import { IPC_READ_COMMANDS, IPC_WRITE_COMMANDS } from '../ipc/commands'
import type { IpcInvoke, IpcListen } from '../ipc/local-engine-ipc-client'
import { workerRequestIdFromString } from './protocol'
import type {
  IpcInvokeMessage,
  IpcInvokeResultMessage,
  WorkerRequestId,
} from './protocol'

const ALLOWED_COMMANDS = new Set<string>([
  ...IPC_READ_COMMANDS,
  ...IPC_WRITE_COMMANDS,
])

type PendingInvoke = Readonly<{
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}>

/**
 * Bridges LocalEngineIpcClient's invoke() out of the Worker. A Worker's
 * global scope has no `window`, so @tauri-apps/api/core's invoke()
 * (which reads window.__TAURI_INTERNALS__.invoke) throws
 * ReferenceError if called directly from here — see C1-04 / H1.
 *
 * Only commands present in IPC_READ_COMMANDS/IPC_WRITE_COMMANDS are
 * forwarded to main; anything else is rejected before crossing the
 * boundary, so the Worker cannot invoke arbitrary Tauri commands through
 * this bridge.
 */
export function createIpcInvokeBridge(
  post: (message: IpcInvokeMessage) => void,
): {
  invoke: IpcInvoke
  resolveInvoke: (message: IpcInvokeResultMessage) => void
} {
  const pending = new Map<WorkerRequestId, PendingInvoke>()
  let counter = 0

  const invoke: IpcInvoke = <T>(
    command: string,
    args?: Readonly<{ request: object }>,
  ) => {
    if (!ALLOWED_COMMANDS.has(command)) {
      return Promise.reject(
        new Error(
          `ipc-bridge: command "${command}" is not in the Local Engine allowlist`,
        ),
      )
    }

    const requestId = workerRequestIdFromString(`w:${++counter}`)
    return new Promise<T>((resolve, reject) => {
      pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      post({
        type: 'IPC_INVOKE',
        requestId,
        payload: { command, request: args?.request ?? {} },
      })
    })
  }

  function resolveInvoke(message: IpcInvokeResultMessage): void {
    const entry = pending.get(message.requestId)
    if (!entry) return
    pending.delete(message.requestId)

    if (message.payload.ok) {
      entry.resolve(message.payload.value)
    } else {
      entry.reject(new Error(message.payload.error.message))
    }
  }

  return { invoke, resolveInvoke }
}

/**
 * Coordinator/Outbox (the only consumers of the Worker's adapters) use
 * SyncPort exclusively. LocalChangeSource — the port backed by listen() —
 * is Application/Pinia's concern per docs/architecture/layers.md; nothing
 * in the Worker subscribes to it. This stub exists only so
 * LocalEngineIpcClient's constructor is satisfied; calling it is a
 * programming error and should fail loudly rather than silently hang.
 */
export const unsupportedListen: IpcListen = () =>
  Promise.reject(
    new Error(
      'ipc-bridge: listen() is not supported inside the JMAP worker (LocalChangeSource is Application-only, see docs/architecture/layers.md)',
    ),
  )

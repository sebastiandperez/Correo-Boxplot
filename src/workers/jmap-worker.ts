/// <reference lib="webworker" />
import { LocalEngineIpcClient } from '../ipc/local-engine-ipc-client'
import { createTauriLocalEngineAdapters } from '../adapters/tauri'
import { createIpcInvokeBridge, unsupportedListen } from './ipc-bridge'
import { TokenManager } from '../jmap/auth/token-manager'
import { JamClientAdapter } from '../jmap/adapter'
import { Coordinator } from '../sync/coordinator'
import { Outbox } from '../sync/outbox'
import { JmapAuthError } from '../jmap/errors'
import type { AuthConfig } from '../jmap/transport/http'
import type { SyncPort } from '../ports/sync-port'
import type { ReadRepository } from '../ports/read-repository'
import type { JmapClient } from '../jmap/client'
import type {
  MainToWorkerMessage,
  RemoteConnectionStatus,
  WorkerToMainMessage,
} from './protocol'

export type WorkerRuntimeDeps = Readonly<{
  post: (message: WorkerToMainMessage) => void
  syncPort: SyncPort
  readRepository: ReadRepository
  resolveIpcInvoke: (
    message: Extract<MainToWorkerMessage, { type: 'IPC_INVOKE_RESULT' }>,
  ) => void
  createJmapClient?: (sessionUrl: string, auth: AuthConfig) => JmapClient
}>

export type WorkerRuntime = Readonly<{
  handleMessage: (data: MainToWorkerMessage) => void
}>

/**
 * Pure factory for the Worker's message-handling state machine. Has no
 * dependency on WorkerGlobalScope/self — every side effect goes through
 * the injected `post`/`syncPort`/`resolveIpcInvoke`, so it's directly
 * unit-testable (mirrors the pure-function-extracted-from-#[tauri::command]
 * pattern already used on the Rust side, e.g. src-tauri/src/ipc/commands.rs).
 * The runtime guard at the bottom of this file only wires this to the real
 * self.postMessage/self.onmessage.
 */
export function createWorkerRuntime(deps: WorkerRuntimeDeps): WorkerRuntime {
  const { post, syncPort, readRepository, resolveIpcInvoke } = deps
  const createJmapClient =
    deps.createJmapClient ??
    ((sessionUrl: string, auth: AuthConfig) =>
      new JamClientAdapter(sessionUrl, auth))

  // Token lives ONLY in Worker memory — never in Pinia, SQLite, or localStorage
  // per AGENTS.md security invariants.
  const tokenManager = new TokenManager()

  let jmapClient: JmapClient | null = null
  let coordinator: Coordinator | null = null
  let outbox: Outbox | null = null
  let sessionGeneration = 0

  // Set right before an explicit TEARDOWN_SESSION request calls
  // tokenManager.invalidate(), so the onTokenExpired listener below can
  // tell "main asked for this" apart from "the token just expired on its
  // own timer" and avoid posting SESSION_TEARDOWN twice for one teardown.
  let explicitTeardownInFlight = false
  let invalidationStatus: RemoteConnectionStatus = 'expired'

  function postStatus(status: RemoteConnectionStatus): void {
    post({ type: 'CONNECTION_STATUS', payload: { status } })
  }

  function resetToAnonymous(): void {
    sessionGeneration += 1
    jmapClient = null
    coordinator = null
    outbox = null
  }

  // Listen for token invalidation (natural expiry, or a 401 surfaced by an
  // in-flight call) to tear down the real client.
  tokenManager.onTokenExpired(() => {
    resetToAnonymous()
    postStatus(invalidationStatus)
    invalidationStatus = 'expired'

    if (explicitTeardownInFlight) {
      // The TEARDOWN_SESSION handler below will post TEARDOWN_COMPLETE
      // itself, correlated to main's requestId. Don't double-announce.
      return
    }

    post({
      type: 'SESSION_TEARDOWN',
      payload: { canary: tokenManager.getCanaryStatus() },
    })
  })

  function handleMessage(data: MainToWorkerMessage): void {
    switch (data.type) {
      case 'IPC_INVOKE_RESULT': {
        resolveIpcInvoke(data)
        return
      }

      case 'INIT_SESSION': {
        const { sessionUrl, token, expiresInSeconds } = data.payload
        postStatus('connecting')

        // Store token exclusively in Worker memory.
        tokenManager.setToken(token, expiresInSeconds)

        const authConfig = tokenManager.getAuthConfig()
        if (!authConfig) {
          postStatus('error')
          post({
            type: 'SESSION_ERROR',
            requestId: data.requestId,
            payload: { error: 'Failed to store the session token.' },
          })
          return
        }

        resetToAnonymous()
        const generation = sessionGeneration
        const activeClient = createJmapClient(sessionUrl, authConfig)
        jmapClient = activeClient
        coordinator = new Coordinator(jmapClient, syncPort, readRepository)
        outbox = new Outbox(jmapClient, syncPort, readRepository)

        activeClient
          .openSession()
          .then((session) => {
            if (
              generation !== sessionGeneration ||
              jmapClient !== activeClient ||
              tokenManager.getToken() === null
            ) {
              return
            }

            postStatus('authenticated')
            post({
              type: 'SESSION_READY',
              requestId: data.requestId,
              payload: { primaryAccounts: session.primaryAccounts },
            })
          })
          .catch((err: unknown) => {
            if (generation !== sessionGeneration) return
            tokenManager.clearToken()
            resetToAnonymous()
            postStatus('error')
            post({
              type: 'SESSION_ERROR',
              requestId: data.requestId,
              payload: {
                error: safeRemoteError(err),
              },
            })
          })
        return
      }

      case 'TEARDOWN_SESSION': {
        explicitTeardownInFlight = true
        invalidationStatus = 'anonymous'
        // Synchronously fires the onTokenExpired listener above, which
        // already resets to anonymous and posts CONNECTION_STATUS —
        // don't post it a second time here.
        tokenManager.invalidate()
        explicitTeardownInFlight = false

        post({
          type: 'TEARDOWN_COMPLETE',
          requestId: data.requestId,
          payload: { canary: tokenManager.getCanaryStatus() },
        })
        return
      }

      case 'SYNC_ACCOUNT': {
        const { accountKey, jmapAccountId } = data.payload
        const activeCoordinator = coordinator
        const operationClient = jmapClient
        if (activeCoordinator === null) {
          post({
            type: 'SYNC_ERROR',
            requestId: data.requestId,
            payload: { accountKey, error: 'No authenticated JMAP session' },
          })
          return
        }
        activeCoordinator
          .syncAccount(accountKey, jmapAccountId)
          .then(() => {
            post({
              type: 'SYNC_SUCCESS',
              requestId: data.requestId,
              payload: { accountKey },
            })
          })
          .catch((error: unknown) => {
            invalidateOnAuthError(error, operationClient)
            post({
              type: 'SYNC_ERROR',
              requestId: data.requestId,
              payload: { accountKey, error: safeRemoteError(error) },
            })
          })
        return
      }

      case 'SEND_EMAIL': {
        const { accountKey, jmapAccountId, mutationId } = data.payload
        const activeOutbox = outbox
        const operationClient = jmapClient
        if (activeOutbox === null) {
          post({
            type: 'SEND_ERROR',
            requestId: data.requestId,
            payload: { mutationId, error: 'No authenticated JMAP session' },
          })
          return
        }
        activeOutbox
          .processSendMutation(accountKey, jmapAccountId, mutationId)
          .then((outcome) => {
            post({
              type: 'SEND_SUCCESS',
              requestId: data.requestId,
              payload: { mutationId, outcome: outcome.kind },
            })
          })
          .catch((error: unknown) => {
            invalidateOnAuthError(error, operationClient)
            post({
              type: 'SEND_ERROR',
              requestId: data.requestId,
              payload: {
                mutationId,
                error: safeRemoteError(error),
              },
            })
          })
        return
      }

      default: {
        const exhaustive: never = data
        console.error('[jmap-worker] Unhandled message type', exhaustive)
      }
    }
  }

  function invalidateOnAuthError(
    error: unknown,
    operationClient: JmapClient | null,
  ): void {
    if (error instanceof JmapAuthError && jmapClient === operationClient) {
      invalidationStatus = 'expired'
      tokenManager.invalidate()
    }
  }

  function safeRemoteError(error: unknown): string {
    return error instanceof JmapAuthError
      ? 'Remote authentication failed'
      : 'Remote operation failed'
  }

  return { handleMessage }
}

// Enforce that we are inside a Worker
if (
  typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope
) {
  function post(message: WorkerToMainMessage): void {
    self.postMessage(message)
  }

  // A Worker's global scope has no `window`, so LocalEngineIpcClient's
  // default invoke() (@tauri-apps/api/core, which reads
  // window.__TAURI_INTERNALS__) throws ReferenceError if called directly
  // from here. Bridge invoke() through main via postMessage instead (H1).
  const { invoke: bridgedInvoke, resolveInvoke } = createIpcInvokeBridge(post)
  const client = new LocalEngineIpcClient(bridgedInvoke, unsupportedListen)
  const adapters = createTauriLocalEngineAdapters(client)

  const runtime = createWorkerRuntime({
    post,
    syncPort: adapters.syncPort,
    readRepository: adapters.readRepository,
    resolveIpcInvoke: resolveInvoke,
  })

  self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
    runtime.handleMessage(event.data)
  }
}

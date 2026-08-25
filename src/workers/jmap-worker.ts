/// <reference lib="webworker" />
import { LocalEngineIpcClient } from '../ipc/local-engine-ipc-client'
import { createTauriLocalEngineAdapters } from '../adapters/tauri'
import { createIpcInvokeBridge, unsupportedListen } from './ipc-bridge'
import { TokenManager } from '../jmap/auth/token-manager'
import { JamClientAdapter } from '../jmap/adapter'
import { MockJmapClient } from '../jmap/mock-client'
import { Coordinator } from '../sync/coordinator'
import { Outbox } from '../sync/outbox'
import type { SyncPort } from '../ports/sync-port'
import type { JmapClient } from '../jmap/client'
import type {
  MainToWorkerMessage,
  RemoteConnectionStatus,
  WorkerToMainMessage,
} from './protocol'

export type WorkerRuntimeDeps = Readonly<{
  post: (message: WorkerToMainMessage) => void
  syncPort: SyncPort
  resolveIpcInvoke: (
    message: Extract<MainToWorkerMessage, { type: 'IPC_INVOKE_RESULT' }>,
  ) => void
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
  const { post, syncPort, resolveIpcInvoke } = deps

  // Token lives ONLY in Worker memory — never in Pinia, SQLite, or localStorage
  // per AGENTS.md security invariants.
  const tokenManager = new TokenManager()

  // The active JMAP client — either a real JamClientAdapter (when authenticated)
  // or a MockJmapClient (for offline/development mode).
  let jmapClient: JmapClient = new MockJmapClient()
  let coordinator = new Coordinator(jmapClient, syncPort)
  let outbox = new Outbox(jmapClient, syncPort)
  let stateChangeUnsubscribe: (() => void) | null = null

  // Set right before an explicit TEARDOWN_SESSION request calls
  // tokenManager.invalidate(), so the onTokenExpired listener below can
  // tell "main asked for this" apart from "the token just expired on its
  // own timer" and avoid posting SESSION_TEARDOWN twice for one teardown.
  let explicitTeardownInFlight = false

  function postStatus(status: RemoteConnectionStatus): void {
    post({ type: 'CONNECTION_STATUS', payload: { status } })
  }

  function teardownPushListener(): void {
    stateChangeUnsubscribe?.()
    stateChangeUnsubscribe = null
  }

  function resetToAnonymous(): void {
    teardownPushListener()
    jmapClient = new MockJmapClient()
    coordinator = new Coordinator(jmapClient, syncPort)
    outbox = new Outbox(jmapClient, syncPort)
  }

  // Listen for token invalidation (natural expiry, or a 401 surfaced by an
  // in-flight call) to tear down the real client.
  tokenManager.onTokenExpired(() => {
    resetToAnonymous()
    postStatus('anonymous')

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

        // Replace MockJmapClient with a real JamClientAdapter.
        const activeClient = new JamClientAdapter(sessionUrl, authConfig)
        jmapClient = activeClient
        coordinator = new Coordinator(jmapClient, syncPort)
        outbox = new Outbox(jmapClient, syncPort)

        activeClient
          .openSession()
          .then((session) => {
            teardownPushListener()
            stateChangeUnsubscribe = activeClient.onStateChange((change) => {
              post({ type: 'STATE_CHANGE', payload: change })
            })

            postStatus('authenticated')
            post({
              type: 'SESSION_READY',
              requestId: data.requestId,
              payload: { primaryAccounts: session.primaryAccounts },
            })
          })
          .catch((err: unknown) => {
            resetToAnonymous()
            postStatus('error')
            post({
              type: 'SESSION_ERROR',
              requestId: data.requestId,
              payload: {
                error: err instanceof Error ? err.message : String(err),
              },
            })
          })
        return
      }

      case 'TEARDOWN_SESSION': {
        explicitTeardownInFlight = true
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
        const { accountKey, jmapAccountId, sinceState } = data.payload
        coordinator
          .syncEmails(accountKey, jmapAccountId, sinceState)
          .then(() => {
            post({
              type: 'SYNC_SUCCESS',
              requestId: data.requestId,
              payload: { accountKey },
            })
          })
          .catch((error: unknown) => {
            post({
              type: 'SYNC_ERROR',
              requestId: data.requestId,
              payload: { accountKey, error: String(error) },
            })
          })
        return
      }

      case 'SEND_EMAIL': {
        const { accountKey, jmapAccountId, mutation } = data.payload
        outbox
          .processSendMutation(accountKey, jmapAccountId, mutation)
          .then(() => {
            post({
              type: 'SEND_SUCCESS',
              requestId: data.requestId,
              payload: { mutationId: mutation.mutationId },
            })
          })
          .catch((error: unknown) => {
            post({
              type: 'SEND_ERROR',
              requestId: data.requestId,
              payload: {
                mutationId: mutation.mutationId,
                error: String(error),
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
    resolveIpcInvoke: resolveInvoke,
  })

  self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
    runtime.handleMessage(event.data)
  }
}

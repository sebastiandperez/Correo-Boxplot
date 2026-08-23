/// <reference lib="webworker" />
import { LocalEngineIpcClient } from '../ipc/local-engine-ipc-client'
import { createTauriLocalEngineAdapters } from '../adapters/tauri'
import { TokenManager } from '../jmap/auth/token-manager'
import { JamClientAdapter } from '../jmap/adapter'
import { MockJmapClient } from '../jmap/mock-client'
import { Coordinator } from '../sync/coordinator'
import { Outbox } from '../sync/outbox'
import type { JmapClient } from '../jmap/client'
import type { MainToWorkerMessage } from './protocol'

// Enforce that we are inside a Worker
if (
  typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope
) {
  const client = new LocalEngineIpcClient()
  const adapters = createTauriLocalEngineAdapters(client)

  // Token lives ONLY in Worker memory — never in Pinia, SQLite, or localStorage
  // per AGENTS.md security invariants.
  const tokenManager = new TokenManager()

  // The active JMAP client — either a real JamClientAdapter (when authenticated)
  // or a MockJmapClient (for offline/development mode).
  let jmapClient: JmapClient = new MockJmapClient()
  let coordinator = new Coordinator(jmapClient, adapters.syncPort)
  let outbox = new Outbox(jmapClient, adapters.syncPort)

  // Listen for token invalidation to tear down the real client
  tokenManager.onTokenExpired(() => {
    jmapClient = new MockJmapClient()
    coordinator = new Coordinator(jmapClient, adapters.syncPort)
    outbox = new Outbox(jmapClient, adapters.syncPort)

    self.postMessage({
      type: 'SESSION_TEARDOWN',
      payload: { canary: tokenManager.getCanaryStatus() },
    })
  })

  self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
    const data = event.data

    if (data.type === 'INIT_SESSION') {
      // Received from main thread after WebAuthn authentication
      const { sessionUrl, token, expiresInSeconds } = data.payload as {
        sessionUrl: string
        token: string
        expiresInSeconds?: number
      }

      // Store token exclusively in Worker memory
      tokenManager.setToken(token, expiresInSeconds)

      const authConfig = tokenManager.getAuthConfig()
      if (authConfig) {
        // Replace MockJmapClient with real JamClientAdapter
        jmapClient = new JamClientAdapter(sessionUrl, authConfig)
        coordinator = new Coordinator(jmapClient, adapters.syncPort)
        outbox = new Outbox(jmapClient, adapters.syncPort)

        // Open session to validate server capabilities
        jmapClient
          .openSession()
          .then((session) => {
            self.postMessage({
              type: 'SESSION_READY',
              payload: { primaryAccounts: session.primaryAccounts },
            })
          })
          .catch((err) => {
            self.postMessage({
              type: 'SESSION_ERROR',
              payload: { error: err instanceof Error ? err.message : String(err) },
            })
          })
      }
    } else if (data.type === 'TEARDOWN_SESSION') {
      tokenManager.invalidate()
      jmapClient = new MockJmapClient()
      coordinator = new Coordinator(jmapClient, adapters.syncPort)
      outbox = new Outbox(jmapClient, adapters.syncPort)

      self.postMessage({
        type: 'TEARDOWN_COMPLETE',
        payload: { canary: tokenManager.getCanaryStatus() },
      })
    } else if (data.type === 'SYNC_ACCOUNT') {
      const { accountKey, jmapAccountId, sinceState } = data.payload
      coordinator
        .syncEmails(accountKey, jmapAccountId, sinceState)
        .then(() => {
          self.postMessage({
            type: 'SYNC_SUCCESS',
            payload: { accountKey },
          })
        })
        .catch((error) => {
          self.postMessage({
            type: 'SYNC_ERROR',
            payload: { accountKey, error: String(error) },
          })
        })
    } else if (data.type === 'SEND_EMAIL') {
      const { accountKey, jmapAccountId, mutation } = data.payload
      outbox
        .processSendMutation(accountKey, jmapAccountId, mutation)
        .then(() => {
          self.postMessage({
            type: 'SEND_SUCCESS',
            payload: { mutationId: mutation.mutationId },
          })
        })
        .catch((error) => {
          self.postMessage({
            type: 'SEND_ERROR',
            payload: { mutationId: mutation.mutationId, error: String(error) },
          })
        })
    }
  }
}
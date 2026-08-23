/// <reference lib="webworker" />
import { TokenManager } from '../jmap/auth/token-manager'
import { JamClientAdapter } from '../jmap/adapter'

// Enforce that we are inside a Worker
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const tokenManager = new TokenManager()
  let jamAdapter: JamClientAdapter | null = null

  // Listen for setup and teardown commands from the main thread
  self.onmessage = (event: MessageEvent) => {
    const data = event.data

    if (data.type === 'INIT_SESSION') {
      const { sessionUrl, token } = data.payload
      
      // Token lives only in worker memory
      tokenManager.setToken(token)

      const authConfig = tokenManager.getAuthConfig()
      if (authConfig) {
        jamAdapter = new JamClientAdapter(sessionUrl, authConfig)
        
        // This is a bootstrap stub. In the future, the Coordinator and Outbox
        // will be instantiated here and will use the jamAdapter.
        jamAdapter.openSession().then(session => {
          self.postMessage({ type: 'SESSION_READY', payload: { primaryAccounts: session.primaryAccounts } })
        }).catch(err => {
          self.postMessage({ type: 'SESSION_ERROR', payload: { error: err.message } })
        })
      }
    } else if (data.type === 'TEARDOWN_SESSION') {
      tokenManager.invalidate()
      jamAdapter = null
      
      // Canary status ensures no token leaks in memory
      self.postMessage({ type: 'TEARDOWN_COMPLETE', payload: { canary: tokenManager.getCanaryStatus() } })
    }
  }
}

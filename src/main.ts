import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { createTauriLocalEngineAdapters } from './adapters/tauri'
import { createApplicationContext } from './app/application'
import { applicationContextKey } from './app/vue-application-context'
import { LocalEngineIpcClient } from './ipc/local-engine-ipc-client'
import { JmapWorkerClient } from './app/worker-client'
import { createTauriRemoteRuntime } from './app/remote'
import './styles.css'
import './styles/shell.css'

const pinia = createPinia()
const client = new LocalEngineIpcClient()
const adapters = createTauriLocalEngineAdapters(client)

const workerClient = new JmapWorkerClient()
const remoteRuntime = createTauriRemoteRuntime(adapters)

const context = createApplicationContext({
  ...adapters,
  workerClient,
  remoteApplication: remoteRuntime.remoteApplication,
  bodyMaterializer: remoteRuntime.bodyMaterializer,
})

createApp(App).use(pinia).provide(applicationContextKey, context).mount('#app')

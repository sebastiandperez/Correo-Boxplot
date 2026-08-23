import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { createTauriLocalEngineAdapters } from './adapters/tauri'
import { createApplicationContext } from './app/application'
import { applicationContextKey } from './app/vue-application-context'
import { LocalEngineIpcClient } from './ipc/local-engine-ipc-client'
import './styles.css'
import './styles/shell.css'

const pinia = createPinia()
const client = new LocalEngineIpcClient()
const context = createApplicationContext(createTauriLocalEngineAdapters(client))

createApp(App).use(pinia).provide(applicationContextKey, context).mount('#app')

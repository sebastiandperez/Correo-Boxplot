import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import './styles.css'
import './styles/shell.css'

createApp(App).use(createPinia()).mount('#app')

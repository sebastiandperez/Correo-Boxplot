import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const runToken = process.env.A08_RUN_TOKEN
if (runToken === undefined || runToken.length === 0) {
  throw new Error('A08_RUN_TOKEN is required')
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  define: {
    __A08_RUN_TOKEN__: JSON.stringify(runToken),
  },
  build: {
    outDir: fileURLToPath(
      new URL('../../src-tauri/target/persona-a-dist', import.meta.url),
    ),
    emptyOutDir: true,
  },
})

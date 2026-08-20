import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      vitest: fileURLToPath(
        new URL('./browser-vitest-shim.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist-conformance', import.meta.url)),
    emptyOutDir: true,
  },
})

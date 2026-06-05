import { defineConfig } from 'vitest/config'
import path from 'path'

// Pin timezone so date/locale-dependent tests are deterministic across machines/CI.
// Buenos Aires (UTC-3, no DST) is the project's primary market.
process.env.TZ = 'America/Argentina/Buenos_Aires'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
  },
})

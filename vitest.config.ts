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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Scope coverage to the layers that have unit tests today (logic + API routes).
      // UI components are excluded until a jsdom/RTL setup lands.
      include: ['src/lib/**', 'src/app/api/**'],
      exclude: ['**/__tests__/**', '**/*.d.ts', 'src/lib/types/**'],
    },
  },
})

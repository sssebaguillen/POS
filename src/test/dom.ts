// Shared setup for component (jsdom) tests. Import this once at the top of any
// test file that also carries the `// @vitest-environment jsdom` docblock.
// Kept out of the global vitest setupFiles on purpose so the node-env unit
// tests never load react-dom / jest-dom.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

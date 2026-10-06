import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { dataRefresh } from './scripts/dev-refresh-plugin.mjs'

export default defineConfig({
  plugins: [react(), dataRefresh()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})

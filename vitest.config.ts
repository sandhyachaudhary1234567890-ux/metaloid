import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Frontend unit tests run in jsdom with no network: every fetch is stubbed.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    restoreMocks: true,
  },
})

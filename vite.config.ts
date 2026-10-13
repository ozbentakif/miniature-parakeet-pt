/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative asset paths, so the build works under a GitHub Pages sub-path
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
  },
})

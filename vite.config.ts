import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Frontend dev server on :5273, proxying /api to the Hono backend on :8790
// (dev-server.ts in local dev, index.ts in prod-like runs).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://localhost:8790', changeOrigin: true },
    },
  },
})

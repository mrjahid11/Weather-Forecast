import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config with dev-server proxy so client AJAX to /api forwards to backend
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
    proxy: {
      '/api/lab': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            const startedAt = Date.now()
            ;(req as { _stockInsightStartedAt?: number })._stockInsightStartedAt =
              startedAt
            console.info(
              `[${new Date(startedAt).toISOString()}] PROCESS_START frontend_api_proxy ${req.method} ${req.url}`,
            )
          })

          proxy.on('proxyRes', (proxyRes, req) => {
            const endedAt = Date.now()
            const startedAt = (
              req as { _stockInsightStartedAt?: number }
            )._stockInsightStartedAt
            const durationMs = typeof startedAt === 'number' ? endedAt - startedAt : 0
            console.info(
              `[${new Date(endedAt).toISOString()}] PROCESS_END frontend_api_proxy ${req.method} ${req.url} status=${proxyRes.statusCode} duration_ms=${durationMs}`,
            )
          })
        },
      },
    },
  },
})

import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// LAN HTTPS for phone testing: if C:\metaloid\certs\{key,cert}.pem exist
// (generate: cd server && node certs-gen.mjs), serve TLS so phone
// browsers treat the origin as secure (after bypassing the self-signed
// warning once) and unlock mic + transcription. Falls back to plain HTTP.
const keyPath = path.resolve(__dirname, 'certs', 'key.pem')
const certPath = path.resolve(__dirname, 'certs', 'cert.pem')
const tls = fs.existsSync(keyPath) && fs.existsSync(certPath)
console.log(`[metaloid] tls=${tls} key=${keyPath}`)

// Same-origin gateway: the dev/preview server proxies /api to the local
// gateway so a remote browser (tunnel, preview host, reverse proxy) reaches
// it without knowing 127.0.0.1 — an unreachable gateway still degrades to
// the app's honest offline/demo state.
const apiProxy = {
  '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: apiProxy,
    https: tls ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : undefined,
  },
  // production preview for phone testing (no StrictMode, no HMR):
  // npm run build && npx vite preview --port 4173 --host 0.0.0.0
  preview: {
    port: 4173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: apiProxy,
    https: tls ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : undefined,
  },
  build: { outDir: 'dist' },
})

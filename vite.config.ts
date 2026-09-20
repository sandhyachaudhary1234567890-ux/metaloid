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

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    https: tls ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : undefined,
  },
  // production preview for phone testing (no StrictMode, no HMR):
  // npm run build && npx vite preview --port 4173 --host 0.0.0.0
  preview: {
    port: 4173,
    host: '0.0.0.0',
    https: tls ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : undefined,
  },
  build: { outDir: 'dist' },
})

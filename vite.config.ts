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

// The app lives under /app/ so the repo root can serve the marketing page.
// Dev + preview get a tiny middleware that serves landing/index.html at "/"
// — one URL shows the site, one shows the product, same as production.
const landing = {
  name: 'metaloid-landing',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || '/').split('?')[0];
      if (url === '/' || url === '/index.html' || url === '/landing') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(fs.readFileSync(path.resolve(__dirname, 'landing/index.html')));
        return;
      }
      next();
    });
  },
  configurePreviewServer(server: import('vite').PreviewServer) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || '/').split('?')[0];
      if (url === '/' || url === '/index.html' || url === '/landing') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(fs.readFileSync(path.resolve(__dirname, 'landing/index.html')));
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), landing],
  // product UI is served from /app/; the landing page owns /
  base: '/app/',
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
  // dist/ is the whole deployable site: landing at the root, product in
  // /app/ (assets + public/ follow the base automatically).
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
    // Split the heavy, rarely-changing libraries out of the app chunk so the
    // shell paints fast and a UI edit doesn't invalidate 800 kB of vendor code.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-markdown': ['react-markdown', 'remark-gfm'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})

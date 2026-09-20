# metaloid — private personal AI operating system (frontend + demo transport)

Premium, minimal, **product-level** personal AI assistant. One loop:
open → ask → think → answer → speak / show / tool → memory / history.

## Run

```bash
npm run dev      # http://localhost:5173
npm run build
```

## Deploy — frontend on Vercel (`metaloid`), gateway on Render

The gateway is a persistent Node process (missions, OSINT jobs, SSE
streams), so it canNOT live on Vercel serverless. Split deploy:

**A. Push the repo to GitHub** (already committed locally — keys, certs,
and logs were verified absent from the commit):

```bash
cd C:\metaloid
gh repo create metaloid --private --source=. --push
```

(or create an empty private repo on github.com, then
`git remote add origin <url>`, `git push -u origin master`)

**B. Gateway → Render** (free tier works):

1. Render dashboard → New → Web Service → select the `metaloid` repo
2. Root directory: `server` · Build: `npm install` · Start: `npm start`
   (or use the `render.yaml` blueprint at repo root)
3. Environment variables:
   - `BIND_HOST` = `0.0.0.0`
   - `ALLOW_ORIGINS` = `https://metaloid.vercel.app`
     (use the real frontend URL once Vercel assigns it)
   - `OPENROUTER_API_KEY` = fresh key (**rotate first** — the key once
     pasted in chat is burned: dashboard → revoke → new key)
   - `NVIDIA_API_KEY` = leave unset unless NVIDIA access is enabled
     afterwards (current key has no model entitlements)
   - `NVIDIA_ENABLED` = `false`
4. Deploy → copy the service URL, e.g. `https://metaloid-gateway.onrender.com`
   (health: `GET /api/health` → `ai:true`)

**C. Frontend → Vercel** (project name: `metaloid`):

1. Vercel dashboard → Add New → Project → Import the `metaloid` repo
2. Framework preset: **Vite** (auto-detected; `vercel.json` pins
   build `npm run build`, output `dist`, SPA rewrites)
3. Environment variable (set BEFORE first build — Vite bakes it in):
   - `VITE_API_URL` = `https://metaloid-gateway.onrender.com`
4. Deploy → `https://metaloid.vercel.app`
   (If the gateway URL came later: set `VITE_API_URL`, redeploy — or set
   Backend URL once inside the app: Settings → Connections.)

**Notes that bite:**

- Free Render services sleep when idle → first request wakes in ~30–60s;
  the app shows honest offline/demo states meanwhile, then ONLINE.
- `server/data/*.json` resets on Render redeploys — browser history and
  memories (localStorage) are unaffected.
- Real `https://` on both ends: mic + transcription work with no cert
  tricks (unlike LAN testing). CORS stays locked to the frontend origin.
- Keys live only in Render env vars; the browser never sees them.

## Same-WiFi phone testing (host local)

Both servers bind the LAN **over HTTPS** (`certs/` from `server/certs-gen.mjs`;
gateway reads the same certs automatically):

- App: `https://192.168.29.25:5173` · Gateway: `https://192.168.29.25:8787`
  (your laptop IP — re-check with `Get-NetIPAddress` if Wi-Fi changes;
  regenerate certs if the IP changes).
- For the cleanest phone test use the **production build** (no dev
  double-mount, no hot-reload): `npm run build` →
  `npx vite preview --port 4173 --host 0.0.0.0` → phone opens
  `https://192.168.29.25:4173` (same cert warning bypass once).
  Dev (`:5173`) is for coding; prod (`:4173`) is for judging.

1. Phone on the **same Wi-Fi** → open `https://192.168.29.25:5173` →
   **Advanced → Proceed** past the self-signed warning (one time).
   After the bypass the origin counts as **secure → mic + transcription work**.
2. On the phone: Settings → Connections → Backend URL →
   `https://192.168.29.25:8787` (phone's `127.0.0.1` is itself, not the laptop;
   `https` is required — an `https` page cannot call an `http` gateway).
   Sidebar should show **ONLINE**.
3. If the phone can't reach it: allow inbound TCP 5173 + 8787 in
   Windows Defender Firewall (admin), same band on both devices.
4. No-flag fallback: plain `http://` LAN works for everything EXCEPT mic
   (Chrome blocks capture on insecure origins) — or set
   `chrome://flags/#unsafely-treat-insecure-origins-as-secure`.
5. Never expose 8787 to the internet — it fronts paid API keys.
   (`server/.env` → `BIND_HOST=127.0.0.1` returns to local-only.)

## Information architecture (only these)

- **Home** — command center: mode tabs, greeting, M-core hero, glass
  composer, mode pills, right rail (user · recents · honest status · quote)
- **Chat** — long conversations, editorial messages, contextual actions
- **Live** — camera + voice + vision, one purpose: show + ask
- **Memory** — intentional saves (Personal · Preferences · Projects · Important · Instructions)
- **History** — conversations by Today / Yesterday / Previous 7 days
- **Settings** — Appearance · Voice · Language · Agent · Memory · Privacy · Connections · System

Tools are **contextual** (drawer + inline activity cards), never a route.
Connections + system health live in **Settings → Connections/System**.

## State ownership (`src/store/`)

- `session.tsx` — view, agent status, settings, **real connection**, toasts, modal, overlays
- `library.tsx` — memories only
- `chat.tsx` — conversations, streaming generation, TTS
- `index.tsx` — composition + `useApp()` compat; new code uses focused hooks

## Backend wiring (`src/lib/transport.ts`)

All backend traffic goes through `transport.ts`:

- `checkBackend(url)` — real `/health` probe (4s timeout). Empty URL or
  failure ⇒ `offline`, and the UI says **LOCAL DEMO**, never Online.
- `streamChat()` — SSE path ready behind the `online` flag; demo engine otherwise.
- Set the gateway in **Settings → Connections → Backend URL** (keys stay server-side).

Health re-checks on boot, every 20s, and on window focus. When offline the
app still opens; AI controls degrade honestly with retry actions.

## Voice loop (realtime, local)

Mic → client VAD → interim STT → turn → streamed LLM (`task:'voice'`,
short spoken style) → adaptive segmenter → chunked TTS → gapless queue →
barge-in (energy + transcript paths, generation-guarded). Turns persist to
history. Needs Chrome/Edge for live transcription; TTS/profiles follow
Settings → Voice. Per-turn TTFT/TTFA/barge-in measured in-UI.
Spec: `VOICE_ARCHITECTURE.md`.

## Acoustic intelligence (`src/lib/voice/acoustics.ts`)

The mic is treated as an environment, not a wire: real constraint
readback, rolling noise floor + SNR, heuristic sound classes
(silence/speech/fan/music/hum/impact/unknown — never forced), adaptive
VAD floor, fused duck-then-confirm barge-in, ephemeral event log, no raw
audio retained. Proven 14/14 on synthesized signals; telemetry lives in
the Pipeline panel. Torture + acoustic results: `voicetest/RESULTS.md`.

## Home hero — black hole (`src/components/BlackHoleCanvas.tsx`)

Three.js WebGL stage (bundled `three@0.163`, lazy chunk ~125KB gzip):
event-horizon glow, noise-textured accretion disk, 22–60k twinkling
stars, screen-space lensing + chromatic aberration, bloom. Guards:
reduced-motion renders one still frame; touch never traps scroll
(orbit drag desktop-only, gentle auto-drift everywhere); DPR capped;
ResizeObserver sizing; full GPU dispose on unmount. Startup handoff
anchor (`#home-orb-anchor`) is the stage frame.

## Startup film (`src/components/StartupSequence.tsx`)

10s cinematic boot mixed with the reference frames:
arena ignition → crystal/orbital build → pearl activation
(CORE ONLINE · VOICE/VISION/MEMORY/LANGUAGE READY) →
`metaloid / PERSONAL INTELLIGENCE SYSTEM` → morph into the live Home
underneath (`#home-orb-anchor` tracked, layers dissolve 8.6–9.85s).

- Toggle: Settings → Appearance → Startup animation · `?no-intro` bypass
- Real frames: drop chronological stills + manifest at
  `public/intro/frames.json` (JSON array of URLs); the film crossfades
  them under the procedural layers. Absent manifest ⇒ procedural only.

## Honesty rules (enforced in UI)

- Connection pill: ONLINE only when the probe succeeds, else LOCAL DEMO.
- Status equalizer animates only while actually speaking.
- Tool cards carry a DEMO tag until a real tool executes.
- Camera stops on Live unmount; audio stops on interrupt; listeners clean up.

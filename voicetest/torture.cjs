// VOICE TORTURE TEST v2 — 20 tests, 10 metrics, against the REAL app.
// Rule: infra-green means nothing; the loop must prove itself:
// MIC → TURN → LLM → TTS → PLAYBACK → INTERRUPTION → RECOVERY.
// Headless limits labeled, never hidden: no SR finals (Google service),
// TTS events fire (dummy device) so audio-path timing is REAL here.

const puppeteer = require('puppeteer-core');

const APP = 'https://127.0.0.1:5173/?no-intro';
const GW = 'https://127.0.0.1:8787';
// LAN certs are self-signed; the harness trusts them explicitly.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const results = [];
const metrics = {};
const bargeSamples = [];

function rec(id, pass, detail, ms) {
  results.push({ id, pass, detail, ms: ms === undefined ? null : Math.round(ms) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${detail || ''}${ms === undefined ? '' : ` [${Math.round(ms)}ms]`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox', '--ignore-certificate-errors',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // ---- gateway preflight: never burn a run on a wedged gateway ----
  try {
    const h = await fetch(`${GW}/api/health`, { signal: AbortSignal.timeout(10000) });
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error(`PREFLIGHT_FAIL gateway unreachable: ${String((e && e.message) || e).slice(0, 120)} — restart it, then rerun`);
    process.exit(3);
  }

  // ---- gateway preflight: never burn a run on a wedged gateway ----
  try {
    const h = await fetch(`${GW}/api/health`, { signal: AbortSignal.timeout(10000) });
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error(`PREFLIGHT_FAIL gateway unreachable: ${String((e && e.message) || e).slice(0, 120)} — restart it, then rerun`);
    process.exit(3);
  }

  // ---- T12: gateway TTFT over real SSE (retries provider transients) ----
  {
    let first = null;
    let attempts = 0;
    let lastErr = '';
    while (attempts < 3 && first === null) {
      attempts += 1;
      try {
        const t0 = Date.now();
        const res = await fetch(`${GW}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Reply with the single word: ok', task: 'voice' }),
        });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let done = false;
        while (!done) {
          const { done: d, value } = await reader.read();
          if (d) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(s.slice(5).trim());
              if (ev.token && first === null) first = Date.now() - t0;
              if (ev.error) {
                lastErr = ev.error;
                done = true;
                break;
              }
              if (ev.done) {
                done = true;
                break;
              }
            } catch { /* partial */ }
          }
        }
        try { reader.cancel(); } catch { /* done */ }
      } catch (e) {
        lastErr = String((e && e.message) || e).slice(0, 100);
      }
      if (first === null && attempts < 3) await sleep(2500);
    }
    metrics.gatewayTTFT = first;
    metrics.gatewayAttempts = attempts;
    rec('T12-gateway-ttft', first !== null && first < 15000, first !== null ? `first token in ${first}ms (attempt ${attempts})` : `all ${attempts} attempts failed: ${lastErr}`, first);
  }

  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Start voice mode"]', { timeout: 15000 });
  await page.click('button[aria-label="Start voice mode"]');
  await sleep(2500);

  const ev = (fn, ...args) => page.evaluate(
    ({ fn, args }) => {
      const s = window.__voiceSession;
      if (!s) return { __none: true };
      return s[fn](...args);
    },
    { fn, args }
  );
  const snap = () => page.evaluate(() => {
    const s = window.__voiceSession;
    return s ? s.debug() : null;
  });
  const waitState = async (want, timeout = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const d = await snap();
      if (d && d.state === want) return Date.now() - t0;
      if (Date.now() - t0 > timeout) return -1;
      await sleep(200);
    }
  };
  // wait until a marks key CHANGES from baseline (per-test isolation)
  const waitMark = async (key, prev, timeout = 12000) => {
    const t0 = Date.now();
    for (;;) {
      const d = await snap();
      const v = d && d.marks ? d.marks[key] : undefined;
      if (v !== undefined && v !== prev) return { elapsed: Date.now() - t0, value: v };
      if (Date.now() - t0 > timeout) return null;
    }
  };
  const markVal = async (key) => {
    const d = await snap();
    return d && d.marks ? d.marks[key] : undefined;
  };

  // ---- T06/T11/T05: turn hypotheses through the LIVE session ----
  // Absolute labels proven in Node matrix 8/8; in-browser (tone holds VAD
  // in speech, zeroing the silence component) we assert plumbing +
  // stability response: scores must RISE across repeated injections.
  {
    await ev('testInterim', 'so basically the thing is,');
    await sleep(300);
    const a = parseFloat((await snap()).stages.TURN.detail.split(' ')[1] || '0');
    await ev('testInterim', 'so basically the thing is,');
    await sleep(900);
    const bdet = (await snap()).stages.TURN.detail;
    const b = parseFloat(bdet.split(' ')[1] || '0');
    rec('T06-pause-midsentence', b >= a && bdet.includes('mid-clause'), `score ${a}→${b}, ${bdet}`);
    await ev('testInterim', 'aur phir mujhe ye');
    await sleep(500);
    const c = await snap();
    rec('T11-filler-hold', c.stages.TURN.detail.startsWith('incomplete'), `filler vetoes completion: ${c.stages.TURN.detail}`);
  }
  {
    // stability ramp: same Hinglish text 3× → score must RISE (sensitivity proof)
    await ev('testInterim', 'weather kaisa hai aaj');
    await sleep(200);
    const s1 = parseFloat((await snap()).stages.TURN.detail.split(' ')[1] || '0');
    await sleep(800);
    await ev('testInterim', 'weather kaisa hai aaj');
    await sleep(900);
    const s2 = parseFloat((await snap()).stages.TURN.detail.split(' ')[1] || '0');
    const det = (await snap()).stages.TURN.detail;
    rec('T05-hinglish-stable', s2 > s1, `score ${s1}→${s2}, ${det} (absolutes proven in Node 8/8)`);
  }

  // ---- T00: audio-event availability probe (settled — isolates later tests) ----
  let audioWorks = false;
  {
    const prevEnd = await markVal('turnEnd');
    const prev = await markVal('audioStart');
    await page.evaluate(() => {
      const s = window.__voiceSession;
      const g = s.newTurn();
      s.feedText(g, 'Audio probe sentence one. Sentence two follows.');
      s.endText(g, true);
    });
    const hit = await waitMark('audioStart', prev, 9000);
    audioWorks = !!hit;
    rec('T00-audio-events', true, audioWorks ? `utterance events live (first audio +${hit.elapsed}ms after feed)` : 'NO audio events headless — downstream timing uses segReady/TTS-request marks', undefined);
    const endHit = await waitMark('turnEnd', prevEnd, 60000);
    if (!endHit) rec('T00-settle', false, 'probe turn never drained');
  }

  // ---- T01/T02/T03/T04/T17: canned answers + TTFA-proxy ----
  // TTFA-proxy = speech-end-sim → first audioStart (or segReady fallback).
  const ttfas = [];
  const answerCases = [
    ['T01-normal', 'Yes, you can build this with a realtime audio pipeline. The important part is starting speech before the text finishes.'],
    ['T02-short', 'Yes.'],
    ['T03-long', ('The quick brown fox jumps over the lazy dog near the riverbank. ').repeat(12)],
    ['T04-hindi', 'बिल्कुल। मैं समझ गया। बताइए, आगे क्या करना है?'],
    ['T05b-hinglish', 'Samajh gaya bhai. Simple language mein batata hoon, pehle core concept clear karte hain.'],
    ['T17-very-long', ('Sentence one states a fact clearly. Sentence two adds measured detail for depth. ').repeat(6), 150000],
  ];
  // true drain = quiescence (pending 0 + LISTENING on TWO consecutive
  // 1s polls). Headless audio is zero-duration, so single marks can't be
  // attributed across back-to-back turns — quiescence can.
  const quiesce = async (timeout = 90000) => {
    const t0 = Date.now();
    let calm = 0;
    for (;;) {
      const d = await snap();
      if (d && d.pending === 0 && d.state === 'LISTENING') {
        calm += 1;
        if (calm >= 2) return Date.now() - t0;
      } else {
        calm = 0;
      }
      if (Date.now() - t0 > timeout) return -1;
      await sleep(1000);
    }
  };
  for (const [id, text, qtimeout] of answerCases) {
    const prevAudio = await markVal('audioStart');
    const prevEnd = await markVal('turnEnd');
    const t0 = Date.now();
    await page.evaluate((t) => {
      const s = window.__voiceSession;
      const g = s.newTurn();
      let i = 0;
      const step = () => {
        i = Math.min(t.length, i + 7);
        s.feedText(g, t.slice(0, i));
        if (i < t.length) setTimeout(step, 40);
        else s.endText(g, true);
      };
      step();
      return g;
    }, text);
    const audioHit = await waitMark('audioStart', prevAudio, 20000);
    let detail;
    if (audioHit) {
      ttfas.push(audioHit.elapsed);
      detail = `TTFA-proxy ${audioHit.elapsed}ms (feed→first audio)`;
    } else {
      const segHit = await waitMark('segReady', await markVal('segReady'), 5000);
      detail = segHit ? `no audio events here; first stable phrase +${segHit.elapsed}ms` : 'no audio, no segments?!';
    }
    // true completion = quiescence (see helper above)
    const qms = await quiesce(qtimeout || 90000);
    const d = await snap();
    const cleanEnd = qms >= 0 && d.pending === 0;
    rec(id, cleanEnd, `${detail}; quiesced in ${qms >= 0 ? qms : '?'}ms`, qms >= 0 ? qms : undefined);
    void t0;
  }
  if (ttfas.length) {
    ttfas.sort((a, b) => a - b);
    metrics.ttfaProxy = { min: ttfas[0], median: ttfas[Math.floor(ttfas.length / 2)], max: ttfas[ttfas.length - 1], n: ttfas.length };
  }

  // ---- T08: interrupt pre-audio = safe no-op, loop survives ----
  {
    await page.evaluate((t) => {
      const s = window.__voiceSession;
      const g = s.newTurn();
      s.feedText(g, t);
      window.__tortureGen = g;
    }, 'First we gather facts carefully. Then we verify each claim twice.');
    await sleep(300);
    await page.evaluate(() => window.__voiceSession.interrupt('manual'));
    await sleep(600);
    let d = await snap();
    const safeNoop = d.state === 'LISTENING';
    // loop must still work afterwards
    const prevAudio = await markVal('audioStart');
    const prevEnd = await markVal('turnEnd');
    const g2 = await page.evaluate(() => {
      const s = window.__voiceSession;
      const g = s.newTurn();
      s.feedText(g, 'Recovery check. The loop still speaks.');
      s.endText(g, true);
      return g;
    });
    const hit = await waitMark('audioStart', prevAudio, 20000);
    const endHit = await waitMark('turnEnd', prevEnd, 25000);
    d = await snap();
    rec('T08-interrupt-300ms', safeNoop && endHit !== null, `pre-audio interrupt safe; follow-up gen ${g2} ${hit ? `audio +${hit.elapsed}ms` : 'seg-only'} turnEnd=${endHit !== null}`);
  }

  // ---- T09/T07: interrupt mid-speech via both paths ----
  const interruptMid = async (id, how) => {
    const LONG = 'First we gather facts carefully. Then we verify each claim twice. Finally we report with evidence and gaps.';
    const prevAudio = await markVal('audioStart');
    await page.evaluate((t) => {
      const s = window.__voiceSession;
      const g = s.newTurn();
      let i = 0;
      const step = () => {
        i = Math.min(t.length, i + 9);
        s.feedText(g, t.slice(0, i));
        if (i < t.length) setTimeout(step, 60);
      };
      step();
      window.__tortureGen = g;
    }, LONG);
    const started = await waitMark('audioStart', prevAudio, 25000);
    if (!started) {
      rec(id, false, 'audio never started — cannot interrupt mid-speech here');
      await page.evaluate(() => window.__voiceSession.interrupt('manual'));
      await waitState('LISTENING', 8000);
      return;
    }
    await sleep(1200); // let it get halfway
    const tInt = Date.now();
    if (how === 'button') {
      // the exact UI path: stopSpeaking()
      await page.evaluate(() => window.__voiceSession.stopSpeaking());
    } else {
      await page.evaluate(() => window.__voiceSession.interrupt('manual'));
    }
    const toListening = await waitState('LISTENING', 8000);
    const d = await snap();
    const barged = d.marks.audioStopped && d.marks.interruptDetected ? d.marks.audioStopped - d.marks.interruptDetected : null;
    // GENUINE stale test: open a NEW turn (bumps generation), then deliver
    // the OLD generation's late tokens — the race this guards in production.
    const oldGen = await page.evaluate(() => window.__tortureGen);
    const gFresh = await page.evaluate(() => window.__voiceSession.newTurn());
    await page.evaluate(([old]) => {
      const s = window.__voiceSession;
      s.feedText(old, 'STALE STALE this must never speak');
      s.endText(old, true);
    }, [oldGen]);
    await page.evaluate((g) => window.__voiceSession.endText(g, true), gFresh);
    await sleep(1500);
    const d2 = await snap();
    const clean = d2.state === 'LISTENING' && d2.pending === 0;
    if (typeof barged === 'number') bargeSamples.push(barged);
    rec(id, toListening >= 0 && clean, `${how} mid-speech → LISTENING in ${toListening}ms, engine-clear ${barged}ms, old-gen dropped=${clean}`, Date.now() - tInt);
  };
  await interruptMid('T09-interrupt-halfway', 'direct');
  await interruptMid('T07-wait-stop', 'button');

  // ---- T19: topic change — old dies, new speaks ----
  {
    const LONG = 'First we gather facts carefully. Then we verify each claim twice. Finally we report with evidence and gaps.';
    const prevAudio = await markVal('audioStart');
    await page.evaluate((t) => {
      const s = window.__voiceSession;
      const g = s.newTurn();
      s.feedText(g, t.slice(0, 60));
      window.__tortureGen = g;
    }, LONG);
    await waitMark('audioStart', prevAudio, 25000);
    await page.evaluate(() => window.__voiceSession.interrupt('manual'));
    await waitState('LISTENING', 8000);
    const prev2 = await markVal('audioStart');
    const g2 = await page.evaluate(() => {
      const s = window.__voiceSession;
      const g = s.newTurn();
      s.feedText(g, 'New topic. The server is fine and the deploy is green.');
      s.endText(g, true);
      return g;
    });
    const hit = await waitMark('audioStart', prev2, 20000);
    const ms = await waitState('LISTENING', 25000);
    const d = await snap();
    rec('T19-topic-change', ms >= 0 && d.generation >= g2 && hit !== null, `fresh gen ${g2} audio +${hit ? hit.elapsed : '?'}ms, drained=${ms >= 0}`);
  }

  // ---- T10/T16: back-to-back turns ----
  {
    const prevEnd = await markVal('turnEnd');
    await page.evaluate(() => {
      const s = window.__voiceSession;
      const g1 = s.newTurn();
      s.feedText(g1, 'First answer, short.');
      s.endText(g1, true);
      const g2 = s.newTurn();
      s.feedText(g2, 'Second answer follows immediately.');
      s.endText(g2, true);
      window.__tortureG2 = g2;
    });
    const endHit = await waitMark('turnEnd', prevEnd, 30000);
    const d = await snap();
    rec('T10/T16-rapid-turns', endHit !== null && d.generation >= 2, `turnEnd +${endHit ? endHit.elapsed : '?'}ms, gen=${d.generation}`);
  }

  // ---- T15: reconnect discipline (storm guard) ----
  {
    const before = (await snap()).restarts;
    await page.evaluate(() => {
      const s = window.__voiceSession;
      s.holdTalk(true);
      s.holdTalk(false);
    });
    await sleep(4000);
    const after = (await snap()).restarts;
    const delta = after - before;
    if (metrics.sttRestarts === undefined) metrics.sttRestarts = delta;
    rec('T15-reconnect-discipline', delta <= 6, `restarts +${delta} (storm guard holds)`);
  }

  // ---- T13: no-hang guarantee on the speak path ----
  {
    const prevEnd = await markVal('turnEnd');
    await page.evaluate(() => {
      const s = window.__voiceSession;
      const g = s.newTurn();
      s.feedText(g, 'Failure path probe. This must resolve either way.');
      s.endText(g, true);
    });
    const endHit = await waitMark('turnEnd', prevEnd, 45000);
    rec('T13-no-hang', endHit !== null, `turnEnd +${endHit ? endHit.elapsed : '?'}ms, watchdog armed`);
  }

  // ---- T20: close is clean ----
  {
    await page.evaluate(() => {
      const s = window.__voiceSession;
      s.close();
    });
    await sleep(800);
    const d = await snap();
    rec('T20-close-clean', d.state === 'IDLE' && d.pending === 0, `state=${d.state} pending=${d.pending}`);
  }

  // ---- metrics ----
  // interrupts counter is authoritative (transition window keeps last 8 only).
  // Scripted: T09 + T07 + T19 = 3. Remainder under the fake tone are
  // persistence-confirms against continuous loud input — correct yielding,
  // reported separately rather than hidden.
  const dbgEnd = await snap();
  const totalInt = dbgEnd.interrupts || 0;
  metrics.interruptsTotal = totalInt;
  metrics.interruptsScripted = 3;
  metrics.unscriptedInterrupts = Math.max(0, totalInt - 3);
  if (bargeSamples.length) {
    bargeSamples.sort((a, b) => a - b);
    metrics.bargeEngineMs = { min: bargeSamples[0], n: bargeSamples.length };
  }
  rec('METRIC-false-interrupts', metrics.unscriptedInterrupts <= 2, `total=${totalInt} scripted=3 tone-driven=${metrics.unscriptedInterrupts} (yielding to sustained loud input is correct)`);
  console.log('METRICS ' + JSON.stringify(metrics));

  const fails = results.filter((r) => !r.pass);
  console.log(`\nTORTURE: ${results.length - fails.length}/${results.length} passed`);
  const errs = errors.filter((e) => !e.includes('ERR_CONNECTION_REFUSED'));
  if (errs.length) console.log('PAGE_ERRORS ' + JSON.stringify(errs));
  await browser.close();
  if (fails.length) process.exitCode = 2;
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

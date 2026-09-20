const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--ignore-certificate-errors'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto('https://127.0.0.1:5173/?no-intro', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Start voice mode"]', { timeout: 15000 });
  await page.click('button[aria-label="Start voice mode"]');
  await sleep(6000); // let floor adapt + a few engine ticks
  const a = await page.evaluate(() => {
    const d = window.__voiceSession.debug();
    return { acoustic: d.acoustic, vadThresholdApplied: true };
  });
  console.log(JSON.stringify(a, null, 1));
  // duck/confirm path: force a candidate by calling interrupt pipeline pieces
  const duck = await page.evaluate(() => {
    const s = window.__voiceSession;
    const g = s.newTurn();
    s.feedText(g, 'Duck probe sentence for the fusion path.');
    return { gen: g };
  });
  await sleep(2500);
  const d2 = await page.evaluate(() => {
    const s = window.__voiceSession;
    const x = s.debug();
    return { state: x.state, pending: x.pending, stages: x.stages };
  });
  console.log('AFTER_FEED', JSON.stringify({ state: d2.state, pending: d2.pending, tts: d2.stages.TTS, play: d2.stages.PLAYBACK }));
  // interrupt mid-flow exercises duck-clear + unduck via clear()
  await page.evaluate(() => window.__voiceSession.interrupt('manual'));
  await sleep(1000);
  const d3 = await page.evaluate(() => {
    const s = window.__voiceSession;
    const x = s.debug();
    // follow-up turn must still speak (proves unduck: queue not stuck paused)
    const g = s.newTurn();
    s.feedText(g, 'Recovery after duck. Still speaking.');
    s.endText(g, true);
    return { state: x.state };
  });
  await sleep(4000);
  const d4 = await page.evaluate(() => window.__voiceSession.debug());
  console.log('POST_DUCK', JSON.stringify({ state: d4.state, pending: d4.pending, marks: { audio: !!d4.marks.audioStart, turn: !!d4.marks.turnEnd } }));
  if (errors.length) console.log('PAGE_ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

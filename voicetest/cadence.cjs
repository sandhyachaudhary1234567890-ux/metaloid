// Cadence probe: how does headless speech actually flow?
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
  await page.goto('https://127.0.0.1:5173/?no-intro', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Start voice mode"]', { timeout: 15000 });
  await page.click('button[aria-label="Start voice mode"]');
  await sleep(2500);
  await page.evaluate(() => {
    const s = window.__voiceSession;
    const g = s.newTurn();
    window.__pg = g;
    s.feedText(g, 'Alpha beta gamma delta. Epsilon zeta eta theta. Iota kappa lambda mu.');
    s.endText(g, true);
  });
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const d = await page.evaluate(() => {
      const s = window.__voiceSession;
      const x = s.debug();
      return { st: x.state, pend: x.pending, audio: x.marks.audioStart || 0, turn: x.marks.turnEnd || 0 };
    });
    console.log(`${Date.now() - t0}ms state=${d.st} pend=${d.pend} audio=${d.audio} turnEnd=${d.turn}`);
    if (d.st === 'LISTENING' && d.pend === 0 && d.turn !== 0) break;
    await sleep(300);
  }
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

// Mic-stability probe: does the mic session flap? Watches micId,
// opens/closes counters, mount counts, and recognition churn.
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const APP = process.argv[2] || 'https://127.0.0.1:5173/?no-intro';
  const browser = await puppeteer.launch({
    executablePath: 'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--ignore-certificate-errors'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Start voice mode"]', { timeout: 15000 });
  await page.click('button[aria-label="Start voice mode"]');
  await sleep(3000);
  const ids = new Set();
  let mounts0 = 0;
  let opens0 = 0;
  let closes0 = 0;
  for (let i = 0; i < 8; i++) {
    const s = await page.evaluate(() => {
      const sess = window.__voiceSession;
      const d = sess ? sess.debug() : null;
      return { micId: d?.micId || 'none', opens: d?.opens ?? -1, closes: d?.closes ?? -1, restarts: d?.restarts ?? -1, mounts: window.__voiceMounts || 0, state: d?.state || '?' };
    });
    if (i === 0) {
      mounts0 = s.mounts;
      opens0 = s.opens;
      closes0 = s.closes;
    }
    ids.add(s.micId);
    console.log(`${(i + 1) * 2.5}s mic=${s.micId.slice(0, 8)}… opens=${s.opens} closes=${s.closes} mounts=${s.mounts} restarts=${s.restarts} state=${s.state}`);
    await sleep(2500);
  }
  const fin = await page.evaluate(() => {
    const d = window.__voiceSession.debug();
    return { opens: d.opens, closes: d.closes, mounts: window.__voiceMounts };
  });
  console.log(`\nMIC_IDS_SEEN=${ids.size} OPENS_DELTA=${fin.opens - opens0} CLOSES_DELTA=${fin.closes - closes0} MOUNTS_DELTA=${fin.mounts - mounts0}`);
  console.log(ids.size === 1 && fin.opens - opens0 <= 1 && fin.closes - closes0 === 0 ? 'MIC_STABLE' : 'MIC_FLAPPING');
  if (errors.length) console.log('PAGE_ERRORS', JSON.stringify(errors));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

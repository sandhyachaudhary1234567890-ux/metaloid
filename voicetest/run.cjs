const puppeteer = require('puppeteer-core');

(async () => {
  const mode = process.argv[2] || 'tone'; // tone | file
  const headful = process.argv.includes('--headful');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome.exe',
    headless: headful ? false : 'new',
    args: [
      ...(mode === 'file'
        ? ['--use-file-for-fake-audio-capture=C:\\metaloid\\voicetest\\speech.wav']
        : ['--use-fake-device-for-media-stream']),
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox', '--ignore-certificate-errors',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 }); // mobile layout → bottom-nav FAB
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200));
  });
  await page.goto('https://127.0.0.1:5173/?no-intro', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Start voice mode"]', { timeout: 15000 });
  await page.click('button[aria-label="Start voice mode"]');
  const snap = () => page.evaluate(() => {
    const s = window.__voiceSession;
    const labelEl = document.querySelector('[role="dialog"] h2');
    return { label: labelEl ? labelEl.textContent : 'NO_DIALOG', dbg: s ? s.debug() : null };
  });
  const out = [];
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      out.push({ t: `${(i + 1) * 2}s`, ...(await snap()) });
    } catch (e) {
      out.push({ t: `${(i + 1) * 2}s`, snapFail: e.message });
    }
  }
  let texts = '';
  try {
    texts = await page.evaluate(() => (document.querySelector('[role="dialog"]') || {}).innerText?.slice(0, 700) || 'NO_DIALOG');
  } catch (e) {
    texts = 'EVAL_FAIL ' + e.message;
  }
  console.log(JSON.stringify({ mode, snaps: out, texts, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

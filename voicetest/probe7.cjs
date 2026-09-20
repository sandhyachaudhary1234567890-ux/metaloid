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
  const ev = (text) => page.evaluate((t) => window.__voiceSession.testInterim(t), text);
  const det = async () => page.evaluate(() => window.__voiceSession.debug().stages.TURN.detail);
  await ev('so basically the thing is,');
  await sleep(300);
  const d1 = await det();
  const a = parseFloat(d1.split(' ')[1] || '0');
  await ev('so basically the thing is,');
  await sleep(900);
  const bdet = await det();
  const b = parseFloat(bdet.split(' ')[1] || '0');
  console.log(JSON.stringify({ d1, bdet, a, b, ta: typeof a, tb: typeof b, inc: bdet.includes('mid-clause'), res: b >= a && bdet.includes('mid-clause') }));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

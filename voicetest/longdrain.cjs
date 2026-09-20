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
  const voices = await page.evaluate(() => window.speechSynthesis.getVoices().length);
  console.log('VOICES_HEADLESS=', voices);
  const text = ('Sentence one states a fact clearly. Sentence two adds measured detail for depth. ').repeat(8);
  await page.evaluate((t) => {
    const s = window.__voiceSession;
    const g = s.newTurn();
    window.__pg = g;
    let i = 0;
    const step = () => {
      i = Math.min(t.length, i + 7);
      s.feedText(g, t.slice(0, i));
      if (i < t.length) setTimeout(step, 40);
      else s.endText(g, true);
    };
    step();
  }, text);
  for (let k = 0; k < 30; k++) {
    const d = await page.evaluate(() => {
      const s = window.__voiceSession;
      const x = s.debug();
      return { st: x.state, pend: x.pending, gen: x.generation };
    });
    console.log(`${(k + 1) * 5}s state=${d.st} pend=${d.pend} gen=${d.gen}`);
    if (d.st === 'LISTENING' && d.pend === 0 && k > 2) break;
    await sleep(5000);
  }
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

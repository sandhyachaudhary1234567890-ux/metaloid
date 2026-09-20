const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--ignore-certificate-errors', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto('https://127.0.0.1:5173/?no-intro', { waitUntil: 'networkidle0', timeout: 90000 });
  // go to an empty chat to see the composer
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const chat = btns.find((b) => b.textContent.trim() === 'Chat');
    if (chat) chat.click();
  });
  await sleep(1500);
  // type to activate the send button
  const ta = await page.$('textarea[aria-label="Prompt input"]');
  if (ta) {
    await ta.click();
    await ta.type('Hello metaloid', { delay: 30 });
  }
  await sleep(1200);
  const info = await page.evaluate(() => {
    const send = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Send message' || b.getAttribute('aria-label') === 'Stop generating'
    );
    if (!send) return { found: false };
    const r = send.getBoundingClientRect();
    const canvas = send.querySelector('canvas');
    return {
      found: true,
      label: send.getAttribute('aria-label'),
      disabled: send.disabled,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      hasCanvas: !!canvas,
      canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
    };
  });
  console.log('SEND_BTN ' + JSON.stringify(info));
  // clip screenshot around the composer
  const cta = await page.$('textarea[aria-label="Prompt input"]');
  if (cta) {
    const box = await cta.boundingBox();
    if (box) {
      await page.screenshot({
        path: 'send-button.png',
        clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 60), width: Math.min(900, 1440 - box.x), height: 320 },
      });
    }
  }
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 6)));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

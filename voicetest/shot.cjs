const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      errors.push(m.type().toUpperCase() + ': ' + m.text().slice(0, 220));
    }
  });
  await page.goto('https://127.0.0.1:5173/?no-intro', { waitUntil: 'networkidle0', timeout: 90000 });
  await sleep(6000); // let WebGL boot + a few frames render
  const info = await page.evaluate(() => {
    const canvas = document.querySelector('#home-orb-anchor canvas');
    const gl = canvas ? { w: canvas.width, h: canvas.height } : null;
    let webgl = 'n/a';
    try {
      const t = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      webgl = t ? (t.getParameter(t.VERSION) || 'yes') : 'none';
    } catch (e) {
      webgl = 'throw';
    }
    return { canvas: gl, webgl, anchor: !!document.getElementById('home-orb-anchor') };
  });
  console.log('INFO ' + JSON.stringify(info));
  await page.screenshot({ path: 'home-hero.png' });
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 12)));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

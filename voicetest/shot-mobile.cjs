const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--ignore-certificate-errors', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto('https://127.0.0.1:5173/?no-intro', { waitUntil: 'networkidle0', timeout: 90000 });
  await sleep(6000);
  // horizontal overflow check
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    canvas: !!document.querySelector('#home-orb-anchor canvas'),
  }));
  console.log('MOBILE ' + JSON.stringify(overflow));
  await page.screenshot({ path: 'home-mobile.png' });
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 6)));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

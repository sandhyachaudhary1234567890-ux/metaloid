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
  await sleep(2500);
  const toolsBtn = await page.$('button[aria-haspopup="menu"]');
  if (!toolsBtn) throw new Error('Tools pill not found');
  await toolsBtn.click();
  await sleep(700);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('[role="menu"]');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), items: m.innerText.slice(0, 200) };
  });
  console.log('TOOLS_MENU ' + JSON.stringify(menu));
  // screenshot composer region with open menu
  const ta = await page.$('textarea[aria-label="Prompt input"]');
  const box = ta ? await ta.boundingBox() : null;
  if (box) {
    await page.screenshot({
      path: 'composer-tools.png',
      clip: { x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 330), width: 760, height: 480 },
    });
  }
  // close, open Mode menu
  await page.keyboard.press('Escape');
  await sleep(400);
  const modeBtn = await page.$('button[aria-haspopup="listbox"]');
  if (!modeBtn) throw new Error('Mode pill not found');
  await modeBtn.click();
  await sleep(700);
  const modeMenu = await page.evaluate(() => {
    const m = document.querySelector('[role="listbox"]');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), items: m.innerText.slice(0, 200) };
  });
  console.log('MODE_MENU ' + JSON.stringify(modeMenu));
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 6)));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

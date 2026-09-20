const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--ignore-certificate-errors'],
  });
  const page = await browser.newPage();
  page.on('requestfailed', (r) => console.log('FAILED_URL:', r.url().slice(0, 120), '|', (r.failure() || {}).errorText));
  await page.goto('https://127.0.0.1:5173/?no-intro', { waitUntil: 'networkidle0', timeout: 90000 }).catch((e) => console.log('GOTO:', e.message.slice(0, 100)));
  await new Promise((r) => setTimeout(r, 4000));
  await browser.close();
})().catch((e) => {
  console.error('HARNESS_FAIL', e.message);
  process.exit(1);
});

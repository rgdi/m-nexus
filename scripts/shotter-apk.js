// shotter-apk.js — screenshot del APK info card
const { chromium } = require('/usr/local/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('file:///workspace/m-nexus/dist/v2.21.1/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/workspace/m-nexus/screenshots/v2211/v2-apk-info.png', type: 'png' });
  await browser.close();
  console.log('apk info card captured');
})();

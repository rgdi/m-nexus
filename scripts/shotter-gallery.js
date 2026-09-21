// shotter-gallery.js
const { chromium } = require('/usr/local/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('https://1qp3lfmiya5j9.space.minimax.io', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/workspace/m-nexus/screenshots/v2211/v2-gallery-top.png', type: 'png' });
  // Scroll to v2 features
  await page.evaluate(() => window.scrollTo(0, document.querySelector('h3:nth-of-type(3)').offsetTop));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/workspace/m-nexus/screenshots/v2211/v2-gallery-features.png', type: 'png' });
  await browser.close();
  console.log('gallery captured');
})();

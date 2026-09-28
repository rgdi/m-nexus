// capture_v236.cjs — PWA verification captures.
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const DIR = '/workspace/m-nexus/screenshots';
const BASE = 'http://localhost:8080';
const API = 'http://localhost:4000';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const auth = await ctx.request.post(API + '/api/v1/register', {
    data: { username: 'p' + Date.now(), password: 'demo123', deviceId: 'd' + Date.now(), deviceName: 'pw', platform: 'web' },
  }).then(r => r.json()).catch(() => ({}));
  await page.addInitScript(function (a) {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
    localStorage.setItem('mnexus.auth.access', a.accessToken);
    localStorage.setItem('mnexus.auth.refresh', a.refreshToken);
    localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
  }, auth);

  await page.goto(BASE + '/?c=' + Date.now() + '#/progress', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: DIR + '/v236-pwa-progress-phone.png' });
  console.log('  📸 v236-pwa-progress-phone.png');

  // Wait for the SW to finish precaching, then go offline.
  await page.waitForTimeout(12000);
  const cacheInfo = await page.evaluate(async () => {
    const keys = await caches.keys();
    const out = {};
    for (const k of keys) { const c = await caches.open(k); out[k] = (await c.keys()).length; }
    const regs = await navigator.serviceWorker.getRegistrations();
    return { caches: out, state: regs[0]?.active?.state };
  });
  console.log('  SW:', JSON.stringify(cacheInfo));

  await ctx.setOffline(true);
  await page.waitForTimeout(600);
  await page.goto(BASE + '/#/study', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: DIR + '/v236-pwa-offline-study-phone.png' });
  console.log('  📸 v236-pwa-offline-study-phone.png (offline)');

  await browser.close();
})();

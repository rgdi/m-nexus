'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');
const SCREENS_DIR = '/workspace/m-nexus/screenshots';
const BASE = 'http://localhost:8080';
const API_BASE = 'http://localhost:4000';
if (!fs.existsSync(SCREENS_DIR)) fs.mkdirSync(SCREENS_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();

  const username = 'demo' + Date.now();
  const authResp = await ctx.request.post(API_BASE + '/api/v1/register', {
    data: { username, password: 'demo123', deviceId: 'd' + Date.now(), deviceName: 'playwright', platform: 'web' },
  }).then(r => r.json()).catch(() => ({}));
  if (!authResp.accessToken) { console.log('AUTH FAIL'); await browser.close(); return; }

  await page.addInitScript(function (data) {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4000';
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
    localStorage.setItem('mnexus.auth.access', data.accessToken);
    localStorage.setItem('mnexus.auth.refresh', data.refreshToken);
  }, authResp);

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 1. Empty state (no notifications)
  await page.screenshot({ path: SCREENS_DIR + '/v2341-bell-empty-tablet.png', clip: { x: 800, y: 0, width: 566, height: 200 } });
  console.log('  📸 v2341-bell-empty-tablet.png');

  // 2. Open dropdown (empty)
  await page.click('.notif-bell-btn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: SCREENS_DIR + '/v2341-bell-dropdown-empty-tablet.png', clip: { x: 700, y: 0, width: 666, height: 500 } });
  console.log('  📸 v2341-bell-dropdown-empty-tablet.png');

  // 3. Close + generate notifications
  await page.click('body', { position: { x: 100, y: 500 } });
  await page.waitForTimeout(500);
  await page.click('.notif-bell-btn');
  await page.waitForTimeout(300);
  // Click "Generar (FSRS-7)" button
  const genBtn = await page.$('.notif-btn-primary');
  if (genBtn) {
    await genBtn.click();
    await page.waitForTimeout(2500);
  }
  // Re-open dropdown
  await page.click('body', { position: { x: 100, y: 500 } });
  await page.waitForTimeout(300);
  await page.click('.notif-bell-btn');
  await page.waitForTimeout(800);
  await page.screenshot({ path: SCREENS_DIR + '/v2341-bell-dropdown-with-items-tablet.png', clip: { x: 700, y: 0, width: 666, height: 500 } });
  console.log('  📸 v2341-bell-dropdown-with-items-tablet.png');

  // 4. Just the bell area with badge
  await page.click('body', { position: { x: 100, y: 500 } });
  await page.waitForTimeout(500);
  await page.screenshot({ path: SCREENS_DIR + '/v2341-bell-badge-tablet.png', clip: { x: 800, y: 0, width: 566, height: 200 } });
  console.log('  📸 v2341-bell-badge-tablet.png');

  // 5. Phone view
  await page.setViewportSize({ width: 414, height: 896 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: SCREENS_DIR + '/v2341-bell-phone.png', clip: { x: 0, y: 0, width: 414, height: 200 } });
  console.log('  📸 v2341-bell-phone.png');

  // Open dropdown on phone
  await page.click('.notif-bell-btn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: SCREENS_DIR + '/v2341-bell-phone-open.png' });
  console.log('  📸 v2341-bell-phone-open.png');

  await browser.close();
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });

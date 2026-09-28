'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');
const SCREENS_DIR = '/workspace/m-nexus/screenshots';
if (!fs.existsSync(SCREENS_DIR)) fs.mkdirSync(SCREENS_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();

  // Seed a fake "previously logged in" state in localStorage so autofill
  // might trigger. Also seed Chrome's autofill heuristic data via cookies.
  await page.addInitScript(() => {
    // Drop any previous auth so we land on login
    localStorage.clear();
    // Pre-set Chrome's autofill heuristics (best-effort; usually only in chrome://settings)
    // These attributes ARE what password managers key off of.
  });

  // Navigate to login (skip setup via direct hash)
  await page.goto('http://localhost:8080/#/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Click on username field to trigger any autofill popup
  await page.click('#mn-user');
  await page.waitForTimeout(800);

  await page.screenshot({
    path: SCREENS_DIR + '/v2342-login-tablet.png',
  });
  console.log('  📸 v2342-login-tablet.png');

  // Phone
  await page.setViewportSize({ width: 414, height: 896 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: SCREENS_DIR + '/v2342-login-phone.png',
  });
  console.log('  📸 v2342-login-phone.png');

  await browser.close();
})();

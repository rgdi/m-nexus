// capture_v232.cjs — Capturas de v2.32.0 features.

'use strict';

const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');

const SCREENS_DIR = '/workspace/m-nexus/screenshots';
const BASE = 'http://localhost:8080';

if (!fs.existsSync(SCREENS_DIR)) fs.mkdirSync(SCREENS_DIR, { recursive: true });

const VIEWPORTS = {
  tablet: { width: 1366, height: 900 },
  phone: { width: 414, height: 896 },
};

async function loginAs(page, token, refresh) {
  await page.evaluate(({ t, r }) => {
    localStorage.setItem('mnexus.auth.access', t);
    localStorage.setItem('mnexus.auth.refresh', r);
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
  }, { t: token, r: refresh });
}

async function navigate(page, hash, opts = {}) {
  await page.addInitScript(() => {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4100';
  });
  await page.goto(BASE + hash, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(opts.wait ?? 1500);
  await page.evaluate(() => {
    localStorage.setItem('mnexus.setup.completed', '1');
  });
}

async function shoot(page, name, v = 'tablet') {
  await page.setViewportSize(VIEWPORTS[v]);
  await page.waitForTimeout(500);
  const out = `${SCREENS_DIR}/${name}-${v}.png`;
  await page.screenshot({ path: out, fullPage: false });
  console.log(`  📸 ${out}`);
  return out;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const authResp = await fetch('http://localhost:4100/api/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'demo' + Date.now(),
      password: 'demo123',
      deviceId: 'dev-pw-' + Date.now(),
      deviceName: 'playwright',
      platform: 'web',
    }),
  }).then((r) => r.json());

  await page.goto(BASE + '/');
  await loginAs(page, authResp.accessToken, authResp.refreshToken);
  await page.evaluate(() => {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
  });

  // ===== Generate notifications before capturing =====
  await page.evaluate(() => {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4100';
  });
  await page.goto(BASE + '/#/overview');
  await page.waitForTimeout(2000);

  // Trigger generation from the bell button
  await page.evaluate(() => {
    const btn = document.querySelector('.notif-bell-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const genBtn = document.querySelector('[data-generate]');
    if (genBtn) genBtn.click();
  });
  await page.waitForTimeout(2500);

  // Close dropdown first
  await page.evaluate(() => {
    const btn = document.querySelector('.notif-bell-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);

  // Overview with notifications bell + badge
  console.log('▶ Overview v2.32 with bell');
  await shoot(page, 'v232-overview-bell', 'tablet');

  // Bell dropdown open
  await page.evaluate(() => {
    const btn = document.querySelector('.notif-bell-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
  await shoot(page, 'v232-notifications-dropdown', 'tablet');

  // Close dropdown, go to boards screen
  await page.evaluate(() => {
    const btn = document.querySelector('.notif-bell-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  await navigate(page, '#/boards', { wait: 2500 });
  // Click somewhere outside to close dropdown
  await page.mouse.click(683, 500);
  await page.waitForTimeout(800);
  await shoot(page, 'v232-boards', 'tablet');
  await shoot(page, 'v232-boards', 'phone');

  // Trigger diagnose
  await page.evaluate(() => {
    const btn = document.querySelector('[data-action="diagnose"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(3000);
  await shoot(page, 'v232-boards-diagnosed', 'tablet');

  // Go to FSRS simulator to show predict in action
  console.log('▶ FSRS simulator (predict in action)');
  await navigate(page, '#/fsrs-sim', { wait: 2000 });
  await shoot(page, 'v232-fsrs', 'tablet');

  await browser.close();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

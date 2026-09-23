// capture_v2321.cjs — Capturas de v2.32.1 (UI cleanup).

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

async function navigate(page, hash, opts = {}) {
  await page.addInitScript(() => {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4100';
  });
  await page.goto(BASE + hash, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(opts.wait ?? 1200);
  await page.evaluate(() => {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
  });
}

async function shoot(page, name, v = 'tablet') {
  await page.setViewportSize(VIEWPORTS[v]);
  await page.waitForTimeout(500);
  const out = `${SCREENS_DIR}/${name}-${v}.png`;
  await page.screenshot({ path: out, fullPage: false });
  console.log(`  📸 ${out}`);
}

async function loginAs(page, token, refresh) {
  await page.evaluate(({ t, r }) => {
    localStorage.setItem('mnexus.auth.access', t);
    localStorage.setItem('mnexus.auth.refresh', r);
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
  }, { t: token, r: refresh });
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Register fresh user
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
  }).then((r) => r.json()).catch(() => ({}));

  await page.goto(BASE + '/');
  if (authResp.accessToken) {
    await loginAs(page, authResp.accessToken, authResp.refreshToken);
  }

  // === Overview with new dock (9 items) ===
  console.log('▶ v2.32.1 Overview with simplified dock');
  await navigate(page, '#/overview', { wait: 1500 });
  await shoot(page, 'v2321-dock', 'tablet');

  // === Insights screen with 3 tabs ===
  console.log('▶ v2.32.1 Insights / Graph tab');
  await navigate(page, '#/v232', { wait: 2500 });
  await shoot(page, 'v2321-insights-graph', 'tablet');

  console.log('▶ v2.32.1 Insights / Multi-board tab');
  await page.evaluate(() => {
    const btn = document.querySelector('[data-tab="mb"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  await shoot(page, 'v2321-insights-multiboard', 'tablet');

  console.log('▶ v2.32.1 Insights / FSRS tab');
  await page.evaluate(() => {
    const btn = document.querySelector('[data-tab="fsrs"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  await shoot(page, 'v2321-insights-fsrs', 'tablet');

  // === Drawer with Advanced section ===
  console.log('▶ v2.32.1 Drawer (Advanced section)');
  await navigate(page, '#/overview', { wait: 1500 });
  await page.evaluate(() => {
    const btn = document.getElementById('hamburger');
    if (btn) btn.click();
  });
  await page.waitForTimeout(700);
  await shoot(page, 'v2321-drawer-advanced', 'tablet');

  // === Phone ===
  console.log('▶ v2.32.1 Phone (overview)');
  await navigate(page, '#/overview', { wait: 1500 });
  await shoot(page, 'v2321-overview', 'phone');

  console.log('▶ v2.32.1 Phone (insights)');
  await navigate(page, '#/v232', { wait: 1500 });
  await shoot(page, 'v2321-insights-phone', 'phone');

  await browser.close();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });

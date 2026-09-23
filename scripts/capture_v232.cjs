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
  await page.waitForTimeout(opts.wait ?? 1200);
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
  }).then((r) => r.json()).catch(() => ({}));

  await page.goto(BASE + '/');
  if (authResp.accessToken) {
    await loginAs(page, authResp.accessToken, authResp.refreshToken);
  }

  // ===== Capture screens =====
  console.log('▶ v2.32.0 Features screen');
  await navigate(page, '#/v232', { wait: 4000 });
  await shoot(page, 'v232-features', 'tablet');

  // Wait for Smart Notifications to populate
  await page.waitForTimeout(3000);
  await shoot(page, 'v232-features-loaded', 'tablet');

  // Click "Generate" on smart notifications
  await page.evaluate(() => {
    const btn = document.querySelector('[data-action="generate"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  await shoot(page, 'v232-features-notifications', 'tablet');

  // ===== Multi-board create deck =====
  console.log('▶ Multi-board create');
  await page.evaluate(() => {
    window.prompt = () => 'Bioquímica';
    document.querySelector('[data-action="create"]')?.click();
  });
  await page.waitForTimeout(1500);
  await shoot(page, 'v232-multiboard-with-deck', 'tablet');

  // ===== Open OCR modal =====
  console.log('▶ OCR modal');
  await page.evaluate(() => {
    document.querySelector('[data-action="open-ocr"]')?.click();
  });
  await page.waitForTimeout(1500);
  await shoot(page, 'v232-ocr-modal', 'tablet');

  await shoot(page, 'v232-features', 'phone');

  await browser.close();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

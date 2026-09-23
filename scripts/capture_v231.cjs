// capture_v231.cjs — Capturas de v2.31.0 KG + v2.30 FSRS dashboard
//                    + v2.29 PDF occlusion + v2.28 highlights + journal v2.26.

'use strict';

const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

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
  return out;
}

async function captureScreen(page, hash, slug, label) {
  console.log(`▶ ${label}`);
  try {
    await navigate(page, hash, { wait: 2000 });
    await shoot(page, slug, 'tablet');
    await shoot(page, slug, 'phone');
  } catch (e) {
    console.error(`  ✗ ${label} failed: ${e.message}`);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Register fresh user to get valid token
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
  const accessToken = authResp.accessToken;
  const refreshToken = authResp.refreshToken;

  await page.goto(BASE + '/');
  if (accessToken) {
    await loginAs(page, accessToken, refreshToken);
  } else {
    await page.evaluate(() => {
      localStorage.setItem('mnexus.lang', 'es');
      localStorage.setItem('mnexus.setup.completed', '1');
    });
  }

  // ===== Capture screens =====
  await captureScreen(page, '#/overview', 'v231-overview', 'Overview (v2.31)');

  // Notes with content
  console.log('▶ Notes with content open');
  await navigate(page, '#/notes', { wait: 2000 });
  await page.evaluate(() => {
    const items = document.querySelectorAll('aside li, .sidebar li, .notes-sidebar li');
    for (const li of items) {
      if (li.textContent.includes('Math')) {
        li.click();
        break;
      }
    }
  });
  await page.waitForTimeout(2500);
  await shoot(page, 'v231-notes-content', 'tablet');

  await captureScreen(page, '#/notes', 'v231-notes', 'Notes (v2.25 outliner)');
  await captureScreen(page, '#/journal', 'v231-journal', 'Daily Journal (v2.26)');
  await captureScreen(page, '#/fsrs-sim', 'v231-fsrs', 'FSRS Simulator');
  await captureScreen(page, '#/pdf', 'v231-pdf', 'PDF Library (v2.28)');

  // Knowledge Graph
  console.log('▶ Knowledge Graph (v2.31) — wait for layout to converge');
  await navigate(page, '#/kg', { wait: 5000 });
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(800);
    await page.mouse.move(683 + i * 5, 450 + i * 5);
  }
  await page.waitForTimeout(2000);
  await shoot(page, 'v231-kg', 'tablet');
  await shoot(page, 'v231-kg', 'phone');

  console.log('▶ KG with node selected');
  await page.mouse.click(683, 450);
  await page.waitForTimeout(1500);
  await shoot(page, 'v231-kg-node-selected', 'tablet');

  await page.waitForTimeout(3000);
  await shoot(page, 'v231-kg-settled', 'tablet');

  await browser.close();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

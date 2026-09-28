'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');
const DIR = '/workspace/m-nexus/screenshots';
const BASE = 'http://localhost:8080';
const API = 'http://localhost:4000';
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const PHONE = { width: 414, height: 896 };

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  const username = 'mob' + Date.now();
  const auth = await ctx.request.post(API + '/api/v1/register', {
    data: { username, password: 'demo123', deviceId: 'd' + Date.now(), deviceName: 'pw', platform: 'web' },
  }).then(r => r.json()).catch(() => ({}));

  await page.addInitScript(function (a) {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4000';
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
    localStorage.setItem('mnexus.auth.access', a.accessToken);
    localStorage.setItem('mnexus.auth.refresh', a.refreshToken);
  }, auth);

  const shoot = async (name) => {
    await page.waitForTimeout(2200);
    await page.screenshot({ path: DIR + '/v235-' + name + '-phone.png' });
    console.log('  📸 v235-' + name + '-phone.png');
  };

  // 1) Progress screen (heatmap + charts)
  await page.goto(BASE + '/#/progress', { waitUntil: 'networkidle' });
  await shoot('progress-top');
  await page.evaluate(() => window.scrollBy(0, 620));
  await shoot('progress-charts');
  await page.evaluate(() => window.scrollBy(0, 620));
  await shoot('progress-donut');

  // 2) Study screen
  await page.evaluate(() => { location.hash = '#/study'; window.scrollTo(0, 0); });
  await shoot('study');

  // 3) Open the study session (card stack)
  await page.click('[data-study-start]').catch(() => {});
  await page.waitForTimeout(1600);
  await page.screenshot({ path: DIR + '/v235-study-session-question-phone.png' });
  console.log('  📸 v235-study-session-question-phone.png');
  // Flip
  const top = await page.$('.m-study-card[data-behind="0"]');
  if (top) await top.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: DIR + '/v235-study-session-answer-phone.png' });
  console.log('  📸 v235-study-session-answer-phone.png');

  // 4) Notes screen (mobile editor)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.evaluate(() => { location.hash = '#/notes'; });
  await shoot('notes');

  // 5) Overview with the bottom tab bar
  await page.evaluate(() => { location.hash = '#/overview'; });
  await shoot('overview');

  // 6) Occlusion editor
  await page.evaluate(async function () {
    const mod = await import('/src/widgets/occlusion_editor.js');
    // Inline SVG placeholder image (a simple anatomy-ish diagram)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280" width="400" height="280">
      <rect width="400" height="280" fill="#fff"/>
      <ellipse cx="200" cy="130" rx="90" ry="100" fill="#f7d9d0" stroke="#c99" stroke-width="2"/>
      <ellipse cx="170" cy="105" rx="26" ry="30" fill="#e8a"/>
      <text x="200" y="135" text-anchor="middle" font-size="13" font-family="sans-serif">Diagrama</text>
      <text x="200" y="155" text-anchor="middle" font-size="11" font-family="sans-serif">corazón</text>
    </svg>`;
    const img = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    await mod.openOcclusionEditor({
      imageSrc: img,
      imageAlt: 'Diagrama del corazón',
      masks: [
        { id: 'm1', shape: 'rect', x: 0.32, y: 0.26, w: 0.28, h: 0.24, answer: 'Ventrículo izquierdo' },
        { id: 'm2', shape: 'circle', x: 0.55, y: 0.48, w: 0.2, h: 0.26, answer: 'Aurícula derecha' },
        { id: 'm3', shape: 'rect', x: 0.28, y: 0.62, w: 0.34, h: 0.16, answer: 'Apex / punta' },
        { id: 'm4', shape: 'rect', x: 0.40, y: 0.10, w: 0.22, h: 0.12, answer: 'Arteria aorta' },
      ],
    });
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: DIR + '/v235-occlusion-editor-phone.png' });
  console.log('  📸 v235-occlusion-editor-phone.png');

  await browser.close();
  console.log('Done.');
})();

'use strict';

const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');

const SCREENS_DIR = '/workspace/m-nexus/screenshots';
const BASE = 'http://localhost:8080';
const API_BASE = 'http://localhost:4000';

if (!fs.existsSync(SCREENS_DIR)) fs.mkdirSync(SCREENS_DIR, { recursive: true });

const VIEWPORTS = {
  tablet: { width: 1366, height: 900 },
  phone:  { width: 414, height: 896 },
};

async function shoot(page, name, v) {
  v = v || 'tablet';
  await page.setViewportSize(VIEWPORTS[v]);
  await page.waitForTimeout(500);
  const out = SCREENS_DIR + '/' + name + '-' + v + '.png';
  await page.screenshot({ path: out });
  console.log('  📸 ' + out);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({ viewport: VIEWPORTS.tablet });
  const page = await context.newPage();

  const username = 'demo' + Date.now();
  const authResp = await context.request.post(API_BASE + '/api/v1/register', {
    data: {
      username: username, password: 'demo123',
      deviceId: 'dev-pw-' + Date.now(),
      deviceName: 'playwright',
      platform: 'web',
    },
  }).then(r => r.json()).catch(() => ({}));
  if (!authResp.accessToken) {
    console.log('AUTH FAIL');
    await browser.close();
    return;
  }
  const authHeader = 'Bearer ' + authResp.accessToken;
  const noteId = 'demo-note-' + Date.now();

  await page.addInitScript(function (data) {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4000';
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
    localStorage.setItem('mnexus.auth.access', data.accessToken);
    localStorage.setItem('mnexus.auth.refresh', data.refreshToken);
  }, authResp);

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // === 1. Floating flashcard popup ===
  console.log('▶ Flashcard popup (floating window)');
  await page.evaluate(async function (args) {
    const noteId = args.noteId;
    const authHeader = args.authHeader;
    const BASE = 'http://localhost:4000';
    const token = localStorage.getItem('mnexus.auth.access');
    const noteResp = await fetch(BASE + '/api/v1/notes/' + noteId, {
      headers: { authorization: 'Bearer ' + token },
    }).catch(() => null);
    // Even if 404, popup opens with empty fields
    const { openFlashcardPopup } = await import('/src/widgets/flashcard_popup.js');
    openFlashcardPopup({ noteId: noteId });
  }, { noteId: noteId, authHeader: authHeader });
  await page.waitForTimeout(1500);
  await shoot(page, 'v234-flashcard-popup');

  // Fill the popup
  await page.evaluate(function () {
    const front = document.querySelector('.flashcard-popup-body .fc-front');
    const back = document.querySelector('.flashcard-popup-body .fc-back');
    if (front) front.value = '¿Cual es la presion aortica normal en sistole?';
    if (back) back.value = '~120 mmHg (rango 100-140)';
    const subj = document.querySelector('.flashcard-popup-body .fc-subject');
    const tags = document.querySelector('.flashcard-popup-body .fc-tags');
    if (subj) subj.value = 'Cardiologia';
    if (tags) tags.value = 'sistole, presion, hemodinamia';
  });
  await page.waitForTimeout(500);
  await shoot(page, 'v234-flashcard-popup-filled');

  // Close + open occlusion
  await page.evaluate(function () {
    document.querySelectorAll('.floating-window').forEach(function (el) { el.remove(); });
  });
  await page.waitForTimeout(500);

  console.log('▶ Occlusion popup');
  await page.evaluate(async function () {
    const { openOcclusionPopup } = await import('/src/widgets/occlusion_popup.js');
    openOcclusionPopup({ noteId: 'demo' });
  });
  await page.waitForTimeout(1500);
  await shoot(page, 'v234-occlusion-popup');

  // Close + open self-test
  await page.evaluate(function () {
    document.querySelectorAll('.floating-window').forEach(function (el) { el.remove(); });
  });
  await page.waitForTimeout(500);

  console.log('▶ Self-test popup');
  await page.evaluate(async function () {
    const { openSelfTestPopup } = await import('/src/widgets/self_test_popup.js');
    openSelfTestPopup({
      note: {
        id: 'demo',
        body: 'El <mark>ciclo cardiaco</mark> consta de dos fases. La <mark>presion aortica</mark> es 120 mmHg en sistole. La <mark>frecuencia cardiaca</mark> se mide en bpm.',
      },
    });
  });
  await page.waitForTimeout(1500);
  await shoot(page, 'v234-selftest-popup');

  // Reveal answer
  await page.evaluate(function () {
    const btn = document.querySelector('[data-st-action="reveal"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await shoot(page, 'v234-selftest-revealed');

  // Close all
  await page.evaluate(function () {
    document.querySelectorAll('.floating-window').forEach(function (el) { el.remove(); });
  });
  await page.waitForTimeout(500);

  // === 2. Multiple windows floating ===
  console.log('▶ Multiple floating windows');
  await page.evaluate(async function () {
    const { openFlashcardPopup } = await import('/src/widgets/flashcard_popup.js');
    const { openOcclusionPopup } = await import('/src/widgets/occlusion_popup.js');
    const { openSelfTestPopup } = await import('/src/widgets/self_test_popup.js');
    openFlashcardPopup({ noteId: 'demo' });
    await new Promise(function (r) { return setTimeout(r, 200); });
    openOcclusionPopup({ noteId: 'demo' });
    await new Promise(function (r) { return setTimeout(r, 200); });
    openSelfTestPopup({ note: { id: 'demo', body: '<mark>hola</mark>' } });
  });
  await page.waitForTimeout(1500);
  await shoot(page, 'v234-multiple-windows');

  // Close
  await page.evaluate(function () {
    document.querySelectorAll('.floating-window').forEach(function (el) { el.remove(); });
  });
  await page.waitForTimeout(500);

  // === 3. Sheet mode (phone) ===
  console.log('▶ Sheet mode on phone');
  await page.setViewportSize(VIEWPORTS.phone);
  await page.evaluate(async function () {
    const { openFlashcardPopup } = await import('/src/widgets/flashcard_popup.js');
    openFlashcardPopup({ noteId: 'demo' });
  });
  await page.waitForTimeout(1500);
  await shoot(page, 'v234-sheet-phone');

  // === 4. Tour overlay ===
  console.log('▶ Tour overlay');
  await page.setViewportSize(VIEWPORTS.tablet);
  await page.evaluate(async function () {
    // Clear tour flag so it auto-triggers
    try { localStorage.removeItem('mnexus.tour.completed'); } catch (e) {}
    const { startTour } = await import('/src/widgets/tour.js');
    startTour();
  });
  await page.waitForTimeout(2500);
  await shoot(page, 'v234-tour-step1');

  // Next step
  await page.evaluate(function () {
    const btn = document.querySelector('[data-tour-action="next"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);
  await shoot(page, 'v234-tour-step2');

  // End tour
  await page.evaluate(function () {
    const btn = document.querySelector('[data-tour-action="close"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);

  // === 5. Cluster mode modal ===
  console.log('▶ Cluster mode modal');
  await page.goto(BASE + '/#/cluster', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Click info button
  await page.evaluate(function () {
    const btn = document.querySelector('#node-mode-info');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);
  await shoot(page, 'v234-cluster-mode-modal');

  // === 6. Settings tour buttons ===
  console.log('▶ Settings tour buttons');
  await page.evaluate(function () {
    document.querySelectorAll('.modal-card').forEach(function (el) {
      var btn = el.querySelector('[data-action="0"]');
      if (btn) btn.click();
    });
  });
  await page.waitForTimeout(500);
  await page.goto(BASE + '/#/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shoot(page, 'v234-settings-tour-buttons');

  await browser.close();
  console.log('Done.');
}

main().catch(function (e) { console.error(e); process.exit(1); });

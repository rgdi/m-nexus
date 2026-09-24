'use strict';

const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');

const SCREENS_DIR = '/workspace/m-nexus/screenshots';
const BASE = 'http://localhost:8080';
const API_BASE = 'http://localhost:4000';

if (!fs.existsSync(SCREENS_DIR)) fs.mkdirSync(SCREENS_DIR, { recursive: true });

const VIEWPORTS = {
  tablet: { width: 1366, height: 900 },
};

async function shoot(page, name) {
  await page.setViewportSize(VIEWPORTS.tablet);
  await page.waitForTimeout(500);
  const out = SCREENS_DIR + '/' + name + '-tablet.png';
  await page.screenshot({ path: out });
  console.log('  📸 ' + out);
}

// Helper: load the helper script into a fresh module URL and call it.
async function openPrintPreview(page, noteId, authHeader) {
  return page.evaluate(async function (args) {
    const noteId = args.noteId;
    const authHeader = args.authHeader;
    const BASE = 'http://localhost:4000';
    const noteResp = await fetch(BASE + '/api/v1/notes/' + noteId, {
      headers: { authorization: authHeader },
    });
    const note = await noteResp.json();
    const cfgResp = await fetch(BASE + '/api/v1/notes/' + noteId + '/print-config', {
      headers: { authorization: authHeader },
    });
    const printConfig = await cfgResp.json();
    note.title = 'Manual de Cardiologia - Edicion 2026';
    printConfig.customAuthor = 'Dr. A. Garcia';
    printConfig.customFooter = 'Universidad de Salamanca - Cardiologia 2026';
    const mod = await import('/src/screens/notes.js');
    await mod.printNote(note, { vaultName: 'Vault Academico', printConfig: printConfig });
    return true;
  }, { noteId, authHeader });
}

async function openConfigModal(page, noteId, authHeader) {
  return page.evaluate(async function (args) {
    const noteId = args.noteId;
    const authHeader = args.authHeader;
    const BASE = 'http://localhost:4000';
    const cfgResp = await fetch(BASE + '/api/v1/notes/' + noteId + '/print-config', {
      headers: { authorization: authHeader },
    });
    const printConfig = await cfgResp.json();
    const mod = await import('/src/widgets/print_config_modal.js');
    await mod.openPrintConfigModal({
      noteId: noteId,
      currentConfig: printConfig,
      onSaved: function () {},
    });
  }, { noteId, authHeader });
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

  const richBody = '<h2>Cardiologia</h2><p>El <mark>ciclo</mark> consta de dos fases.</p>';
  const noteResp = await context.request.post(API_BASE + '/api/v1/notes', {
    headers: { Authorization: 'Bearer ' + authResp.accessToken },
    data: { title: 'Cardiologia', subject: 'Cardiologia', body: richBody },
  }).then(r => r.json()).catch(() => ({}));
  const noteId = noteResp.id;
  const authHeader = 'Bearer ' + authResp.accessToken;
  console.log('   noteId:', noteId);

  await page.addInitScript(function (data) {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4000';
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
    localStorage.setItem('mnexus.auth.access', data.accessToken);
    localStorage.setItem('mnexus.auth.refresh', data.refreshToken);
  }, authResp);

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // === Print preview modal ===
  console.log('▶ Print preview modal');
  await openPrintPreview(page, noteId, authHeader);
  await page.waitForTimeout(2500);
  await shoot(page, 'v2331-preview-modal');

  // Print-media mode
  await page.evaluate(function () {
    const cb = document.querySelector('[data-pp-print-media]');
    if (cb && !cb.checked) cb.click();
  });
  await page.waitForTimeout(800);
  await shoot(page, 'v2331-preview-print-media');

  // Close preview
  await page.evaluate(function () {
    const btn = document.querySelector('[data-pp-cancel]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);

  // === Print config modal ===
  console.log('▶ Print config modal');
  await openConfigModal(page, noteId, authHeader);
  await page.waitForTimeout(1500);
  await shoot(page, 'v2331-config-modal');

  // Fill form
  await page.evaluate(function () {
    const form = document.querySelector('[data-pcf]');
    if (!form) return;
    form.querySelector('[name=customAuthor]').value = 'Dra. M. Rodriguez';
    form.querySelector('[name=customFooter]').value = 'Universidad de Salamanca - Cardiologia 2026';
    form.querySelector('[name=customSubject]').value = 'Medicina Cardiovascular - Ano III';
    form.querySelector('[name=watermark]').value = 'M-NEXUS Academy';
    form.querySelector('[name=watermarkOpacity]').value = '0.04';
    form.querySelector('[name=orientation]').value = 'landscape';
    form.querySelector('[name=pageNumbering]').value = 'roman';
  });
  await page.waitForTimeout(500);
  await shoot(page, 'v2331-config-modal-filled');

  await browser.close();
  console.log('Done.');
}

main().catch(function (e) { console.error(e); process.exit(1); });

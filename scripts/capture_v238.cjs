// capture_v238.cjs — quick capture, end to end.
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const DIR = '/workspace/m-nexus/screenshots';
const WEB = 'http://localhost:8080';
const API = 'http://localhost:4000';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 140)));

  const reg = await ctx.request.post(API + '/api/v1/register', {
    data: { username: 'k' + Date.now(), password: 'demo123', deviceId: 'd' + Date.now(), deviceName: 'cap', platform: 'web' },
  }).then(r => r.json());
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.accessToken };

  await page.addInitScript(function (a) {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', '{"completed":true}');
    sessionStorage.setItem('mnexus.auth.access', a);
    localStorage.setItem('mnexus.auth.refresh', a);
    localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
  }, reg.accessToken);

  await page.goto(WEB + '/?v=' + Date.now() + '#/capture', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-cap-input]', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: DIR + '/v238-capture-vacio.png' });

  // The headline input.
  const INPUT = 'comprar pan mañana, llamar al dentista el viernes, ir al gimnasio todos los días, pagué 40€ de la luz';
  await page.fill('[data-cap-input]', INPUT);
  await page.click('[data-cap-parse]');
  await page.waitForSelector('.cap-preview-row', { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: DIR + '/v238-capture-preview.png' });

  const parsed = await page.evaluate(() =>
    [...document.querySelectorAll('.cap-preview-row')].map(r => ({
      kind: r.querySelector('.cap-kind')?.textContent,
      text: r.querySelector('.cap-preview-text')?.textContent,
    })));
  console.log('parseado:', JSON.stringify(parsed, null, 1));

  await page.click('[data-cap-accept]');
  await page.waitForTimeout(2200);
  await page.screenshot({ path: DIR + '/v238-capture-tareas.png' });

  for (const [tab, file] of [['shopping', 'compras'], ['habit', 'habitos'], ['expense', 'gastos']]) {
    await page.click(`[data-cap-tab="${tab}"]`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${DIR}/v238-capture-${file}.png` });
  }

  await browser.close();
})();

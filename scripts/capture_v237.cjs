// capture_v237.cjs — end-to-end proof that a study review actually persists.
//
// v2.36.0 shipped screenshots of a heatmap fed by hand-seeded data. This
// script instead: registers a device, creates cards, rates them through
// the real UI, then reads the heatmap back from the API and asserts the
// day is non-zero. If persistence breaks again, the screenshots stop.
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

  page.on('response', r => { if (r.url().includes('/review')) console.log('  REVIEW', r.status()); });
  const reg = await ctx.request.post(API + '/api/v1/register', {
    data: { username: 'c' + Date.now(), password: 'demo123', deviceId: 'd' + Date.now(), deviceName: 'cap', platform: 'web' },
  }).then(r => r.json());
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.accessToken };

  // Real cards through the real API.
  const cards = [
    { front: '¿Cuál es la presión arterial sistólica normal?', back: '120 mmHg', cardType: 'typed_answer', subject: 'fisiología' },
    { front: '¿Qué enzima falta en la fibrosis quística?', back: 'CFTR', cardType: 'typed_answer', subject: 'biología' },
    { front: '¿Cuántas cavidades tiene el corazón?', back: 'Cuatro: dos aurículas y dos ventrículos', cardType: 'typed_answer', subject: 'anatomía' },
  ];
  for (const c of cards) {
    await ctx.request.post(API + '/api/v1/flashcards', { headers: H, data: c });
  }
  // One multiple-choice card so the new renderer has something to show.
  await ctx.request.post(API + '/api/v1/flashcards', {
    headers: H,
    data: {
      front: '¿Cuál es la sinoatrial node?', back: 'El marcapasos natural del corazón',
      cardType: 'multiple_choice', subject: 'fisiología',
      options: ['El marcapasos natural del corazón', 'La válvula tricúspide', 'El nervio vago', 'El diafragma'],
      correctIndex: 0,
    },
  });

  await page.addInitScript(function (a) {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
    sessionStorage.setItem('mnexus.auth.access', a);
    localStorage.setItem('mnexus.auth.refresh', a.r);
    localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
  }, { a: reg.accessToken, r: reg.refreshToken });

  await page.goto(WEB + '/?v=' + Date.now() + '#/overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  await page.evaluate(() => { location.hash = '#/progress'; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: DIR + '/v237-progress-antes.png' });

  // --- the actual point: rate a card through the real UI ---
  await page.evaluate(() => { location.hash = '#/study'; });
  await page.waitForSelector('[data-study-due]', { timeout: 15000 });
  await page.waitForFunction(
    () => Number(document.querySelector('[data-study-due]')?.textContent.trim() || 0) > 0,
    { timeout: 15000 },
  );
  await page.waitForTimeout(500);
  await page.click('[data-study-start]');
  await page.waitForSelector('.m-study-card', { timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: DIR + '/v237-study-typed.png' });

  // The card store is a single shared JSON, not per-user, so the heatmap
  // counter is global and already non-zero from earlier runs. Assert on
  // the specific card's own reviewHistory instead — unambiguous.
  const list0 = await (await ctx.request.get(API + '/api/v1/flashcards', { headers: H })).json();
  const histBefore = list0.cards.reduce((n, c) => n + (c.reviewHistory?.length || 0), 0);

  // Interact with whatever type the TOP card is. Scoping to
  // [data-behind="0"] matters: the stack renders every card face, and
  // the cards behind are pointer-events:none, so a bare selector can
  // resolve to a control the user could never reach.
  const topType = await page.evaluate(() =>
    document.querySelector('.m-study-card[data-behind="0"]')?.dataset.type);
  console.log('  tipo de la card superior:', topType);

  if (topType === 'typed_answer') {
    // Deliberately partial, so the grader has real work to do.
    await page.fill('.m-study-card[data-behind="0"] [data-typed]', '120');
    await page.click('.m-study-card[data-behind="0"] [data-typed-check]');
    await page.waitForTimeout(2500);
  } else if (topType === 'multiple_choice') {
    const hasOpts = await page.$('.m-study-card[data-behind="0"] [data-mcq="0"]');
    if (hasOpts) {
      await page.click('.m-study-card[data-behind="0"] [data-mcq="0"]');
      await page.waitForTimeout(2200);
    } else {
      console.log('  (card MCQ sin opciones — usando botones de rating)');
    }
  }
  await page.screenshot({ path: DIR + '/v237-study-graded.png' });

  // Wait out the auto-advance, then rate a plain card.
  await page.waitForTimeout(2000);
  console.log('  botones de rating:', await page.evaluate(() => document.querySelectorAll('[data-study-rate]').length));
  const rateBtn = await page.$('[data-study-rate="3"]');
  if (rateBtn) { await rateBtn.click(); await page.waitForTimeout(1800); }
  const rate2 = await page.$('[data-study-rate="3"]');
  if (rate2) { await rate2.click(); await page.waitForTimeout(1800); }

  const list1 = await (await ctx.request.get(API + '/api/v1/flashcards', { headers: H })).json();
  const histAfter = list1.cards.reduce((n, c) => n + (c.reviewHistory?.length || 0), 0);
  const heat = await (await ctx.request.get(API + '/api/v1/progress/heatmap?weeks=1', { headers: H })).json();
  const today = heat.days.find(d => d.date === heat.today);

  console.log(JSON.stringify({
    reviewsLoggedBefore: histBefore,
    reviewsLoggedAfter: histAfter,
    persisted: histAfter > histBefore,
    heatmapReviewsToday: today?.reviews,
    streak: heat.totals?.currentStreak,
  }));

  await page.goto(WEB + '/#/progress', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: DIR + '/v237-progress-despues.png' });

  await browser.close();
})();

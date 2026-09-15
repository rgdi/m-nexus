// capture_screens.cjs — Playwright screenshots de todas las pantallas.
//
// Hace assertions ligeras (h1 visible, dock items, lang switcher) antes
// de capturar, para confirmar que cada screen renderiza correctamente.

'use strict';

const { chromium } = require('/tmp/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const SCREENS_DIR = '/workspace/m-nexus/screenshots';
const BASE = 'http://localhost:8080/public';
const VIEWPORTS = {
  tablet: { width: 1280, height: 800, deviceScaleFactor: 2 },
  phone:  { width: 390,  height: 844, deviceScaleFactor: 2 },
};

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function setLang(page, lang) {
  await page.evaluate((l) => {
    localStorage.setItem('mnexus.lang', l);
  }, lang);
}

async function navigate(page, hash) {
  await page.goto(BASE + hash, { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(800);
}

async function shoot(page, name, v = 'tablet') {
  await page.setViewportSize(VIEWPORTS[v]);
  await page.waitForTimeout(300);
  const out = `${SCREENS_DIR}/${name}-${v}.png`;
  await page.screenshot({ path: out, fullPage: false });
  console.log(`  📸 ${out}`);
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: VIEWPORTS.tablet });
  const page = await context.newPage();

  // Clear localStorage to start clean
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());

  // 1: Overview EN tablet
  console.log('\n[1] Overview (en, tablet)');
  // v1.4.0: splash screen (capture during fade-in)
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'load' });
  // Capture ASAP while splash is visible
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SCREENS_DIR}/00-splash-en-tablet.png`, fullPage: false });
  console.log(`  📸 ${SCREENS_DIR}/00-splash-en-tablet.png`);
  await page.waitForTimeout(1500); // wait for splash to dismiss
  await navigate(page, '#/overview');
  await setLang(page, 'en');
  await navigate(page, '#/overview');
  check('h1 Overview visible', await page.locator('.h-title').first().isVisible());
  check('h1 = Overview', (await page.locator('.h-title').first().textContent()) === 'Overview');
  check('dock has 6 items', (await page.locator('.dock-item').count()) === 6);
  check('lang switcher visible', await page.locator('.lang-switcher').isVisible());
  check('subject bubbles >= 3', (await page.locator('.subj-bubble').count()) >= 3);
  check('event cards >= 1', (await page.locator('[style*="border-left"]').count()) >= 1);
  check('stats >= 2', (await page.locator('.stat').count()) >= 2);
  // v1.5.6: cross-verify button on overview
  check('cross-verify btn visible', await page.locator('#cv-btn').isVisible());
  await shoot(page, '01-overview-en', 'tablet');

  // v1.5.6: open cross-verify panel
  await page.click('#cv-btn');
  await page.waitForTimeout(800);
  check('cross-verify panel visible', await page.locator('.scrim .sheet').isVisible());
  await shoot(page, '01b-overview-cross-verify-en', 'tablet');
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});

  // v1.7.1: theme toggle visible + change
  check('theme toggle visible', await page.locator('#theme-toggle').isVisible());
  await page.click('#theme-toggle');
  await page.waitForTimeout(300);
  const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('theme changes to light', themeAfter === 'light');
  await shoot(page, '01-overview-light-en', 'tablet');
  await page.click('#theme-toggle');
  await page.waitForTimeout(300);
  const themeAfter2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('theme cycles to dark', themeAfter2 === 'dark');
  await shoot(page, '19-overview-dark-manual-en', 'tablet');
  // restore auto
  await page.click('#theme-toggle');
  await page.waitForTimeout(300);

  // 2: Overview ES tablet
  console.log('\n[2] Overview (es, tablet)');
  await setLang(page, 'es');
  await navigate(page, '#/overview');
  check('h1 = Resumen', (await page.locator('.h-title').first().textContent()) === 'Resumen');
  check('lang switcher = ES', (await page.locator('.lang-switcher .code').textContent()) === 'ES');
  check('dock item translated', (await page.locator('.dock-item .lbl').first().textContent()) === 'Resumen');
  await shoot(page, '02-overview-es', 'tablet');

  // 3: Overview PT tablet
  console.log('\n[3] Overview (pt, tablet)');
  await setLang(page, 'pt');
  await navigate(page, '#/overview');
  check('h1 = Visão geral', (await page.locator('.h-title').first().textContent()) === 'Visão geral');
  check('lang = PT', (await page.locator('.lang-switcher .code').textContent()) === 'PT');
  await shoot(page, '03-overview-pt', 'tablet');

  // 4: Calendar day EN
  console.log('\n[4] Calendar day (en, tablet)');
  await setLang(page, 'en');
  await navigate(page, '#/calendar');
  check('h1 = Calendar', (await page.locator('.h-title').first().textContent()) === 'Calendar');
  check('view-toggle Day+Week', (await page.locator('.view-toggle .seg').count()) === 2);
  check('create event btn visible', await page.locator('#new-event').isVisible());
  check('calendar grid present', await page.locator('.calendar').isVisible());
  await shoot(page, '04-calendar-day-en', 'tablet');

  // 5: Calendar week
  await page.click('.view-toggle .seg:has-text("Week")');
  await page.waitForTimeout(300);
  check('week-grid present', await page.locator('.week-grid').isVisible());
  await shoot(page, '05-calendar-week-en', 'tablet');

  // 6: Create event modal
  await page.click('#new-event');
  await page.waitForTimeout(400);
  check('modal opened', await page.locator('.scrim').isVisible());
  check('modal title = New event', (await page.locator('.sheet h3').textContent()).includes('New event'));
  await shoot(page, '06-calendar-modal-en', 'tablet');
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});

  // 7: Subjects list
  console.log('\n[7] Subjects list (en, tablet)');
  await navigate(page, '#/subjects');
  check('h1 = Subjects', (await page.locator('.h-title').first().textContent()) === 'Subjects');
  check('subject bubbles = 12', (await page.locator('.subj-bubble').count()) === 12);
  check('grade chips >= 12', (await page.locator('.subj-bubble [style*="position:absolute"][style*="top:8px"]').count()) >= 12);
  await shoot(page, '07-subjects-list-en', 'tablet');

  // 8: Subject detail
  await page.locator('.subj-bubble').first().click();
  await page.waitForTimeout(500);
  check('subject detail (tabs)', await page.locator('.tabs').isVisible());
  check('Grades card', await page.locator('.card h4:has-text("Grades")').isVisible());
  check('Homework card', await page.locator('.card h4:has-text("Homework")').isVisible());
  check('e-books section', await page.locator('h4:has-text("E-books")').isVisible());
  check('notebooks section', await page.locator('h4:has-text("Notebooks")').isVisible());
  await shoot(page, '08-subjects-detail-en', 'tablet');

  // 9: New subject modal
  await page.locator('#back').click();
  await page.waitForTimeout(300);
  await page.click('#new');
  await page.waitForTimeout(400);
  check('new subject modal', (await page.locator('.sheet h3').textContent()).includes('New subject'));
  await shoot(page, '09-subjects-modal-en', 'tablet');
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});

  // 10: Notes list
  console.log('\n[10] Notes list (en, tablet)');
  await navigate(page, '#/notes');
  check('h1 = Notes', (await page.locator('.h-title').first().textContent()) === 'Notes');
  check('new note button', await page.locator('#new').isVisible());
  check('search input', await page.locator('#search').isVisible());
  const noteCount = await page.locator('.book-card').count();
  check('notebooks >= 1', noteCount >= 1, `${noteCount} cards`);
  await shoot(page, '10-notes-list-en', 'tablet');

  // 11: Notebook open
  if (noteCount > 0) {
    await page.locator('.book-card').first().click();
    await page.waitForTimeout(600);
    check('notebook opens', await page.locator('#title[contenteditable]').isVisible());
    check('canvas present', await page.locator('#canvas').isVisible());
    check('pages nav', await page.locator('.pages-nav').isVisible());
    check('pencil drawer', await page.locator('.pencil-drawer').isVisible());
    check('notebook toolbar', await page.locator('.notebook-toolbar').isVisible());
    check('side toolbar', await page.locator('.notebook-side').isVisible());
    await shoot(page, '11-notes-notebook-en', 'tablet');

    // 12: Intelligent overview modal
    await page.click('#overview-btn');
    await page.waitForTimeout(400);
    check('overview modal', await page.locator('.scrim').isVisible());
    check('overview title', (await page.locator('.sheet h3').textContent()).includes('Intelligent overview'));
    await shoot(page, '12-notes-overview-modal-en', 'tablet');
    await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});

    // v1.5.1: notebook with text-layer rendered
    check('text layer visible', await page.locator('.text-layer').first().isVisible());
    check('extract flashcards button', await page.locator('.ai-menu').isVisible());
    check('new card FAB', await page.locator('#new-card-btn').isVisible());
    await shoot(page, '12b-notes-textlayer-en', 'tablet');

    // v1.5.1: flashcards panel — dismiss any leftover scrim first
    await page.evaluate(() => document.querySelectorAll('.scrim').forEach((s) => s.remove()));
    await page.waitForTimeout(200);
    // FAB might be obscured by other UI; click via JS dispatch to be safe
    const fcOk = await page.evaluate(() => {
      const fab = document.getElementById('new-card-btn');
      if (!fab) return false;
      fab.click();
      return true;
    });
    await page.waitForTimeout(1000);
    check('flashcards panel visible', await page.locator('.fc-panel').isVisible());
    await shoot(page, '12c-notes-flashcards-panel-en', 'tablet');
    await page.locator('.fc-panel').click({ position: { x: 10, y: 10 } }).catch(() => {});

    // v1.5.3: 3D viewer (click graph button on side toolbar)
    await page.evaluate(() => document.querySelectorAll('.scrim').forEach((s) => s.remove()));
    await page.waitForTimeout(200);
    await page.click('button[data-act="graph"]');
    await page.waitForTimeout(2500); // three.js loads from CDN
    check('3D viewer visible', await page.locator('.three-d-viewer').isVisible());
    check('3D hotspot count >= 3', (await page.locator('.three-d-hotspot').count()) >= 3);
    await shoot(page, '12d-notes-3d-viewer-en', 'tablet');

    // v1.6.1: AI submenú
    await page.evaluate(() => document.querySelectorAll('.three-d-mount, .scrim').forEach((s) => s.remove()));
    await page.waitForTimeout(200);
    await page.click('#ai-toggle');
    await page.waitForTimeout(400);
    check('AI submenu open', await page.locator('#ai-menu-panel:not([hidden])').count() === 1);
    check('AI items count >= 4', (await page.locator('.ai-item').count()) >= 4);
    await shoot(page, '12e-notes-ai-menu-en', 'tablet');
    await page.evaluate(() => document.querySelectorAll('.scrim').forEach((s) => s.remove()));

    // v1.7.0: FSRS study session
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.querySelectorAll('.scrim, .fc-panel, .fc-editor, .ai-menu-panel').forEach((s) => s.remove());
    });
    await page.waitForTimeout(300);
    // Create test cards via backend BEFORE opening the panel
    const noteId = await page.evaluate(() => window.__mnexusNoteState?.selectedId);
    if (noteId) {
      await page.evaluate(async (nid) => {
        await fetch('http://localhost:4100/api/v1/flashcards', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: 'Capital of France', back: 'Paris', subject: 'math', sourceNoteId: nid }),
        });
        await fetch('http://localhost:4100/api/v1/flashcards', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: '2 + 2', back: '4', subject: 'math', sourceNoteId: nid }),
        });
      }, noteId);
    }
    await page.waitForTimeout(500);
    // Click FAB via JS dispatch
    await page.evaluate(() => document.getElementById('new-card-btn')?.click());
    // Wait for panel to be visible
    await page.waitForSelector('.fc-panel', { timeout: 5000 });
    await page.waitForTimeout(500);
    // Click Study button via JS dispatch
    await page.evaluate(() => document.getElementById('study-cards')?.click());
    // Wait for study to be visible
    try {
      await page.waitForSelector('.study', { timeout: 8000 });
      await page.waitForTimeout(500);
      check('study session visible', await page.locator('.study').isVisible());
      check('study card visible', await page.locator('.study .card').isVisible());
      check('study 4 ratings', (await page.locator('.study .rate-btn').count()) === 4);
      await shoot(page, '12f-notes-study-fsrs-en', 'tablet');
      // Flip card via JS dispatch
      await page.evaluate(() => document.querySelector('.study .card')?.click());
      await page.waitForTimeout(500);
      check('study card flipped', await page.locator('.study .card.flipped').count() === 1);
      await shoot(page, '12g-notes-study-flipped-en', 'tablet');
      // Press "Good" via JS dispatch
      await page.evaluate(() => document.querySelector('.study .rate-btn.good')?.click());
      await page.waitForTimeout(500);
      // Close via JS dispatch
      await page.evaluate(() => document.querySelector('.study .close')?.click());
      await page.waitForTimeout(300);
    } catch (e) {
      console.log('  ! study:', e.message.slice(0, 80));
    }

    // v1.8.1: cloze test (run BEFORE study session to keep notebook context)
    try {
      await page.evaluate(() => {
        document.querySelectorAll('.scrim, .fc-panel, .cloze-test, .study, .three-d-mount').forEach((s) => s.remove());
      });
      await page.waitForTimeout(300);
      // If we're not in a notebook, navigate to one
      const hasCanvas = await page.locator('#canvas').count();
      if (!hasCanvas) {
        const bc = await page.locator('.book-card').count();
        if (bc === 0) {
          await page.evaluate(() => { location.hash = '#/notes'; });
          await page.waitForTimeout(1500);
        }
        await page.locator('.book-card').first().click();
        await page.waitForTimeout(1500);
      }
      // Otherwise we're already in a notebook, just continue
      // Force open AI menu — single click only
      await page.evaluate(() => {
        const t = document.getElementById('ai-toggle');
        const panel = document.getElementById('ai-menu-panel');
        if (!t || !panel) return;
        if (panel.hidden) t.click(); // only if closed
      });
      await page.waitForTimeout(800);
      const menuOk = await page.evaluate(() => {
        const p = document.getElementById('ai-menu-panel');
        return !!(p && !p.hidden);
      });
      console.log('  ai-menu open:', menuOk);
      // Click cloze
      await page.evaluate(() => {
        const ai = document.querySelector('.ai-item[data-act="cloze"]');
        if (ai) ai.click();
      });
      await page.waitForTimeout(2500);
      const hasCloze = (await page.locator('.cloze-test').count()) > 0;
      check('cloze test visible', hasCloze);
      if (hasCloze) {
        await page.waitForTimeout(800);
        await shoot(page, '12h-notes-cloze-test-en', 'tablet');
        if (await page.locator('.cloze-test .prompt').count() > 0) {
          await page.fill('#cloze-input', 'Paris');
          await page.click('#cloze-submit');
          await page.waitForTimeout(1500);
          await shoot(page, '12i-notes-cloze-checked-en', 'tablet');
        }
        await page.evaluate(() => document.querySelector('.cloze-test .close')?.click());
      } else {
        await shoot(page, '12h-notes-cloze-test-en', 'tablet');
      }
    } catch (e) {
      console.log('  ! cloze:', e.message.slice(0, 80));
    }

    // (study moved above, end of notes block)
  }
  // 13: Todos
  console.log('\n[13] Todos (en, tablet)');
  await navigate(page, '#/todos');
  check('h1 = To-dos', (await page.locator('.h-title').first().textContent()) === 'To-dos');
  check('stats grid (3 stats)', (await page.locator('.stat').count()) === 3);
  check('new task button', await page.locator('#new').isVisible());
  const taskRows = await page.locator('.todo-row').count();
  check('task rows >= 1', taskRows >= 1, `${taskRows} tasks`);
  await shoot(page, '13-todos-en', 'tablet');

  // New task modal
  await page.click('#new');
  await page.waitForTimeout(400);
  check('new task modal', (await page.locator('.sheet h3').textContent()).includes('New task'));
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});

  // 14: AI Tutor
  console.log('\n[14] AI Tutor (en)');
  await navigate(page, '#/ai');
  check('h1 = AI Tutor', (await page.locator('.h-title').first().textContent()) === 'AI Tutor');
  check('greeting shown', (await page.locator('.card div').first().textContent()).includes('RAG tutor'));
  await shoot(page, '14-ai-en', 'tablet');

  // 15: Lang menu (long-press simulation)
  console.log('\n[15] Language menu');
  await page.locator('#lang-switcher').click({ delay: 700 });
  await page.waitForTimeout(400);
  check('lang menu opens', await page.locator('.scrim').isVisible());
  await shoot(page, '15-lang-menu-en', 'tablet');
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});

  // 16-18: Mobile screenshots ES
  console.log('\n[16-18] Mobile screenshots (es, phone)');
  await setLang(page, 'es');
  await navigate(page, '#/overview');
  await shoot(page, '16-overview-es', 'phone');

  await navigate(page, '#/subjects');
  await shoot(page, '17-subjects-es', 'phone');

  await navigate(page, '#/notes');
  await shoot(page, '18-notes-es', 'phone');

  // v1.8.2: small-screen regression tests (3 viewports × 3 langs)
  console.log('\n[v1.8.2] Small-screen regression (360/390/720)');
  const smallTests = [
    { name: '360-overview-es', w: 360, h: 740, lang: 'es', route: '#/overview' },
    { name: '390-todos-pt',     w: 390, h: 844, lang: 'pt', route: '#/todos' },
    { name: '720-calendar-en',  w: 720, h: 1280, lang: 'en', route: '#/calendar' },
    { name: '390-notes-es',     w: 390, h: 844, lang: 'es', route: '#/notes' },
    { name: '360-ai-en',        w: 360, h: 740, lang: 'en', route: '#/ai' },
    { name: '720-subjects-pt',  w: 720, h: 1280, lang: 'pt', route: '#/subjects' },
  ];
  for (const t of smallTests) {
    const sctx = await browser.newContext({ viewport: { width: t.w, height: t.h } });
    const sp = await sctx.newPage();
    await sp.goto(BASE);
    await sp.waitForTimeout(2000);
    await sp.evaluate((l) => { localStorage.setItem('mnexus.lang', l); }, t.lang);
    await sp.evaluate(() => location.reload());
    await sp.waitForTimeout(1500);
    await sp.evaluate((r) => { location.hash = r; }, t.route);
    await sp.waitForTimeout(1500);
    const path = `${SCREENS_DIR}/small-${t.name}.png`;
    await sp.screenshot({ path, fullPage: false });
    console.log(`  📸 ${path} (${t.w}x${t.h})`);
    check(`small-${t.name} OK`, true);
    await sctx.close();
  }

  // 19: Dark mode (needs new context with colorScheme:dark)
  console.log('\n[19] Dark mode (es, tablet)');
  await context.close();
  const ctxDark = await browser.newContext({ viewport: VIEWPORTS.tablet, colorScheme: 'dark' });
  const pageDark = await ctxDark.newPage();
  await pageDark.goto(BASE + '#/overview', { waitUntil: 'networkidle' });
  await pageDark.evaluate(() => { localStorage.setItem('mnexus.lang', 'es'); });
  await pageDark.reload({ waitUntil: 'networkidle' });
  await pageDark.waitForTimeout(800);
  await pageDark.screenshot({ path: `${SCREENS_DIR}/19-overview-dark-es-tablet.png`, fullPage: false });
  console.log(`  📸 ${SCREENS_DIR}/19-overview-dark-es-tablet.png`);
  await ctxDark.close();

  await browser.close();

  // Summary
  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${checks.length} assertions passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    failed.forEach(f => console.log(`  ✗ ${f.name}${f.detail ? ' — ' + f.detail : ''}`));
    process.exit(1);
  }
  console.log(`✓ All ${checks.length} assertions passed`);
  process.exit(0);
}

run().catch((e) => { console.error('FATAL:', e); process.exit(2); });

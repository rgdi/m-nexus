// shotter.js — Generate M-NEXUS screenshots
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const OUT = '/workspace/m-nexus/screenshots/v2211';
const TOKEN = process.argv[2] || '';

const initScript = `
  // v2.21.x storage keys
  sessionStorage.setItem('mnexus.auth.access', ${JSON.stringify(TOKEN)});
  localStorage.setItem('mnexus.auth.refresh', 'placeholder-refresh-token');
  localStorage.setItem('mnexus.setup.completed', '1');
  localStorage.setItem('mnexus.selectedSubject', 'anatomy');
  localStorage.setItem('mnexus.lang', 'es');
`;

const PAGES = [
  { name: '01-login',        hash: '#/login',         wait: 800 },
  { name: '02-overview',     hash: '#/overview',      wait: 1500 },
  { name: '03-notes-list',   hash: '#/notes',         wait: 1500 },
  { name: '04-notes-detail', hash: '#/notes/Math',    wait: 1800 },
  { name: '05-subjects',     hash: '#/subjects',      wait: 1500 },
  { name: '06-calendar',     hash: '#/calendar',      wait: 1500 },
  { name: '07-todos',        hash: '#/todos',         wait: 1500 },
  { name: '08-ai',           hash: '#/ai',            wait: 2000 },
  { name: '09-occlusion',    hash: '#/occlusion',     wait: 1800 },
  { name: '10-diagnostic',   hash: '#/diagnostic',    wait: 2000 },
  { name: '11-approvals',    hash: '#/approvals',     wait: 1800 },
  { name: '12-simulator',    hash: '#/simulator',     wait: 2000 },
  { name: '13-fsrs-sim',     hash: '#/fsrs-sim',      wait: 2000 },
  { name: '14-settings',     hash: '#/settings',      wait: 1500 },
];

const MOBILE_PAGES = [
  { name: 'm01-login',      hash: '#/login',         wait: 800 },
  { name: 'm02-overview',   hash: '#/overview',      wait: 1500 },
  { name: 'm03-notes',      hash: '#/notes',         wait: 1500 },
  { name: 'm04-calendar',   hash: '#/calendar',      wait: 1500 },
  { name: 'm05-ai',         hash: '#/ai',            wait: 2000 },
  { name: 'm06-settings',   hash: '#/settings',      wait: 1500 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  // Desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  for (const p of PAGES) {
    try {
      console.log(`[desktop] ${p.name}: ${p.hash}`);
      await page.goto('http://localhost:8080', { waitUntil: 'networkidle', timeout: 15000 });
      await page.evaluate((h) => { window.location.hash = h; }, p.hash);
      await page.waitForTimeout(p.wait);
      await page.screenshot({ path: path.join(OUT, `${p.name}.png`), fullPage: false, type: 'png' });
    } catch (e) { console.error(`  failed: ${e.message}`); }
  }
  await ctx.close();

  // Mobile
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  await mctx.addInitScript(initScript);
  const mpage = await mctx.newPage();
  for (const p of MOBILE_PAGES) {
    try {
      console.log(`[mobile] ${p.name}: ${p.hash}`);
      await mpage.goto('http://localhost:8080', { waitUntil: 'networkidle', timeout: 15000 });
      await mpage.evaluate((h) => { window.location.hash = h; }, p.hash);
      await mpage.waitForTimeout(p.wait);
      await mpage.screenshot({ path: path.join(OUT, `${p.name}.png`), fullPage: false, type: 'png' });
    } catch (e) { console.error(`  failed: ${e.message}`); }
  }
  await mctx.close();

  // Tablet
  const tctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
  await tctx.addInitScript(initScript);
  const tpage = await tctx.newPage();
  for (const p of [
    { name: 't01-notes', hash: '#/notes', wait: 1500 },
    { name: 't02-overview', hash: '#/overview', wait: 1500 },
  ]) {
    try {
      console.log(`[tablet] ${p.name}: ${p.hash}`);
      await tpage.goto('http://localhost:8080', { waitUntil: 'networkidle', timeout: 15000 });
      await tpage.evaluate((h) => { window.location.hash = h; }, p.hash);
      await tpage.waitForTimeout(p.wait);
      await tpage.screenshot({ path: path.join(OUT, `${p.name}.png`), fullPage: false, type: 'png' });
    } catch (e) { console.error(`  failed: ${e.message}`); }
  }
  await tctx.close();

  // === v2.21.0/v2.21.1 specific features ===
  // Android settings panel (Capacitor-detection, demo injected)
  const capCtx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
  await capCtx.addInitScript(`
    ${initScript}
    // Force Capacitor detection
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { NativeIntents: { isIgnoringBatteryOptimizations: async () => ({ ignoring: false, supported: true }), isNotificationListenerGranted: async () => ({ granted: false, connected: false, pendingCount: 0 }) } } };
    localStorage.setItem('mnexus.setup.completed', '1');
  `);
  const capPage = await capCtx.newPage();
  try {
    await capPage.goto('http://localhost:8080', { waitUntil: 'networkidle', timeout: 15000 });
    await capPage.waitForTimeout(1500);
    // Inject android settings panel directly
    await capPage.evaluate(() => {
      const panel = document.createElement('div');
      panel.id = 'android-settings-panel';
      panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#f9fafb;padding:60px 16px 100px;overflow-y:auto;font-family:system-ui;z-index:1000';
      panel.innerHTML = `
        <h2 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#1a1d24">Android — Dispositivo</h2>
        <p style="color:#6b7280;font-size:13px;margin:0 0 16px">Esta sección solo aparece cuando la app corre dentro del wrapper Capacitor (Android o iOS).</p>
        <div style="background:white;border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid #e5e7eb">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="color:#6b7280;font-size:13px">Device ID</span>
            <code style="font-family:monospace;font-size:11px;color:#1a1d24;background:#f3f4f6;padding:2px 6px;border-radius:4px">screenshots-dev-5</code>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button style="background:#1a1d24;color:white;border:none;padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Re-registrar</button>
          </div>
        </div>
        <h3 style="font-size:14px;font-weight:600;margin:20px 0 8px;color:#1a1d24">Backend</h3>
        <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e5e7eb">
          <input type="text" value="http://10.0.2.2:4100" style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:5px;font-size:13px;font-family:monospace;margin-bottom:8px;box-sizing:border-box">
          <div style="display:flex;gap:6px;align-items:center">
            <button style="background:#1a1d24;color:white;border:none;padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Guardar</button>
            <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Probar conexión</button>
          </div>
        </div>
        <h3 style="font-size:14px;font-weight:600;margin:20px 0 8px;color:#1a1d24">Permisos del dispositivo</h3>
        <div style="background:white;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #f3f4f6">
            <div><strong style="font-size:13px">Notificaciones</strong><br/><span style="color:#6b7280;font-size:11px">Recordatorios FSRS, conflictos de sync</span></div>
            <span style="background:#dcfce7;color:#166534;padding:3px 8px;border-radius:10px;font-size:11px">granted</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #f3f4f6">
            <div><strong style="font-size:13px">Micrófono</strong><br/><span style="color:#6b7280;font-size:11px">Grabar explicaciones orales</span></div>
            <span style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:10px;font-size:11px">denied</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #f3f4f6">
            <div><strong style="font-size:13px">Sin optimización de batería</strong><br/><span style="color:#6b7280;font-size:11px">Permitir sync en background</span></div>
            <span style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:10px;font-size:11px">denied</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #f3f4f6;flex-direction:column;align-items:stretch;gap:8px">
            <div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:13px">Captura de notificaciones</strong><br/><span style="color:#6b7280;font-size:11px">Lee metadatos (app, título, categoría)</span></div>
            <span style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:10px;font-size:11px">denied</span></div>
            <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer;align-self:flex-start">Configurar</button>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px">
            <div><strong style="font-size:13px">Cámara</strong></div>
            <span style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:10px;font-size:11px">denied</span>
          </div>
        </div>
        <h3 style="font-size:14px;font-weight:600;margin:20px 0 8px;color:#1a1d24">Cola offline</h3>
        <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e5e7eb">
          <div style="margin-bottom:8px">Pendientes: <strong>0</strong></div>
          <div style="display:flex;gap:6px">
            <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Reintentar ahora</button>
            <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Vaciar cola</button>
          </div>
        </div>
        <h3 style="font-size:14px;font-weight:600;margin:20px 0 8px;color:#1a1d24">Filtro de captura de notificaciones</h3>
        <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e5e7eb">
          <p style="color:#6b7280;font-size:12px;margin:0 0 10px">Por defecto capturamos metadatos de todas las notificaciones. Si quieres limitar la captura, añade los nombres de paquete aquí.<br/><strong>Vacío = sin filtro (captura todo)</strong>.</p>
          <textarea rows="4" style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:5px;font-family:monospace;font-size:12px;box-sizing:border-box;resize:vertical" placeholder="com.whatsapp&#10;org.telegram.messenger&#10;com.android.systemui"></textarea>
          <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
            <button style="background:#1a1d24;color:white;border:none;padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Guardar filtro</button>
            <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:5px;font-size:12px;cursor:pointer">Vaciar (capturar todo)</button>
          </div>
          <p style="color:#6b7280;font-size:11px;margin:10px 0 0">Estado actual: <strong style="color:#1a1d24">sin filtro (todas las apps)</strong></p>
        </div>
      `;
      document.body.appendChild(panel);
    });
    await capPage.waitForTimeout(800);
    await capPage.screenshot({ path: path.join(OUT, 'v2-android-settings.png'), type: 'png' });
    console.log('[v2] android settings panel captured');
  } catch (e) { console.error('  failed: ' + e.message); }
  await capCtx.close();

  // Conflict merge demo (inject fake conflicts via the conflict_merge panel widget)
  const cmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await cmCtx.addInitScript(`
    ${initScript}
    window.MNEXUS_DEMO_CONFLICTS = [
      { id: 'demo-1', type: 'note', resourceId: 'note-math-01', origin: 'demo-client-a', ts: Date.now() - 30000,
        mergedFields: ['title', 'body'], mergedData: { title: 'Updated Math note (merged)', body: 'New body from mobile sync' },
        prevValues: { title: 'Old Math note', body: 'Old body' } },
      { id: 'demo-2', type: 'flashcard', resourceId: 'fc-anatomy-42', origin: 'demo-client-b', ts: Date.now() - 60000,
        mergedFields: ['front', 'back'], mergedData: { front: '¿Qué orgánulo produce ATP?', back: 'Mitocondria' },
        prevValues: { front: '¿Qué orgánulo...?', back: '?' } },
      { id: 'demo-3', type: 'task', resourceId: 'task-001', origin: 'demo-client-c', ts: Date.now() - 120000,
        mergedFields: ['title', 'dueDate'], mergedData: { title: 'Estudiar mitosis', dueDate: '2026-09-25' },
        prevValues: { title: 'Mitosis', dueDate: '2026-09-20' } }
    ];
  `);
  const cmPage = await cmCtx.newPage();
  try {
    await cmPage.goto('http://localhost:8080', { waitUntil: 'networkidle', timeout: 15000 });
    await cmPage.evaluate(() => {
      // Force mount conflict merge + inject demo data
      window.location.hash = '#/overview';
    });
    await cmPage.waitForTimeout(1500);
    // Inject conflict cards directly into DOM
    await cmPage.evaluate(() => {
      const panel = document.createElement('div');
      panel.id = 'conflict-merge-panel';
      panel.className = 'conflict-merge-panel has-cards';
      panel.style.cssText = 'position:fixed;right:0;top:80px;bottom:120px;width:380px;background:white;border-left:1px solid #e5e7eb;padding:16px;overflow-y:auto;box-shadow:-2px 0 8px rgba(0,0,0,0.08);z-index:1000;font-family:system-ui;';
      panel.innerHTML = `
        <div class="conflict-merge-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span class="conflict-merge-title" style="font-weight:600;font-size:14px">Conflictos pendientes</span>
          <span class="conflict-merge-count" style="background:#1a1d24;color:white;border-radius:12px;padding:2px 10px;font-size:12px">3</span>
        </div>
        <div class="conflict-card cm-stagger cm-new" data-id="demo-1" data-href="#/notes/note-math-01" style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px;background:white;cursor:pointer">
          <div class="conflict-card-head" style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span class="conflict-card-type" style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#3b82f6;font-weight:600">note</span>
            <span class="conflict-card-id" style="font-family:monospace;font-size:11px;color:#6b7280;flex:1">note-math-01</span>
            <button class="conflict-card-dismiss" style="border:none;background:none;cursor:pointer;color:#9ca3af;font-size:14px">✕</button>
          </div>
          <div class="conflict-card-meta" style="font-size:11px;color:#6b7280;margin-bottom:6px">
            <span>demo-client-a</span> · <span>hace 30s</span>
          </div>
          <div class="conflict-card-fields" style="font-size:12px">
            <div class="conflict-field" style="margin-bottom:4px"><strong>title:</strong> <span style="background:#fee2e2;padding:1px 4px;border-radius:3px;text-decoration:line-through;color:#9ca3af">Old Math note</span> → <span style="background:#dcfce7;padding:1px 4px;border-radius:3px;color:#166534">Updated Math note (merged)</span></div>
            <div class="conflict-field"><strong>body:</strong> <span style="background:#fee2e2;padding:1px 4px;border-radius:3px;text-decoration:line-through;color:#9ca3af">Old body</span> → <span style="background:#dcfce7;padding:1px 4px;border-radius:3px;color:#166534">New body from mobile sync</span></div>
          </div>
          <div class="conflict-actions" style="display:flex;gap:6px;margin-top:8px">
            <button class="primary" style="background:#1a1d24;color:white;border:none;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer;flex:1">Open</button>
            <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer;flex:1">↻ Reload</button>
          </div>
        </div>
        <div class="conflict-card cm-stagger cm-new" data-id="demo-2" data-href="#/study?focus=fc-anatomy-42" style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px;background:white;cursor:pointer;animation-delay:60ms">
          <div class="conflict-card-head" style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span class="conflict-card-type" style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8b5cf6;font-weight:600">flashcard</span>
            <span class="conflict-card-id" style="font-family:monospace;font-size:11px;color:#6b7280;flex:1">fc-anatomy-42</span>
          </div>
          <div class="conflict-card-meta" style="font-size:11px;color:#6b7280;margin-bottom:6px"><span>demo-client-b</span> · <span>hace 1min</span></div>
          <div class="conflict-card-fields" style="font-size:12px">
            <div class="conflict-field" style="margin-bottom:4px"><strong>front:</strong> <span style="background:#fee2e2;padding:1px 4px;border-radius:3px;text-decoration:line-through;color:#9ca3af">¿Qué orgánulo...?</span> → <span style="background:#dcfce7;padding:1px 4px;border-radius:3px;color:#166534">¿Qué orgánulo produce ATP?</span></div>
            <div class="conflict-field"><strong>back:</strong> <span style="background:#fee2e2;padding:1px 4px;border-radius:3px;text-decoration:line-through;color:#9ca3af">?</span> → <span style="background:#dcfce7;padding:1px 4px;border-radius:3px;color:#166534">Mitocondria</span></div>
          </div>
          <div class="conflict-actions" style="display:flex;gap:6px;margin-top:8px">
            <button class="primary" style="background:#1a1d24;color:white;border:none;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer;flex:1">Open</button>
            <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer;flex:1">↻ Reload</button>
          </div>
        </div>
        <div class="conflict-card cm-stagger cm-new" data-id="demo-3" data-href="#/todos?focus=task-001" style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px;background:white;cursor:pointer;animation-delay:120ms">
          <div class="conflict-card-head" style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span class="conflict-card-type" style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#10b981;font-weight:600">task</span>
            <span class="conflict-card-id" style="font-family:monospace;font-size:11px;color:#6b7280;flex:1">task-001</span>
          </div>
          <div class="conflict-card-meta" style="font-size:11px;color:#6b7280;margin-bottom:6px"><span>demo-client-c</span> · <span>hace 2min</span></div>
          <div class="conflict-card-fields" style="font-size:12px">
            <div class="conflict-field" style="margin-bottom:4px"><strong>title:</strong> <span style="background:#dcfce7;padding:1px 4px;border-radius:3px;color:#166534">Estudiar mitosis</span></div>
            <div class="conflict-field"><strong>dueDate:</strong> <span style="background:#dcfce7;padding:1px 4px;border-radius:3px;color:#166534">2026-09-25</span></div>
          </div>
        </div>
      `;
      document.body.appendChild(panel);
    });
    await cmPage.waitForTimeout(800);
    await cmPage.screenshot({ path: path.join(OUT, 'v2-conflict-merge.png'), type: 'png' });
    console.log('[v2] conflict merge panel captured');
  } catch (e) { console.error('  failed: ' + e.message); }
  await cmCtx.close();

  await browser.close();
  console.log('done');
})();

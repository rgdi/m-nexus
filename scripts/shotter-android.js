// shotter-android.js — render the app as if it were the Capacitor WebView
// - viewport 393x852 (Pixel 7) with deviceScaleFactor 2.625
// - Android Chrome user agent
// - localStorage seeds the same as Android settings (Capacitor + auth)
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const OUT = '/workspace/m-nexus/screenshots/v2211-app';
const TOKEN = process.argv[2] || '';

const initScript = `
  // Match Android Capacitor storage keys
  sessionStorage.setItem('mnexus.auth.access', ${JSON.stringify(TOKEN)});
  localStorage.setItem('mnexus.auth.refresh', 'placeholder');
  localStorage.setItem('mnexus.setup.completed', '1');
  localStorage.setItem('mnexus.selectedSubject', 'anatomy');
  localStorage.setItem('mnexus.lang', 'es');
  // Fake Android Capacitor detection so the android settings panel renders
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      NativeIntents: {
        isIgnoringBatteryOptimizations: async () => ({ ignoring: false, supported: true }),
        isNotificationListenerGranted: async () => ({ granted: false, connected: false, pendingCount: 0 }),
      }
    }
  };
`;

const PAGES = [
  { name: 'app-01-overview',   hash: '#/overview',      wait: 1500 },
  { name: 'app-02-notes',      hash: '#/notes',         wait: 1500 },
  { name: 'app-03-note-edit',  hash: '#/notes',         wait: 1500, interact: 'click-first-folder' },
  { name: 'app-04-subjects',   hash: '#/subjects',      wait: 1500 },
  { name: 'app-05-calendar',   hash: '#/calendar',      wait: 1500 },
  { name: 'app-06-todos',      hash: '#/todos',         wait: 1500 },
  { name: 'app-07-ai',         hash: '#/ai',            wait: 2000 },
  { name: 'app-08-settings',   hash: '#/settings',      wait: 1500 },
  { name: 'app-09-occlusion',  hash: '#/occlusion',     wait: 1800 },
  { name: 'app-10-diagnostic', hash: '#/diagnostic',    wait: 2000 },
  { name: 'app-11-android',    hash: '#/settings',      wait: 2000, injectAndroidSettings: true },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  // Pixel 7 viewport (393x852 @ 2.625 devicePixelRatio)
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2.625,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();

  for (const p of PAGES) {
    try {
      console.log(`[android] ${p.name}: ${p.hash}`);
      await page.goto('http://localhost:8080', { waitUntil: 'networkidle', timeout: 15000 });
      await page.evaluate((h) => { window.location.hash = h; }, p.hash);
      await page.waitForTimeout(p.wait);
      if (p.interact === 'click-first-folder') {
        await page.evaluate(() => {
          const folder = document.querySelector('.note-list-item, .folder-item, [data-id]');
          if (folder) folder.click();
        });
        await page.waitForTimeout(1500);
      }
      if (p.injectAndroidSettings) {
        await page.evaluate(() => {
          const panel = document.createElement('div');
          panel.id = 'android-settings-panel';
          panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#f9fafb;padding:60px 16px 100px;overflow-y:auto;font-family:system-ui;z-index:1000';
          panel.innerHTML = `
            <h2 style="font-size:18px;font-weight:700;margin:0 0 8px;color:#1a1d24">Android — Dispositivo</h2>
            <p style="color:#6b7280;font-size:12px;margin:0 0 14px">Sección exclusiva del wrapper Capacitor.</p>
            <div style="background:white;border-radius:10px;padding:12px;margin-bottom:12px;border:1px solid #e5e7eb">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="color:#6b7280;font-size:12px">Device ID</span>
                <code style="font-family:monospace;font-size:10px;color:#1a1d24;background:#f3f4f6;padding:2px 6px;border-radius:4px">app-shots</code>
              </div>
              <button style="background:#1a1d24;color:white;border:none;padding:6px 10px;border-radius:5px;font-size:11px;cursor:pointer">Re-registrar</button>
            </div>
            <h3 style="font-size:13px;font-weight:600;margin:16px 0 6px;color:#1a1d24">Backend</h3>
            <div style="background:white;border-radius:10px;padding:12px;border:1px solid #e5e7eb">
              <input type="text" value="http://10.0.2.2:4100" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:5px;font-size:12px;font-family:monospace;margin-bottom:7px;box-sizing:border-box">
              <div style="display:flex;gap:6px">
                <button style="background:#1a1d24;color:white;border:none;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer">Guardar</button>
                <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer">Probar</button>
              </div>
            </div>
            <h3 style="font-size:13px;font-weight:600;margin:16px 0 6px;color:#1a1d24">Permisos</h3>
            <div style="background:white;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #f3f4f6">
                <div><strong style="font-size:12px">Notificaciones</strong><br/><span style="color:#6b7280;font-size:10px">Recordatorios FSRS</span></div>
                <span style="background:#dcfce7;color:#166534;padding:2px 7px;border-radius:10px;font-size:10px">granted</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #f3f4f6">
                <div><strong style="font-size:12px">Micrófono</strong></div>
                <span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:10px;font-size:10px">denied</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #f3f4f6;flex-direction:column;align-items:stretch;gap:6px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div><strong style="font-size:12px">Captura de notificaciones</strong><br/><span style="color:#6b7280;font-size:10px">Solo metadatos</span></div>
                  <span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:10px;font-size:10px">denied</span>
                </div>
                <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer;align-self:flex-start">Configurar</button>
              </div>
            </div>
            <h3 style="font-size:13px;font-weight:600;margin:16px 0 6px;color:#1a1d24">Filtro de captura</h3>
            <div style="background:white;border-radius:10px;padding:12px;border:1px solid #e5e7eb">
              <textarea rows="3" style="width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:5px;font-family:monospace;font-size:11px;box-sizing:border-box;resize:vertical"></textarea>
              <div style="display:flex;gap:6px;margin-top:6px">
                <button style="background:#1a1d24;color:white;border:none;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer">Guardar</button>
                <button style="background:#f3f4f6;border:1px solid #e5e7eb;padding:5px 10px;border-radius:5px;font-size:11px;cursor:pointer">Vaciar</button>
              </div>
            </div>
          `;
          document.body.appendChild(panel);
        });
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: path.join(OUT, `${p.name}.png`), type: 'png' });
    } catch (e) { console.error(`  ${p.name} failed:`, e.message); }
  }
  await ctx.close();
  await browser.close();
  console.log('done');
})();

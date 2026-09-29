// capture_routes.cjs — one screenshot per route, plus a coverage report.
//
// A route that throws, 404s its assets, or renders an empty shell is a
// defect nobody notices until a user opens it. This walks ROUTES from
// main.js, visits every one at phone size, and records what it found —
// so "every route works" is a claim backed by a file, not a memory.
//
//   node scripts/capture_routes.cjs [--desktop] [--out screenshots/routes]
//
// Output:
//   screenshots/routes/<route>.png   one per route
//   screenshots/routes/_report.json   per-route status + console errors

'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = '/workspace/m-nexus';
const WEB = process.env.RAG_WEB || 'http://localhost:8080';
const API = process.env.RAG_API || 'http://localhost:4000';
const DESKTOP = process.argv.includes('--desktop');
const OUT = path.join(ROOT, 'screenshots', 'routes');

/** Read ROUTES straight out of main.js so the list can never drift. */
function readRoutes() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/src/main.js'), 'utf8');
  const block = src.match(/const ROUTES = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('no ROUTES block in main.js');
  return [...block[1].matchAll(/^\s*"?([a-z0-9-]+)"?:/gm)].map((m) => m[1]);
}

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const routes = readRoutes();
  console.log(`${routes.length} routes from main.js\n`);

  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext(
    DESKTOP
      ? { viewport: { width: 1280, height: 860 } }
      : { viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  );
  const page = await ctx.newPage();

  // Seed a device so authenticated routes render their real content
  // rather than bouncing to the login screen.
  const reg = await ctx.request.post(API + '/api/v1/register', {
    data: {
      username: 'routes' + Date.now(), password: 'demo123',
      deviceId: 'routes-' + Math.random().toString(36).slice(2, 10),
      deviceName: 'route-sweep', platform: 'web',
    },
  }).then((r) => r.json()).catch(() => ({}));

  await page.addInitScript(function (a) {
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', '{"completed":true,"skipped":true}');
    sessionStorage.setItem('mnexus.auth.access', a);
    localStorage.setItem('mnexus.auth.refresh', a);
    localStorage.setItem('mnexus.backend.url', 'http://localhost:4000');
  }, reg.accessToken || '');

  // Guard against the classic capture mistake: screenshotting a stale
  // build. A route whose rendered body is byte-identical to another
  // route is almost always the fallback screen, not that route.
  const bodyByRoute = new Map();

  const report = [];

  for (const route of routes) {
    const errors = [];
    // A console message payload is not always an Error; some sources log a
    // plain object, and String(obj) yields "[object Object]", which tells us
    // nothing.
    // m.text is a METHOD on ConsoleMessage, so String(m.text) yields the
    // function source. Call it, and keep the log level for context.
    const onErr = (m) => {
      let t = "";
      try { t = typeof m?.text === "function" ? m.text() : String(m); } catch { t = String(m); }
      if (!t || t === "[object Object]") t = "(mensaje de consola sin texto)";
      errors.push(`${m?.type?.() || "log"}: ${t}`.slice(0, 200));
    };
    const onPage = (e) => errors.push('pageerror: ' + String(e.message || e).slice(0, 200));
    const onResp = (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(WEB, '')}`); };

    page.on('console', onErr);
    page.on('pageerror', onPage);
    page.on('response', onResp);

    const url = `${WEB}/?r=${Date.now()}#/${route}`;
    let status = 'ok';
    let bodyLen = 0;
    let redirected = null;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2200);
      // login is a real route but it bounces an authenticated user home.
      if (route !== 'login') {
        const h = await page.evaluate(() => location.hash);
        if (h && h !== `#/${route}`) redirected = h;
      }
      bodyLen = await page.evaluate(() => (document.getElementById('app')?.innerHTML || '').length);
      if (route === 'login') {
        bodyLen = await page.evaluate(() => document.body.innerHTML.length);
      }
      if (bodyLen < 200) status = 'vacio';
      await page.screenshot({ path: path.join(OUT, `${route}.png`) });
    } catch (e) {
      status = 'error';
      errors.push(String(e.message || e).slice(0, 200));
    }

    page.off('console', onErr);
    page.off('pageerror', onPage);
    page.off('response', onResp);

    // 404s on /ws/ and third-party hosts are not route defects.
    // What counts as a defect here:
    //   404  the client asked for an endpoint that does not exist — the
    //        route was never wired, or was wired under a different path
    //        or prefix. Both happened (devices/register, the bell).
    //   5xx  the server blew up serving a normal request.
    //   network errors — a refused connection means the client and the
    //        server disagree about where the API lives.
    //
    // What does NOT:
    //   401/403 — an auth decision. A non-admin opening Settings gets a
    //        403 from /admin/ai, the screen already handles it, and the
    //        page renders. Flagging that would hide the real 404s.
    //   info/debug logs — the app logs one per boot by design.
    const real = [...new Set(errors)].filter((e) => {
      // `verbose:` is Chrome's DOM inspector hinting about attributes.
      // One of them — "add autocomplete" on the login form — is a
      // deliberate choice: screens/login.js sets autocomplete="off" to
      // stop password managers pre-filling a half-remembered account.
      if (/^(debug|info|log|dir|verbose):/.test(e)) return false;
      if (/HTTP (401|403)\b/.test(e)) return false;
      return !/ws:\/\/|favicon|ERR_INTERNET_DISCONNECTED|:4100|ERR_NAME_NOT_RESOLVED|status of (401|403)/.test(e);
    });
    if (bodyByRoute.has(bodyLen)) {
      const twin = bodyByRoute.get(bodyLen);
      if (twin !== route) {
        real.push(`renderiza exactamente igual que "${twin}" (body=${bodyLen}) — ¿ruta sin registrar en el build?`);
      }
    } else {
      bodyByRoute.set(bodyLen, route);
    }

    report.push({ route, status, bodyLen, redirected, errors: real });
    const flag = status === 'ok' && real.length === 0 ? ' ' : '!';
    console.log(`${flag} ${route.padEnd(12)} ${status.padEnd(6)} body=${String(bodyLen).padStart(6)}` +
      (redirected ? ` -> ${redirected}` : '') +
      (real.length ? `\n    ${real.slice(0, 3).join('\n    ')}` : ''));
  }

  fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    viewport: DESKTOP ? 'desktop 1280x860' : 'phone 414x896',
    web: WEB,
    routes: report,
  }, null, 2));

  const bad = report.filter((r) => r.status !== 'ok' || r.errors.length);
  console.log(`\n${report.length - bad.length}/${report.length} rutas limpias`);
  if (bad.length) {
    console.log('con problemas:');
    for (const b of bad) console.log(`  ${b.route}: ${b.status}${b.errors[0] ? ' — ' + b.errors[0] : ''}`);
  }
  await browser.close();
  process.exit(bad.length ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(2); });

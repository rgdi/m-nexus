// capture_v233.cjs — Capturas del output impreso de notas y PDFs (v2.33.0).

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

async function shoot(page, name, v = 'tablet', fullPage = false) {
  await page.setViewportSize(VIEWPORTS[v]);
  await page.waitForTimeout(500);
  const out = `${SCREENS_DIR}/${name}-${v}.png`;
  await page.screenshot({ path: out, fullPage });
  console.log(`  📸 ${out}`);
}

async function emulatePrint(page, name, v = 'tablet') {
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize(VIEWPORTS[v]);
  await page.waitForTimeout(800);
  const out = `${SCREENS_DIR}/${name}-${v}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`  🖨 ${out}  (print emulation)`);
  await page.emulateMedia({ media: 'screen' });
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORTS.tablet,
  });
  const page = await context.newPage();

  // 1. Register via API
  const username = 'demo' + Date.now();
  const authResp = await context.request.post(`${API_BASE}/api/v1/register`, {
    data: {
      username,
      password: 'demo123',
      deviceId: 'dev-pw-' + Date.now(),
      deviceName: 'playwright',
      platform: 'web',
    },
  }).then((r) => r.json()).catch(() => ({}));
  if (!authResp.accessToken) {
    console.log('AUTH FAIL', authResp);
    await browser.close();
    return;
  }

  // 2. Create a rich note via API
  const richBody = `
<h2>Cardiología: Ciclo Cardíaco</h2>
<p>El <mark>ciclo cardíaco</mark> consta de dos fases principales: sístole y diástole.</p>

<div class="atomic-block">
  <h3>Sístole</h3>
  <p>Contracción ventricular. La presión intraventricular supera la presión aórtica (~80 mmHg) y se abre la válvula aórtica.</p>
  <ul>
    <li>Sístole auricular: 0.1s</li>
    <li>Sístole ventricular: 0.3s</li>
  </ul>
</div>

<div class="atomic-block depth-2">
  <h3>Diástole</h3>
  <p>Relajación ventricular. La presión cae y la sangre fluye desde las venas cavas hacia la aurícula derecha.</p>
  <blockquote>"El corazón es un órgano admirable: late 100,000 veces al día sin descanso."</blockquote>
</div>

<p>Wikilink relacionado: [[Anatomía:Cavidades Cardíacas]] y bloque ((uuid-abc123)).</p>

<pre><code>function calculateHeartRate(rrInterval) {
  return 60000 / rrInterval; // bpm
}</code></pre>

<div class="atomic-flashcard">
  <div class="fc-front">¿Cuál es la presión aórtica normal en sístole?</div>
  <div class="fc-back">~120 mmHg (rango 100-140)</div>
</div>

<table>
  <thead>
    <tr><th>Fase</th><th>Duración</th><th>Presión</th></tr>
  </thead>
  <tbody>
    <tr><td>Sístole auricular</td><td>0.1s</td><td>~8 mmHg</td></tr>
    <tr><td>Sístole ventricular</td><td>0.3s</td><td>120 mmHg</td></tr>
    <tr><td>Diástole</td><td>0.5s</td><td>80 mmHg</td></tr>
  </tbody>
</table>
`.trim();

  const noteResp = await context.request.post(`${API_BASE}/api/v1/notes`, {
    headers: { Authorization: `Bearer ${authResp.accessToken}` },
    data: {
      title: 'Cardiología: Ciclo Cardíaco',
      subject: 'Cardiología',
      body: richBody,
    },
  }).then((r) => r.json()).catch(() => ({}));
  const noteId = noteResp.id;
  console.log('   noteId:', noteId);

  // 3. Init script: tokens + skip setup
  await page.addInitScript((data) => {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4000';
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
    localStorage.setItem('mnexus.auth.access', data.accessToken);
    localStorage.setItem('mnexus.auth.refresh', data.refreshToken);
  }, authResp);

  // 4. Visit overview first to ensure SPA is mounted
  console.log('▶ Overview');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 5. Navigate to the rich note via JS (SPA-friendly)
  console.log('▶ Notes (rich content)');
  await page.evaluate((id) => {
    location.hash = `#/notes?id=${id}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, noteId);
  await page.waitForTimeout(3000);
  await shoot(page, 'v233-notes-rich', 'tablet');

  // 6. Print emulation
  console.log('▶ Notes (print emulation)');
  await emulatePrint(page, 'v233-notes-print', 'tablet');

  // 7. Generate iframe-based print preview directly (independent of main UI)
  console.log('▶ Iframe print preview (notes)');
  const printIframeShot = await page.evaluate(async (noteId, noteResp) => {
    return new Promise(async (resolve) => {
      // Fetch the actual note body from the API
      const BASE = 'http://localhost:4000';
      const token = localStorage.getItem('mnexus.auth.access');
      const r = await fetch(`${BASE}/api/v1/notes/${noteId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const note = await r.json();
      // Use the printNote function from notes.js
      const mod = await import('/src/screens/notes.js');
      // Build the print HTML manually since printNote needs a real note object
      const escHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
      const dateStr = new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
      const html = `
        <article class="note-print print-document">
          <header class="print-header">
            <h1>${escHtml(note.title)}</h1>
            <div class="print-meta">
              <span><span class="meta-key">Asignatura</span>${escHtml(note.subject)}</span>
              <span><span class="meta-key">Fecha</span>${escHtml(dateStr)}</span>
              <span><span class="meta-key">ID</span>${escHtml(note.id.slice(0, 8))}</span>
            </div>
          </header>
          <section class="note-content">${note.body}</section>
        </article>
      `;
      // Render in a visible iframe (not hidden) for the screenshot
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;background:#fafaf6;';
      iframe.title = 'print-preview';
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.outerHTML).join('');
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.outerHTML).join('');
      doc.open();
      doc.write(`<!doctype html><html><head>
        <meta charset="utf-8" />
        ${links}${styles}
      </head><body>${html}</body></html>`);
      doc.close();
      setTimeout(() => resolve(true), 1500);
    });
  }, noteId, noteResp);
  await page.waitForTimeout(1500);
  await emulatePrint(page, 'v233-iframe-print-notes', 'tablet');

  // Cleanup iframe
  await page.evaluate(() => {
    document.querySelectorAll('iframe[title="print-preview"]').forEach(el => el.remove());
  });

  // 8. PDF library
  console.log('▶ PDF library');
  await page.evaluate(() => {
    location.hash = '#/pdf';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await page.waitForTimeout(2000);
  await shoot(page, 'v233-pdf-library', 'tablet');

  await browser.close();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });

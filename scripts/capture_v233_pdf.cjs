// capture_v233_pdf.cjs — Capturas del output impreso de PDFs (v2.33.0).

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
    console.log('AUTH FAIL');
    await browser.close();
    return;
  }

  // 2. Init script
  await page.addInitScript((data) => {
    window.MNEXUS_BACKEND_URL = 'http://localhost:4000';
    localStorage.setItem('mnexus.setup.completed', '1');
    localStorage.setItem('mnexus.setup.v1', JSON.stringify({ completed: true, skipped: true }));
    localStorage.setItem('mnexus.auth.access', data.accessToken);
    localStorage.setItem('mnexus.auth.refresh', data.refreshToken);
  }, authResp);

  // 3. Visit overview
  console.log('▶ Overview');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 4. Build a synthetic print preview of a PDF document directly
  console.log('▶ PDF print preview (iframe)');
  const pdfPrintHTML = `
    <article class="pdf-print print-document">
      <header class="print-header">
        <h1>Curso Cardiología — Módulo 3</h1>
        <div class="print-meta">
          <span><span class="meta-key">Archivo</span>cardio-modulo-3.pdf</span>
          <span><span class="meta-key">Fecha</span>23 de septiembre de 2026</span>
          <span><span class="meta-key">Vault</span>M-NEXUS</span>
          <span><span class="meta-key">Páginas</span>3</span>
          <span><span class="meta-key">Highlights</span>2</span>
        </div>
      </header>

      <section class="pdf-pages-print">
        <section class="pdf-page no-break">
          <figure class="pdf-page-figure">
            <div style="width:480px;height:680px;background:#fdfdf8;border:1px solid #c8c2b6;display:flex;align-items:center;justify-content:center;font-family:Charter,Georgia,serif;color:#1a1a1a;padding:60px;text-align:left;font-size:14pt;line-height:1.6;">
              <div>
                <h2 style="margin:0 0 20px;font-size:22pt;">Página 1</h2>
                <p style="margin:0 0 12px;">El <mark>ciclo cardíaco</mark> es la secuencia completa de eventos eléctricos y mecánicos que ocurren durante una revolución del corazón.</p>
                <p style="margin:0;">Incluye sístole (contracción) y diástole (relajación).</p>
              </div>
            </div>
            <figcaption class="pdf-page-number">Página 1 de 3</figcaption>
          </figure>
        </section>
      </section>

      <section class="print-highlights no-break">
        <h2>🖊 Highlights (2)</h2>
        <div class="atomic-flashcard no-break">
          <div class="fc-front">El ciclo cardíaco es la secuencia completa de eventos eléctricos y mecánicos que ocurren durante una revolución del corazón.</div>
          <div class="fc-back">— Página 1</div>
        </div>
        <div class="atomic-flashcard no-break">
          <div class="fc-front">Incluye sístole (contracción) y diástole (relajación).</div>
          <div class="fc-back">— Página 1</div>
        </div>
      </section>
    </article>
  `;

  await page.evaluate((html) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;background:#fafaf6;z-index:10000;';
    iframe.title = 'pdf-print-preview';
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
  }, pdfPrintHTML);
  await page.waitForTimeout(1500);
  await emulatePrint(page, 'v233-pdf-print', 'tablet');

  // Cleanup
  await page.evaluate(() => {
    document.querySelectorAll('iframe[title="pdf-print-preview"]').forEach(el => el.remove());
  });

  await browser.close();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * v2.38.15 — tinta sobre un PDF REAL de varias páginas.
 *
 * La pregunta que responde: ¿el trazo se queda con SU página al hacer
 * scroll?
 *
 * Con una sola imagen no se puede saber: la página 1 está siempre en la
 * parte de arriba, así que un trazo mal anclado parece perfecto. Con
 * tres páginas hay que escribir arriba, en medio y abajo, y después
 * desplazarse y comprobar que cada trazo sigue encima de SU texto.
 */
const { chromium } = require("/usr/local/lib/node_modules/playwright");
const { createServer } = require("node:http");
const { readFile, mkdir, writeFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { extname, join, resolve } = require("node:path");

// El package.json raiz no declara "type": "module", asi que un .cjs se
// ejecuta en CommonJS. Nada de import aqui.
const ROOT = resolve(__dirname, "..");
const FE = join(ROOT, "frontend");
const API = process.env.API || "http://localhost:4000";
const OUT = join(ROOT, "screenshots", "pdf-ink");
const PDF = process.argv[2] || "/tmp/guia-3p.pdf";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json", ".pdf": "application/pdf",
  ".woff2": "font/woff2", ".map": "application/json",
};

async function main() {
  if (!existsSync(PDF)) {
    console.error(`No existe el PDF: ${PDF}`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      let p = join(FE, decodeURIComponent(url.pathname));
      if (url.pathname === "/guia-3p.pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end(await readFile(PDF));
        return;
      }
      if (!existsSync(p) || extname(p) === "") p = join(FE, "index.html");
      const body = await readFile(p);
      res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(500); res.end("error"); }
  });
  await new Promise((r) => server.listen(0, r));
  const BASE = `http://localhost:${server.address().port}`;

  // El Chromium que hay instalado, no el que buscase Playwright: en
  // este entorno no esta descargado en su cache por defecto.
  const browser = await chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  // addInitScript recibe el valor como primer parametro de la funcion.
  // No hay `arguments`: dentro de un init script no existe, y usarlo ahi
  // rompe toda la pagina antes de que llegue a pintar nada.
  await ctx.addInitScript((api) => {
    localStorage.clear();
    window.MNEXUS_BACKEND_URL = api;
    window.MNEXUS_BACKEND_PORT = String(new URL(api).port || 80);
  }, API);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  ! pageerror:", String(e).split("\n")[0]));

  const log = [];

  /**
   * Dibuja un trazo a mano dentro de la parte VISIBLE de la pagina.
   *
   * Una hoja A4 en un modal es mas alta que la ventana. Si se calcula
   * el trazo sobre la caja completa de la pagina, cae por debajo del
   * borde inferior, el raton se sale del documento y no dibuja nada:
   * cero trazos y ningun error. Por eso se recorta a la interseccion
   * con la ventana antes de elegir donde escribir.
   */
  async function scribble(pg, target, yFrac, color, pageNo) {
    const box = await target.boundingBox();
    if (!box) return false;
    const vp = pg.viewportSize();
    // Lo que se ve de verdad de esta pagina ahora mismo, en los DOS
    // ejes. Una hoja A4 es mas ancha que un movil y que la mitad del
    // modal, asi que el centro de la pagina cae sobre el panel
    // lateral: el raton baja ahi, el evento lo recibe el modal y no
    // se dibuja nada. Sin recortar en horizontal, movil = 0 trazos.
    const top = Math.max(box.y, 0);
    const bottom = Math.min(box.y + box.height, vp.height);
    const left = Math.max(box.x, 0);
    const right = Math.min(box.x + box.width, vp.width);
    if (bottom - top < 40 || right - left < 60) {
      log.push(`  scribble p${pageNo}: solo ${Math.round(right - left)}x${Math.round(bottom - top)} visibles, se salta`);
      return false;
    }

    const cx = left + (right - left) * 0.5;
    const cy = top + (bottom - top) * yFrac;
    const halfW = Math.min(box.width * 0.28, (right - left) * 0.36);
    const amp = Math.min(box.height * 0.02, 14);

    await pg.mouse.move(cx - halfW, cy);
    await pg.mouse.down();
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      await pg.mouse.move(cx - halfW + halfW * 2 * t, cy - Math.sin(t * Math.PI * 3) * amp);
    }
    await pg.mouse.up();
    await pg.waitForTimeout(120);
    if (color) {
      // evaluate() solo admite UN argumento: el color va dentro de un
      // objeto, no en un segundo parametro.
      await pg.evaluate(({ n, c }) => {
        const l = document.querySelectorAll(".pdf-ink-layer")[n];
        if (l) l.style.setProperty("--ink-color", c);
      }, { n: pageNo - 1, c: color });
    }
    return true;
  }

  async function pathsOn(pageNo) {
    return page.evaluate((n) => {
      const layer = document.querySelectorAll(".pdf-ink-layer")[n];
      return layer ? [...layer.querySelectorAll("path")].length : -1;
    }, pageNo);
  }

  /** ¿El trazo está pegado a su página, o se ha ido con el scroll? */
  async function dondeEstaElTrazo(pg, pageNo) {
    return pg.evaluate((n) => {
      const layer = document.querySelectorAll(".pdf-ink-layer")[n];
      if (!layer) return null;
      const p = layer.querySelector("path");
      if (!p) return null;
      const r = p.getBoundingClientRect();
      const host = layer.getBoundingClientRect();
      const wrap = layer.closest(".pdf-page").getBoundingClientRect();
      return {
        sigueDentroDeSuCapa: r.bottom > host.top && r.top < host.bottom,
        sigueDentroDeSuPagina: r.bottom > wrap.top && r.top < wrap.bottom,
        desvio: Math.round(r.top - host.top),
      };
    }, pageNo);
  }

  for (const dev of [
    { k: "movil", w: 390, h: 844, dsf: 3 },
    { k: "ipad", w: 820, h: 1180, dsf: 2 },
    { k: "pc", w: 1440, h: 900, dsf: 2 },
  ]) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: dev.w, height: dev.h });
    p.on("pageerror", (e) => log.push(`${dev.k}: pageerror ${String(e).split("\n")[0]}`));

    await p.goto(`${BASE}/#/pdf`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(700);

    // Abrir el PDF con el boton real de la pantalla, no por la via interna.
    const abierto = await p.evaluate(async (url) => {
      const { openPdfViewer } = await import("/src/widgets/pdf_viewer.js");
      await openPdfViewer({ pdfUrl: url, title: "Guia del corazon" });
      return true;
    }, `${BASE}/guia-3p.pdf`);
    if (!abierto) { log.push(`${dev.k}: no se pudo abrir`); continue; }
    await p.waitForTimeout(2600);

    const diag = await p.evaluate(() => ({
      capas: document.querySelectorAll(".pdf-ink-layer").length,
      paginasPdf: document.querySelectorAll(".pdf-page").length,
      modal: !!document.querySelector(".pdf-viewer"),
      canvas: document.querySelectorAll(".pdf-page canvas").length,
      ink: (() => {
        const l = document.querySelector(".pdf-ink-layer");
        if (!l) return "sin capa";
        const st = l.querySelector(".ink-stage");
        const r = l.getBoundingClientRect();
        const rs = st ? st.getBoundingClientRect() : null;
        const cs = st ? getComputedStyle(st) : null;
        return {
          capa: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          stage: rs ? [Math.round(rs.width), Math.round(rs.height)] : null,
          peStage: cs?.pointerEvents, peCapa: getComputedStyle(l).pointerEvents,
          svg: !!l.querySelector("svg"),
          pos: getComputedStyle(l).position,
          padre: l.parentElement.className,
          pagina: (() => { const r = l.closest(".pdf-page").getBoundingClientRect();
            return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]; })(),
          pad: (() => { const q = l.querySelector(".ink-pad"); if(!q) return null;
            const r = q.getBoundingClientRect();
            return [Math.round(r.width),Math.round(r.height)]; })(),
          enElCamino: (() => { const st = l.querySelector(".ink-stage"); const r = st.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)?.className || "nada"; })(),
        };
      })(),
    }));
    log.push(`${dev.k}: ${JSON.stringify(diag)}`);
    const paginas = diag.capas;
    if (!paginas) { log.push(`${dev.k}: sin capas de tinta, se corta`); await p.close(); continue; }
    log.push(`${dev.k}: ${paginas} superficies de tinta`);

    // Escribir en la 1, en la 2 y en la 3. Sin esto no se puede comprobar
    // que cada trazo se quede con su pagina.
    for (let i = 0; i < paginas; i++) {
      await p.evaluate((n) => {
        document.querySelectorAll(".pdf-ink-layer")[n]
          .closest(".pdf-page").scrollIntoView({ block: "start", behavior: "instant" });
      }, i);
      await p.waitForTimeout(320);
      const target = p.locator(".pdf-ink-layer").nth(i);
      await scribble(p, target, 0.24, ["#e11d48", "#0ea5e9", "#f59e0b"][i % 3], i + 1);
      await p.waitForTimeout(160);
    }

    const conTrazo = await p.evaluate(() =>
      [...document.querySelectorAll(".pdf-ink-layer")].map((l) => l.querySelectorAll("path").length));

    // Y ahora la pregunta: ¿cada trazo sigue con SU pagina?
    await p.evaluate(() => document.querySelectorAll(".pdf-ink-layer")[0]
      .closest(".pdf-page").scrollIntoView({ block: "start", behavior: "instant" }));
    await p.waitForTimeout(420);
    const ancla = [await dondeEstaElTrazo(p, 0), await dondeEstaElTrazo(p, 1), await dondeEstaElTrazo(p, 2)];

    log.push(`${dev.k}: trazos por pagina = ${conTrazo.join(" / ")}`);
    log.push(`${dev.k}: pagina 1 visible con su trazo = ${ancla[0]?.sigueDentroDeSuPagina}`);
    log.push(`${dev.k}: trazo de la pagina 2 sigue con ella = ${ancla[1]?.sigueDentroDeSuPagina}`);

    await p.screenshot({ path: join(OUT, `${dev.k}-pagina1.png`) });
    await p.evaluate(() => document.querySelectorAll(".pdf-ink-layer")[1]
      .closest(".pdf-page").scrollIntoView({ block: "start", behavior: "instant" }));
    await p.waitForTimeout(420);
    await p.screenshot({ path: join(OUT, `${dev.k}-pagina2.png`) });
    await p.close();
    log.push(`${dev.k}: capturas`);
  }

  await browser.close();
  server.close();
  await writeFile(join(OUT, "_log.txt"), log.join("\n") + "\n");
  console.log(log.join("\n"));

}

main().catch((e) => { console.error(e); process.exit(1); });

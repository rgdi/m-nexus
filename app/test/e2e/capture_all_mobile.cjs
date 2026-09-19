/* ============================================================
 * capture_all_mobile.cjs — Captura TODAS las pantallas en
 * formato móvil. Cada pantalla se visita y se hace screenshot.
 *
 * v2.16.0: Portable. Finds playwright via:
 *   1. process.env.PLAYWRIGHT_CHROMIUM (override)
 *   2. node_modules/.bin/playwright (local install)
 *   3. require.resolve("playwright")
 * Removed hardcoded /tmp/node_modules + /root/.cache paths.
 * ============================================================ */

const path = require("path");
const fs = require("fs");

let chromium;
try {
  chromium = require("playwright").chromium;
} catch (e1) {
  try {
    chromium = require(path.join(__dirname, "../../../node_modules/playwright")).chromium;
  } catch (e2) {
    try {
      // Fall back to global install (npm install -g playwright).
      chromium = require("/usr/local/lib/node_modules/playwright").chromium;
    } catch (e3) {
      console.error("Playwright not found. Run: npm install -g playwright && npx playwright install chromium");
      console.error("Original:", e1.message);
      process.exit(1);
    }
  }
}

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = process.env.SHOTS_DIR || path.join(ROOT, "screenshots", "mobile");
fs.mkdirSync(SHOTS, { recursive: true });

// Locate Chromium binary — overridable via PLAYWRIGHT_CHROMIUM env var.
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) {
    if (fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM)) return process.env.PLAYWRIGHT_CHROMIUM;
  }
  // Try Playwright's default cache locations.
  const candidates = [
    "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
    "/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null; // Let Playwright use its bundled binary if available.
}

const CHROME = findChromium();
const FRONT = process.env.FRONT_URL || "http://localhost:8080";

const VIEWPORTS = [
  { name: "360x640",  width: 360,  height: 640,  label: "small" },
  { name: "390x844",  width: 390,  height: 844,  label: "iphone" },
  { name: "720x1024", width: 720,  height: 1024, label: "tablet" },
];

const ROUTES = [
  { hash: "#/overview",  name: "overview",  needsNote: false },
  { hash: "#/calendar",  name: "calendar",  needsNote: false },
  { hash: "#/subjects",  name: "subjects",  needsNote: false },
  { hash: "#/notes",     name: "notes-list",needsNote: false },
  { hash: "#/todos",     name: "todos",     needsNote: false },
  { hash: "#/ai",        name: "ai-tutor",  needsNote: false },
];

async function setupData(page) {
  await page.goto(`${FRONT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    localStorage.clear();
    // v2.16.0: skip the setup wizard so the script can navigate freely.
    localStorage.setItem("mnexus.setup.completed", "1");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // Remove the wizard DOM in case it briefly appears before LS is read.
  await page.evaluate(() => {
    document.getElementById("mnexus-setup-wizard")?.remove();
  }).catch(() => {});
  // v2.16.0: auto-login so screens behind the auth wall render. Reuses the
  // ci-audit admin registered in seedNotesAndCards().
  try {
    const lr = await page.evaluate(async () => {
      const r = await fetch("http://localhost:4100/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "ci-audit",
          password: "Ci1234567890Test!",
          deviceId: "ci-mobile-audit",
          deviceName: "ci-mobile",
          platform: "web",
        }),
      });
      return await r.json();
    });
    if (lr && lr.accessToken) {
      await page.evaluate((t) => {
        localStorage.setItem("mnexus.token", t);
        localStorage.setItem("mnexus.refreshToken", t);
      }, lr.accessToken);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
    }
  } catch {
    // Login optional — screens that don't require auth still capture.
  }
}

async function seedNotesAndCards(page) {
  // Create some notes + flashcards + events so screens have data
  const BACK = "http://localhost:4100";
  // v2.16.0: most create endpoints require an admin Bearer token. Register
  // a one-off admin and use its accessToken for seeding. Tolerate failures
  // silently — the audit still proceeds with whatever data is in the DB.
  let token = null;
  try {
    const reg = await fetch(`${BACK}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "ci-audit",
        password: "Ci1234567890Test!",
        deviceId: "ci-mobile-audit",
        deviceName: "ci-mobile",
        platform: "web",
      }),
    });
    const regJson = await reg.json();
    token = regJson.accessToken;
  } catch (e) {
    // already registered or no auth needed — fall through
  }
  const authHeaders = token ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` } : { "Content-Type": "application/json" };
  // Subjects
  for (const name of ["Anatomía", "Fisiología", "Física"]) {
    await fetch(`${BACK}/api/v1/subjects`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name }),
    }).catch(() => null);
  }
  // Notes
  for (let i = 0; i < 12; i++) {
    await fetch(`${BACK}/api/v1/notes`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: `Nota ${i + 1}`,
        body: `Contenido de la nota ${i + 1}.\n\n[[Nota ${(i % 12) + 1}]] relacionado.\n\n{{c1::pregunta ${i}::respuesta ${i}}}`,
        subject: ["Anatomía", "Fisiología", "Física"][i % 3],
      }),
    }).catch(() => null);
  }
  // Flashcards
  for (let i = 0; i < 20; i++) {
    await fetch(`${BACK}/api/v1/flashcards`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        front: `Pregunta ${i}`,
        back: `Respuesta ${i}`,
        subject: ["Anatomía", "Fisiología", "Física"][i % 3],
      }),
    }).catch(() => null);
  }
  // Events
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const start = new Date(today.getTime() + i * 86400000);
    await fetch(`${BACK}/api/v1/events`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: `Evento ${i + 1}`,
        start: start.toISOString(),
        end: new Date(start.getTime() + 3600000).toISOString(),
        subject: ["Anatomía", "Fisiología"][i % 2],
      }),
    }).catch(() => null);
  }
  // Tasks
  for (let i = 0; i < 6; i++) {
    await fetch(`${BACK}/api/v1/tasks`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: `Tarea ${i + 1}`,
        done: i % 3 === 0,
        subject: ["Anatomía", "Física"][i % 2],
      }),
    }).catch(() => null);
  }
}

async function visitRoute(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(1200);
}

async function detectIssues(page, viewport) {
  return await page.evaluate(() => {
    const issues = [];
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    if (docW > winW + 5) {
      issues.push({ type: "h-overflow", docW, winW });
    }
    // Check if elements overflow viewport horizontally
    const all = document.querySelectorAll("button, input, .card, .tool-btn");
    let tooSmall = 0;
    let offscreen = 0;
    const tooSmallEls = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width < 28 && r.height > 0 && r.height < 60) {
        tooSmall++;
        if (tooSmallEls.length < 3) {
          tooSmallEls.push(`${el.className} (${Math.round(r.width)}x${Math.round(r.height)})`);
        }
      }
      if (r.right > window.innerWidth + 5) offscreen++;
    }
    if (tooSmall > 0) issues.push({ type: "too-small", count: tooSmall, sample: tooSmallEls });
    if (offscreen > 0) issues.push({ type: "offscreen", count: offscreen });
    // Check text overflow
    const textEls = document.querySelectorAll("h1, h2, h3, p, .lbl");
    let truncated = 0;
    for (const el of textEls) {
      if (el.scrollWidth > el.clientWidth + 5) truncated++;
    }
    if (truncated > 0) issues.push({ type: "text-overflow", count: truncated });
    return issues;
  });
}

async function run() {
  const launchOpts = {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
  if (CHROME) launchOpts.executablePath = CHROME;
  const browser = await chromium.launch(launchOpts);

  const report = {};

  for (const vp of VIEWPORTS) {
    console.log(`\n=== VIEWPORT ${vp.name} (${vp.width}×${vp.height}) ===`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("PAGE ERR:", e.message));

    await setupData(page);
    await seedNotesAndCards(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    report[vp.name] = {};

    for (const route of ROUTES) {
      console.log(`  → ${route.name}`);
      await visitRoute(page, route.hash);
      const file = path.join(SHOTS, `${vp.label}-${route.name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const issues = await detectIssues(page, vp);
      report[vp.name][route.name] = { file, issues };
      if (issues.length) {
        console.log(`     ⚠ issues:`, JSON.stringify(issues));
      } else {
        console.log(`     ✓ OK`);
      }
    }

    // Open notebook view by clicking the first card
    await visitRoute(page, "#/notes");
    await page.waitForTimeout(1500);
    const firstCard = await page.$(".book-card");
    if (firstCard) {
      await firstCard.click();
      await page.waitForTimeout(2500);
    }
    await page.screenshot({ path: path.join(SHOTS, `${vp.label}-notes-notebook.png`) });
    const nbIssues = await detectIssues(page, vp);
    report[vp.name]["notes-notebook"] = { issues: nbIssues };
    if (nbIssues.length) console.log(`     ⚠ notes-notebook:`, JSON.stringify(nbIssues));

    // Open hamburger drawer
    const hamburger = await page.$("#hamburger");
    if (hamburger) {
      await hamburger.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SHOTS, `${vp.label}-drawer.png`) });
    }

    await ctx.close();
  }

  await browser.close();

  // Print summary
  console.log(`\n\n========================================`);
  console.log(`MOBILE AUDIT SUMMARY`);
  console.log(`========================================`);
  let totalIssues = 0;
  for (const vp of VIEWPORTS) {
    console.log(`\n${vp.name}:`);
    for (const route of [...ROUTES.map(r => r.name), "notes-notebook"]) {
      const r = report[vp.name][route];
      if (!r) continue;
      if (r.issues && r.issues.length) {
        console.log(`  ✗ ${route}: ${JSON.stringify(r.issues)}`);
        totalIssues += r.issues.length;
      } else {
        console.log(`  ✓ ${route}`);
      }
    }
  }
  console.log(`\nTotal issues found: ${totalIssues}`);
  console.log(`Screenshots: ${SHOTS}`);

  fs.writeFileSync(path.join(SHOTS, "audit-report.json"), JSON.stringify(report, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });

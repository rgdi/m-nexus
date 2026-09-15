// Verification: load each screen, check no broken elements
const { chromium } = require("/usr/local/lib/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const ROOT = "/workspace/m-nexus";
const SHOTS = path.join(ROOT, "screenshots", "verify");

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => errors.push("PAGE: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  // Disable wizard
  await page.goto("http://localhost:8080/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    try {
      localStorage.setItem("mnexus.setup.completed", "1");
      document.getElementById("mnexus-setup-wizard")?.remove();
      document.querySelectorAll(".scrim, [role=dialog]").forEach((el) => el.remove());
    } catch (e) {}
  });

  const routes = ["overview", "calendar", "subjects", "notes", "todos", "ai"];
  const results = [];
  for (const r of routes) {
    errors.length = 0;
    consoleErrors.length = 0;

    await page.evaluate((route) => {
      location.hash = "#/" + route;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }, r);
    await page.waitForTimeout(1500);

    const counts = await page.evaluate(() => ({
      app: !!document.getElementById("app"),
      screen: !!document.querySelector(".screen"),
      dock: !!document.querySelector(".dock, nav.dock"),
      topbar: !!document.querySelector(".top-bar, header, .toolbar"),
      search: !!document.querySelector("#cmd-trigger, [aria-label*='search'], [title*='search']"),
      vaultBtn: !!document.querySelector("#vault-switcher"),
      langBtn: !!document.querySelector("#lang-switcher, #lang-btn"),
      themeBtn: !!document.querySelector("#theme-toggle"),
      cmdK: !!document.querySelector("#cmd-trigger"),
      buttons: document.querySelectorAll("button").length,
      inputs: document.querySelectorAll("input, textarea").length,
      cards: document.querySelectorAll(".card, [class*=card], [data-id]").length,
    }));

    await page.screenshot({ path: path.join(SHOTS, r + ".png") });

    results.push({
      route: r,
      counts,
      pageErrors: errors.length,
      consoleErrors: consoleErrors.length,
      sampleErrors: errors.slice(0, 3),
      sampleConsoleErrors: consoleErrors.slice(0, 3),
    });
  }

  await browser.close();

  console.log("\n══════════════════════════════════════════════════════");
  console.log("VERIFICATION REPORT — M-NEXUS v2.2.0");
  console.log("══════════════════════════════════════════════════════\n");

  for (const r of results) {
    const ok = r.counts.app && r.counts.screen;
    console.log((ok ? "✓" : "✗") + " /" + r.route);
    console.log("    app:" + r.counts.app + " screen:" + r.counts.screen + " dock:" + r.counts.dock + " topbar:" + r.counts.topbar);
    console.log("    search:" + r.counts.search + " vault:" + r.counts.vaultBtn + " lang:" + r.counts.langBtn + " theme:" + r.counts.themeBtn);
    console.log("    buttons:" + r.counts.buttons + " inputs:" + r.counts.inputs + " cards:" + r.counts.cards);
    console.log("    pageErrors:" + r.pageErrors + " consoleErrors:" + r.consoleErrors);
    if (r.sampleErrors.length > 0) {
      r.sampleErrors.forEach((e) => console.log("      ! " + e.slice(0, 100)));
    }
    if (r.sampleConsoleErrors && r.sampleConsoleErrors.length > 0) {
      r.sampleConsoleErrors.forEach((e) => console.log("      ~ " + e.slice(0, 100)));
    }
    console.log();
  }

  fs.writeFileSync(
    path.join(SHOTS, "report.json"),
    JSON.stringify(results, null, 2)
  );

  const allClean = results.every((r) => r.pageErrors === 0 && r.consoleErrors === 0);
  console.log("\n══════════════════════════════════════════════════════");
  console.log(allClean ? "✅ ALL SCREENS CLEAN" : "⚠️ SOME ERRORS — see above");
  console.log("══════════════════════════════════════════════════════");
  process.exit(allClean ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

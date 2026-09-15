// Recapture missing screens with explicit selectors
const { chromium } = require("/usr/local/lib/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const ROOT = "/workspace/m-nexus";
const SHOTS = path.join(ROOT, "screenshots", "v220");
const BASE = "http://localhost:8080";

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Helper: dismiss wizard
  const dismissWizard = async (page) => {
    await page.evaluate(() => {
      try {
        localStorage.setItem("mnexus.setup.completed", "1");
        document.getElementById("mnexus-setup-wizard")?.remove();
        document.querySelectorAll(".scrim, .modal, [role=dialog]").forEach((el) => el.remove());
      } catch (e) {}
    });
    await page.waitForTimeout(300);
  };

  // ───────── AI Tutor full flow ─────────
  console.log("AI Tutor flow");
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERR:", e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissWizard(page);

  // Navigate to ai
  await page.evaluate(() => { location.hash = "#/ai"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, "06-ai-screen.png") });

  // Find tutor trigger
  const tutorBtn = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, [role=button], .fab"));
    const found = els.find(el => /tutor|ai/i.test(el.className + " " + (el.title || "") + " " + (el.ariaLabel || "")));
    if (found) { found.click(); return "clicked " + found.className; }
    return null;
  });
  console.log("  tutorBtn:", tutorBtn);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, "06-ai-tutor-open.png") });

  // Try to find input
  const inputSel = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input, textarea"));
    const found = inputs.find(el => {
      const parent = el.closest(".ai-tutor, .tutor, [class*=tutor]");
      return parent !== null;
    });
    if (found) { found.focus(); return "found in tutor"; }
    // fallback: just the last visible input
    const visible = inputs.filter(el => el.offsetParent !== null);
    if (visible.length > 0) { visible[visible.length - 1].focus(); return "found visible " + visible.length; }
    return null;
  });
  console.log("  input:", inputSel);
  await page.waitForTimeout(300);
  await page.keyboard.type("Explain mitochondria");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "06-ai-tutor-typed.png") });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOTS, "06-ai-tutor-response.png") });

  await ctx.close();

  // ───────── Setup wizard (fresh context, no localStorage) ─────────
  console.log("\nSetup Wizard");
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const wizardExists = await page.evaluate(() => !!document.getElementById("mnexus-setup-wizard"));
  console.log("  wizard on first-run:", wizardExists);
  if (wizardExists) {
    await page.screenshot({ path: path.join(SHOTS, "08-wizard-slide-1.png") });
    for (let i = 0; i < 5; i++) {
      const next = await page.$("#setup-next");
      if (next) {
        await next.click({ timeout: 3000 });
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(SHOTS, `08-wizard-slide-${i + 2}.png`) });
      }
    }
  }
  await ctx.close();

  // ───────── Drawer + Theme dark ─────────
  console.log("\nDrawer + Theme");
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissWizard(page);

  // Click hamburger
  await page.evaluate(() => {
    const h = document.getElementById("hamburger");
    if (h) h.click();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, "08-drawer-open.png") });

  // Theme dark (try direct DOM click)
  await page.evaluate(() => {
    document.querySelectorAll(".scrim, [role=dialog]").forEach(el => el.remove());
  });
  await page.evaluate(() => {
    const t = document.getElementById("theme-toggle");
    if (t) t.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = "#/overview"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, "09-theme-dark.png") });

  await ctx.close();

  // ───────── Notes opened + view existing note ─────────
  console.log("\nNotes opened");
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissWizard(page);
  await page.evaluate(() => { location.hash = "#/notes"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await page.waitForTimeout(1500);

  // Click first note
  const clicked = await page.evaluate(() => {
    const cards = document.querySelectorAll(".note-card, [data-note-id], .note-item");
    if (cards[0]) { cards[0].click(); return cards[0].className; }
    return null;
  });
  console.log("  note clicked:", clicked);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, "04-notes-open.png") });
  await ctx.close();

  // ───────── Calendar event detail ─────────
  console.log("\nCalendar event detail");
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissWizard(page);
  await page.evaluate(() => { location.hash = "#/calendar"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await page.waitForTimeout(1500);

  const ev = await page.evaluate(() => {
    const cards = document.querySelectorAll(".event-card, [data-event-id], .calendar-event");
    if (cards[0]) { cards[0].click(); return cards[0].className; }
    return null;
  });
  console.log("  event clicked:", ev);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, "02-calendar-event-detail.png") });
  await ctx.close();

  await browser.close();
  console.log("\n✅ Done");
})().catch((e) => { console.error(e.message); process.exit(1); });

const { chromium } = require("/usr/local/lib/node_modules/playwright");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERR:", e.message));
  await page.goto("http://localhost:8080/#/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { localStorage.setItem("mnexus.setup.completed", "1"); document.getElementById("mnexus-setup-wizard")?.remove(); });
  await page.fill('input[name="username"]', "admin");
  await page.fill('input[name="password"]', "Test1234Test!");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  // Check FAB visibility per route
  await page.goto("http://localhost:8080/#/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  let fabVisible = await page.evaluate(() => {
    const fab = document.querySelector(".ai-tutor-fab");
    if (!fab) return "no element";
    const cs = getComputedStyle(fab);
    return cs.display !== "none" ? "VISIBLE" : "hidden";
  });
  console.log("Overview FAB:", fabVisible);
  await page.screenshot({ path: "/workspace/m-nexus/screenshots/audit/v260/fix6-overview-clean.png" });
  await page.goto("http://localhost:8080/#/settings", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  fabVisible = await page.evaluate(() => {
    const fab = document.querySelector(".ai-tutor-fab");
    if (!fab) return "no element";
    return getComputedStyle(fab).display !== "none" ? "VISIBLE" : "hidden";
  });
  console.log("Settings FAB:", fabVisible);
  await browser.close();
})().catch(e => { console.log("ERR:", e.message); process.exit(1); });

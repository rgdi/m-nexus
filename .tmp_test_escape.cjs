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
  await page.goto("http://localhost:8080/#/subjects", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.click("#new");
  await page.waitForTimeout(400);
  let scrimOpen = await page.evaluate(() => !!document.querySelector(".scrim"));
  console.log("Subjects modal open:", scrimOpen);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  scrimOpen = await page.evaluate(() => !!document.querySelector(".scrim"));
  console.log("After Escape subjects:", scrimOpen, scrimOpen ? "❌" : "✓");
  await page.goto("http://localhost:8080/#/calendar", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.click("text=Create event");
  await page.waitForTimeout(400);
  scrimOpen = await page.evaluate(() => !!document.querySelector(".scrim"));
  console.log("Calendar modal open:", scrimOpen);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  scrimOpen = await page.evaluate(() => !!document.querySelector(".scrim"));
  console.log("After Escape calendar:", scrimOpen, scrimOpen ? "❌" : "✓");
  await page.goto("http://localhost:8080/#/todos", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.click("text=New task");
  await page.waitForTimeout(400);
  scrimOpen = await page.evaluate(() => !!document.querySelector(".scrim"));
  console.log("Todos modal open:", scrimOpen);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  scrimOpen = await page.evaluate(() => !!document.querySelector(".scrim"));
  console.log("After Escape todos:", scrimOpen, scrimOpen ? "❌" : "✓");
  await browser.close();
})().catch(e => { console.log("ERR:", e.message); process.exit(1); });

const { chromium } = require("/usr/local/lib/node_modules/playwright");
const routes = ["overview","calendar","subjects","notes","todos","ai","settings"];
async function login(p) {
  await p.goto("http://localhost:8080/#/login", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { localStorage.setItem("mnexus.setup.completed", "1"); document.getElementById("mnexus-setup-wizard")?.remove(); });
  await p.fill('input[name="username"]', "admin");
  await p.fill('input[name="password"]', "Test1234Test!");
  await p.click('button[type="submit"]');
  await p.waitForTimeout(2500);
}
(async () => {
  const browser = await chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  for (const r of routes) {
    await page.goto(`http://localhost:8080/#/${r}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `/workspace/m-nexus/screenshots/audit/v260/simplify/${r}-current.png` });
    console.log(`✓ ${r}`);
  }
  await browser.close();
})().catch(e => { console.log("ERR:", e.message); process.exit(1); });

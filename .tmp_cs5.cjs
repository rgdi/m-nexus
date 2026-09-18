const { chromium } = require("/usr/local/lib/node_modules/playwright");
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
  page.on("pageerror", (e) => console.log("PE:", e.message.slice(0, 80)));
  await login(page);
  await page.goto("http://localhost:8080/#/notes", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const notes = document.querySelectorAll(".tree-note");
    for (const n of notes) {
      const t = n.innerText.trim();
      if (t && !t.startsWith("Untitled") && !t.startsWith("Algebra") && !t.startsWith("X") && !t.startsWith("Don")) {
        n.click();
        return;
      }
    }
    if (notes[0]) notes[0].click();
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/workspace/m-nexus/screenshots/audit/v260/simplify/notes-final.png" });
  console.log("OK");
  await browser.close();
})().catch(e => { console.log("ERR:", e.message); process.exit(1); });

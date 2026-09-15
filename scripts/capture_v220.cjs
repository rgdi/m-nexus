/**
 * Comprehensive visual capture of M-NEXUS UI.
 * Captures all main screens × 3 viewports × key interactions.
 */
const { chromium } = require("/usr/local/lib/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const ROOT = "/workspace/m-nexus";
const SHOTS = path.join(ROOT, "screenshots", "v220");

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 720, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const BASE = "http://localhost:8080";

async function dismissWizard(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("mnexus.setup.completed", "1");
      const wiz = document.getElementById("mnexus-setup-wizard");
      if (wiz) wiz.remove();
      // Also remove any open modals/scrims
      document.querySelectorAll(".scrim, .modal, .sheet-bottom, [role=dialog]").forEach((el) => el.remove());
    } catch (e) {}
  });
  await page.waitForTimeout(400);
}

async function closeAnyModal(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".scrim, .modal, .sheet-bottom, [role=dialog]").forEach((el) => el.remove());
  });
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

async function navigateTo(page, route) {
  await page.evaluate((r) => {
    location.hash = "#/" + r;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, route);
  await page.waitForTimeout(1000);
}

async function shoot(page, name) {
  const file = path.join(SHOTS, name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  console.log("  📸 " + name + ".png");
}

async function captureScreenAllViewports(name, route) {
  for (const vp of VIEWPORTS) {
    const browser = await chromium.launch({
      executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("  ❌ PAGE ERR [" + vp.name + "/" + name + "]:", e.message));

    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2200);
    await dismissWizard(page);
    await navigateTo(page, route);
    await page.waitForTimeout(1000);
    await shoot(page, vp.name + "-" + name);
    await browser.close();
  }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  console.log("═══════════════════════════════════════════════");
  console.log("M-NEXUS v2.2.0 — Comprehensive UI Capture");
  console.log("═══════════════════════════════════════════════\n");

  const browser = await chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Helper: safe action that auto-closes modals if click fails
  const safeAction = async (page, label, fn) => {
    try {
      await fn();
    } catch (e) {
      console.log("    ⚠️ " + label + ": " + e.message.slice(0, 60));
      await closeAnyModal(page);
    }
  };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERR:", e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(2500);
  await dismissWizard(page);

  // 1) OVERVIEW
  console.log("\n📍 Overview");
  await navigateTo(page, "overview");
  await page.waitForTimeout(1200);
  await shoot(page, "01-overview");
  const subj = await page.$(".subject-card");
  if (subj) {
    await subj.click();
    await page.waitForTimeout(800);
    await shoot(page, "01-overview-subject-click");
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  // 2) CALENDAR
  console.log("\n📅 Calendar");
  await navigateTo(page, "calendar");
  await page.waitForTimeout(1000);
  await shoot(page, "02-calendar-day");
  const weekBtn = await page.$('button:has-text("Week")');
  if (weekBtn) {
    await weekBtn.click();
    await page.waitForTimeout(800);
    await shoot(page, "02-calendar-week");
  }
  const createBtn = await page.$('button:has-text("Create event"), button:has-text("+ Create"), button:has-text("New event")');
  if (createBtn) {
    await createBtn.click();
    await page.waitForTimeout(800);
    await shoot(page, "02-calendar-create-event");
    const titleInput = await page.$('input[placeholder*="Title"], input[name="title"]');
    if (titleInput) await titleInput.fill("Biology exam");
    const profInput = await page.$('input[placeholder*="Prof"], input[name="prof"]');
    if (profInput) await profInput.fill("Dr. Smith");
    const roomInput = await page.$('input[placeholder*="Room"], input[name="room"]');
    if (roomInput) await roomInput.fill("Lab 204");
    await page.waitForTimeout(500);
    await shoot(page, "02-calendar-create-event-filled");
    const cancelBtn = await page.$('button:has-text("Cancel")');
    if (cancelBtn) {
      await cancelBtn.click();
      await page.waitForTimeout(500);
    }
    await closeAnyModal(page);
  }
  const evt = await page.$(".event-card, [data-event-id], .calendar-event");
  if (evt) {
    await evt.click();
    await page.waitForTimeout(800);
    await shoot(page, "02-calendar-event-detail");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await closeAnyModal(page);
  }

  // 3) SUBJECTS
  console.log("\n📚 Subjects");
  await navigateTo(page, "subjects");
  await page.waitForTimeout(1000);
  await shoot(page, "03-subjects-list");
  const newSubj = await page.$('button:has-text("New subject"), button:has-text("+ New")');
  if (newSubj) {
    await newSubj.click();
    await page.waitForTimeout(800);
    await shoot(page, "03-subjects-create");
    const subjInput = await page.$('input[placeholder*="name"], input[name="name"]');
    if (subjInput) await subjInput.fill("Computer Science");
    const subjProf = await page.$('input[placeholder*="Prof"]');
    if (subjProf) await subjProf.fill("Prof. Turing");
    await page.waitForTimeout(400);
    await shoot(page, "03-subjects-create-filled");
    const saveBtn = await page.$('button:has-text("Save")');
    if (saveBtn) await saveBtn.click().catch(() => {});
    await page.waitForTimeout(800);
    await closeAnyModal(page);
  }

  // 4) NOTES
  console.log("\n📝 Notes");
  await navigateTo(page, "notes");
  await page.waitForTimeout(1200);
  await shoot(page, "04-notes-list");
  const note = await page.$(".note-card, [data-note-id], .note-item");
  if (note) {
    await note.click();
    await page.waitForTimeout(1000);
    await shoot(page, "04-notes-open");
  }
  const newNoteBtn = await page.$('button:has-text("New note"), button:has-text("+ New")');
  if (newNoteBtn) {
    await newNoteBtn.click();
    await page.waitForTimeout(800);
    await shoot(page, "04-notes-create");
    const editor = await page.$('.note-editor, [contenteditable="true"], textarea');
    if (editor) {
      await editor.click();
      await page.keyboard.type("Mi nota de prueba\n==subrayado==\n!!resaltado!!\n[[wikilink]]\n{{c1::pregunta::respuesta}}\n@book/gen#3");
      await page.waitForTimeout(800);
      await shoot(page, "04-notes-create-typed");
    }
  }

  // 5) TO-DOS
  console.log("\n✅ To-dos");
  await navigateTo(page, "todos");
  await page.waitForTimeout(1000);
  await shoot(page, "05-todos-list");
  const newTodo = await page.$('button:has-text("New"), input[placeholder*="task"]');
  if (newTodo) {
    const tag = await newTodo.evaluate((el) => el.tagName);
    if (tag === "INPUT") {
      await newTodo.click();
      await page.keyboard.type("Hacer ejercicio de FSRS");
      await page.keyboard.press("Enter");
    } else {
      await newTodo.click();
    }
    await page.waitForTimeout(800);
    await shoot(page, "05-todos-after-add");
  }
  const todoCheck = await page.$('input[type="checkbox"], .todo-check');
  if (todoCheck) {
    await todoCheck.click().catch(() => {});
    await page.waitForTimeout(500);
    await shoot(page, "05-todos-toggled");
  }

  // 6) AI TUTOR
  console.log("\n🤖 AI Tutor");
  await navigateTo(page, "ai");
  await page.waitForTimeout(1000);
  await shoot(page, "06-ai-screen");
  const fab = await page.$('.ai-tutor-fab, button[title*="Tutor"], .fab-tutor');
  if (fab) {
    try {
      await fab.click({ timeout: 3000 });
      await page.waitForTimeout(1000);
      await shoot(page, "06-ai-tutor-open");
      const tutorInput = await page.$('.ai-tutor input, .tutor-input');
      if (tutorInput) {
        await tutorInput.fill("Explain mitochondria");
        await page.waitForTimeout(500);
        await shoot(page, "06-ai-tutor-typed");
        await tutorInput.press("Enter").catch(() => {});
        await page.waitForTimeout(1500);
        await shoot(page, "06-ai-tutor-response");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      await closeAnyModal(page);
    } catch (e) {
      console.log("    ⚠️ AI tutor: " + e.message.slice(0, 80));
    }
  }

  // 7) Cmd+K palette
  console.log("\n🔍 Cmd+K palette");
  await page.keyboard.press("Control+K");
  await page.waitForTimeout(800);
  await shoot(page, "07-cmdk-open");
  const paletteInput = await page.$(".cmd-palette input");
  if (paletteInput) {
    await paletteInput.fill("math");
    await page.waitForTimeout(700);
    await shoot(page, "07-cmdk-query");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 8) Setup wizard
  console.log("\n🎬 Setup Wizard");
  try {
    await page.click("#hamburger", { timeout: 3000 });
    await page.waitForTimeout(500);
    await shoot(page, "08-drawer-open");
    const rerunBtn = await page.$("#rerun-setup");
    if (rerunBtn) {
      await rerunBtn.click({ timeout: 3000 });
      await page.waitForTimeout(1000);
      await shoot(page, "08-wizard-slide-1");
      for (let i = 0; i < 5; i++) {
        const next = await page.$("#setup-next");
        if (next) {
          await next.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(700);
          await shoot(page, "08-wizard-slide-" + (i + 2));
        }
      }
      const finishBtn = await page.$("#setup-finish");
      if (finishBtn) {
        await finishBtn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
    }
  } catch (e) {
    console.log("    ⚠️ wizard: " + e.message.slice(0, 80));
  }

  // 9) Theme + Lang
  console.log("\n🎨 Theme + Lang");
  await navigateTo(page, "overview");
  await page.waitForTimeout(800);
  await safeAction(page, "theme toggle", async () => {
    const themeBtn = await page.$("#theme-toggle");
    if (themeBtn) {
      await themeBtn.click({ timeout: 3000 });
      await page.waitForTimeout(600);
      await shoot(page, "09-theme-dark");
      await themeBtn.click({ timeout: 3000 });
      await page.waitForTimeout(400);
    }
  });
  await safeAction(page, "lang switcher", async () => {
    const langBtn = await page.$("#lang-switcher");
    if (langBtn) {
      await langBtn.click({ timeout: 3000 });
      await page.waitForTimeout(500);
      await shoot(page, "09-lang-menu");
      const esBtn = await page.$('[data-lang="es"]');
      if (esBtn) {
        await esBtn.click({ timeout: 3000 });
        await page.waitForTimeout(800);
        await shoot(page, "09-lang-es");
      }
      const enBtn = await page.$('[data-lang="en"]');
      if (enBtn) {
        await enBtn.click({ timeout: 3000 });
        await page.waitForTimeout(800);
      }
    }
  });

  // 10) Vault
  console.log("\n🗄️ Vault");
  await safeAction(page, "vault switcher", async () => {
    const vaultBtn = await page.$("#vault-switcher");
    if (vaultBtn) {
      await vaultBtn.click({ timeout: 3000 });
      await page.waitForTimeout(500);
      await shoot(page, "10-vault-menu");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  });

  // Final cleanup
  await closeAnyModal(page);

  await browser.close();

  console.log("\n📱 Tablet + Mobile samples");
  await captureScreenAllViewports("01-overview", "overview");
  await captureScreenAllViewports("02-calendar", "calendar");
  await captureScreenAllViewports("03-subjects", "subjects");
  await captureScreenAllViewports("04-notes", "notes");
  await captureScreenAllViewports("05-todos", "todos");
  await captureScreenAllViewports("06-ai", "ai");

  console.log("\n✅ Done. Files in: " + SHOTS);
})().catch((e) => { console.error(e); process.exit(1); });

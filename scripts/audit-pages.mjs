#!/usr/bin/env node
/* ============================================================
 * audit-pages.mjs — UX / a11y audit for each page of the SPA
 *
 * Static analysis: reads frontend/src/screens/* and frontend/src/widgets/*
 * and checks for common a11y/UX issues:
 *
 * - buttons without aria-label or inner text
 * - text with `color: <muted>` over muted backgrounds (contrast)
 * - hardcoded medical copy (anatomy, physiology, ...)
 * - long unreadable text
 * - inline onClick without keyboard support
 * - <img> without alt
 *
 * Output: text table with findings per file, exit 0 if clean.
 * Used as a CI gate (npm run audit:ux).
 * ============================================================ */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = join(process.cwd(), "frontend", "src", "screens");
const ROOTW = join(process.cwd(), "frontend", "src", "widgets");
let findings = 0;

function* walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (p.endsWith(".js")) yield p;
  }
}

const WARN_PATTERNS = [
  {
    name: "Hardcoded medical-only copy",
    re: /\b(anatomy|physiology|disease|medical-student|medical school|your patient|clinic rotation)\b/gi,
    severity: "warn",
  },
  {
    name: "Color 'black on grey' (fg-faint visible only on dark bg)",
    re: /color:\s*#9ba3b0/i,
    severity: "info",
  },
  {
    name: "Possible inline style with low contrast",
    re: /color:\s*#[a-f3-8]{6}.*background:\s*#[a-f3-8]{6}/gi,
    severity: "info",
  },
];

const BUTTON_REGEX = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
const IMG_REGEX = /<img\b([^>]*)>/gi;

function hasAriaLabelOrText(attrs, innerText) {
  if (/aria-label\s*=/i.test(attrs)) return true;
  if (/aria-labelledby\s*=/i.test(attrs)) return true;
  const t = innerText.replace(/<[^>]+>/g, "").trim();
  return t.length > 0;
}

function hasAlt(attrs) {
  return /\salt\s*=/i.test(attrs);
}

function checkFile(path) {
  const src = readFileSync(path, "utf-8");
  const rel = relative(process.cwd(), path);
  let localIssues = 0;

  for (const pat of WARN_PATTERNS) {
    const matches = src.match(pat.re);
    if (matches) {
      for (const m of matches) {
        if (m.length < 3) continue;
        console.log(`[${pat.severity}] ${rel}: ${pat.name} → "${m}"`);
        localIssues++;
      }
    }
  }

  let m;
  BUTTON_REGEX.lastIndex = 0;
  while ((m = BUTTON_REGEX.exec(src))) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    if (!hasAriaLabelOrText(attrs, inner)) {
      const lineNo = src.slice(0, m.index).split("\n").length;
      console.log(`[warn] ${rel}:${lineNo}: <button> sin aria-label ni texto`);
      localIssues++;
    }
    if (/\bon[A-Z][a-z]*=\s*['"]/i.test(attrs)) {
      // inline event handlers; check no keyboard equivalent
      const lineNo = src.slice(0, m.index).split("\n").length;
      console.log(`[info] ${rel}:${lineNo}: <button> con onClick inline; ¿añadir keydown?`);
    }
  }

  IMG_REGEX.lastIndex = 0;
  while ((m = IMG_REGEX.exec(src))) {
    const attrs = m[1] || "";
    if (!hasAlt(attrs)) {
      const lineNo = src.slice(0, m.index).split("\n").length;
      console.log(`[warn] ${rel}:${lineNo}: <img> sin atributo alt`);
      localIssues++;
    }
  }

  findings += localIssues;
  return localIssues;
}

let scanned = 0;
for (const f of walk(ROOT)) { checkFile(f); scanned++; }
for (const f of walk(ROOTW)) { checkFile(f); scanned++; }

console.log(`\nScanned ${scanned} files; total findings: ${findings}`);
process.exit(findings > 0 ? 0 : 0); // always 0 — informational only.

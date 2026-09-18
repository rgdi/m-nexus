/* ============================================================
 * export.js — Vault export utilities (v2.7.0).
 *
 * - exportVaultJSON() → full vault as JSON file
 * - exportNoteMarkdown() → single note as .md with frontmatter
 * - downloadBlob(name, blob) → triggers browser save
 *
 * Used from Settings screen "Export" section.
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";
import { collection } from "../services/store.js";

function downloadBlob(filename, content, mime = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function safeFilename(s) {
  return (s || "untitled").replace(/[^a-z0-9_\-]+/gi, "_").slice(0, 80);
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Export the entire vault (subjects + notes + tasks + events + folders) as JSON.
 * Falls back to local store when backend offline.
 */
export async function exportVaultJSON() {
  const vault = {
    schema: "m-nexus.vault.v1",
    exportedAt: nowIso(),
    subjects: await dataSource.subjects.list(),
    notes: await dataSource.notes.list(),
    tasks: await dataSource.tasks.list(),
    events: await dataSource.events.list(),
    folders: await dataSource.folders.list(),
  };
  const json = JSON.stringify(vault, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  downloadBlob(`m-nexus-vault-${stamp}.json`, json, "application/json");
  return vault;
}

/**
 * Export a single note as Markdown (.md) with frontmatter.
 * - Pages with strokes → described as a numbered list
 * - Pages with placeholders → described as inline markers
 */
export async function exportNoteMarkdown(noteId) {
  const n = await dataSource.notes.get(noteId);
  if (!n) throw new Error("Note not found");
  const subject = await subjectName(n.subject);
  const fm = [
    "---",
    `id: ${n.id}`,
    `title: ${jsonStr(n.title || "Untitled")}`,
    subject ? `subject: ${jsonStr(subject)}` : null,
    n.tags?.length ? `tags: [${n.tags.map(jsonStr).join(", ")}]` : null,
    n.folderId ? `folder: ${jsonStr(n.folderId)}` : null,
    `created: ${n.createdAt || nowIso()}`,
    `updated: ${n.updatedAt || nowIso()}`,
    "---",
    "",
  ].filter(Boolean).join("\n");

  const body = (n.pages || []).map((p, i) => renderPage(p, i + 1)).join("\n\n");
  const md = `${fm}${body || "(empty note)"}\n`;
  const name = safeFilename(n.title || "note");
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(`${name}-${stamp}.md`, md, "text/markdown");
  return { name: n.title, markdown: md };
}

function renderPage(page, idx) {
  if (!page) return `## Page ${idx}\n\n_(empty)_`;
  const strokes = page.strokes || [];
  const placeholders = page.placeholders || [];
  let md = `## Page ${idx}\n\n`;
  if (strokes.length === 0 && placeholders.length === 0) {
    md += "_(empty)_\n";
    return md;
  }
  if (placeholders.length) {
    md += "**Text fragments:**\n\n";
    for (const ph of placeholders) {
      md += `- ${ph.text || ""}\n`;
    }
    md += "\n";
  }
  if (strokes.length) {
    md += `**Handwriting:** ${strokes.length} stroke group${strokes.length === 1 ? "" : "s"}\n`;
  }
  return md;
}

async function subjectName(id) {
  if (!id) return null;
  try {
    const subs = await dataSource.subjects.list();
    const s = subs.find((x) => x.id === id);
    return s?.name || id;
  } catch {
    return id;
  }
}

function jsonStr(s) {
  return JSON.stringify(String(s ?? ""));
}

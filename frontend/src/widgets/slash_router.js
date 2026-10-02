/* ============================================================
 * widgets/slash_router.js — Slash command router for v2.34.0.
 *
 * Listens for `/f`, `/occlusion`, `/test` in any text input or
 * contenteditable. When detected:
 *
 * 1. Removes the slash command from the text (so it's not in the note).
 * 2. Opens the appropriate floating popup (draggable window / sheet).
 *
 * The popup operates on the note by noteId reference, NOT by injecting
 * markup into the note body. This is the v2.34.0 design: nothing UI
 * lives inside the note text.
 * ============================================================ */

import { openFlashcardPopup } from "./flashcard_popup.js";
import { openOcclusionPopup } from "./occlusion_popup.js";
import { openSelfTestPopup } from "./self_test_popup.js";

let _mounted = false;

const COMMANDS = {
  "/f":          { kind: "flashcard", label: "Flashcard" },
  "/flashcard":  { kind: "flashcard", label: "Flashcard" },
  "/flashcards": { kind: "flashcard", label: "Flashcard" },
  "/occlusion":  { kind: "occlusion", label: "Occlusion" },
  "/oc":         { kind: "occlusion", label: "Occlusion" },
  "/mask":       { kind: "occlusion", label: "Occlusion" },
  "/test":       { kind: "selftest",  label: "Self-test" },
  "/quiz":       { kind: "selftest",  label: "Self-test" },
};

/**
 * mountSlashRouter({ noteId, note })
 *
 * @param opts.noteId string
 * @param opts.note   object  full note (for self-test extraction)
 */
export function mountSlashRouter(opts = {}) {
  if (_mounted) return;
  _mounted = true;

  const noteId = opts.noteId;
  const note = opts.note;

  document.addEventListener("input", (e) => {
    const target = e.target;
    if (!target || !target.matches) return;
    if (!target.matches("textarea, input, [contenteditable]")) return;
    if (target.dataset?.noSlash === "1") return;

    const text = target.value !== undefined ? target.value : (target.textContent || "");

    // Match any of our slash commands at end of input.
    for (const cmd of Object.keys(COMMANDS)) {
      if (text.endsWith(cmd) || text.endsWith(cmd + " ")) {
        handleCommand(target, cmd, COMMANDS[cmd], noteId, note);
        return;
      }
    }
  }, true); // capture phase so we beat the old inline handlers

  // Also listen for keypress so /f typed with no trailing space still works.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const target = e.target;
    if (!target || !target.matches?.("textarea, input, [contenteditable]")) return;
    const text = target.value !== undefined ? target.value : (target.textContent || "");
    for (const cmd of Object.keys(COMMANDS)) {
      // Match /cmd at the end of a word/line
      const re = new RegExp("(^|\\s)" + cmd.replace("/", "\\/") + "$");
      if (re.test(text)) {
        handleCommand(target, cmd, COMMANDS[cmd], noteId, note);
        return;
      }
    }
  }, true);
}

function handleCommand(target, cmd, def, noteId, note) {
  // Clear the slash command from the input.
  if (target.value !== undefined) {
    target.value = target.value.replace(new RegExp(cmd + "\\s*$"), "").trimEnd();
  } else {
    target.textContent = (target.textContent || "")
      .replace(new RegExp(cmd + "\\s*$"), "")
      .trimEnd();
  }
  // Trigger input event so the note picks up the cleaned text.
  target.dispatchEvent(new Event("input", { bubbles: true }));

  // Open the popup.
  switch (def.kind) {
    case "flashcard":
      openFlashcardPopup({ noteId });
      break;
    case "occlusion":
      openOcclusionPopup({ noteId });
      break;
    case "selftest":
      openSelfTestPopup({ note, cards: note?.cards || [] });
      break;
  }

  // Visual feedback
  flashHint(target, def.label);
}

function flashHint(target, label) {
  // Small floating hint near the caret
  const rect = target.getBoundingClientRect();
  const hint = document.createElement("div");
  hint.className = "slash-router-hint";
  hint.textContent = "✨ " + label + " popup";
  hint.style.cssText = `
    position: fixed;
    left: ${Math.min(rect.left, window.innerWidth - 220)}px;
    top: ${Math.max(20, rect.top - 36)}px;
    background: rgba(47, 111, 237, 0.95);
    color: white;
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 12px;
    z-index: 3000;
    pointer-events: none;
    animation: fw-sheet-in 0.2s ease-out;
  `;
  document.body.appendChild(hint);
  setTimeout(() => {
    hint.style.transition = "opacity 0.3s, transform 0.3s";
    hint.style.opacity = "0";
    hint.style.transform = "translateY(-10px)";
    setTimeout(() => hint.remove(), 320);
  }, 1200);
}

export const __test = { COMMANDS };

/* ============================================================
 * widgets/floating_window.js — Draggable / resizable popup manager.
 *
 * v2.34.0 — Replaces inline slash-command UI with proper popups.
 *
 * - Desktop: floating window, draggable via header, resizeable via
 *   bottom-right corner, can be minimized, focus + z-index.
 * - Mobile/tablet: bottom-sheet modal with drag-down handle.
 *
 * Multiple windows can coexist. Each window is independent.
 * ============================================================ */

const _windows = new Set();
let _zCounter = 1000;

/**
 * openFloatingWindow({ title, body, width, height, kind, onClose })
 *
 * @param opts.title   string — window title (header)
 * @param opts.body    HTMLElement | string — content
 * @param opts.width   number — initial width px (default 480)
 * @param opts.height  number — initial height px (default 360)
 * @param opts.kind    string — "popup" (desktop) or "sheet" (mobile).
 *                            auto-detected if omitted.
 * @param opts.icon    string — emoji or short text shown in header
 * @param opts.id      string — unique id; replaces existing window with same id
 * @param opts.onClose fn() — called when window is closed
 *
 * @returns handle { close(), focus(), setBody(html) }
 */
export function openFloatingWindow(opts) {
  const id = opts.id || ("fw-" + Math.random().toString(36).slice(2, 8));
  const title = opts.title || "Popup";
  const kind = opts.kind || (window.matchMedia("(max-width: 900px)").matches ? "sheet" : "popup");

  // Close existing window with same id
  closeFloatingWindow(id);

  // Root
  const root = document.createElement("div");
  root.className = "floating-window floating-window--" + kind;
  root.dataset.fwId = id;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.setAttribute("aria-label", title);

  // Header
  const header = document.createElement("header");
  header.className = "floating-window-header";
  header.innerHTML = `
    <span class="floating-window-icon" aria-hidden="true">${escapeText(opts.icon || "✦")}</span>
    <span class="floating-window-title">${escapeText(title)}</span>
    <div class="floating-window-actions">
      <button type="button" class="floating-window-btn" data-fw-action="minimize" aria-label="Minimizar">—</button>
      <button type="button" class="floating-window-btn" data-fw-action="close" aria-label="Cerrar">✕</button>
    </div>
  `;

  // Body
  const body = document.createElement("div");
  body.className = "floating-window-body";
  if (opts.body instanceof HTMLElement) {
    body.appendChild(opts.body);
  } else if (typeof opts.body === "string") {
    body.innerHTML = opts.body;
  }

  // Resize handle (desktop only)
  let resize = null;
  if (kind === "popup") {
    resize = document.createElement("div");
    resize.className = "floating-window-resize";
    resize.setAttribute("aria-hidden", "true");
    root.appendChild(resize);
  }

  // Sheet handle (mobile only)
  let sheetHandle = null;
  if (kind === "sheet") {
    sheetHandle = document.createElement("div");
    sheetHandle.className = "floating-window-sheet-handle";
    sheetHandle.setAttribute("aria-hidden", "true");
    root.appendChild(sheetHandle);
  }

  root.appendChild(header);
  root.appendChild(body);

  // Position & size
  const W = Math.max(320, opts.width || 480);
  const H = Math.max(220, opts.height || 360);
  if (kind === "popup") {
    const cx = Math.max(20, (window.innerWidth - W) / 2 + (Math.random() * 60 - 30));
    const cy = Math.max(20, (window.innerHeight - H) / 2 + (Math.random() * 60 - 30));
    root.style.width = W + "px";
    root.style.height = H + "px";
    root.style.left = cx + "px";
    root.style.top = cy + "px";
  } else {
    root.style.width = "100%";
    root.style.height = (opts.height || 480) + "px";
  }

  document.body.appendChild(root);
  _windows.add(root);

  focusWindow(root);

  // === Drag (desktop) ===
  if (kind === "popup") {
    attachDrag(root, header);
    attachResize(root, resize);
  } else {
    attachSheetDrag(root, sheetHandle, header);
  }

  // === Actions ===
  header.querySelector('[data-fw-action="close"]').addEventListener("click", () => {
    closeFloatingWindow(id);
    if (opts.onClose) opts.onClose();
  });
  header.querySelector('[data-fw-action="minimize"]').addEventListener("click", () => {
    root.classList.toggle("floating-window--minimized");
  });

  // Focus on click anywhere
  root.addEventListener("mousedown", () => focusWindow(root));

  return {
    id,
    root,
    body,
    close: () => closeFloatingWindow(id),
    focus: () => focusWindow(root),
    setBody(html) {
      if (html instanceof HTMLElement) {
        body.innerHTML = "";
        body.appendChild(html);
      } else {
        body.innerHTML = html;
      }
    },
  };
}

export function closeFloatingWindow(id) {
  const root = document.querySelector(`[data-fw-id="${id}"]`);
  if (root) {
    root.remove();
    _windows.delete(root);
  }
}

export function closeAllFloatingWindows() {
  _windows.forEach((w) => w.remove());
  _windows.clear();
}

function focusWindow(root) {
  _zCounter += 1;
  root.style.zIndex = String(_zCounter);
}

function attachDrag(root, handle) {
  let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;
  handle.addEventListener("mousedown", (e) => {
    if (e.target.closest(".floating-window-btn")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = root.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let nx = origX + dx;
    let ny = origY + dy;
    // Clamp to viewport
    nx = Math.max(0, Math.min(window.innerWidth - 80, nx));
    ny = Math.max(0, Math.min(window.innerHeight - 40, ny));
    root.style.left = nx + "px";
    root.style.top = ny + "px";
  });
  document.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      document.body.style.userSelect = "";
    }
  });

  // Touch support
  handle.addEventListener("touchstart", (e) => {
    if (e.target.closest(".floating-window-btn")) return;
    const t = e.touches[0];
    dragging = true;
    startX = t.clientX;
    startY = t.clientY;
    const rect = root.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    root.style.left = (origX + dx) + "px";
    root.style.top = (origY + dy) + "px";
  }, { passive: true });
  document.addEventListener("touchend", () => { dragging = false; });
}

function attachResize(root, handle) {
  if (!handle) return;
  let startX = 0, startY = 0, origW = 0, origH = 0, resizing = false;
  handle.addEventListener("mousedown", (e) => {
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    origW = root.offsetWidth;
    origH = root.offsetHeight;
    document.body.style.userSelect = "none";
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const nw = Math.max(320, origW + (e.clientX - startX));
    const nh = Math.max(220, origH + (e.clientY - startY));
    root.style.width = nw + "px";
    root.style.height = nh + "px";
  });
  document.addEventListener("mouseup", () => {
    if (resizing) {
      resizing = false;
      document.body.style.userSelect = "";
    }
  });
}

function attachSheetDrag(root, handle, header) {
  // Drag-down to dismiss
  let startY = 0, startTop = 0, dragging = false;
  handle.addEventListener("touchstart", (e) => {
    dragging = true;
    const t = e.touches[0];
    startY = t.clientY;
    startTop = parseFloat(root.style.top || "0");
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const dy = t.clientY - startY;
    if (dy > 0) {
      root.style.transform = `translateY(${dy}px)`;
      root.style.opacity = String(Math.max(0.3, 1 - dy / 600));
    }
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    const t = root.style.transform || "";
    const dy = parseInt(t.replace(/[^\d-]/g, ""), 10) || 0;
    if (dy > 100) {
      closeFloatingWindow(root.dataset.fwId);
    } else {
      root.style.transform = "";
      root.style.opacity = "";
    }
  });
}

function escapeText(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": String.fromCharCode(38) + "amp;",
    "<": String.fromCharCode(38) + "lt;",
    ">": String.fromCharCode(38) + "gt;",
    '"': String.fromCharCode(38) + "quot;",
    "'": String.fromCharCode(38) + "#39;",
  }[c]));
}

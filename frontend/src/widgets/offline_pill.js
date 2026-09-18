/* ============================================================
 * offline_pill.js — backend online/offline indicator (v2.7.0).
 *
 * Renders a small pill near the dock showing connection state.
 * Listens for `backend-status` events from dataSource.
 * Re-checks every 30s so a server restart surfaces automatically.
 * ============================================================ */

import { isOnline, detectBackend } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";

const t = (key, fallback) => {
  try { return i18n.t(key) || fallback; } catch { return fallback; }
};

function safeIsOnline() {
  try { return isOnline(); } catch { return false; }
}
function safeDetect() {
  try { return detectBackend(); } catch { return Promise.resolve(false); }
}

const RECHECK_MS = 30_000;
let mounted = false;
let pillEl = null;
let timer = null;

export function mountOfflinePill() {
  if (mounted) return;
  mounted = true;
  ensurePill();
  updatePill(safeIsOnline());
  document.addEventListener("backend-status", (e) => updatePill(!!e.detail?.online));
  // Periodic recheck so transient outages heal
  if (timer) clearInterval(timer);
  timer = setInterval(() => safeDetect().catch(() => {}), RECHECK_MS);
}

function ensurePill() {
  if (pillEl) return pillEl;
  pillEl = document.createElement("div");
  pillEl.className = "offline-pill";
  pillEl.innerHTML = `<span class="dot"></span><span class="lbl"></span>`;
  document.body.appendChild(pillEl);
  // Click → recheck now
  pillEl.addEventListener("click", async () => {
    pillEl.classList.add("recheck");
    await detectBackend().catch(() => {});
    pillEl.classList.remove("recheck");
  });
  return pillEl;
}

function updatePill(online) {
  if (!pillEl) return;
  pillEl.dataset.state = online ? "online" : "offline";
  pillEl.querySelector(".lbl").textContent = online ? t("common.online", "Online") : t("common.offline", "Offline");
  pillEl.title = online
    ? "Backend reachable"
    : "Backend unreachable — using local cache";
}

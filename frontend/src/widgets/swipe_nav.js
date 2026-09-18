/* ============================================================
 * swipe_nav.js — Mobile gesture navigation (v2.7.0).
 *
 * - Right-edge swipe (40px wide strip on left edge → 60% screen width)
 *   → history.back()
 * - Left-edge swipe (mirror) → history.forward()
 * - Visual hint: subtle edge glow + progress bar during gesture.
 * - Disabled on >= 720px viewport (desktop uses keyboard shortcuts).
 *
 * Why: replaces the floating "← back" button on mobile.
 * ============================================================ */

const EDGE_PX = 24;       // start within this distance from edge
const COMMIT_RATIO = 0.35; // must traverse 35% of viewport width to commit
const MIN_VELOCITY = 0.4;  // px/ms — fast flick also commits
let attached = false;
let touchStart = null;
let progressEl = null;

function isMobile() {
  return window.innerWidth < 720;
}

function ensureProgressEl() {
  if (progressEl) return progressEl;
  progressEl = document.createElement("div");
  progressEl.className = "swipe-progress";
  progressEl.innerHTML = `<div class="swipe-progress-bar"></div>`;
  document.body.appendChild(progressEl);
  return progressEl;
}

function showProgress(side, ratio) {
  const el = ensureProgressEl();
  el.classList.add("visible");
  el.dataset.side = side;
  const bar = el.querySelector(".swipe-progress-bar");
  bar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
}

function hideProgress() {
  if (progressEl) progressEl.classList.remove("visible");
}

export function mountSwipeNav() {
  if (attached) return;
  attached = true;

  document.addEventListener("touchstart", (e) => {
    if (!isMobile()) return;
    // ignore if touching inputs/canvas
    const tag = (e.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    if (e.target?.closest?.(".canvas-host, .notebook-toolbar-bottom")) return;
    const t = e.touches[0];
    const fromLeft = t.clientX < EDGE_PX;
    const fromRight = window.innerWidth - t.clientX < EDGE_PX;
    if (!fromLeft && !fromRight) return;
    touchStart = {
      x: t.clientX,
      y: t.clientY,
      time: Date.now(),
      side: fromLeft ? "left" : "right",
    };
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!touchStart) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    // require horizontal-ish motion
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (touchStart.side === "left" && dx <= 0) return;
    if (touchStart.side === "right" && dx >= 0) return;
    const ratio = Math.abs(dx) / window.innerWidth;
    showProgress(touchStart.side, ratio);
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const elapsed = Date.now() - touchStart.time;
    const ratio = Math.abs(dx) / window.innerWidth;
    const velocity = Math.abs(dx) / Math.max(elapsed, 1);
    const shouldCommit =
      ratio >= COMMIT_RATIO || velocity >= MIN_VELOCITY;
    hideProgress();
    if (shouldCommit) {
      if (touchStart.side === "left") {
        history.back();
      } else {
        history.forward();
      }
    }
    touchStart = null;
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    touchStart = null;
    hideProgress();
  });
}

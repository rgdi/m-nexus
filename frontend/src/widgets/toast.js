/* widgets/toast.js — shared transient message.
 *
 * v2.37.0. The same ~15-line function was copy-pasted into four widgets
 * (fsrs_dashboard, kg_graph, multi_board, notifications_bell), each with
 * its own timer variable and its own CSS class. That means four toasts
 * could be visible at once and a fix to one never reached the others.
 *
 * Single element, single timer, one class namespace. `showToast(msg)`
 * and `showToast(msg, "error")` both work; a boolean is accepted too so
 * the existing call sites keep compiling unchanged.
 */

const HOST_CLASS = "mn-toast";
const SHOW_CLASS = "is-visible";
const ERROR_CLASS = "is-error";

let timer = null;
let el = null;

function ensure() {
  if (el?.isConnected) return el;
  el = document.createElement("div");
  el.className = HOST_CLASS;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);
  return el;
}

/**
 * @param {string} msg
 * @param {"error"|"info"|boolean} [kind] "error" (or true) styles it as a failure
 * @param {number} [ms] dwell time, default 2600
 */
export function showToast(msg, kind = "info", ms = 2600) {
  if (typeof document === "undefined") return;
  const isError = kind === "error" || kind === true;
  const t = ensure();
  t.textContent = msg;
  t.classList.toggle(ERROR_CLASS, isError);
  t.classList.add(SHOW_CLASS);
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove(SHOW_CLASS), ms);
}

export function hideToast() {
  clearTimeout(timer);
  el?.classList.remove(SHOW_CLASS);
}

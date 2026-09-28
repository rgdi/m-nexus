/* ============================================================
 * screens/login.js — Admin login screen.
 * v2.6.0 — username + password + 90-day session.
 * v2.34.2 — autofill hardening.
 *
 * Browsers and password managers (Chrome, Edge, 1Password, LastPass)
 * try to auto-fill the login form based on:
 *   - The field `name` attribute
 *   - The form's autocomplete hints
 *   - The URL/path
 *   - The previously-typed value
 *
 * That can surface unrelated suggestions (e.g. "Notes AI") the user
 * never typed. To block this we:
 *   - Use `autocomplete="off"` on the form AND on each field
 *   - Use generic, non-semantic field names (mn-user / mn-pass) so
 *     password managers don't recognise the form as "login"
 *   - Start fields as `readonly` and remove the attribute on focus,
 *     which defeats Chromium's autofill heuristics
 *   - Add `data-lpignore`, `data-1p-ignore`, `data-form-type="other"`
 *     to suppress common managers
 * ============================================================ */

import { auth } from "../services/auth.js";
import { i18n } from "../services/i18n.js";
import { detectApiBase } from "../services/api_base.js";

const t = (k, args) => i18n.t(k, args);

export async function renderLogin() {
  const root = document.getElementById("screen-root") || document.getElementById("app");
  if (!root) return;
  // Random suffixes defeat heuristic URL+name-based autofill.
  const suffix = Math.random().toString(36).slice(2, 8);
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card" data-form-type="other" data-lpignore="true" data-1p-ignore="true">
        <div class="login-logo">✦ M-NEXUS</div>
        <h2 class="login-title">${t("login.title")}</h2>
        <p class="login-subtitle">${t("login.subtitle")}</p>
        <form id="login-form" autocomplete="off" data-lpignore="true" data-1p-ignore="true">
          <label class="login-field">
            <span>${t("login.username")}</span>
            <input
              type="text"
              name="mn-user-${suffix}"
              id="mn-user"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              required
              readonly
              onfocus="this.removeAttribute('readonly')"
            />
          </label>
          <label class="login-field">
            <span>${t("login.password")}</span>
            <input
              type="password"
              name="mn-pass-${suffix}"
              id="mn-pass"
              autocomplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              required
              readonly
              onfocus="this.removeAttribute('readonly')"
            />
          </label>
          <div id="login-error" class="login-error" hidden></div>
          <button type="submit" class="login-submit">${t("login.submit")}</button>
        </form>
        <div class="login-hint">${t("login.hint")}</div>
      </div>
    </div>
  `;
  // Strip readonly after first paint so normal typing works.
  requestAnimationFrame(() => {
    root.querySelectorAll("input[readonly]").forEach((el) => el.removeAttribute("readonly"));
  });

  const form = document.getElementById("login-form");
  const errBox = document.getElementById("login-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const fd = new FormData(form);
    const username = (fd.get(`mn-user-${suffix}`) || "").toString().trim();
    const password = (fd.get(`mn-pass-${suffix}`) || "").toString();
    if (!username || !password) return;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "...";
    try {
      const base = detectApiBase();
      const r = await fetch(`${base}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (r.status === 429) {
        const body = await r.json().catch(() => ({}));
        errBox.textContent = t("login.tooMany").replace("{n}", body.retryAfterSec || "60");
      } else if (r.status === 423) {
        const body = await r.json().catch(() => ({}));
        errBox.textContent = t("login.locked").replace("{n}", body.retryAfterSec || "3600");
      } else if (!r.ok) {
        errBox.textContent = t("login.failed");
      } else {
        const data = await r.json();
        if (data.accessToken) {
          auth.saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          location.hash = "#/overview";
          return;
        }
        errBox.textContent = t("login.failed");
      }
      errBox.hidden = false;
    } catch (err) {
      errBox.textContent = t("login.networkError");
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = t("login.submit");
    }
  });
}


/* ============================================================
 * screens/login.js — Admin login screen.
 * v2.6.0 — username + password + 90-day session.
 * ============================================================ */

import { auth } from "../services/auth.js";
import { i18n } from "../services/i18n.js";

const t = (k, args) => i18n.t(k, args);

export async function renderLogin() {
  const root = document.getElementById("screen-root") || document.getElementById("app");
  if (!root) return;
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">✦ M-NEXUS</div>
        <h2 class="login-title">${t("login.title")}</h2>
        <p class="login-subtitle">${t("login.subtitle")}</p>
        <form id="login-form" autocomplete="on">
          <label class="login-field">
            <span>${t("login.username")}</span>
            <input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required autofocus />
          </label>
          <label class="login-field">
            <span>${t("login.password")}</span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <div id="login-error" class="login-error" hidden></div>
          <button type="submit" class="login-submit">${t("login.submit")}</button>
        </form>
        <div class="login-hint">${t("login.hint")}</div>
      </div>
    </div>
  `;
  const form = document.getElementById("login-form");
  const errBox = document.getElementById("login-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const fd = new FormData(form);
    const username = (fd.get("username") || "").toString().trim();
    const password = (fd.get("password") || "").toString();
    if (!username || !password) return;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "...";
    try {
      const r = await fetch(`${window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://" + window.location.hostname + ":4100" : ""}/api/v1/auth/login`, {
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

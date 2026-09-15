/* ============================================================
 * vault.js — multi-vault switcher.
 * v1.9.3 — cada vault tiene su namespace en localStorage.
 *
 * Default vault: "default".
 * Cambiar de vault recarga toda la app y usa un nuevo prefijo.
 *
 * Backend: las notas/flashcards/etc siguen siendo globales pero
 * etiquetamos cada recurso con su vaultId.
 * ============================================================ */

const KEY = "mnexus.vaults.current";

export function getVaults() {
  return ["default", "school", "personal", "work"];
}

export function getCurrentVault() {
  return localStorage.getItem(KEY) || "default";
}

export function setCurrentVault(v) {
  try { localStorage.setItem(KEY, v); } catch {}
}

export function vaultPrefix(vaultId) {
  return `mnexus.vault.${vaultId || getCurrentVault()}`;
}

/** Apply vault prefix to a localStorage key. */
export function vKey(name) {
  return `${vaultPrefix()}.${name}`;
}

/** Get a vault-scoped value from localStorage. */
export function vGet(name, fallback = null) {
  try {
    const v = localStorage.getItem(vKey(name));
    return v === null ? fallback : v;
  } catch { return fallback; }
}

/** Set a vault-scoped value in localStorage. */
export function vSet(name, value) {
  try { localStorage.setItem(vKey(name), value); } catch {}
}

/**
 * mountVaultSwitcher — pill button en top-right que muestra el vault activo.
 * Click = menú con los vaults disponibles.
 */
export function mountVaultSwitcher() {
  if (document.getElementById("vault-switcher")) return;
  const btn = document.createElement("button");
  btn.id = "vault-switcher";
  btn.className = "vault-switcher";
  sync(btn);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openVaultMenu(btn);
  });
  document.body.appendChild(btn);
}

function sync(btn) {
  const cur = getCurrentVault();
  const icons = { default: "🏠", school: "🎒", personal: "✨", work: "💼" };
  btn.innerHTML = `<span class="vault-ico">${icons[cur] || "📁"}</span><span class="vault-name">${cur}</span>`;
  btn.title = `Vault: ${cur}`;
  btn.setAttribute("aria-label", `Switch vault (current: ${cur})`);
}

function openVaultMenu(btn) {
  document.querySelectorAll(".vault-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "vault-menu";
  const vaults = getVaults();
  const cur = getCurrentVault();
  menu.innerHTML = vaults.map((v) => `
    <button class="vault-opt ${v === cur ? "active" : ""}" data-vault="${v}">
      <span>${v === cur ? "✓" : "○"}</span>
      <span>${v}</span>
    </button>
  `).join("");
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.right = `${window.innerWidth - r.right}px`;
  menu.querySelectorAll(".vault-opt").forEach((b) => {
    b.addEventListener("click", () => {
      const v = b.dataset.vault;
      setCurrentVault(v);
      sync(btn);
      menu.remove();
      // notify + reload
      document.dispatchEvent(new CustomEvent("vault:change", { detail: { vault: v } }));
      location.reload();
    });
  });
  setTimeout(() => {
    const close = (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", close);
      }
    };
    document.addEventListener("click", close);
  }, 50);
}

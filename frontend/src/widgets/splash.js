/* ============================================================
 * splash.js — splash screen con logo "Education Service".
 * v1.4.0 — replica la pantalla de carga del modelo.
 * ============================================================ */

export function showSplash() {
  if (document.getElementById("mnexus-splash")) return;

  const splash = document.createElement("div");
  splash.id = "mnexus-splash";
  splash.className = "splash";
  splash.innerHTML = `
    <div class="splash-blob splash-blob-1"></div>
    <div class="splash-blob splash-blob-2"></div>
    <div class="splash-content">
      <h1 class="splash-title">Education<br/>Service</h1>
      <p class="splash-tagline">always at hand</p>
    </div>
  `;
  document.body.appendChild(splash);

  // Quitar splash cuando el usuario toque o tras 1.2s
  const dismiss = () => {
    splash.classList.add("splash-hide");
    setTimeout(() => splash.remove(), 400);
  };
  splash.addEventListener("pointerdown", dismiss, { once: true });
  setTimeout(dismiss, 1200);
}

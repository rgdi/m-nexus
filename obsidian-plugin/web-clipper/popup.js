// M-NEXUS Web Clipper - popup script.
// v0.33: envía el contenido a la API del backend, que crea la nota en el vault.

const VAULTS_KEY = "mnexus.vaults";
const BACKEND_KEY = "mnexus.backend";

async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  document.getElementById("url").textContent = tab?.url ?? "(sin URL)";

  // Cargar vaults del backend
  const { [BACKEND_KEY]: backend } = await chrome.storage.local.get(BACKEND_KEY);
  if (!backend) {
    document.getElementById("status").textContent =
      "Configura el backend en Ajustes de M-NEXUS.";
    return;
  }
  try {
    const r = await fetch(`${backend}/api/v1/vaults`);
    const vaults = await r.json();
    const sel = document.getElementById("vaults");
    sel.innerHTML = "";
    for (const v of vaults) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.name;
      sel.appendChild(opt);
    }
  } catch (err) {
    document.getElementById("status").textContent = "Error cargando vaults: " + err.message;
  }

  document.getElementById("clip").onclick = () => clipPage(tab);
}

async function clipPage(tab) {
  const status = document.getElementById("status");
  status.textContent = "Extrayendo…";
  // Inyectar extractor
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: extractPage,
  });
  const vault = document.getElementById("vaults").value;
  const folder = document.getElementById("folder").value || "Clippings";
  const tags = document.getElementById("tags").value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { [BACKEND_KEY]: backend } = await chrome.storage.local.get(BACKEND_KEY);
  try {
    const r = await fetch(`${backend}/api/v1/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultId: vault,
        folder,
        tags,
        url: tab.url,
        title: result.title,
        content: result.content,
        excerpt: result.excerpt,
        author: result.author,
        publishedAt: result.publishedAt,
        cover: result.cover,
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    status.textContent = "✅ Guardado en " + data.path;
  } catch (err) {
    status.textContent = "❌ Error: " + err.message;
  }
}

function extractPage() {
  // Extracts metadata and main content using heuristics.
  const get = (sel, attr = "content") => {
    const el = document.head.querySelector(sel);
    return el ? el.getAttribute(attr) : null;
  };
  const title =
    get("meta[property='og:title']") ||
    get("meta[name='twitter:title']") ||
    document.title;
  const author =
    get("meta[name='author']") ||
    get("meta[property='article:author']") ||
    null;
  const publishedAt =
    get("meta[property='article:published_time']") ||
    get("meta[name='date']") ||
    null;
  const cover =
    get("meta[property='og:image']") ||
    get("meta[name='twitter:image']") ||
    null;
  const excerpt =
    get("meta[property='og:description']") ||
    get("meta[name='description']") ||
    "";

  // Try Readability-like extraction
  let mainEl = document.querySelector("main, article, [role='main']");
  if (!mainEl) {
    mainEl = document.body;
  }
  // Strip scripts, styles, navs
  const clone = mainEl.cloneNode(true);
  clone.querySelectorAll("script, style, nav, aside, footer, header").forEach((el) => el.remove());
  const content = clone.textContent.replace(/\s+/g, " ").trim().slice(0, 10000);

  return { title, author, publishedAt, cover, excerpt, content };
}

init();

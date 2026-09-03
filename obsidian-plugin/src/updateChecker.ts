// v0.28: UpdateChecker — comprueba automáticamente si hay una versión más
// nueva del plugin y notifica al usuario.
//
// Estrategia: usa la GitHub Releases API (pública, sin auth) para obtener
// la última release del repo. Si el tag es más nuevo que la versión actual,
// muestra un Notice con un link para descargar.
//
// Para activar: import { checkForUpdates } y llamarlo desde onload().
//
// Auto-actualización real: la hace BRAT (Beta Reviewer's Auto-update Tool)
// o el sistema de Community Plugins de Obsidian. Este checker solo NOTIFICA.

import { requestUrl, Notice } from "obsidian";

const REPO_OWNER = "rgdi";
const REPO_NAME = "m-nexus";
const GITHUB_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const DOWNLOAD_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  releaseNotes: string;
  downloadUrl: string;
  publishedAt: string;
}

/** Compara dos versiones semver (0.28.0 < 0.28.1, etc). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/** Comprueba la última versión disponible en GitHub. */
export async function fetchLatestVersion(): Promise<{
  version: string;
  notes: string;
  publishedAt: string;
  htmlUrl: string;
} | null> {
  try {
    const res = await requestUrl({
      url: GITHUB_API,
      throw: false,
    });
    if (res.status !== 200) return null;
    const data = res.json as {
      tag_name: string;
      body: string;
      published_at: string;
      html_url: string;
    };
    return {
      version: data.tag_name.replace(/^v/, ""),
      notes: data.body || "",
      publishedAt: data.published_at,
      htmlUrl: data.html_url,
    };
  } catch {
    return null;
  }
}

/**
 * Comprueba si hay updates. Si los hay, muestra un Notice.
 * Llamar desde onload() del plugin. No bloquea.
 */
export async function checkForUpdates(
  currentVersion: string,
  options: { silent?: boolean; onUpdate?: (info: UpdateInfo) => void } = {}
): Promise<UpdateInfo | null> {
  const latest = await fetchLatestVersion();
  if (!latest) {
    if (!options.silent) {
      new Notice("⚠️ M-NEXUS: no se pudo comprobar actualizaciones (sin red?)");
    }
    return null;
  }

  const hasUpdate = compareVersions(latest.version, currentVersion) > 0;
  const info: UpdateInfo = {
    current: currentVersion,
    latest: latest.version,
    hasUpdate,
    releaseNotes: latest.notes,
    downloadUrl: latest.htmlUrl,
    publishedAt: latest.publishedAt,
  };

  if (hasUpdate) {
    new Notice(
      `🔔 M-NEXUS ${latest.version} disponible (tienes ${currentVersion})\n` +
      `Click para abrir la release →`,
      8000
    );
    // Hacer el notice clickable (Obsidian 1.5+)
    const noticeEl = document.querySelector(".notice") as HTMLElement | null;
    if (noticeEl) {
      noticeEl.style.cursor = "pointer";
      noticeEl.onclick = () => window.open(info.downloadUrl, "_blank");
    }
    if (options.onUpdate) options.onUpdate(info);
  } else if (!options.silent) {
    new Notice(`✓ M-NEXUS ${currentVersion} está al día`);
  }

  return info;
}

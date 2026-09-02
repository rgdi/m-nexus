// v0.28: UpdateChecker para el backend — chequea si hay nueva versión
// en GitHub y la loguea al arrancar.
//
// Para auto-actualizar realmente, usar el script install-mnexus.sh --update
// o el workflow de GitHub Actions.

import { logger } from "./log.js";
import { VERSION } from "../version.js";

const REPO_OWNER = "rgdi";
const REPO_NAME = "m-nexus";
const GITHUB_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

/** Compara versiones semver. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

interface ReleaseInfo {
  version: string;
  publishedAt: string;
  releaseUrl: string;
  downloadUrl: string;
}

/** Consulta la última release. Devuelve null si no se puede. */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(GITHUB_API, {
      headers: { "User-Agent": "mnexus-backend" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name: string;
      published_at: string;
      html_url: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };
    const backendAsset = data.assets.find((a) => a.name.includes("backend"));
    return {
      version: data.tag_name.replace(/^v/, ""),
      publishedAt: data.published_at,
      releaseUrl: data.html_url,
      downloadUrl: backendAsset?.browser_download_url ?? data.html_url,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Comprueba updates al arrancar. Loguea si hay nueva versión.
 * No bloquea el arranque (timeout corto).
 */
export async function checkForUpdatesOnStartup(): Promise<void> {
  // No hacer check en tests
  if (process.env.NODE_ENV === "test" || process.env.MNEXUS_SKIP_UPDATE_CHECK === "1") {
    return;
  }

  // Timeout corto para no bloquear el arranque
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  const check = fetchLatestRelease().catch(() => null);

  const latest = await Promise.race([check, timeout]);
  if (!latest) return;

  if (compareVersions(latest.version, VERSION) > 0) {
    logger.warn(
      `⚠️  Nueva versión disponible: v${latest.version} (tienes v${VERSION})\n` +
      `   Descarga: ${latest.downloadUrl}\n` +
      `   O ejecuta: install.sh --update`
    );
  } else {
    logger.info(`Versión actual v${VERSION} es la última`);
  }
}

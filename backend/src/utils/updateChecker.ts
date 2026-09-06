// v0.28-0.30: UpdateChecker para el backend.
// Re-exports applyUpdate + detectRestartCommand for backward compat.

export * from "./updateApply.js";


//
// Capacidades:
// - checkForUpdatesOnStartup(): chequea en el arranque, no bloquea
// - fetchLatestRelease(): consulta GitHub API
// - getUpdateInfo(): compara current vs latest, devuelve info
// - downloadUpdate(): descarga el ZIP con progreso
// - applyUpdate(): backup, extract, restart (PM2-friendly)
//
// La app puede:
// 1. GET /api/v1/update (info)
// 2. POST /api/v1/update/check (force check)
// 3. POST /api/v1/update/apply (download + install + restart)

import { logger } from "./log.js";
import { VERSION } from "../version.js";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const REPO_OWNER = "rgdi";
const REPO_NAME = "m-nexus";
const GITHUB_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

/** Compara versiones semver (a - b: -1, 0, 1). */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

export interface ReleaseInfo {
  version: string;
  tagName: string;
  publishedAt: string;
  releaseUrl: string;
  downloadUrl: string;
  fileName: string;
  size: number;
  body: string;
  isPrerelease: boolean;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  downloadUrl: string;
  fileName: string;
  size: number;
  publishedAt: string;
  body: string;
  isPrerelease: boolean;
}

/** Consulta la última release (estable por defecto). */
export async function fetchLatestRelease(allowPrerelease = false): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(GITHUB_API, {
      headers: { "User-Agent": "mnexus-backend", Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      logger.warn(`[update] GitHub API responded ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      tag_name: string;
      published_at: string;
      html_url: string;
      body: string;
      prerelease: boolean;
      assets: Array<{ name: string; browser_download_url: string; size: number }>;
    };
    if (data.prerelease && !allowPrerelease) {
      // Si la última es prerelease, intentar la penúltima (release estable)
      return fetchLatestStable();
    }
    const backendAsset =
      data.assets.find((a) => a.name.includes("backend") && a.name.endsWith(".zip")) ??
      data.assets.find((a) => a.name.includes("backend"));
    if (!backendAsset) return null;
    return {
      version: data.tag_name.replace(/^v/, ""),
      tagName: data.tag_name,
      publishedAt: data.published_at,
      releaseUrl: data.html_url,
      downloadUrl: backendAsset.browser_download_url,
      fileName: backendAsset.name,
      size: backendAsset.size,
      body: data.body ?? "",
      isPrerelease: data.prerelease,
    };
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "[update] fetchLatestRelease failed");
    return null;
  }
}

/** Busca la última release estable (no prerelease). */
async function fetchLatestStable(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=10`, {
      headers: { "User-Agent": "mnexus-backend", Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const releases = (await res.json()) as Array<{
      tag_name: string;
      published_at: string;
      html_url: string;
      body: string;
      prerelease: boolean;
      assets: Array<{ name: string; browser_download_url: string; size: number }>;
    }>;
    for (const data of releases) {
      if (data.prerelease) continue;
      const backendAsset =
        data.assets.find((a) => a.name.includes("backend") && a.name.endsWith(".zip")) ??
        data.assets.find((a) => a.name.includes("backend"));
      if (!backendAsset) continue;
      return {
        version: data.tag_name.replace(/^v/, ""),
        tagName: data.tag_name,
        publishedAt: data.published_at,
        releaseUrl: data.html_url,
        downloadUrl: backendAsset.browser_download_url,
        fileName: backendAsset.name,
        size: backendAsset.size,
        body: data.body ?? "",
        isPrerelease: false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Compara current vs latest, devuelve un UpdateCheckResult. */
export async function getUpdateInfo(allowPrerelease = false): Promise<UpdateCheckResult> {
  const latest = await fetchLatestRelease(allowPrerelease);
  if (!latest) {
    return {
      currentVersion: VERSION,
      latestVersion: VERSION,
      hasUpdate: false,
      releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
      downloadUrl: "",
      fileName: "",
      size: 0,
      publishedAt: "",
      body: "",
      isPrerelease: false,
    };
  }
  return {
    currentVersion: VERSION,
    latestVersion: latest.version,
    hasUpdate: compareVersions(latest.version, VERSION) > 0,
    releaseUrl: latest.releaseUrl,
    downloadUrl: latest.downloadUrl,
    fileName: latest.fileName,
    size: latest.size,
    publishedAt: latest.publishedAt,
    body: latest.body,
    isPrerelease: latest.isPrerelease,
  };
}

/** Cache de check para no martillar la API (5 min). */
let cached: { at: number; info: UpdateCheckResult } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getUpdateInfoCached(allowPrerelease = false): Promise<UpdateCheckResult> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.info;
  }
  const info = await getUpdateInfo(allowPrerelease);
  cached = { at: Date.now(), info };
  return info;
}

export function clearUpdateCache(): void {
  cached = null;
}

/**
 * Comprueba updates al arrancar. Loguea si hay nueva versión.
 * No bloquea el arranque (timeout corto).
 */
export async function checkForUpdatesOnStartup(): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.MNEXUS_SKIP_UPDATE_CHECK === "1") {
    return;
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  const check = (async () => {
    const info = await getUpdateInfo(false);
    return info;
  })();
  const result = await Promise.race([check, timeout]);
  if (!result) return;
  if (result.hasUpdate) {
    logger.warn(
      `\n╔════════════════════════════════════════════════════════════╗\n` +
      `║  Nueva versión disponible: v${result.latestVersion} (tienes v${result.currentVersion})`.padEnd(61) + `║\n` +
      `║  Descarga: ${result.downloadUrl}`.padEnd(61).slice(0, 61) + `║\n` +
      `║  O ejecuta: mnexus update-apply                            ║\n` +
      `║  Release notes: ${result.releaseUrl}`.padEnd(61).slice(0, 61) + `║\n` +
      `╚════════════════════════════════════════════════════════════╝`
    );
  } else {
    logger.info(`Versión actual v${VERSION} es la última estable`);
  }
}

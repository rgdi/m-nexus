// v0.28-0.30: UpdateChecker para el backend.
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

// ──────────────────────────────────────────────────────────────────
// Apply update (download + extract + restart)
// ──────────────────────────────────────────────────────────────────

export interface ApplyUpdateOptions {
  targetDir: string;        // donde está el backend instalado (process.cwd() por defecto)
  backupDir: string;        // donde guardar el backup (targetDir/../backups)
  workDir: string;          // donde descargar el ZIP temporal
  restartCmd?: string;      // comando para reiniciar (PM2, systemd, etc)
}

export interface ApplyUpdateResult {
  ok: boolean;
  fromVersion: string;
  toVersion: string;
  backupPath: string | null;
  steps: string[];
  error?: string;
}

/** Descarga un archivo de una URL a un path local. */
export async function downloadFile(url: string, dest: string, onProgress?: (downloaded: number, total: number) => void): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "mnexus-backend" } });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const total = parseInt(res.headers.get("content-length") ?? "0", 10);
  if (!res.body) throw new Error("no body");
  let downloaded = 0;
  const reader = res.body.getReader();
  const out = createWriteStream(dest);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;
      out.write(Buffer.from(value));
      if (onProgress) onProgress(downloaded, total);
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  } finally {
    out.destroy();
  }
}

/** Aplica una actualización: backup, download, extract, restart-ready. */
export async function applyUpdate(
  info: UpdateCheckResult,
  opts: ApplyUpdateOptions
): Promise<ApplyUpdateResult> {
  const steps: string[] = [];
  const targetDir = resolve(opts.targetDir);
  const backupDir = resolve(opts.backupDir);
  const workDir = resolve(opts.workDir);

  try {
    // 1. Verificar que hay update
    if (!info.hasUpdate) {
      return { ok: false, fromVersion: info.currentVersion, toVersion: info.latestVersion, backupPath: null, steps, error: "no_update_available" };
    }

    // 2. Crear directorios
    for (const dir of [backupDir, workDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    steps.push(`workdir_ready:${workDir}`);
    steps.push(`backupdir_ready:${backupDir}`);

    // 3. Backup del directorio actual
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `backup-v${info.currentVersion}-${ts}.zip`);
    if (existsSync(targetDir)) {
      // Backup selectivo: solo src/, node_modules/, package.json, etc.
      // (no queremos logear el ZIP temporal)
      try {
        execSync(
          `cd "${dirname(targetDir)}" && zip -r "${backupPath}" "${targetDir.split("/").pop()}" -x "*.log" "*.tmp" "node_modules/.cache/*"`,
          { stdio: "pipe" }
        );
        steps.push(`backup_created:${backupPath}`);
      } catch (e) {
        // No es fatal, continuamos
        steps.push(`backup_skipped:${(e as Error).message}`);
      }
    }

    // 4. Descargar el nuevo ZIP
    const zipPath = join(workDir, info.fileName);
    await downloadFile(info.downloadUrl, zipPath, (d, t) => {
      if (t > 0) logger.info(`[update] downloading... ${Math.round((d / t) * 100)}%`);
    });
    steps.push(`downloaded:${zipPath}`);
    const stat = statSync(zipPath);
    logger.info(`[update] downloaded ${stat.size} bytes`);

    // 5. Extraer en staging
    const stageDir = join(workDir, `staging-${info.latestVersion}`);
    if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });
    execSync(`unzip -q "${zipPath}" -d "${stageDir}"`, { stdio: "pipe" });
    steps.push(`extracted:${stageDir}`);

    // 6. Detectar la estructura del ZIP y mover al target
    // El ZIP contiene deploy/ (con dist/, package.json, etc.)
    const deployDir = join(stageDir, "deploy");
    const finalDir = existsSync(deployDir) ? deployDir : stageDir;

    // 7. Backup del node_modules y otros pesados (no los borramos, los reutilizamos)
    // Solo reemplazamos lo que viene en el ZIP
    execSync(
      `cp -r "${finalDir}/." "${targetDir}/"`,
      { stdio: "pipe" }
    );
    steps.push(`replaced:${targetDir}`);

    // 8. Reemplazar package.json y reinstalar deps si cambió
    try {
      execSync(`cd "${targetDir}" && npm install --omit=dev --no-audit --no-fund`, { stdio: "pipe" });
      steps.push(`deps_installed`);
    } catch (e) {
      steps.push(`deps_skipped:${(e as Error).message}`);
    }

    // 9. Limpiar staging
    rmSync(stageDir, { recursive: true, force: true });
    steps.push(`cleaned`);

    // 10. Marcar para reinicio
    if (opts.restartCmd) {
      try {
        // schedule restart en 1 segundo para que el response llegue
        execSync(`(sleep 1 && ${opts.restartCmd}) > /dev/null 2>&1 &`, { stdio: "pipe" });
        steps.push(`restart_scheduled:${opts.restartCmd}`);
      } catch (e) {
        steps.push(`restart_failed:${(e as Error).message}`);
      }
    } else {
      steps.push(`restart_manual:backend_needs_restart`);
    }

    return { ok: true, fromVersion: info.currentVersion, toVersion: info.latestVersion, backupPath, steps };
  } catch (e) {
    return {
      ok: false,
      fromVersion: info.currentVersion,
      toVersion: info.latestVersion,
      backupPath: null,
      steps,
      error: (e as Error).message,
    };
  }
}

/** Detecta el comando de restart apropiado según el entorno. */
export function detectRestartCommand(): string | undefined {
  // PM2
  if (existsSync("/usr/bin/pm2") || existsSync("/usr/local/bin/pm2")) {
    return "pm2 restart mnexus-backend || pm2 restart all";
  }
  // systemd
  if (existsSync("/etc/systemd/system/mnexus-backend.service")) {
    return "systemctl restart mnexus-backend";
  }
  return undefined;
}

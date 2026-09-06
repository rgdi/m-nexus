// Apply updates: backup, download, replace.

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


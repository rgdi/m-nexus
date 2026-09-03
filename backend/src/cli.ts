#!/usr/bin/env node
// v0.30: CLI para el backend M-NEXUS.
//
// Uso:
//   mnexus update-check       -> consulta la última versión (sin descargar)
//   mnexus update-apply       -> descarga y aplica la última versión estable
//   mnexus update-apply --pre -> incluye prereleases
//   mnexus version            -> muestra la versión actual

import {
  getUpdateInfo,
  applyUpdate,
  detectRestartCommand,
} from "./utils/updateChecker.js";
import { VERSION } from "./version.js";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const REPO_ROOT = process.env.MNEXUS_REPO_ROOT ?? join(homedir(), ".mnexus");

function help(): void {
  console.log(`M-NEXUS backend v${VERSION}

Usage:
  mnexus version                show current version
  mnexus update-check           check for available updates
  mnexus update-check --pre     include prereleases
  mnexus update-apply           download and apply latest stable
  mnexus update-apply --pre     include prereleases
  mnexus help                   show this help
`);
}

async function cmdVersion(): Promise<void> {
  console.log(`mnexus-backend v${VERSION}`);
}

async function cmdUpdateCheck(pre: boolean): Promise<void> {
  console.log(`[mnexus] checking for updates (current: v${VERSION})${pre ? " [prereleases OK]" : ""}...`);
  const info = await getUpdateInfo(pre);
  if (info.hasUpdate) {
    console.log(`
╭─────────────────────────────────────────────────────────╮
│  ¡Nueva versión disponible!                             │
├─────────────────────────────────────────────────────────┤
│  Actual:  v${info.currentVersion.padEnd(45)}│
│  Nueva:   v${info.latestVersion.padEnd(45)}│
│  Tamaño:  ${(info.size / 1024).toFixed(0).padStart(6)} KB${" ".repeat(36)}│
│  Fecha:   ${new Date(info.publishedAt).toLocaleString().padEnd(45)}│
├─────────────────────────────────────────────────────────┤
│  Para aplicar:                                           │
│    mnexus update-apply                                    │
│                                                         │
│  Release notes: ${info.releaseUrl.slice(0, 40)}│
╰─────────────────────────────────────────────────────────╯
`);
  } else if (info.latestVersion === VERSION) {
    console.log(`✓ v${VERSION} es la última versión`);
  } else {
    console.log(`Versión local (v${VERSION}) es más reciente que la publicada (v${info.latestVersion})`);
  }
}

async function cmdUpdateApply(pre: boolean): Promise<void> {
  console.log(`[mnexus] checking for updates...`);
  const info = await getUpdateInfo(pre);
  if (!info.hasUpdate) {
    console.log(`✓ Ya tienes la última versión (v${VERSION})`);
    return;
  }

  console.log(`[mnexus] update found: v${info.currentVersion} -> v${info.latestVersion}`);

  const targetDir = process.env.MNEXUS_BACKEND_DIR ?? REPO_ROOT;
  const backupDir = join(targetDir, "..", "mnexus-backups");
  const workDir = join(targetDir, "..", "mnexus-staging");
  const restartCmd = detectRestartCommand();

  console.log(`[mnexus] target:  ${targetDir}`);
  console.log(`[mnexus] backup:  ${backupDir}`);
  console.log(`[mnexus] staging: ${workDir}`);
  if (restartCmd) console.log(`[mnexus] restart: ${restartCmd}`);

  const result = await applyUpdate(info, { targetDir, backupDir, workDir, restartCmd });

  if (!result.ok) {
    console.error(`✗ update failed: ${result.error}`);
    console.error(`  steps: ${result.steps.join(", ")}`);
    process.exit(1);
  }
  console.log(`✓ updated to v${result.toVersion}`);
  console.log(`  backup: ${result.backupPath}`);
  if (restartCmd) {
    console.log(`  restart scheduled`);
  } else {
    console.log(`  ⚠  restart manual: cd ${targetDir} && npm start`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "help";
  const flags = new Set(args.slice(1));
  const pre = flags.has("--pre") || flags.has("--prerelease");

  try {
    switch (cmd) {
      case "version":
      case "--version":
      case "-v":
        await cmdVersion();
        break;
      case "update-check":
        await cmdUpdateCheck(pre);
        break;
      case "update-apply":
        await cmdUpdateApply(pre);
        break;
      case "help":
      case "--help":
      case "-h":
      default:
        help();
    }
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();

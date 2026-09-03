// Tests para el módulo de auto-update del backend.
// Mockea fetch para no depender de la red.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  compareVersions,
  fetchLatestRelease,
  getUpdateInfo,
  getUpdateInfoCached,
  clearUpdateCache,
  applyUpdate,
  downloadFile,
  type ReleaseInfo,
  type UpdateCheckResult,
} from "../src/utils/updateChecker.js";
import { VERSION } from "../src/version.js";
import { mkdtempSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOCK_RELEASE: ReleaseInfo = {
  version: "9.9.9",
  tagName: "v9.9.9",
  publishedAt: "2026-09-03T10:00:00Z",
  releaseUrl: "https://github.com/rgdi/m-nexus/releases/tag/v9.9.9",
  downloadUrl: "https://github.com/rgdi/m-nexus/releases/download/v9.9.9/m-nexus-backend-v9.9.9.zip",
  fileName: "m-nexus-backend-v9.9.9.zip",
  size: 12345,
  body: "## Changes\n- New feature X",
  isPrerelease: false,
};

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("returns -1 when a < b", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.0.0", "1.1.0")).toBe(-1);
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
  });

  it("returns 1 when a > b", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("handles missing components as 0", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBe(-1);
  });

  it("strips prerelease tag", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(0);
  });

  it("handles real versions", () => {
    expect(compareVersions("0.29.1", "0.30.0")).toBe(-1);
    expect(compareVersions(VERSION, "9.9.9")).toBeLessThan(0);
  });
});

describe("fetchLatestRelease", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearUpdateCache();
  });

  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const result = await fetchLatestRelease();
    expect(result).toBeNull();
  });

  it("returns ReleaseInfo on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: "v1.2.3",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://example.com/release",
        body: "release notes",
        prerelease: false,
        assets: [
          { name: "m-nexus-plugin-v1.2.3.zip", browser_download_url: "https://x/plugin.zip", size: 100 },
          { name: "m-nexus-backend-v1.2.3.zip", browser_download_url: "https://x/backend.zip", size: 200 },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    const result = await fetchLatestRelease();
    expect(result).not.toBeNull();
    expect(result?.version).toBe("1.2.3");
    expect(result?.downloadUrl).toBe("https://x/backend.zip");
    expect(result?.fileName).toBe("m-nexus-backend-v1.2.3.zip");
  });

  it("skips prerelease when not allowed", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({
          tag_name: "v2.0.0-beta",
          prerelease: true,
          body: "",
          assets: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify([
        { tag_name: "v2.0.0-beta", prerelease: true, body: "", assets: [] },
        { tag_name: "v1.9.0", prerelease: false, body: "stable", assets: [
          { name: "m-nexus-backend-v1.9.0.zip", browser_download_url: "https://x/b.zip", size: 100 },
        ] },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const result = await fetchLatestRelease(false);
    expect(result?.version).toBe("1.9.0");
  });

  it("includes prerelease when allowed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: "v2.0.0-beta",
        prerelease: true,
        body: "",
        assets: [
          { name: "m-nexus-backend-v2.0.0-beta.zip", browser_download_url: "https://x/b.zip", size: 100 },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    const result = await fetchLatestRelease(true);
    expect(result?.version).toBe("2.0.0-beta");
    expect(result?.isPrerelease).toBe(true);
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const result = await fetchLatestRelease();
    expect(result).toBeNull();
  });

  it("returns null if no backend asset", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: "v1.0.0",
        prerelease: false,
        body: "",
        assets: [{ name: "m-nexus-plugin-v1.0.0.zip", browser_download_url: "x", size: 1 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    const result = await fetchLatestRelease();
    expect(result).toBeNull();
  });
});

describe("getUpdateInfo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearUpdateCache();
  });

  it("returns hasUpdate=true when latest > current", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: MOCK_RELEASE.tagName,
        published_at: MOCK_RELEASE.publishedAt,
        html_url: MOCK_RELEASE.releaseUrl,
        body: MOCK_RELEASE.body,
        prerelease: MOCK_RELEASE.isPrerelease,
        assets: [{ name: MOCK_RELEASE.fileName, browser_download_url: MOCK_RELEASE.downloadUrl, size: MOCK_RELEASE.size }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    const info = await getUpdateInfo();
    expect(info.hasUpdate).toBe(true);
    expect(info.currentVersion).toBe(VERSION);
    expect(info.latestVersion).toBe("9.9.9");
  });

  it("returns hasUpdate=false when at latest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: `v${VERSION}`,
        published_at: "2026-01-01T00:00:00Z",
        html_url: "x",
        body: "",
        prerelease: false,
        assets: [{ name: "m-nexus-backend.zip", browser_download_url: "x", size: 1 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));
    const info = await getUpdateInfo();
    expect(info.hasUpdate).toBe(false);
  });
});

describe("getUpdateInfoCached", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearUpdateCache();
  });

  it("caches results for 5 min", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "x",
        body: "",
        prerelease: false,
        assets: [{ name: "m-nexus-backend.zip", browser_download_url: "x", size: 1 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    await getUpdateInfoCached();
    await getUpdateInfoCached();
    await getUpdateInfoCached();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clearUpdateCache forces re-fetch", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "x",
        body: "",
        prerelease: false,
        assets: [{ name: "m-nexus-backend.zip", browser_download_url: "x", size: 1 }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    await getUpdateInfoCached();
    clearUpdateCache();
    await getUpdateInfoCached();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("downloadFile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a file successfully", async () => {
    const data = Buffer.from("hello world");
    vi.stubGlobal("fetch", vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(data));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Length": String(data.length) } });
    }));
    const tmpDir = mkdtempSync(join(tmpdir(), "dl-"));
    const dest = join(tmpDir, "out.bin");
    let progress = 0;
    await downloadFile("https://x/y", dest, (d) => { progress = d; });
    expect(existsSync(dest)).toBe(true);
    expect(statSync(dest).size).toBe(data.length);
    expect(progress).toBe(data.length);
    rmSync(tmpDir, { recursive: true });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const tmpDir = mkdtempSync(join(tmpdir(), "dl-"));
    await expect(downloadFile("https://x/y", join(tmpDir, "x"))).rejects.toThrow(/HTTP 500/);
    rmSync(tmpDir, { recursive: true });
  });
});

describe("applyUpdate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearUpdateCache();
  });

  it("returns ok=false when no update available", async () => {
    const info: UpdateCheckResult = {
      currentVersion: VERSION,
      latestVersion: VERSION,
      hasUpdate: false,
      releaseUrl: "x",
      downloadUrl: "x",
      fileName: "x",
      size: 0,
      publishedAt: "",
      body: "",
      isPrerelease: false,
    };
    const tmpDir = mkdtempSync(join(tmpdir(), "apply-"));
    const result = await applyUpdate(info, {
      targetDir: tmpDir,
      backupDir: join(tmpDir, "bak"),
      workDir: join(tmpDir, "work"),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_update_available");
    rmSync(tmpDir, { recursive: true });
  });
});

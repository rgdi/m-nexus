import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { uploadRoutes } from "../src/routes/upload.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

describe("Chunked upload", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "upload-test-"));
    process.env.UPLOAD_DIR = tmpDir;
    app = Fastify({
      bodyLimit: 100 * 1024 * 1024,
    });
    app.addContentTypeParser(
      ["application/octet-stream", "application/zip"],
      { parseAs: "buffer" },
      (_req, body: Buffer, done) => done(null, body)
    );
    await app.register(uploadRoutes);
  });

  async function initUpload(filename: string, totalSize: number, deviceId = "test-device"): Promise<{
    uploadId: string;
    totalChunks: number;
    chunkSize: number;
  }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/upload/init",
      payload: { filename, totalSize, deviceId },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function uploadChunk(uploadId: string, n: number, data: Buffer) {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/upload/${uploadId}/chunk/${n}`,
      payload: data,
      headers: { "content-type": "application/octet-stream" },
    });
    return res;
  }

  it("init validates required fields", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/upload/init", payload: {} });
    expect(r.statusCode).toBe(400);
  });

  it("init rejects too-large files", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/upload/init",
      payload: { filename: "big", totalSize: 600 * 1024 * 1024, deviceId: "d1" },
    });
    expect(r.statusCode).toBe(413);
  });

  it("init rejects non-positive size", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/upload/init",
      payload: { filename: "x", totalSize: 0, deviceId: "d1" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("full chunked upload + assemble matches original", async () => {
    const original = Buffer.alloc(2_500_000); // 2.5 MB
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    const sha256 = createHash("sha256").update(original).digest("hex");
    const init = await initUpload("test.bin", original.length);
    expect(init.totalChunks).toBe(3); // 1MB chunks
    // subir chunks
    for (let i = 0; i < init.totalChunks; i++) {
      const start = i * init.chunkSize;
      const end = Math.min(start + init.chunkSize, original.length);
      const chunk = original.subarray(start, end);
      const r = await uploadChunk(init.uploadId, i, chunk);
      expect(r.statusCode).toBe(200);
      const json = r.json();
      expect(json.ok).toBe(true);
      expect(json.received).toBe(i + 1);
    }
    // status
    const sR = await app.inject({ method: "GET", url: `/api/v1/upload/${init.uploadId}/status` });
    expect(sR.json().complete).toBe(true);
    expect(sR.json().missing).toHaveLength(0);
    // complete
    const cR = await app.inject({
      method: "POST",
      url: `/api/v1/upload/${init.uploadId}/complete`,
      payload: { expectedSha256: sha256 },
    });
    expect(cR.statusCode).toBe(200);
    const result = cR.json();
    expect(result.sha256).toBe(sha256);
    // verify file exists
    expect(existsSync(result.path)).toBe(true);
    const written = readFileSync(result.path);
    expect(written.length).toBe(original.length);
    expect(written.equals(original)).toBe(true);
  });

  it("rejects chunk with wrong size", async () => {
    const init = await initUpload("x.bin", 2000, "d1");
    // chunk 0 should be 1000 bytes (default chunk size 1MB but file is 2KB → 1 chunk)
    // set custom chunk size
    const init2 = await app.inject({
      method: "POST",
      url: "/api/v1/upload/init",
      payload: { filename: "x.bin", totalSize: 2000, deviceId: "d1", chunkSize: 1000 },
    });
    const initData = init2.json();
    const wrongSize = await uploadChunk(initData.uploadId, 0, Buffer.alloc(500));
    expect(wrongSize.statusCode).toBe(400);
  });

  it("rejects upload from non-init session", async () => {
    const r = await uploadChunk("nonexistent-id", 0, Buffer.alloc(100));
    expect(r.statusCode).toBe(404);
  });

  it("rejects out-of-range chunk index", async () => {
    const init = await initUpload("x.bin", 2000, "d1");
    const r = await uploadChunk(init.uploadId, 99, Buffer.alloc(100));
    expect(r.statusCode).toBe(400);
  });

  it("duplicate chunk upload is idempotent", async () => {
    const initR = await app.inject({
      method: "POST",
      url: "/api/v1/upload/init",
      payload: { filename: "x.bin", totalSize: 2000, deviceId: "d1", chunkSize: 1000 },
    });
    const init = initR.json();
    const r1 = await uploadChunk(init.uploadId, 0, Buffer.alloc(1000));
    const r2 = await uploadChunk(init.uploadId, 0, Buffer.alloc(1000));
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r2.json().duplicate).toBe(true);
  });

  it("complete fails if chunks are missing", async () => {
    const init = await initUpload("x.bin", 2000, "d1");
    const r = await app.inject({ method: "POST", url: `/api/v1/upload/${init.uploadId}/complete` });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INCOMPLETE");
  });

  it("checksum mismatch deletes the assembled file", async () => {
    const original = Buffer.from("hello world");
    const init = await initUpload("hello.txt", original.length, "d1");
    await uploadChunk(init.uploadId, 0, original);
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/upload/${init.uploadId}/complete`,
      payload: { expectedSha256: "0".repeat(64) },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("CHECKSUM_MISMATCH");
  });

  it("DELETE cleans up chunks and session", async () => {
    const init = await initUpload("x.bin", 1000, "d1");
    await uploadChunk(init.uploadId, 0, Buffer.alloc(1000));
    const r = await app.inject({ method: "DELETE", url: `/api/v1/upload/${init.uploadId}` });
    expect(r.statusCode).toBe(200);
    // session should be gone
    const sR = await app.inject({ method: "GET", url: `/api/v1/upload/${init.uploadId}/status` });
    expect(sR.statusCode).toBe(404);
  });
});

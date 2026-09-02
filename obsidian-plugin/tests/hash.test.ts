import { describe, it, expect } from "vitest";
import { sha256Sync } from "../src/utils/hash";

describe("sha256Sync", () => {
  it("hash vacío coincide con el estándar", () => {
    expect(sha256Sync(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hash de 'abc'", () => {
    const bytes = new TextEncoder().encode("abc");
    expect(sha256Sync(bytes)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hash determinista", () => {
    const a = sha256Sync(new TextEncoder().encode("hola"));
    const b = sha256Sync(new TextEncoder().encode("hola"));
    expect(a).toBe(b);
  });

  it("inputs diferentes → hashes diferentes", () => {
    const a = sha256Sync(new TextEncoder().encode("hola"));
    const b = sha256Sync(new TextEncoder().encode("adios"));
    expect(a).not.toBe(b);
  });

  it("devuelve 64 chars hex", () => {
    const h = sha256Sync(new TextEncoder().encode("cualquier cosa"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

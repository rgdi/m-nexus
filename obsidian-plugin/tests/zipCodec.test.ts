// v0.28: Tests del codec ZIP binario (sin dependencias externas).
//
// Cobertura:
//   - crc32 con valores conocidos
//   - encodeZip + decodeZip roundtrip
//   - Múltiples entries con texto UTF-8
//   - DEFLATE (cuando está disponible)
//   - ZIPs con magic bytes correctos
//   - Edge cases: empty, single entry, binary data

import { describe, it, expect } from "vitest";
import { crc32, encodeZip, decodeZip } from "../src/backup/zipCodec";

describe("zipCodec (v0.28)", () => {
  describe("crc32", () => {
    it("CRC de string vacío = 0", () => {
      expect(crc32(new Uint8Array(0))).toBe(0);
    });

    it("CRC de 'a' = 0xe8b7be43", () => {
      // Vector de test conocido
      const crc = crc32(new TextEncoder().encode("a"));
      expect(crc.toString(16)).toBe("e8b7be43");
    });

    it("CRC de '123456789' = 0xcbf43926 (vector oficial FIPS 180-4)", () => {
      // Test vector del estándar NIST para CRC32 (zip uses same polynomial).
      const crc = crc32(new TextEncoder().encode("123456789"));
      expect(crc.toString(16)).toBe("cbf43926");
    });
  });

  describe("encodeZip", () => {
    it("genera un ZIP con magic bytes PK\\x03\\x04", async () => {
      const zip = await encodeZip([
        { path: "hello.txt", data: new TextEncoder().encode("hello") },
      ]);
      expect(zip[0]).toBe(0x50);
      expect(zip[1]).toBe(0x4b);
      expect(zip[2]).toBe(0x03);
      expect(zip[3]).toBe(0x04);
    });

    it("termina con EOCD (PK\\x05\\x06)", async () => {
      const zip = await encodeZip([
        { path: "a.txt", data: new TextEncoder().encode("a") },
      ]);
      // EOCD es los últimos 22 bytes
      const dv = new DataView(zip.buffer, zip.byteOffset + zip.byteLength - 22);
      const sig = dv.getUint32(0, true);
      expect(sig).toBe(0x06054b50);
    });

    it("encode/decode roundtrip con texto simple", async () => {
      const original = [
        { path: "nota1.md", data: new TextEncoder().encode("# Hola\n\nMundo") },
        { path: "carpeta/nota2.md", data: new TextEncoder().encode("## Subtítulo") },
      ];
      const zip = await encodeZip(original);
      const decoded = await decodeZip(zip);
      expect(decoded.length).toBe(2);
      const byPath = new Map(decoded.map((e) => [e.path, e]));
      // Comparar byte a byte (vitest a veces falla con toEqual en Uint8Array)
      const d1 = byPath.get("nota1.md")?.data;
      const o1 = original[0].data;
      expect(d1?.byteLength).toBe(o1.byteLength);
      expect(Array.from(d1 ?? [])).toEqual(Array.from(o1));
      const d2 = byPath.get("carpeta/nota2.md")?.data;
      const o2 = original[1].data;
      expect(d2?.byteLength).toBe(o2.byteLength);
      expect(Array.from(d2 ?? [])).toEqual(Array.from(o2));
    });

    it("encode/decode roundtrip con datos binarios", async () => {
      const binary = new Uint8Array([0, 1, 2, 3, 255, 254, 253, 128, 64, 32]);
      const original = [{ path: "binary.bin", data: binary }];
      const zip = await encodeZip(original);
      const decoded = await decodeZip(zip);
      expect(decoded.length).toBe(1);
      expect(Array.from(decoded[0].data)).toEqual(Array.from(binary));
    });

    it("maneja UTF-8 en paths y contenido", async () => {
      const original = [
        { path: "Anatomía/Notas/2026-09-07.md", data: new TextEncoder().encode("El corazón ❤️ late") },
      ];
      const zip = await encodeZip(original);
      const decoded = await decodeZip(zip);
      expect(decoded.length).toBe(1);
      expect(decoded[0].path).toBe("Anatomía/Notas/2026-09-07.md");
      expect(new TextDecoder().decode(decoded[0].data)).toBe("El corazón ❤️ late");
    });

    it("múltiples entries preservan orden de CRC y size", async () => {
      const original = [
        { path: "a.md", data: new TextEncoder().encode("aaa") },
        { path: "b.md", data: new TextEncoder().encode("bbbb") },
        { path: "c.md", data: new TextEncoder().encode("ccccc") },
      ];
      const zip = await encodeZip(original);
      const decoded = await decodeZip(zip);
      expect(decoded.length).toBe(3);
      for (let i = 0; i < original.length; i++) {
        expect(decoded[i].path).toBe(original[i].path);
        expect(decoded[i].size).toBe(original[i].data.length);
        expect(decoded[i].crc).toBe(crc32(original[i].data));
      }
    });

    it("STORE method (sin deflate) para archivos pequeños", async () => {
      const small = new TextEncoder().encode("x");
      const zip = await encodeZip([{ path: "x.txt", data: small }]);
      const decoded = await decodeZip(zip);
      // Archivos pequeños: STORE es más eficiente, debe usar method=0
      expect(decoded[0].method).toBe(0);
      expect(decoded[0].compressedSize).toBe(1);
      expect(decoded[0].size).toBe(1);
    });

    it("ZIP vacío sin entries", async () => {
      const zip = await encodeZip([]);
      // Debe tener al menos los 22 bytes del EOCD
      expect(zip.byteLength).toBe(22);
      const dv = new DataView(zip.buffer);
      expect(dv.getUint32(0, true)).toBe(0x06054b50);
    });

    it("size del ZIP es aproximadamente header + data", async () => {
      const data = new TextEncoder().encode("hello world");
      const zip = await encodeZip([{ path: "h.txt", data }]);
      // local header (30) + path (5) + data (11) + central dir (46) + path (5) + EOCD (22)
      // = 119 bytes
      expect(zip.byteLength).toBe(119);
    });
  });

  describe("decodeZip", () => {
    it("rechaza ZIP inválido (sin EOCD)", async () => {
      await expect(decodeZip(new Uint8Array([0, 1, 2, 3]))).rejects.toThrow();
    });
  });
});

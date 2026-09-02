// zipCodec — implementación binaria del formato ZIP (PKZIP) para backups rápidos.
//
// Estrategia: solo soporte STORE (sin compresión) + deflate vía CompressionStream nativo.
// Resultado: bytes .zip estándar, abrible con `unzip`, WinRAR, Finder, etc.
//
// Formato ZIP (simplificado):
//   [Local File Header 1]
//   [File Data 1]
//   [Local File Header 2]
//   [File Data 2]
//   ...
//   [Central Directory Header 1]
//   [Central Directory Header 2]
//   ...
//   [End of Central Directory Record]
//
// Cada header tiene un CRC32 — implementamos CRC32 inline (~20 líneas).

// ── CRC32 (tabla precomputada) ───────────────────────────────────────
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Tipos ────────────────────────────────────────────────────────────
export interface ZipEntry {
  path: string;        // ruta interna (sin leading slash)
  data: Uint8Array;    // contenido binario
  /** v0.28: timestamps. Si no se provee, usa la fecha actual. */
  date?: Date;
  /** v0.28: si es true, usa DEFLATE; si no, STORE. Default = STORE. */
  deflate?: boolean;
}

export interface ZipReadEntry {
  path: string;
  data: Uint8Array;
  size: number;
  compressedSize: number;
  method: 0 | 8;     // 0 = STORE, 8 = DEFLATE
  crc: number;
}

// ── Codificación ─────────────────────────────────────────────────────

const SIG_LOCAL = 0x04034b50;  // PK\x03\x04
const SIG_CENTRAL = 0x02014b50; // PK\x01\x02
const SIG_END = 0x06054b50;     // PK\x05\x06
const VERSION = 20;             // 2.0
const VERSION_NEEDED = 20;
const FLAGS_UTF8 = 0x0800;

function dosTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getSeconds() / 2) & 0x1f);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

async function maybeDeflate(data: Uint8Array): Promise<Uint8Array> {
  // v0.28: deflate-raw vía CompressionStream nativo (no requiere librería).
  // Disponible en Obsidian/Electron 22+ y navegadores modernos.
  // @ts-ignore — CompressionStream puede no estar en lib.dom en algunas versiones.
  if (typeof CompressionStream === "undefined") return data;
  // @ts-ignore
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data as BufferSource);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Codifica una lista de entries en un ZIP binario.
 * - Soporta STORE (sin compresión, instantáneo) y DEFLATE (vía CompressionStream).
 * - Escribe headers CRC32 correctos.
 * - Output abrible con `unzip` / WinRAR / Finder.
 */
export async function encodeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  // 1) Pre-procesar: comprimir si hace falta
  const processed: Array<{
    path: Uint8Array;
    data: Uint8Array;
    compressed: Uint8Array;
    method: 0 | 8;
    crc: number;
    time: number;
    date: number;
  }> = [];

  for (const e of entries) {
    const pathBytes = new TextEncoder().encode(e.path);
    const wantDeflate = e.deflate === true;
    const compressed = wantDeflate ? await maybeDeflate(e.data) : e.data;
    const method: 0 | 8 = wantDeflate && compressed.length < e.data.length ? 8 : 0;
    const dt = dosTime(e.date ?? new Date());
    processed.push({
      path: pathBytes,
      data: e.data,
      compressed,
      method,
      crc: crc32(e.data),
      time: dt.time,
      date: dt.date,
    });
  }

  // 2) Calcular tamaños
  // Local file header = 30 bytes + path
  let localSize = 0;
  let centralSize = 0;
  for (const p of processed) {
    localSize += 30 + p.path.length + p.compressed.length;
    centralSize += 46 + p.path.length;
  }
  const eocdSize = 22;
  const totalSize = localSize + centralSize + eocdSize;
  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);
  let off = 0;

  // 3) Local file headers + data
  for (const p of processed) {
    dv.setUint32(off + 0, SIG_LOCAL, true);
    dv.setUint16(off + 4, VERSION_NEEDED, true);
    dv.setUint16(off + 6, FLAGS_UTF8, true);
    dv.setUint16(off + 8, p.method, true);
    dv.setUint16(off + 10, p.time, true);
    dv.setUint16(off + 12, p.date, true);
    dv.setUint32(off + 14, p.crc, true);
    dv.setUint32(off + 18, p.compressed.length, true);
    dv.setUint32(off + 22, p.data.length, true);
    dv.setUint16(off + 26, p.path.length, true);
    dv.setUint16(off + 28, 0, true); // extra field length
    out.set(p.path, off + 30);
    out.set(p.compressed, off + 30 + p.path.length);
    off += 30 + p.path.length + p.compressed.length;
  }

  // 4) Central directory headers
  // Calculamos los local header offsets sobre la marcha (ya conocemos el layout)
  const centralStart = off;
  const localOffsets: number[] = [];
  let lhCursor = 0;
  for (const p of processed) {
    localOffsets.push(lhCursor);
    lhCursor += 30 + p.path.length + p.compressed.length;
  }

  for (let i = 0; i < processed.length; i++) {
    const p = processed[i];
    dv.setUint32(off + 0, SIG_CENTRAL, true);
    dv.setUint16(off + 4, VERSION, true);
    dv.setUint16(off + 6, VERSION_NEEDED, true);
    dv.setUint16(off + 8, FLAGS_UTF8, true);
    dv.setUint16(off + 10, p.method, true);
    dv.setUint16(off + 12, p.time, true);
    dv.setUint16(off + 14, p.date, true);
    dv.setUint32(off + 16, p.crc, true);
    dv.setUint32(off + 20, p.compressed.length, true);
    dv.setUint32(off + 24, p.data.length, true);
    dv.setUint16(off + 28, p.path.length, true);
    dv.setUint16(off + 30, 0, true);
    dv.setUint16(off + 32, 0, true);
    dv.setUint16(off + 34, 0, true);
    dv.setUint16(off + 36, 0, true);
    dv.setUint32(off + 38, 0, true); // external attrs
    dv.setUint32(off + 42, localOffsets[i], true); // local header offset (absoluto)
    out.set(p.path, off + 46);
    off += 46 + p.path.length;
  }

  // 5) End of central directory
  dv.setUint32(off + 0, SIG_END, true);
  dv.setUint16(off + 4, 0, true);
  dv.setUint16(off + 6, 0, true);
  dv.setUint16(off + 8, processed.length, true);
  dv.setUint16(off + 10, processed.length, true);
  dv.setUint32(off + 12, centralSize, true);
  dv.setUint32(off + 16, localSize, true);
  dv.setUint16(off + 20, 0, true);

  return out;
}

// ── Decodificación ───────────────────────────────────────────────────

/**
 * Lee un ZIP binario y devuelve todas las entries.
 * Soporta STORE y DEFLATE (vía DecompressionStream nativo).
 */
export async function decodeZip(bytes: Uint8Array): Promise<ZipReadEntry[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ZipReadEntry[] = [];

  // 1) Localizar End of Central Directory
  let eocdOff = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
    if (dv.getUint32(i, true) === SIG_END) {
      eocdOff = i;
      break;
    }
  }
  if (eocdOff === -1) throw new Error("ZIP inválido: no se encontró EOCD");

  const totalEntries = dv.getUint16(eocdOff + 10, true);
  const centralSize = dv.getUint32(eocdOff + 12, true);
  const centralStart = dv.getUint32(eocdOff + 16, true);

  // 2) Parsear central directory
  let off = centralStart;
  for (let i = 0; i < totalEntries; i++) {
    if (dv.getUint32(off, true) !== SIG_CENTRAL) throw new Error("ZIP: central dir inválido");
    const method = dv.getUint16(off + 10, true) as 0 | 8;
    const crc = dv.getUint32(off + 16, true);
    const compressedSize = dv.getUint32(off + 20, true);
    const size = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;

    // 3) Parsear local header
    if (dv.getUint32(localOff, true) !== SIG_LOCAL) throw new Error("ZIP: local header inválido");
    const localNameLen = dv.getUint16(localOff + 26, true);
    const localExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = new Uint8Array(compressed);
    } else {
      // @ts-ignore
      if (typeof DecompressionStream === "undefined") {
        throw new Error("DEFLATE requiere DecompressionStream nativo");
      }
      // @ts-ignore
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      writer.write(compressed as BufferSource);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      data = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) {
        data.set(c, pos);
        pos += c.length;
      }
    }

    // Verificar CRC (opcional pero útil para detectar corrupción)
    const actualCrc = crc32(data);
    if (actualCrc !== crc) {
      throw new Error(`CRC mismatch en ${name}: esperado ${crc.toString(16)}, real ${actualCrc.toString(16)}`);
    }

    out.push({ path: name, data, size, compressedSize, method, crc });
  }

  return out;
}

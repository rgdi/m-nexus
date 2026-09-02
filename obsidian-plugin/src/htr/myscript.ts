// MyScript Cloud HTR — API comercial con 2000 requests/mes gratis.
// https://developer.myscript.com/cloud/
//
// Documentación: https://developer.myscript.com/reference/rest/rest-overview/
//
// Requiere:
//   - App key + App secret (gratis en developer.myscript.com)
//   - El cliente genera un HMAC-SHA1 del body con la app key como identificador
//   - POST a https://cloud.myscript.com/api/v4.0/iink/batch con JSON

import { requestUrl } from "obsidian";
import { HTRProvider, HTRResult, HTROptions, renderStrokesToPng, svgToPngBlob } from "./provider";
import { PressureStroke } from "../types";

export interface MyScriptConfig {
  appKey: string;
  appSecret: string;
  baseUrl?: string;
}

export class MyScriptHtrProvider implements HTRProvider {
  readonly id = "myscript";
  readonly name = "MyScript Cloud";
  private hmacCache: { key: string; hmac: string } | null = null;

  constructor(private config: MyScriptConfig) {
    if (!config.baseUrl) config.baseUrl = "https://cloud.myscript.com";
  }

  isConfigured(): boolean {
    return Boolean(this.config.appKey && this.config.appSecret);
  }

  async recognize(strokes: PressureStroke[], options: HTROptions = {}): Promise<HTRResult> {
    if (!this.isConfigured()) throw new Error("MyScript: falta appKey/appSecret en Ajustes.");
    const t0 = Date.now();

    // Renderizar trazos a PNG
    const svgUrl = renderStrokesToPng(strokes, { width: 800, height: 400, scale: 2 });
    const blob = await svgToPngBlob(svgUrl, 1);
    const dataUrl = await blobToDataUrl(blob);

    // Construir body
    const lang = options.language ?? "es";
    const body = {
      configuration: {
        lang,
        export: { "image-resolution": 300 },
      },
      contentType: "Raw Content",
      userResources: [],
      inputs: [
        {
          handWritingComponent: {
            width: 1200,
            height: 600,
            strokeGroups: [
              {
                strokes: strokes.flatMap((s) =>
                  s.points.map((p) => ({ x: p.x, y: p.y, t: p.t ?? 0, p: p.pressure }))
                ).map((p) => ({ pointerEvents: [{ x: p.x, y: p.y, t: p.t, p: p.p }] })),
              },
            ],
          },
          components: { HANDWRITING: { configuration: { lang } } },
        },
      ],
    };

    // Generar HMAC
    const hmac = await this.computeHmac(JSON.stringify(body));

    const res = await requestUrl({
      url: `${this.config.baseUrl}/api/v4.0/iink/batch`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "MyScript-Application-Key": this.config.appKey,
        "MyScript-Hmac": hmac,
      },
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`MyScript ${res.status}: ${res.text.slice(0, 500)}`);
    }
    const json = res.json as { exports?: string[] };
    const text = (json.exports ?? []).join("\n").trim();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    return {
      text,
      confidence: 0.92, // MyScript suele ser muy preciso
      language: lang,
      lines,
      durationMs: Date.now() - t0,
    };
  }

  /** HMAC-SHA1 del body, codificado en base64. Formato MyScript: hex. */
  private async computeHmac(body: string): Promise<string> {
    const cacheKey = `${this.config.appKey}:${body.length}`;
    if (this.hmacCache && this.hmacCache.key === cacheKey) return this.hmacCache.hmac;
    // Usar Web Crypto API
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(this.config.appSecret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const hmac = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    this.hmacCache = { key: cacheKey, hmac };
    return hmac;
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

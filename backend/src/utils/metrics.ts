// Métricas Prometheus en formato OpenMetrics.
// v0.13: counters, gauges e histograms para monitorear el backend.
//
// Exposición: GET /metrics (sin auth, scrape desde Prometheus).
//
// Métricas:
//   - mnexus_http_requests_total{path, method, status}
//   - mnexus_http_request_duration_seconds{path, method}
//   - mnexus_embeddings_cache_hits_total
//   - mnexus_embeddings_cache_misses_total
//   - mnexus_embeddings_cache_size
//   - mnexus_embeddings_computed_total
//   - mnexus_whisper_transcriptions_total
//   - mnexus_whisper_transcription_duration_seconds
//   - mnexus_ocr_images_total
//   - mnexus_llm_chat_total{model, provider}
//   - mnexus_active_devices
//   - mnexus_refresh_tokens_total
//   - mnexus_audit_entries_total
//   - mnexus_process_uptime_seconds

import { logger } from "./log.js";

type Labels = Record<string, string>;

interface Counter {
  type: "counter";
  name: string;
  help: string;
  values: Map<string, number>; // serialized labels -> value
}

interface Gauge {
  type: "gauge";
  name: string;
  help: string;
  values: Map<string, number>;
}

interface Histogram {
  type: "histogram";
  name: string;
  help: string;
  buckets: number[]; // upper bounds en segundos
  observations: Map<string, number[]>; // labels -> array de observaciones
  sums: Map<string, number>;
  counts: Map<string, number>;
}

type Metric = Counter | Gauge | Histogram;

function labelsKey(labels: Labels): string {
  return Object.keys(labels).sort().map((k) => `${k}="${labels[k]}"`).join(",");
}

export class Metrics {
  private metrics = new Map<string, Metric>();
  private startTime = Date.now();

  constructor() {
    this.register({
      type: "counter",
      name: "mnexus_http_requests_total",
      help: "Total HTTP requests",
      values: new Map(),
    });
    this.register({
      type: "histogram",
      name: "mnexus_http_request_duration_seconds",
      help: "HTTP request duration in seconds",
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      observations: new Map(),
      sums: new Map(),
      counts: new Map(),
    });
    this.register({
      type: "counter",
      name: "mnexus_embeddings_cache_hits_total",
      help: "Embedding cache hits",
      values: new Map(),
    });
    this.register({
      type: "counter",
      name: "mnexus_embeddings_cache_misses_total",
      help: "Embedding cache misses",
      values: new Map(),
    });
    this.register({
      type: "gauge",
      name: "mnexus_embeddings_cache_size",
      help: "Number of entries in embedding cache",
      values: new Map(),
    });
    this.register({
      type: "counter",
      name: "mnexus_embeddings_computed_total",
      help: "Embeddings computed by the provider (not from cache)",
      values: new Map(),
    });
    this.register({
      type: "counter",
      name: "mnexus_whisper_transcriptions_total",
      help: "Whisper transcriptions completed",
      values: new Map(),
    });
    this.register({
      type: "histogram",
      name: "mnexus_whisper_transcription_duration_seconds",
      help: "Whisper transcription duration in seconds",
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      observations: new Map(),
      sums: new Map(),
      counts: new Map(),
    });
    this.register({
      type: "counter",
      name: "mnexus_ocr_images_total",
      help: "OCR images processed",
      values: new Map(),
    });
    this.register({
      type: "counter",
      name: "mnexus_llm_chat_total",
      help: "LLM chat completions",
      values: new Map(),
    });
    this.register({
      type: "histogram",
      name: "mnexus_llm_chat_duration_seconds",
      help: "LLM chat duration in seconds",
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
      observations: new Map(),
      sums: new Map(),
      counts: new Map(),
    });
    this.register({
      type: "gauge",
      name: "mnexus_active_devices",
      help: "Number of registered devices",
      values: new Map(),
    });
    this.register({
      type: "gauge",
      name: "mnexus_refresh_tokens_total",
      help: "Number of refresh tokens (active + revoked)",
      values: new Map(),
    });
    this.register({
      type: "gauge",
      name: "mnexus_audit_entries_total",
      help: "Number of audit log entries",
      values: new Map(),
    });
    this.register({
      type: "gauge",
      name: "mnexus_process_uptime_seconds",
      help: "Process uptime in seconds",
      values: new Map(),
    });
    this.register({
      type: "counter",
      name: "mnexus_ws_connections_total",
      help: "WebSocket connections opened",
      values: new Map(),
    });
    this.register({
      type: "counter",
      name: "mnexus_ws_compressed_bytes_total",
      help: "Bytes saved by WS compression (v0.13)",
      values: new Map(),
    });
  }

  private register(m: Metric) {
    this.metrics.set(m.name, m);
  }

  incCounter(name: string, labels: Labels = {}, value = 1) {
    const m = this.metrics.get(name);
    if (!m || m.type !== "counter") return;
    const key = labelsKey(labels);
    m.values.set(key, (m.values.get(key) ?? 0) + value);
  }

  setGauge(name: string, labels: Labels = {}, value: number) {
    const m = this.metrics.get(name);
    if (!m || m.type !== "gauge") return;
    m.values.set(labelsKey(labels), value);
  }

  observeHistogram(name: string, labels: Labels, value: number) {
    const m = this.metrics.get(name);
    if (!m || m.type !== "histogram") return;
    const key = labelsKey(labels);
    m.sums.set(key, (m.sums.get(key) ?? 0) + value);
    m.counts.set(key, (m.counts.get(key) ?? 0) + 1);
    const obs = m.observations.get(key) ?? [];
    obs.push(value);
    m.observations.set(key, obs);
  }

  /** Devuelve snapshot del estado actual para gauges derivados. */
  snapshot(snapshot: {
    activeDevices?: number;
    refreshTokens?: number;
    auditEntries?: number;
    cacheSize?: number;
  }): void {
    if (snapshot.activeDevices !== undefined) {
      this.setGauge("mnexus_active_devices", {}, snapshot.activeDevices);
    }
    if (snapshot.refreshTokens !== undefined) {
      this.setGauge("mnexus_refresh_tokens_total", {}, snapshot.refreshTokens);
    }
    if (snapshot.auditEntries !== undefined) {
      this.setGauge("mnexus_audit_entries_total", {}, snapshot.auditEntries);
    }
    if (snapshot.cacheSize !== undefined) {
      this.setGauge("mnexus_embeddings_cache_size", {}, snapshot.cacheSize);
    }
    this.setGauge("mnexus_process_uptime_seconds", {}, Math.floor((Date.now() - this.startTime) / 1000));
  }

  /** Renderiza en formato Prometheus. */
  render(): string {
    const lines: string[] = [];
    for (const m of this.metrics.values()) {
      lines.push(`# HELP ${m.name} ${m.help}`);
      lines.push(`# TYPE ${m.name} ${m.type}`);
      if (m.type === "counter" || m.type === "gauge") {
        for (const [key, value] of m.values.entries()) {
          const labelStr = key ? `{${key}}` : "";
          lines.push(`${m.name}${labelStr} ${value}`);
        }
      } else if (m.type === "histogram") {
        for (const [key, count] of m.counts.entries()) {
          const labels = parseKey(key);
          const obs = m.observations.get(key) ?? [];
          for (const bucket of m.buckets) {
            const inBucket = obs.filter((o) => o <= bucket).length;
            const bucketLabels = { ...labels, le: String(bucket) };
            lines.push(`${m.name}_bucket{${labelStrFrom(bucketLabels)}} ${inBucket}`);
          }
          // +Inf
          const infLabels = { ...labels, le: "+Inf" };
          lines.push(`${m.name}_bucket{${labelStrFrom(infLabels)}} ${count}`);
          const sum = m.sums.get(key) ?? 0;
          const countLabel = key ? `{${key}}` : "";
          lines.push(`${m.name}_sum${countLabel} ${sum}`);
          lines.push(`${m.name}_count${countLabel} ${count}`);
        }
      }
    }
    return lines.join("\n") + "\n";
  }
}

function parseKey(key: string): Record<string, string> {
  if (!key) return {};
  const result: Record<string, string> = {};
  for (const pair of key.split(",")) {
    const [k, v] = pair.split("=");
    if (k && v) {
      result[k] = v.replace(/^"|"$/g, "");
    }
  }
  return result;
}

function labelStrFrom(labels: Record<string, string>): string {
  return Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",");
}

// Singleton
let _instance: Metrics | null = null;
export function getMetrics(): Metrics {
  if (!_instance) {
    _instance = new Metrics();
    logger.info("Metrics inicializadas");
  }
  return _instance;
}

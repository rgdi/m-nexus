// Tests de métricas Prometheus (counters, gauges, histograms, render).

import { describe, it, expect } from "vitest";
import { Metrics, getMetrics } from "../src/utils/metrics";

describe("Metrics", () => {
  it("counter inc y snapshot", () => {
    const m = new Metrics();
    m.incCounter("mnexus_http_requests_total", { path: "/a", method: "GET" });
    m.incCounter("mnexus_http_requests_total", { path: "/a", method: "GET" });
    m.incCounter("mnexus_http_requests_total", { path: "/b", method: "POST" }, 5);
    const out = m.render();
    expect(out).toContain('mnexus_http_requests_total{method="GET",path="/a"} 2');
    expect(out).toContain('mnexus_http_requests_total{method="POST",path="/b"} 5');
  });

  it("gauge set", () => {
    const m = new Metrics();
    m.setGauge("mnexus_embeddings_cache_size", {}, 42);
    const out = m.render();
    expect(out).toContain("mnexus_embeddings_cache_size 42");
  });

  it("histogram observations + buckets", () => {
    const m = new Metrics();
    m.observeHistogram("mnexus_http_request_duration_seconds", { path: "/x" }, 0.05);
    m.observeHistogram("mnexus_http_request_duration_seconds", { path: "/x" }, 0.5);
    m.observeHistogram("mnexus_http_request_duration_seconds", { path: "/x" }, 5);
    const out = m.render();
    // 0.05 <= 0.05, 0.5 buckets; 0.05+0.5 <= 1; etc.
    expect(out).toContain('mnexus_http_request_duration_seconds_count{path="/x"} 3');
    expect(out).toContain('mnexus_http_request_duration_seconds_sum{path="/x"} 5.55');
    // _bucket{le="0.05"} debe ser 1 (solo el 0.05)
    expect(out).toMatch(/mnexus_http_request_duration_seconds_bucket\{[^}]*le="0\.05"[^}]*\} 1/);
    // _bucket{le="0.5"} debe ser 2 (0.05 y 0.5)
    expect(out).toMatch(/mnexus_http_request_duration_seconds_bucket\{[^}]*le="0\.5"[^}]*\} 2/);
  });

  it("renderiza headers # HELP y # TYPE", () => {
    const m = new Metrics();
    const out = m.render();
    expect(out).toContain("# HELP mnexus_http_requests_total");
    expect(out).toContain("# TYPE mnexus_http_requests_total counter");
    expect(out).toContain("# TYPE mnexus_http_request_duration_seconds histogram");
  });

  it("snapshot aplica gauges derivados", () => {
    const m = new Metrics();
    m.snapshot({ activeDevices: 3, cacheSize: 100, auditEntries: 50 });
    const out = m.render();
    expect(out).toContain("mnexus_active_devices 3");
    expect(out).toContain("mnexus_embeddings_cache_size 100");
    expect(out).toContain("mnexus_audit_entries_total 50");
  });

  it("getMetrics singleton", () => {
    const a = getMetrics();
    const b = getMetrics();
    expect(a).toBe(b);
  });

  it("histogram +Inf bucket incluye todas las observaciones", () => {
    const m = new Metrics();
    for (const v of [0.001, 0.01, 0.1, 1, 10, 100]) {
      m.observeHistogram("mnexus_whisper_transcription_duration_seconds", { model: "x" }, v);
    }
    const out = m.render();
    expect(out).toMatch(/mnexus_whisper_transcription_duration_seconds_bucket\{[^}]*le="\+Inf"[^}]*\} 6/);
  });
});

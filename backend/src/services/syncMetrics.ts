// syncMetrics.ts — In-memory counter for /sync/replay activity (v2.21.0).
//
// Lightweight aggregate that the admin dashboard can query via
// GET /api/v1/sync/metrics. Resets on process restart (we don't persist
// these — they're for observability, not billing/auditing).

export interface SyncReplayMetrics {
  totalReplays: number;
  totalEntriesProcessed: number;
  totalApplied: number;
  totalSuperseded: number;
  totalRejected: number;
  totalDroppedAfterRetries: number;
  lastReplayAt: number;
  lastReplayDeviceId: string;
  /** Per-device replay counts since process start. */
  perDevice: Map<string, number>;
}

const _metrics: SyncReplayMetrics = {
  totalReplays: 0,
  totalEntriesProcessed: 0,
  totalApplied: 0,
  totalSuperseded: 0,
  totalRejected: 0,
  totalDroppedAfterRetries: 0,
  lastReplayAt: 0,
  lastReplayDeviceId: "",
  perDevice: new Map(),
};

export function recordReplay(
  deviceId: string,
  counts: { total: number; applied: number; superseded: number; rejected: number; dropped?: number },
): void {
  _metrics.totalReplays += 1;
  _metrics.totalEntriesProcessed += counts.total;
  _metrics.totalApplied += counts.applied;
  _metrics.totalSuperseded += counts.superseded;
  _metrics.totalRejected += counts.rejected;
  if (counts.dropped) _metrics.totalDroppedAfterRetries += counts.dropped;
  _metrics.lastReplayAt = Date.now();
  _metrics.lastReplayDeviceId = deviceId;
  _metrics.perDevice.set(deviceId, (_metrics.perDevice.get(deviceId) || 0) + 1);
}

export function getSyncMetrics(): SyncReplayMetrics {
  return {
    ..._metrics,
    perDevice: new Map(_metrics.perDevice),
  };
}

/** Reset all counters. Used by tests. */
export function resetSyncMetrics(): void {
  _metrics.totalReplays = 0;
  _metrics.totalEntriesProcessed = 0;
  _metrics.totalApplied = 0;
  _metrics.totalSuperseded = 0;
  _metrics.totalRejected = 0;
  _metrics.totalDroppedAfterRetries = 0;
  _metrics.lastReplayAt = 0;
  _metrics.lastReplayDeviceId = "";
  _metrics.perDevice.clear();
}

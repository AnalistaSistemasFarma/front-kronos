/**
 * Validation of the Service Layer collector payload (POST /api/system-metrics/sap/ingest).
 * Pure: unit tested. Only aggregated metrics get through (no raw log lines, no session ids, no free
 * text beyond names): a row that does not validate is dropped and counted in `skipped`, so one odd
 * log line never blocks the collector (it only advances its offsets when the server answers 2xx).
 */

import type { SlNodeSample } from './analysis';
import type { SlSessionCount, SlViewCall } from './store';

export type IngestPayload = {
  /** Rows dropped because they did not validate (the rest is stored). */
  skipped: number;
  source: string;
  collectedAt: string;
  dryRun: boolean;
  nodes: SlNodeSample[];
  viewCalls: SlViewCall[];
  sessions: SlSessionCount[];
};

const NAME = /^[A-Za-z0-9_.\-]{1,128}$/;
const SERVICE = /^b1s5\d{4}$/i;
const IPV6 = /^[0-9a-f:]{2,45}$/i;
const isIp = (v: unknown): v is string =>
  typeof v === 'string' &&
  (IPV6.test(v) || (v.split('.').length === 4 && v.split('.').every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)));

const int = (v: unknown, max = 2_000_000_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : null;
};
const date = (v: unknown) => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  // Not older than 3 days, not more than 10 min in the future.
  if (!Number.isFinite(t) || t < Date.now() - 3 * 86_400_000 || t > Date.now() + 600_000) return null;
  return new Date(t).toISOString();
};

export function validateIngestPayload(body: unknown): { ok: true; payload: IngestPayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };
  const b = body as Record<string, unknown>;
  const source = typeof b.source === 'string' && NAME.test(b.source) ? b.source : null;
  const collectedAt = date(b.collectedAt);
  if (!source || !collectedAt) return { ok: false, error: 'source o collectedAt inválidos' };
  const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
  if ((Array.isArray(b.viewCalls) && b.viewCalls.length > 2000) || (Array.isArray(b.sessions) && b.sessions.length > 2000)) {
    return { ok: false, error: 'Demasiadas filas' };
  }

  let skipped = 0;
  const nodes: SlNodeSample[] = [];
  for (const raw of arr(b.nodes, 64)) {
    const r = raw as Record<string, unknown>;
    const pid = int(r.pid);
    const handles = int(r.handles, 10_000_000);
    const memMb = int(r.memMb, 10_000_000);
    if (typeof r.service !== 'string' || !SERVICE.test(r.service) || pid == null || handles == null || memMb == null) {
      skipped += 1;
      continue;
    }
    nodes.push({ service: r.service.toLowerCase(), pid, handles, memMb, threads: int(r.threads, 100_000), startedAt: date(r.startedAt) ?? null });
  }

  const viewCalls: SlViewCall[] = [];
  for (const raw of arr(b.viewCalls, 2000)) {
    const r = raw as Record<string, unknown>;
    const bucketAt = date(r.bucketAt);
    const view = typeof r.view === 'string' && NAME.test(r.view) && /B1SLQuery$/i.test(r.view) ? r.view : null;
    const sourceIp = isIp(r.sourceIp) ? r.sourceIp : null;
    const calls = int(r.calls);
    if (!bucketAt || !view || !sourceIp || !calls) {
      skipped += 1;
      continue;
    }
    const company = typeof r.company === 'string' && NAME.test(r.company) ? r.company : null;
    viewCalls.push({
      bucketAt,
      view,
      sourceIp,
      company,
      calls,
      errors: int(r.errors) ?? 0,
      timeouts: int(r.timeouts) ?? 0,
      totalMs: int(r.totalMs, Number.MAX_SAFE_INTEGER) ?? 0,
      maxMs: int(r.maxMs) ?? 0,
      bytes: int(r.bytes, Number.MAX_SAFE_INTEGER) ?? 0,
    });
  }

  const sessions: SlSessionCount[] = [];
  for (const raw of arr(b.sessions, 2000)) {
    const r = raw as Record<string, unknown>;
    const bucketAt = date(r.bucketAt);
    const sourceIp = isIp(r.sourceIp) ? r.sourceIp : null;
    const company = typeof r.company === 'string' && NAME.test(r.company) ? r.company : null;
    const user = typeof r.user === 'string' && NAME.test(r.user) ? r.user : null;
    if (!bucketAt || !sourceIp || !company || !user) {
      skipped += 1;
      continue;
    }
    sessions.push({
      bucketAt,
      sourceIp,
      company,
      user,
      logins: int(r.logins) ?? 0,
      logouts: int(r.logouts) ?? 0,
      restores: int(r.restores) ?? 0,
      failures: int(r.failures) ?? 0,
    });
  }

  return { ok: true, payload: { skipped, source, collectedAt, dryRun: b.dryRun === true, nodes, viewCalls, sessions } };
}

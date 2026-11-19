/**
 * Métricas en memoria de llamadas al SAP Service Layer desde este proceso Node.
 *
 * Sirve al monitor en vivo: concurrencia (llamadas en vuelo + sesiones B1SESSION
 * abiertas por SynerLink), latencia y errores por host+CompanyDB. No persiste:
 * se reinicia con el proceso. Varias instancias (pm2 cluster) tienen cada una
 * su propio contador; el API las muestra como "esta instancia".
 */

export type SapMetricKey = string; // `${host}|${companyDB}`

type Sample = { at: number; durationMs: number; status: number };

type Bucket = {
  key: SapMetricKey;
  host: string;
  companyDB: string;
  inflight: number;
  peakInflight: number;
  samples: Sample[]; // ring reciente (~5 min)
};

export type SapEndpointLiveStats = {
  key: SapMetricKey;
  host: string;
  companyDB: string;
  inflight: number;
  peakInflight: number;
  openSessions: number;
  requests: number;
  errors: number;
  p95Ms: number | null;
  lastAt: number | null;
  lastStatus: number | null;
};

const WINDOW_MS = 5 * 60 * 1000;
const MAX_SAMPLES = 400;

const buckets = new Map<SapMetricKey, Bucket>();
const openSessions = new Map<string, { key: SapMetricKey; openedAt: number; expiresAt: number }>();

export function sapMetricKey(host: string, companyDB: string): SapMetricKey {
  return `${host.toLowerCase()}|${companyDB.trim().toUpperCase()}`;
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '(desconocido)';
  }
}

function getBucket(host: string, companyDB: string): Bucket {
  const key = sapMetricKey(host, companyDB || '(sin-db)');
  let b = buckets.get(key);
  if (!b) {
    b = { key, host, companyDB: companyDB || '(sin-db)', inflight: 0, peakInflight: 0, samples: [] };
    buckets.set(key, b);
  }
  return b;
}

function pruneSamples(b: Bucket, now = Date.now()) {
  const cut = now - WINDOW_MS;
  while (b.samples.length && b.samples[0].at < cut) b.samples.shift();
}

function p95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

function pruneSessions(now = Date.now()) {
  for (const [id, s] of openSessions) {
    if (s.expiresAt <= now) openSessions.delete(id);
  }
}

/** Marca el inicio de una llamada HTTP al Service Layer. Devuelve `end(status)`. */
export function beginSapCall(url: string, companyDB: string): (status: number) => void {
  const host = hostOfUrl(url);
  const b = getBucket(host, companyDB);
  b.inflight += 1;
  if (b.inflight > b.peakInflight) b.peakInflight = b.inflight;
  const t0 = performance.now();
  let done = false;
  return (status: number) => {
    if (done) return;
    done = true;
    b.inflight = Math.max(0, b.inflight - 1);
    const durationMs = performance.now() - t0;
    pruneSamples(b);
    b.samples.push({ at: Date.now(), durationMs, status });
    if (b.samples.length > MAX_SAMPLES) b.samples.splice(0, b.samples.length - MAX_SAMPLES);
  };
}

export function noteSapLogin(sessionId: string, baseUrl: string, companyDB: string, expiresAt: number) {
  const host = hostOfUrl(baseUrl);
  const key = sapMetricKey(host, companyDB);
  getBucket(host, companyDB);
  openSessions.set(sessionId, { key, openedAt: Date.now(), expiresAt });
}

export function noteSapLogout(sessionId: string) {
  openSessions.delete(sessionId);
}

export function getSapLiveStats(): SapEndpointLiveStats[] {
  const now = Date.now();
  pruneSessions(now);

  const sessionCount = new Map<SapMetricKey, number>();
  for (const s of openSessions.values()) {
    sessionCount.set(s.key, (sessionCount.get(s.key) ?? 0) + 1);
  }

  const out: SapEndpointLiveStats[] = [];
  for (const b of buckets.values()) {
    pruneSamples(b, now);
    const last = b.samples.length ? b.samples[b.samples.length - 1] : null;
    const errors = b.samples.filter((s) => s.status === 0 || s.status >= 400).length;
    out.push({
      key: b.key,
      host: b.host,
      companyDB: b.companyDB,
      inflight: b.inflight,
      peakInflight: b.peakInflight,
      openSessions: sessionCount.get(b.key) ?? 0,
      requests: b.samples.length,
      errors,
      p95Ms: p95(b.samples.map((s) => s.durationMs)),
      lastAt: last?.at ?? null,
      lastStatus: last?.status ?? null,
    });
  }

  // Incluir claves que solo tienen sesión abierta sin muestras recientes.
  for (const [key, n] of sessionCount) {
    if (out.some((r) => r.key === key)) continue;
    const [host, companyDB] = key.split('|');
    out.push({
      key,
      host,
      companyDB,
      inflight: 0,
      peakInflight: 0,
      openSessions: n,
      requests: 0,
      errors: 0,
      p95Ms: null,
      lastAt: null,
      lastStatus: null,
    });
  }

  return out.sort((a, b) => a.companyDB.localeCompare(b.companyDB) || a.host.localeCompare(b.host));
}

/** Solo pruebas. */
export function __resetSapCallMetricsForTests() {
  buckets.clear();
  openSessions.clear();
}

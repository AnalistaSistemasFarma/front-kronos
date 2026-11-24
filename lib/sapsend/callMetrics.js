/**
 * Métricas en memoria de llamadas SynerLink → SAPSEND (esta instancia Node).
 *
 * Cadena: SynerLink → SAPSEND → Service Layer → SAP.
 * Aquí solo medimos el primer salto (hacia SAPSEND): concurrencia, latencia y
 * errores por operación (create / files / updateStatus / health).
 */

/** @typedef {'create' | 'files' | 'updateStatus' | 'health' | 'other'} SapsendOp */

/**
 * @typedef {{
 *   op: SapsendOp,
 *   inflight: number,
 *   peakInflight: number,
 *   samples: Array<{ at: number, durationMs: number, status: number }>,
 * }} OpBucket
 */

/**
 * @typedef {{
 *   op: SapsendOp,
 *   inflight: number,
 *   peakInflight: number,
 *   requests: number,
 *   errors: number,
 *   p95Ms: number | null,
 *   lastAt: number | null,
 *   lastStatus: number | null,
 * }} SapsendOpStats
 */

const WINDOW_MS = 5 * 60 * 1000;
const MAX_SAMPLES = 400;

/** @type {Map<SapsendOp, OpBucket>} */
const buckets = new Map();

function getBucket(/** @type {SapsendOp} */ op) {
  let b = buckets.get(op);
  if (!b) {
    b = { op, inflight: 0, peakInflight: 0, samples: [] };
    buckets.set(op, b);
  }
  return b;
}

function prune(/** @type {OpBucket} */ b, now = Date.now()) {
  const cut = now - WINDOW_MS;
  while (b.samples.length && b.samples[0].at < cut) b.samples.shift();
}

function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

/**
 * @param {SapsendOp} op
 * @returns {(status: number) => void}
 */
export function beginSapsendCall(op) {
  const b = getBucket(op);
  b.inflight += 1;
  if (b.inflight > b.peakInflight) b.peakInflight = b.inflight;
  const t0 = performance.now();
  let done = false;
  return (status) => {
    if (done) return;
    done = true;
    b.inflight = Math.max(0, b.inflight - 1);
    prune(b);
    b.samples.push({ at: Date.now(), durationMs: performance.now() - t0, status });
    if (b.samples.length > MAX_SAMPLES) b.samples.splice(0, b.samples.length - MAX_SAMPLES);
  };
}

/**
 * fetch hacia SAPSEND con métricas. `init` puede traer `signal`/timeout propio.
 * @param {SapsendOp} op
 * @param {string} url
 * @param {RequestInit} [init]
 */
export async function sapsendFetch(op, url, init = {}) {
  const end = beginSapsendCall(op);
  try {
    const res = await fetch(url, init);
    end(res.status);
    return res;
  } catch (err) {
    end(0);
    throw err;
  }
}

/** @returns {SapsendOpStats[]} */
export function getSapsendLiveStats() {
  const now = Date.now();
  /** @type {SapsendOpStats[]} */
  const out = [];
  for (const b of buckets.values()) {
    prune(b, now);
    const last = b.samples.length ? b.samples[b.samples.length - 1] : null;
    out.push({
      op: b.op,
      inflight: b.inflight,
      peakInflight: b.peakInflight,
      requests: b.samples.length,
      errors: b.samples.filter((s) => s.status === 0 || s.status >= 400).length,
      p95Ms: p95(b.samples.map((s) => s.durationMs)),
      lastAt: last?.at ?? null,
      lastStatus: last?.status ?? null,
    });
  }
  return out.sort((a, b) => a.op.localeCompare(b.op));
}

export function __resetSapsendCallMetricsForTests() {
  buckets.clear();
}

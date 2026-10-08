/**
 * Acumuladores en memoria del Monitor del sistema (sin dependencias de Node ni de SQL, para
 * poder probarlos). El colector (collector.ts) les pasa cada petición y cada cierto tiempo los
 * "vacía" para guardar el resumen en la base.
 */

/** Percentil sobre un arreglo YA ordenado de menor a mayor (método nearest-rank). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/** Muestras de duración guardadas por clave para calcular el p95 (reservoir sampling). */
const MAX_SAMPLES_PER_KEY = 500;
/** Tope de claves distintas por ventana; el resto se suma en "(otras rutas)". */
const MAX_KEYS = 300;
export const OVERFLOW_KEY = '(otras rutas)';

export type RouteDirection = 'in' | 'out';

type Bucket = {
  direction: RouteDirection;
  key: string;
  module: string;
  requests: number;
  errors: number;
  clientErrors: number;
  throttled: number;
  totalMs: number;
  maxMs: number;
  timed: number;
  samples: number[];
};

export type RouteSummary = {
  direction: RouteDirection;
  key: string;
  module: string;
  requests: number;
  /** Respuestas 5xx o fallas de red. */
  errors: number;
  /** Respuestas 4xx (excepto 429). */
  clientErrors: number;
  /** Respuestas 429 (límite de peticiones del servicio externo). */
  throttled: number;
  totalMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
};

export type RecordInput = {
  direction: RouteDirection;
  key: string;
  module: string;
  /** Duración en ms; `null` si no aplica (p. ej. streams SSE que quedan abiertos minutos). */
  durationMs: number | null;
  /** Código HTTP; `0` o `null` si falló sin respuesta. */
  status: number | null;
};

export class RouteAccumulator {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly random: () => number = Math.random) {}

  record(input: RecordInput): void {
    const mapKey = `${input.direction}\u0000${input.key}`;
    let bucket = this.buckets.get(mapKey);
    if (!bucket) {
      if (this.buckets.size >= MAX_KEYS && input.key !== OVERFLOW_KEY) {
        this.record({ ...input, key: OVERFLOW_KEY, module: 'otros' });
        return;
      }
      bucket = {
        direction: input.direction,
        key: input.key,
        module: input.module,
        requests: 0,
        errors: 0,
        clientErrors: 0,
        throttled: 0,
        totalMs: 0,
        maxMs: 0,
        timed: 0,
        samples: [],
      };
      this.buckets.set(mapKey, bucket);
    }

    bucket.requests += 1;
    const status = input.status ?? 0;
    if (status === 429) bucket.throttled += 1;
    else if (status === 0 || status >= 500) bucket.errors += 1;
    else if (status >= 400) bucket.clientErrors += 1;

    const ms = input.durationMs;
    if (ms == null || !Number.isFinite(ms) || ms < 0) return;
    bucket.timed += 1;
    bucket.totalMs += ms;
    if (ms > bucket.maxMs) bucket.maxMs = ms;
    if (bucket.samples.length < MAX_SAMPLES_PER_KEY) {
      bucket.samples.push(ms);
    } else {
      const slot = Math.floor(this.random() * bucket.timed);
      if (slot < MAX_SAMPLES_PER_KEY) bucket.samples[slot] = ms;
    }
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Devuelve el resumen de la ventana y deja el acumulador vacío. */
  drain(): RouteSummary[] {
    const out: RouteSummary[] = [];
    for (const b of this.buckets.values()) {
      const sorted = [...b.samples].sort((x, y) => x - y);
      out.push({
        direction: b.direction,
        key: b.key,
        module: b.module,
        requests: b.requests,
        errors: b.errors,
        clientErrors: b.clientErrors,
        throttled: b.throttled,
        totalMs: Math.round(b.totalMs),
        maxMs: Math.round(b.maxMs),
        avgMs: b.timed ? Math.round(b.totalMs / b.timed) : 0,
        p95Ms: Math.round(percentile(sorted, 95)),
      });
    }
    this.buckets.clear();
    return out;
  }
}

/**
 * Acumulador simple de duraciones (todas las peticiones entrantes de la ventana) para el
 * p95 global del proceso.
 */
export class DurationWindow {
  private samples: number[] = [];
  private seen = 0;
  requests = 0;
  errors = 0;
  throttled = 0;

  constructor(
    private readonly maxSamples = 2000,
    private readonly random: () => number = Math.random
  ) {}

  add(durationMs: number | null, status: number | null): void {
    this.requests += 1;
    const s = status ?? 0;
    if (s === 429) this.throttled += 1;
    else if (s === 0 || s >= 500) this.errors += 1;
    if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return;
    this.seen += 1;
    if (this.samples.length < this.maxSamples) this.samples.push(durationMs);
    else {
      const slot = Math.floor(this.random() * this.seen);
      if (slot < this.maxSamples) this.samples[slot] = durationMs;
    }
  }

  drain(): { requests: number; errors: number; throttled: number; p95Ms: number } {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const result = {
      requests: this.requests,
      errors: this.errors,
      throttled: this.throttled,
      p95Ms: Math.round(percentile(sorted, 95)),
    };
    this.samples = [];
    this.seen = 0;
    this.requests = 0;
    this.errors = 0;
    this.throttled = 0;
    return result;
  }
}

/** % de CPU usado entre dos lecturas de `os.cpus()` (todos los núcleos). */
export function hostCpuPercent(
  prev: readonly { times: Record<string, number> }[],
  next: readonly { times: Record<string, number> }[]
): number {
  let idle = 0;
  let total = 0;
  const n = Math.min(prev.length, next.length);
  for (let i = 0; i < n; i += 1) {
    const a = prev[i].times;
    const b = next[i].times;
    for (const k of Object.keys(b)) {
      const delta = (b[k] ?? 0) - (a[k] ?? 0);
      total += delta;
      if (k === 'idle') idle += delta;
    }
  }
  if (total <= 0) return 0;
  return round2(((total - idle) / total) * 100);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

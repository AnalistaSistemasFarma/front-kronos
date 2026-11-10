/**
 * Orden del hub de procesos por RECURRENCIA (cuánto abre cada persona cada acceso).
 *
 * - Cada apertura suma 1 punto al acceso (subproceso); el proceso suma los de sus accesos.
 * - Los puntos se van olvidando: valen la mitad cada HALF_LIFE_DAYS días. Así algo que se usó
 *   mucho hace meses va bajando solo, sin tener que borrar nada.
 * - Un proceso/acceso solo sube cuando llega a MIN_USES_TO_PROMOTE puntos: un uso ocasional
 *   no cambia el orden. En empate se conserva el orden de siempre (alfabético del API).
 *
 * Fuente: el servidor (dbo.process_hub_usage, /api/processes/usage). Si la tabla aún no existe
 * se usa el navegador (localStorage), que además sirve de copia para pintar sin esperar.
 */

export const HALF_LIFE_DAYS = 30;
/** Puntos mínimos (≈ aperturas recientes) para que un proceso/acceso suba. */
export const MIN_USES_TO_PROMOTE = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'kronos.processUsage.v3.';
const COMPRESS_KEY = 'kronos.processHub.compressed.v1';
const MAX_ENTRIES = 120;

/** Uso de UN acceso. `score` vale en el momento `lastAt` (luego se olvida con el tiempo). */
export type SubprocessUsage = {
  id_subprocess: number;
  id_process: number;
  score: number;
  count: number;
  lastAt: number;
};

export type UsageIndex = {
  bySubprocess: Map<number, number>;
  byProcess: Map<number, number>;
};

/** Puntos que le quedan hoy a un uso guardado (medio valor cada HALF_LIFE_DAYS). */
export function currentScore(entry: Pick<SubprocessUsage, 'score' | 'lastAt'>, now = Date.now()): number {
  const days = Math.max(0, now - entry.lastAt) / DAY_MS;
  return entry.score * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/** Registra una apertura: lo que quedaba (ya olvidado) + 1. */
export function registerOpen(
  entry: SubprocessUsage | undefined,
  ids: { id_subprocess: number; id_process: number },
  now = Date.now()
): SubprocessUsage {
  return {
    id_subprocess: ids.id_subprocess,
    id_process: ids.id_process,
    score: (entry ? currentScore(entry, now) : 0) + 1,
    count: (entry?.count ?? 0) + 1,
    lastAt: now,
  };
}

/** Puntos de hoy por acceso y por proceso (suma de sus accesos). */
export function buildUsageIndex(entries: SubprocessUsage[], now = Date.now()): UsageIndex {
  const bySubprocess = new Map<number, number>();
  const byProcess = new Map<number, number>();
  for (const e of entries) {
    const score = currentScore(e, now);
    bySubprocess.set(e.id_subprocess, score);
    byProcess.set(e.id_process, (byProcess.get(e.id_process) ?? 0) + score);
  }
  return { bySubprocess, byProcess };
}

/** Peso para ordenar: 0 hasta llegar al mínimo, luego los puntos. */
export function usageScore(score: number | undefined | null): number {
  const value = score ?? 0;
  return value >= MIN_USES_TO_PROMOTE ? value : 0;
}

/**
 * Ordena por recurrencia (más usado primero). En empate se conserva el orden original
 * (sort estable), así abrir algo una vez o de último no lo mueve.
 */
export function sortByRecurrence<T>(items: T[], scoreOf: (item: T) => number | undefined): T[] {
  return [...items].sort((a, b) => usageScore(scoreOf(b)) - usageScore(scoreOf(a)));
}

/* ---------- Copia en el navegador (respaldo si el servidor aún no tiene la tabla) ---------- */

function storageKey(userKey: string): string {
  return `${PREFIX}${String(userKey || 'anon').trim() || 'anon'}`;
}

export function normalizeUsageEntries(raw: unknown): SubprocessUsage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && Number(e.id_subprocess) > 0)
    .map((e) => ({
      id_subprocess: Number(e.id_subprocess),
      id_process: Number(e.id_process) || 0,
      score: Math.max(0, Number(e.score) || 0),
      count: Math.max(0, Number(e.count) || 0),
      lastAt: Number(e.lastAt) || 0,
    }));
}

export function readLocalUsage(userKey: string): SubprocessUsage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userKey));
    return raw ? normalizeUsageEntries(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeLocalUsage(userKey: string, entries: SubprocessUsage[]): void {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    // Se guardan los que más pesan hoy (lo muy viejo se cae solo).
    const kept = [...entries]
      .sort((a, b) => currentScore(b, now) - currentScore(a, now))
      .slice(0, MAX_ENTRIES);
    window.localStorage.setItem(storageKey(userKey), JSON.stringify(kept));
  } catch {
    /* cuota / modo privado */
  }
}

/** Suma una apertura en la copia local y devuelve la lista nueva. */
export function recordLocalOpen(
  userKey: string,
  ids: { id_subprocess: number; id_process: number }
): SubprocessUsage[] {
  const entries = readLocalUsage(userKey);
  const index = entries.findIndex((e) => e.id_subprocess === ids.id_subprocess);
  const next = registerOpen(index >= 0 ? entries[index] : undefined, ids);
  if (index >= 0) entries[index] = next;
  else entries.push(next);
  writeLocalUsage(userKey, entries);
  return entries;
}

/* ---------- Preferencia "Comprimir" (por pestaña) ---------- */

export function readCompressedPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(COMPRESS_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCompressedPreference(compressed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(COMPRESS_KEY, compressed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

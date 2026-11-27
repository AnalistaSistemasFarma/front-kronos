/**
 * AUDITORÍA DE AGENTES → ADOPCIÓN DE IA VS PLANTILLA (Nicolás Rivera, 2026-11-26, conv 1 msgs 40043/40045).
 *
 * Pure rules (no DB, no network): weekly series, growth gap («brecha») and the S-curve fit that estimates
 * when adoption stabilizes. Three diffusion models are fitted to the CUMULATIVE number of people who have
 * used an agent (the classic diffusion series): logistic, Gompertz and Bass. The lowest AIC wins. The
 * confidence band comes from a residual bootstrap of the winning model.
 *
 * The fit is only called «reliable» when there are enough weeks, the inflection point is already behind us
 * and the ceiling is not pinned to the population cap. Otherwise the page says why and still shows the trend.
 */

export type ModelName = "logistica" | "gompertz" | "bass";
export type FitStatus = "confiable" | "incierto" | "sin_inflexion" | "insuficiente";

export const MIN_WEEKS = 8;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ weeks */

/** Monday (UTC) of the week that contains `d`, as YYYY-MM-DD. */
export function weekStart(d: Date | string): string {
  const x = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(x.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}

export function addWeeks(isoMonday: string, n: number): string {
  return new Date(new Date(`${isoMonday}T00:00:00Z`).getTime() + n * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** Every Monday from `from` to `to` (both inclusive, both Mondays). */
export function weekRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let w = from; w <= to; w = addWeeks(w, 1)) out.push(w);
  return out;
}

/* ---------------------------------------------------------- company keys */

/**
 * One key per company across the three sources (SynerLink `company.company`, Microsoft 365 tenant labels
 * and the HR «BASE PERSONAL» sheet), which spell them differently.
 */
export function companyKey(name: string | null | undefined): string {
  const t = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const compact = t.replace(/\s+/g, "");
  if (compact === "OLP" || compact === "ONELATAMPHARMA") return "OLP";
  if (compact.startsWith("ONELATAMONCO")) return "OLPONCO";
  if (compact.startsWith("FARMALOGICA")) return "FARMALOGICA";
  if (compact.includes("RYAN")) return "RYAN";
  return compact;
}

/* --------------------------------------------------------- weekly series */

export interface PersonRow {
  id: string;
  createdAt: Date;
  isActive: boolean;
  /** Last DEACTIVATE in user_audit_log, if any. */
  deactivatedAt: Date | null;
}

export interface UserWeekRow {
  idUser: string;
  week: string; // Monday YYYY-MM-DD
  chatMessages: number;
  projectMessages: number;
}

export interface WeekPoint {
  week: string;
  /** Active SynerLink people at the end of the week. */
  headcount: number;
  /** People who wrote to an agent that week. */
  activeAi: number;
  /** People who have ever written to an agent, up to that week (the fitted series). */
  cumulativeAi: number;
  chatMessages: number;
  projectTurns: number;
  interactions: number;
  /** activeAi ÷ headcount. */
  activeRate: number | null;
  /** interactions ÷ activeAi. */
  interactionsPerActive: number | null;
}

/** Was this person an active SynerLink user at the end of the week starting `week`? */
export function activeAtWeekEnd(p: PersonRow, week: string): boolean {
  const end = new Date(`${addWeeks(week, 1)}T00:00:00Z`);
  if (p.createdAt >= end) return false;
  // Active today: counted from creation (a past deactivation was later undone).
  if (p.isActive) return true;
  // Inactive today: counted only up to the recorded deactivation. Without a record we cannot place it, so
  // it is left out of the whole series (conservative; few rows).
  return !!p.deactivatedAt && p.deactivatedAt >= end;
}

export function buildWeeklySeries(weeks: string[], people: PersonRow[], usage: UserWeekRow[]): WeekPoint[] {
  const allowed = new Set(people.map((p) => p.id));
  const byWeek = new Map<string, UserWeekRow[]>();
  for (const u of usage) {
    if (!allowed.has(u.idUser)) continue;
    const list = byWeek.get(u.week) ?? [];
    list.push(u);
    byWeek.set(u.week, list);
  }
  const seen = new Set<string>();
  return weeks.map((week) => {
    const rows = byWeek.get(week) ?? [];
    const active = new Set(rows.map((r) => r.idUser));
    active.forEach((id) => seen.add(id));
    const chatMessages = rows.reduce((s, r) => s + r.chatMessages, 0);
    const projectTurns = rows.reduce((s, r) => s + r.projectMessages, 0);
    const headcount = people.filter((p) => activeAtWeekEnd(p, week)).length;
    const interactions = chatMessages + projectTurns;
    return {
      week,
      headcount,
      activeAi: active.size,
      cumulativeAi: seen.size,
      chatMessages,
      projectTurns,
      interactions,
      activeRate: headcount > 0 ? active.size / headcount : null,
      interactionsPerActive: active.size > 0 ? interactions / active.size : null,
    };
  });
}

/**
 * «Brecha»: growth of AI usage minus growth of headcount, in percentage points, from the first week with
 * data to the last one. Positive = AI grows faster than the workforce.
 */
export function growthGap(first: number, last: number, hcFirst: number, hcLast: number): number | null {
  if (!(first > 0) || !(hcFirst > 0)) return null;
  return ((last - first) / first - (hcLast - hcFirst) / hcFirst) * 100;
}

/* ------------------------------------------------------------- models */

type Curve = (t: number, th: number[]) => number;

/** Parameters live in log space (except the logistic midpoint) so they stay positive. */
const CURVES: Record<ModelName, Curve> = {
  // K / (1 + e^(-r (t - t0)))
  logistica: (t, [lk, lr, t0]) => Math.exp(lk) / (1 + Math.exp(-Math.exp(lr) * (t - t0))),
  // K e^(-b e^(-c t))
  gompertz: (t, [lk, lb, lc]) => Math.exp(lk) * Math.exp(-Math.exp(lb) * Math.exp(-Math.exp(lc) * t)),
  // Bass cumulative adopters, time shifted by one week so the first observed week is > 0.
  bass: (t, [lm, lp, lq]) => {
    const m = Math.exp(lm);
    const p = Math.exp(lp);
    const q = Math.exp(lq);
    const tt = t + 1;
    const e = Math.exp(-(p + q) * tt);
    return (m * (1 - e)) / (1 + (q / p) * e);
  },
};

function nelderMead(f: (x: number[]) => number, x0: number[], iters = 400, step = 0.5): { x: number[]; fx: number } {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + (Math.abs(v) > 1e-9 ? step * Math.abs(v) * 0.5 + step * 0.5 : step) : v)))];
  let vals = simplex.map(f);
  for (let k = 0; k < iters; k++) {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    simplex = order.map(([, i]) => simplex[i]);
    vals = order.map(([v]) => v);
    if (Math.abs(vals[n] - vals[0]) < 1e-10 * (1 + Math.abs(vals[0]))) break;
    const c = Array.from({ length: n }, (_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const at = (a: number) => c.map((cj, j) => cj + a * (simplex[n][j] - cj));
    const xr = at(-1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = at(-2);
      const fe = f(xe);
      [simplex[n], vals[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < vals[n - 1]) {
      [simplex[n], vals[n]] = [xr, fr];
    } else {
      const xc = at(fr < vals[n] ? -0.5 : 0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, vals[n])) [simplex[n], vals[n]] = [xc, fc];
      else {
        simplex = simplex.map((p, i) => (i === 0 ? p : p.map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]))));
        vals = simplex.map(f);
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], fx: vals[best] };
}

function startsFor(model: ModelName, ys: number[], cap: number): number[][] {
  const n = ys.length;
  const max = Math.max(...ys, 1);
  const ks = [max * 1.05, max * 1.5, max * 2.5, cap].filter((k) => k >= max).map(Math.log);
  const out: number[][] = [];
  for (const lk of ks) {
    if (model === "logistica") for (const r of [0.15, 0.5]) for (const t0 of [0, n / 2, n * 1.5]) out.push([lk, Math.log(r), t0]);
    if (model === "gompertz") for (const b of [0.5, 2, 6]) for (const c of [0.05, 0.3]) out.push([lk, Math.log(b), Math.log(c)]);
    if (model === "bass") for (const p of [0.01, 0.1]) for (const q of [0.1, 0.5]) out.push([lk, Math.log(p), Math.log(q)]);
  }
  return out;
}

interface RawFit {
  model: ModelName;
  theta: number[];
  sse: number;
}

function fitOne(model: ModelName, ys: number[], cap: number, starts?: number[][]): RawFit {
  const curve = CURVES[model];
  const max = Math.max(...ys, 1);
  const loss = (th: number[]) => {
    if (th.some((v) => !Number.isFinite(v))) return 1e18;
    const k = Math.exp(th[0]);
    // The ceiling cannot be below what was already observed nor above the population.
    if (k < max * 0.98 || k > cap * 1.0001) return 1e15 * (1 + Math.abs(Math.log(k / Math.min(Math.max(k, max), cap))));
    let s = 0;
    for (let t = 0; t < ys.length; t++) {
      const d = curve(t, th) - ys[t];
      s += d * d;
    }
    return Number.isFinite(s) ? s : 1e18;
  };
  let best: RawFit = { model, theta: [], sse: Infinity };
  for (const x0 of starts ?? startsFor(model, ys, cap)) {
    const r = nelderMead(loss, x0);
    if (r.fx < best.sse) best = { model, theta: r.x, sse: r.fx };
  }
  return best;
}

const aic = (sse: number, n: number, k = 3) => n * Math.log(Math.max(sse, 1e-9) / n) + 2 * k;

/** Inflection (max slope) and first week reaching 95 % of K, scanned on a fine grid. */
function landmarks(model: ModelName, theta: number[], horizon: number) {
  const curve = CURVES[model];
  const k = Math.exp(theta[0]);
  let tInfl = 0;
  let best = -Infinity;
  let t95: number | null = null;
  for (let t = 0; t <= horizon; t += 0.05) {
    const slope = curve(t + 0.025, theta) - curve(t - 0.025, theta);
    if (slope > best) {
      best = slope;
      tInfl = t;
    }
    if (t95 === null && curve(t, theta) >= 0.95 * k) t95 = t;
  }
  return { k, tInfl, t95 };
}

/** Small deterministic PRNG so the bootstrap is reproducible (and testable). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};

export interface ModelScore {
  model: ModelName;
  aic: number;
  rmse: number;
}

export interface FitResult {
  status: FitStatus;
  /** Short reason in Spanish for the UI. */
  reason: string;
  weeks: number;
  best: ModelName | null;
  scores: ModelScore[];
  /** Ceiling in people, with its 90 % bootstrap interval. */
  k: number | null;
  kLow: number | null;
  kHigh: number | null;
  /** Population used as the cap (latest headcount in scope). */
  cap: number;
  inflectionWeek: string | null;
  inflectionReached: boolean;
  stabilizationWeek: string | null;
  stabilizationLow: string | null;
  stabilizationHigh: string | null;
  /** Fitted / predicted curve with its 90 % band, one point per week from the first observed week. */
  curve: { week: string; fit: number; low: number; high: number }[];
}

export interface FitOptions {
  /** Weeks to project past the last observed week (default 26). */
  horizon?: number;
  /** Bootstrap replicates (default 120). */
  replicates?: number;
  seed?: number;
}

/**
 * Fits the three models to the cumulative-adopters series and returns the winner with its landmarks.
 * `cap` is the population ceiling (people in scope); it bounds K.
 */
export function fitAdoption(firstWeek: string, ys: number[], cap: number, opts: FitOptions = {}): FitResult {
  const n = ys.length;
  const horizon = opts.horizon ?? 26;
  const replicates = opts.replicates ?? 120;
  const safeCap = Math.max(cap, Math.max(...ys, 1));
  const empty: FitResult = {
    status: "insuficiente",
    reason: `Hay ${n} semana${n === 1 ? "" : "s"} con datos; se necesitan al menos ${MIN_WEEKS} para ajustar una curva en S.`,
    weeks: n,
    best: null,
    scores: [],
    k: null,
    kLow: null,
    kHigh: null,
    cap: safeCap,
    inflectionWeek: null,
    inflectionReached: false,
    stabilizationWeek: null,
    stabilizationLow: null,
    stabilizationHigh: null,
    curve: [],
  };
  if (n < MIN_WEEKS || Math.max(...ys) <= 0) return empty;

  const fits = (Object.keys(CURVES) as ModelName[]).map((m) => fitOne(m, ys, safeCap));
  const scores = fits
    .map((f) => ({ model: f.model, aic: aic(f.sse, n), rmse: Math.sqrt(f.sse / n) }))
    .sort((a, b) => a.aic - b.aic);
  const winner = fits.find((f) => f.model === scores[0].model)!;
  const curve = CURVES[winner.model];
  const fitted = ys.map((_, t) => curve(t, winner.theta));
  const resid = ys.map((y, t) => y - fitted[t]);
  const lastT = n - 1;
  const scanTo = lastT + 520;
  const lm = landmarks(winner.model, winner.theta, scanTo);

  // Residual bootstrap of the winner (warm-started from its parameters).
  const rnd = mulberry32(opts.seed ?? 20261126);
  const ks: number[] = [];
  const t95s: number[] = [];
  const total = n + horizon;
  const paths: number[][] = Array.from({ length: total }, () => []);
  for (let b = 0; b < replicates; b++) {
    const yb = fitted.map((f) => Math.max(0, f + resid[Math.floor(rnd() * n)]));
    const fb = fitOne(winner.model, yb, safeCap, [winner.theta]);
    if (!Number.isFinite(fb.sse) || fb.sse >= 1e15) continue;
    const l = landmarks(winner.model, fb.theta, scanTo);
    ks.push(l.k);
    if (l.t95 !== null) t95s.push(l.t95);
    for (let t = 0; t < total; t++) paths[t].push(CURVES[winner.model](t, fb.theta));
  }

  const k = lm.k;
  const kLow = ks.length ? quantile(ks, 0.05) : null;
  const kHigh = ks.length ? quantile(ks, 0.95) : null;
  const inflectionReached = lm.tInfl <= lastT;
  const atCap = k >= safeCap * 0.97;
  const wide = kLow !== null && kHigh !== null && kHigh > 0 && (kHigh - kLow) / k > 0.5;
  const toWeek = (t: number | null) => (t === null || !Number.isFinite(t) ? null : addWeeks(firstWeek, Math.round(t)));

  let status: FitStatus = "confiable";
  let reason =
    lm.tInfl < 1
      ? "La curva ya venía en su fase de frenado desde la primera semana (arranque con usuarios piloto): solo se observa la saturación. El techo refleja a quienes hoy tienen acceso a los agentes."
      : "La adopción ya pasó su punto de inflexión y el techo estimado es estable.";
  if (!inflectionReached) {
    status = "sin_inflexion";
    reason =
      "La curva aún no llega a su punto de inflexión: el techo y la fecha de estabilización no son predecibles todavía. Se muestra la tendencia.";
  } else if (atCap) {
    status = "incierto";
    reason = "El techo estimado toca el total de la plantilla: los datos no permiten ver dónde se frena la adopción.";
  } else if (wide) {
    status = "incierto";
    reason = "La banda de confianza del techo es muy ancha (más del 50 %): la predicción es poco firme.";
  }

  return {
    status,
    reason,
    weeks: n,
    best: winner.model,
    scores,
    k,
    kLow,
    kHigh,
    cap: safeCap,
    inflectionWeek: toWeek(lm.tInfl),
    inflectionReached,
    stabilizationWeek: toWeek(lm.t95),
    stabilizationLow: t95s.length ? toWeek(quantile(t95s, 0.05)) : null,
    stabilizationHigh: t95s.length ? toWeek(quantile(t95s, 0.95)) : null,
    curve: Array.from({ length: total }, (_, t) => ({
      week: addWeeks(firstWeek, t),
      fit: curve(t, winner.theta),
      low: paths[t].length ? quantile(paths[t], 0.05) : curve(t, winner.theta),
      high: paths[t].length ? quantile(paths[t], 0.95) : curve(t, winner.theta),
    })),
  };
}

/* ------------------------------------------------ headcount snapshots */

export type SnapshotSource = "m365" | "th";

export interface SnapshotRow {
  week: string;
  source: SnapshotSource;
  companyKey: string;
  /** Normalized area ('' = whole company). Only the HR base has areas. */
  area: string;
  headcount: number;
}

export const normalizeArea = (t: unknown) =>
  String(t ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/**
 * A licensed Microsoft 365 mailbox counts as a PERSON when its local part has a dot (nombre.apellido@).
 * Shared/functional mailboxes (comex@, notificaciones@, pqrcolombia@…) do not. Heuristic, documented in the UI.
 */
export function isPersonMailbox(email: string): boolean {
  const local = String(email ?? "").split("@")[0] ?? "";
  return local.includes(".");
}

/** Counts per company from the M365 groups (lib/portal/contactos.ts). Companies without access are skipped. */
export function m365Counts(groups: { empresa: string; estado: string; usuarios: { correo: string }[] }[]): Omit<SnapshotRow, "week">[] {
  return groups
    .filter((g) => g.estado === "ok")
    .map((g) => ({
      source: "m365" as const,
      companyKey: companyKey(g.empresa),
      area: "",
      headcount: g.usuarios.filter((u) => isPersonMailbox(u.correo)).length,
    }));
}

/** Counts per company and area from the HR «BASE PERSONAL» rows (already filtered to active people). */
export function thCounts(people: { empresa: string; area: string }[]): Omit<SnapshotRow, "week">[] {
  const map = new Map<string, Omit<SnapshotRow, "week">>();
  for (const p of people) {
    const key = companyKey(p.empresa) || "SIN EMPRESA";
    const area = normalizeArea(p.area);
    const id = `${key}|${area}`;
    const row = map.get(id) ?? { source: "th" as const, companyKey: key, area, headcount: 0 };
    row.headcount += 1;
    map.set(id, row);
  }
  return [...map.values()];
}

/**
 * Weekly series of one snapshot source for the filter. `companyKeys` null = every company; `area` null = every
 * area. M365 has no areas: with an area filter it returns nulls. Weeks without a snapshot stay null (no
 * interpolation: the history starts when the snapshots start).
 */
export function snapshotSeries(
  weeks: string[],
  rows: SnapshotRow[],
  source: SnapshotSource,
  companyKeys: string[] | null,
  area: string | null,
): (number | null)[] {
  if (source === "m365" && area) return weeks.map(() => null);
  const keys = companyKeys ? new Set(companyKeys) : null;
  const byWeek = new Map<string, number>();
  for (const r of rows) {
    if (r.source !== source) continue;
    if (keys && !keys.has(r.companyKey)) continue;
    if (area && r.area !== area) continue;
    byWeek.set(r.week, (byWeek.get(r.week) ?? 0) + r.headcount);
  }
  return weeks.map((w) => (byWeek.has(w) ? byWeek.get(w)! : null));
}

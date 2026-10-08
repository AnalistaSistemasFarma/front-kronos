import { SgcError } from '../errors';

/**
 * CAPACITACIÓN del SGC (Sprint 4, paso 5 del flujo documental, obligatoria
 * para todos los tipos) — funciones PURAS: configuración de la capacitación y
 * lectura del Excel de resultados que exporta Microsoft Forms.
 *
 * Formato esperado (exportación de un cuestionario de Forms a Excel): una fila
 * de encabezados y una fila por respuesta, con al menos el CORREO de quien
 * respondió y el TOTAL DE PUNTOS. Se reconocen los encabezados de Forms en
 * español y en inglés («Correo electrónico» / «Email», «Total de puntos» /
 * «Total points», «Nombre» / «Name», «Hora de finalización» / «Completion
 * time») y una plantilla simple («Correo», «Puntaje» o «Nota»). Forms no
 * exporta el puntaje máximo: lo indica Calidad al registrar la capacitación.
 *
 * Supuesto (el más favorable al trabajador y habitual en Forms): si una
 * persona respondió varias veces, cuenta su MEJOR intento; el número de
 * intentos queda registrado.
 */

export const SGC_TRAINING_MODES = ['video', 'sesion', 'mixta'] as const;
export type SgcTrainingMode = (typeof SGC_TRAINING_MODES)[number];

export const SGC_TRAINING_MODE_LABELS: Record<SgcTrainingMode, string> = {
  video: 'Video',
  sesion: 'Sesión (presencial o virtual)',
  mixta: 'Sesión y video',
};

/** Nota mínima por defecto (porcentaje del puntaje máximo). Supuesto a validar con Calidad. */
export const SGC_TRAINING_DEFAULT_MIN_PCT = 80;

export interface SgcTrainingConfig {
  mode: SgcTrainingMode;
  title: string;
  videoUrl: string | null;
  formsUrl: string | null;
  sessionDate: string | null;
  instructor: string | null;
  maxScore: number;
  minScorePct: number;
  notes: string | null;
}

function optText(value: unknown, label: string, max: number): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  if (s.length > max) throw new SgcError(`${label} admite máximo ${max} caracteres.`);
  return s;
}

/** Solo enlaces https (video en Stream/SharePoint/YouTube, formulario de Forms…). */
export function normalizeHttpsUrl(value: unknown, label: string): string | null {
  const s = optText(value, label, 1000);
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new SgcError(`${label}: el enlace no es válido.`);
  }
  if (u.protocol !== 'https:') throw new SgcError(`${label}: use un enlace https.`);
  return u.toString();
}

/** Valida la configuración de la capacitación que registra Calidad. */
export function normalizeTrainingConfig(raw: unknown): SgcTrainingConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof r.mode !== 'string' || !(SGC_TRAINING_MODES as readonly string[]).includes(r.mode)) {
    throw new SgcError('Indique la modalidad de la capacitación: video, sesión o ambas.');
  }
  const mode = r.mode as SgcTrainingMode;
  const title = optText(r.title, 'El tema', 300);
  if (!title || title.length < 5) throw new SgcError('Escriba el tema de la capacitación (mínimo 5 caracteres).');
  const videoUrl = normalizeHttpsUrl(r.videoUrl, 'El enlace del video');
  const formsUrl = normalizeHttpsUrl(r.formsUrl, 'El enlace de la evaluación (Forms)');
  let sessionDate: string | null = null;
  if (typeof r.sessionDate === 'string' && r.sessionDate.trim()) {
    const d = r.sessionDate.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new SgcError('La fecha de la sesión debe ser AAAA-MM-DD.');
    sessionDate = d;
  }
  if ((mode === 'video' || mode === 'mixta') && !videoUrl) throw new SgcError('Indique el enlace del video de la capacitación.');
  if ((mode === 'sesion' || mode === 'mixta') && !sessionDate) throw new SgcError('Indique la fecha de la sesión de capacitación.');
  if (!formsUrl) throw new SgcError('Indique el enlace de la evaluación en Microsoft Forms.');
  const maxScore = Number(r.maxScore);
  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1000) throw new SgcError('El puntaje máximo de la evaluación debe estar entre 1 y 1000.');
  const minRaw = r.minScorePct === undefined || r.minScorePct === null || r.minScorePct === '' ? SGC_TRAINING_DEFAULT_MIN_PCT : Number(r.minScorePct);
  if (!Number.isFinite(minRaw) || minRaw < 1 || minRaw > 100) throw new SgcError('La nota mínima debe ser un porcentaje entre 1 y 100.');
  return {
    mode,
    title,
    videoUrl,
    formsUrl,
    sessionDate,
    instructor: optText(r.instructor, 'Quien dicta la capacitación', 200),
    maxScore: Math.round(maxScore * 100) / 100,
    minScorePct: Math.round(minRaw * 100) / 100,
    notes: optText(r.notes, 'Las observaciones', 2000),
  };
}

/** Encabezado comparable: minúsculas, sin tildes ni espacios repetidos. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .trim();
}

const EMAIL_HEADERS = ['correo electronico', 'correo', 'email', 'e-mail', 'email address', 'direccion de correo electronico', 'correo institucional'];
const SCORE_HEADERS = ['total de puntos', 'total points', 'puntos totales', 'puntaje', 'puntaje total', 'puntuacion', 'puntuacion total', 'nota', 'calificacion', 'score', 'total score'];
const NAME_HEADERS = ['nombre', 'name', 'nombre completo', 'full name'];
const DONE_HEADERS = ['hora de finalizacion', 'completion time', 'fecha de finalizacion'];

export interface SgcResultColumns {
  email: number;
  score: number;
  name: number | null;
  completedAt: number | null;
}

/** Ubica las columnas del Excel (índices base 0) o explica qué falta. */
export function detectResultColumns(headers: readonly unknown[]): SgcResultColumns {
  const norm = headers.map(normalizeHeader);
  const find = (candidates: string[]) => {
    for (const c of candidates) {
      const i = norm.indexOf(c);
      if (i >= 0) return i;
    }
    return -1;
  };
  const email = find(EMAIL_HEADERS);
  const score = find(SCORE_HEADERS);
  const missing = [email < 0 ? '«Correo electrónico» (o «Email»)' : null, score < 0 ? '«Total de puntos» (o «Total points», «Puntaje», «Nota»)' : null].filter(Boolean);
  if (missing.length) throw new SgcError(`El Excel no tiene la(s) columna(s) ${missing.join(' y ')}. Exporte las respuestas de la evaluación desde Microsoft Forms («Abrir en Excel») sin cambiar los encabezados.`);
  const name = find(NAME_HEADERS);
  const done = find(DONE_HEADERS);
  return { email, score, name: name >= 0 ? name : null, completedAt: done >= 0 ? done : null };
}

/** «8», «8,5» u «8.5» (hasta 6 enteros y 4 decimales, signo opcional). */
function isDecimal(x: string): boolean {
  const pieces = x.split(/[.,]/);
  if (pieces.length > 2) return false;
  const [int, dec] = pieces;
  return /^-?\d{1,6}$/.test(int) && (dec === undefined || /^\d{1,4}$/.test(dec));
}

/** Puntaje de una celda: número, «8,5», «8.5» o «8 / 10» (toma el numerador). */
export function parseScore(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value && typeof value === 'object' && 'result' in (value as Record<string, unknown>)) return parseScore((value as { result: unknown }).result);
  const s = String(value ?? '').trim();
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length > 2 || !isDecimal(parts[0].trim()) || (parts.length === 2 && !isDecimal(parts[1].trim()))) return null;
  const n = Number(parts[0].trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.text === 'string') return v.text;
    if (Array.isArray(v.richText)) return (v.richText as { text?: string }[]).map((x) => x.text ?? '').join('');
    if ('result' in v) return cellText(v.result);
    if (typeof v.hyperlink === 'string') return String(v.hyperlink).replace(/^mailto:/i, '');
  }
  return String(value);
}

export interface SgcTrainingResultRow {
  email: string;
  name: string | null;
  score: number;
  percent: number;
  passed: boolean;
  attempts: number;
  inScope: boolean;
  completedAt: string | null;
}

export interface SgcTrainingEvaluation {
  results: SgcTrainingResultRow[];
  summary: {
    rows: number;
    people: number;
    inScope: number;
    passed: number;
    failed: number;
    outOfScope: number;
    /** Personas del alcance sin resultado en el Excel. */
    missing: string[];
    /** Filas que no se pudieron leer (fila del Excel y motivo). */
    rejected: { row: number; reason: string }[];
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Evalúa las filas del Excel (la primera es el encabezado) contra el alcance
 * de la capacitación y la nota mínima. Aprobado ⇔ puntaje ≥ nota mínima %
 * del puntaje máximo.
 */
export function evaluateTrainingResults(
  rows: readonly (readonly unknown[])[],
  opts: { maxScore: number; minScorePct: number; scopeEmails: readonly string[] }
): SgcTrainingEvaluation {
  if (rows.length < 2) throw new SgcError('El Excel no tiene respuestas (solo encabezados o vacío).');
  if (rows.length > 5001) throw new SgcError('El Excel supera 5.000 respuestas.');
  const cols = detectResultColumns(rows[0]);
  const scope = new Set(opts.scopeEmails.map((e) => e.trim().toLowerCase()));
  const best = new Map<string, SgcTrainingResultRow>();
  const rejected: { row: number; reason: string }[] = [];
  let dataRows = 0;
  rows.slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    if (!r || r.every((c) => cellText(c).trim() === '')) return;
    dataRows++;
    const email = cellText(r[cols.email]).trim().toLowerCase().replace(/^mailto:/, '');
    if (!EMAIL_RE.test(email)) {
      rejected.push({ row: rowNumber, reason: 'correo vacío o inválido' });
      return;
    }
    const score = parseScore(r[cols.score]);
    if (score === null || score < 0) {
      rejected.push({ row: rowNumber, reason: 'puntaje vacío o inválido' });
      return;
    }
    if (score > opts.maxScore) {
      rejected.push({ row: rowNumber, reason: `el puntaje (${score}) supera el máximo configurado (${opts.maxScore})` });
      return;
    }
    const percent = Math.round((score / opts.maxScore) * 1000) / 10;
    const name = cols.name !== null ? cellText(r[cols.name]).trim().slice(0, 255) || null : null;
    const doneRaw = cols.completedAt !== null ? r[cols.completedAt] : null;
    const completedAt = doneRaw instanceof Date ? doneRaw.toISOString() : doneRaw ? cellText(doneRaw).slice(0, 40) || null : null;
    const prev = best.get(email);
    const attempts = (prev?.attempts ?? 0) + 1;
    if (!prev || score > prev.score) {
      best.set(email, { email, name: name ?? prev?.name ?? null, score, percent, passed: percent >= opts.minScorePct, attempts, inScope: scope.has(email), completedAt });
    } else {
      prev.attempts = attempts;
    }
  });
  if (dataRows === 0) throw new SgcError('El Excel no tiene respuestas (solo encabezados o vacío).');
  const results = [...best.values()].sort((a, b) => a.email.localeCompare(b.email));
  const inScope = results.filter((r) => r.inScope);
  return {
    results,
    summary: {
      rows: dataRows,
      people: results.length,
      inScope: inScope.length,
      passed: inScope.filter((r) => r.passed).length,
      failed: inScope.filter((r) => !r.passed).length,
      outOfScope: results.length - inScope.length,
      missing: [...scope].filter((e) => !best.has(e)).sort(),
      rejected,
    },
  };
}

/** ¿Hace falta justificar el cierre de la capacitación? (hay personas del alcance sin aprobar). */
export function trainingNeedsJustification(summary: SgcTrainingEvaluation['summary']): boolean {
  return summary.failed > 0 || summary.missing.length > 0;
}

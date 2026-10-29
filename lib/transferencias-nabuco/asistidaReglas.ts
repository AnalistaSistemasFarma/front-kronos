/**
 * Reglas PURAS de la Transferencia asistida (sin BD ni red): validación de la entrada y
 * orden/filtrado de pendientes. Las usan asistida.ts, las rutas y las pruebas.
 */
import { ASISTIDA } from './constants';
import type { EnvioPrevio } from './seleccion';

export interface DocSap {
  DocEntry: number;
  DocNum?: number | null;
  DocDate?: string | null;
  CardName?: string | null;
  DocTotal?: number | null;
}

export type EstadoLog = 'nuevo' | 'simulado' | 'error' | 'pendiente';

export interface DocPendiente extends DocSap {
  estado_log: EstadoLog;
  intentos: number;
}

export class EntradaInvalida extends Error {}

/** Límite de la búsqueda: por defecto 50, entre 1 y 200. */
export function validarLimite(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return ASISTIDA.limiteDefecto;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return ASISTIDA.limiteDefecto;
  return Math.min(n, ASISTIDA.limiteMax);
}

/** Lista de DocEntry: enteros positivos, sin repetidos (conserva el orden), entre 1 y 200. */
export function validarDocEntries(raw: unknown): number[] {
  if (!Array.isArray(raw) || !raw.length) throw new EntradaInvalida('Seleccione al menos un documento.');
  if (raw.length > ASISTIDA.maxDocs) throw new EntradaInvalida(`Máximo ${ASISTIDA.maxDocs} documentos por solicitud.`);
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new EntradaInvalida(`DocEntry no válido: ${String(v)}`);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function fechaMs(v: string | null | undefined): number {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Quita los enviados/descartados del log, marca el estado de cada uno y ordena del MÁS RECIENTE
 * al más antiguo (DocDate desc, DocEntry desc). Sin repetidos.
 */
export function ordenarPendientes(filas: DocSap[], previos: EnvioPrevio[]): DocPendiente[] {
  const porDoc = new Map(previos.map((p) => [p.doc_entry, p]));
  const vistos = new Set<number>();
  const out: DocPendiente[] = [];
  for (const f of filas) {
    if (!Number.isInteger(f.DocEntry) || vistos.has(f.DocEntry)) continue;
    vistos.add(f.DocEntry);
    const p = porDoc.get(f.DocEntry);
    if (p && (p.estado === 'enviado' || p.estado === 'descartado')) continue;
    const base = f as DocPendiente;
    const estado: EstadoLog = p ? (p.estado as EstadoLog) : (base.estado_log ?? 'nuevo');
    out.push({ ...f, estado_log: estado, intentos: p ? p.intentos : (base.intentos ?? 0) });
  }
  return out.sort((a, b) => fechaMs(b.DocDate) - fechaMs(a.DocDate) || b.DocEntry - a.DocEntry);
}

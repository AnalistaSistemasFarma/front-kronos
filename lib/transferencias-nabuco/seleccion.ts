/**
 * Selección de documentos por corrida (PURO). Reglas de idempotencia:
 *   - enviado / descartado → nunca se vuelve a procesar;
 *   - error → solo si quedan reintentos y ya pasó la espera (proximo_intento);
 *   - simulado → solo cuando la config sale de simulación (entonces se envía de verdad);
 *   - pendiente o sin registro → se procesa.
 * Máximo `loteMax` documentos, en orden de DocEntry ascendente.
 */
import type { NabucoEstado } from './constants';

export interface DocCandidato {
  DocEntry: number;
  DocNum?: number | null;
}

export interface EnvioPrevio {
  doc_entry: number;
  estado: NabucoEstado;
  intentos: number;
  proximo_intento: Date | null;
}

export interface OpcionesSeleccion {
  simulacion: boolean;
  maxReintentos: number;
  loteMax: number;
  ahora: Date;
}

export function debeProcesar(previo: EnvioPrevio | undefined, o: Omit<OpcionesSeleccion, 'loteMax'>): boolean {
  if (!previo) return true;
  switch (previo.estado) {
    case 'enviado':
    case 'descartado':
      return false;
    case 'simulado':
      return !o.simulacion;
    case 'error':
      if (previo.intentos >= o.maxReintentos + 1) return false; // 1 intento + N reintentos
      return !previo.proximo_intento || previo.proximo_intento.getTime() <= o.ahora.getTime();
    case 'pendiente':
    default:
      return !previo.proximo_intento || previo.proximo_intento.getTime() <= o.ahora.getTime();
  }
}

export function seleccionarDocumentos(candidatos: DocCandidato[], previos: EnvioPrevio[], o: OpcionesSeleccion): DocCandidato[] {
  const porDoc = new Map(previos.map((p) => [p.doc_entry, p]));
  const vistos = new Set<number>();
  return [...candidatos]
    .filter((c) => Number.isInteger(c.DocEntry) && !vistos.has(c.DocEntry) && (vistos.add(c.DocEntry), true))
    .sort((a, b) => a.DocEntry - b.DocEntry)
    .filter((c) => debeProcesar(porDoc.get(c.DocEntry), o))
    .slice(0, Math.max(0, o.loteMax));
}

/** ¿Se agotaron los reintentos tras este intento fallido? (para alertar). */
export function reintentosAgotados(intentos: number, maxReintentos: number): boolean {
  return intentos >= maxReintentos + 1;
}

/** Filtro OData de candidatos: fecha mínima + filtro adicional configurado. */
export function filtroCandidatos(desdeFecha: string | null, filtroExtra: string | null): string | null {
  const partes: string[] = [];
  if (desdeFecha && /^\d{4}-\d{2}-\d{2}$/.test(desdeFecha)) partes.push(`DocDate ge '${desdeFecha}'`);
  const extra = (filtroExtra ?? '').trim();
  if (extra) partes.push(`(${extra})`);
  return partes.length ? partes.join(' and ') : null;
}

'use client';

import type { DiagnosticoNabuco } from '../../lib/transferencias-nabuco/diagnostico';

/** Utilidades de cliente de Transferencias Nabuco (reusa el fetch y los formatos de Bitácora de Proceso, como Vitrina). */
export { useOtFetch as useNabucoFetch, fmtFechaHora } from '../bitacora-proceso/otClient';

/** Error de la API con su diagnóstico (de Nabuco/SAP con ok:false, o de SynerLink con su HTTP). */
export class NabucoApiError extends Error {
  status: number;
  diagnostico: DiagnosticoNabuco;
  constructor(status: number, diagnostico: DiagnosticoNabuco) {
    super(diagnostico.mensaje);
    this.name = 'NabucoApiError';
    this.status = status;
    this.diagnostico = diagnostico;
  }
}

/** Diagnóstico de una respuesta fallida de NUESTRA API cuando no trae uno (401/403/404/400…). */
export function diagnosticoApi(status: number, error: string | undefined): DiagnosticoNabuco {
  const mensaje = `SynerLink respondió HTTP ${status}: ${error || (status === 401 ? 'Su sesión expiró.' : 'sin mensaje')}`;
  return { ok: false, etapa: status >= 500 ? 'interno' : 'validacion', mensaje, http_synerlink: status, duracion_ms: 0, cuando: new Date().toISOString() };
}

/** Lee la respuesta: lanza NabucoApiError si HTTP != 2xx o si viene { ok: false, diagnostico }. */
export async function leerRespuesta<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; diagnostico?: DiagnosticoNabuco } & T;
  if (!res.ok) throw new NabucoApiError(res.status, data.diagnostico ? { ...data.diagnostico, http_synerlink: data.diagnostico.http_synerlink ?? res.status } : diagnosticoApi(res.status, data.error));
  if (data.ok === false && data.diagnostico) throw new NabucoApiError(res.status, data.diagnostico);
  return data;
}

export async function nabucoSend<T = unknown>(url: string, method: 'POST' | 'PATCH', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new NabucoApiError(0, { ok: false, etapa: 'red', mensaje: `No se pudo llamar a SynerLink: ${errorTexto(e)}`, duracion_ms: 0, cuando: new Date().toISOString() });
  }
  return leerRespuesta<T>(res);
}

/** Diagnóstico de cualquier error capturado en la UI. */
export function diagnosticoDe(e: unknown): DiagnosticoNabuco {
  if (e instanceof NabucoApiError) return e.diagnostico;
  return { ok: false, etapa: 'interno', mensaje: errorTexto(e), duracion_ms: 0, cuando: new Date().toISOString() };
}

export function errorTexto(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface NabucoCompany {
  idCompany: number;
  companyName: string;
  canLeer: boolean;
  canAdministrar: boolean;
}

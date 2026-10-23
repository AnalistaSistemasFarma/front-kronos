'use client';

import { VITRINA_CANALES, VITRINA_ESTADOS, VITRINA_VISIBILIDADES, CANAL_LABEL, ESTADO_LABEL, VISIBILIDAD_LABEL } from '../../lib/vitrina/constants';

/**
 * Utilidades de cliente de la Vitrina Comercial. Reutiliza el fetch con recarga y los
 * formatos de fecha de Bitácora de Proceso (mismo patrón de SynerLink).
 */
export { useOtFetch as useVitrinaFetch, fmtFecha, fmtFechaHora, haceCuanto } from '../bitacora-proceso/otClient';

export async function vitrinaSend<T = unknown>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error || (res.status === 401 ? 'Su sesión expiró.' : `Error ${res.status}`));
  return data;
}

export function errorTexto(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Aviso de resultado de una acción (arriba, con color). */
export type Aviso = { ok: boolean; text: string } | null;
export type Avisar = (ok: boolean, text: string) => void;

export const OPCIONES_VISIBILIDAD = VITRINA_VISIBILIDADES.map((v) => ({ value: v, label: VISIBILIDAD_LABEL[v] }));
export const OPCIONES_CANAL = VITRINA_CANALES.map((v) => ({ value: v, label: CANAL_LABEL[v] }));
export const OPCIONES_ESTADO = VITRINA_ESTADOS.map((v) => ({ value: v, label: ESTADO_LABEL[v] }));

/** «Meropenem 1 g x10 (MERONEM)». */
export function nombrePresentacion(p: { molecula: string; concentracion?: string | null; unidadesCaja?: number | null; nombreComercial?: string | null }): string {
  const base = [p.molecula, p.concentracion, p.unidadesCaja ? `x${p.unidadesCaja}` : null].filter(Boolean).join(' ');
  return p.nombreComercial ? `${base} (${p.nombreComercial})` : base;
}

/** Catálogo del comercial (vista interna o, con modo «presentacion», la versión para el cliente armada en el servidor). */
export function catalogoUrl(idCompany: number, modo: 'interna' | 'presentacion' = 'interna'): string {
  return `/api/vitrina/catalogo?company=${idCompany}${modo === 'presentacion' ? '&modo=presentacion' : ''}`;
}

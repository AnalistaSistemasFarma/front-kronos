'use client';

/** Utilidades de cliente de Transferencias Nabuco (reusa el fetch y los formatos de Bitácora de Proceso, como Vitrina). */
export { useOtFetch as useNabucoFetch, fmtFechaHora } from '../bitacora-proceso/otClient';

export async function nabucoSend<T = unknown>(url: string, method: 'POST' | 'PATCH', body?: unknown): Promise<T> {
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

export interface NabucoCompany {
  idCompany: number;
  companyName: string;
  canLeer: boolean;
  canAdministrar: boolean;
}

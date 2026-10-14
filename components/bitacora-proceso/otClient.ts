'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OT_TURNO_LABEL, type OtTurno } from '../../lib/bitacora-proceso/constants';

/** Utilidades de cliente de la Bitácora de Proceso (fetch, formato de fechas, enlaces). */

export async function otSend<T = unknown>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export function useOtFetch<T>(url: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async (silent = false) => {
    const u = urlRef.current;
    if (!u) return;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(u, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
      if (!res.ok) throw new Error(body.error || (res.status === 401 ? 'Su sesión expiró.' : `Error ${res.status}`));
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [url, load]);

  useEffect(() => {
    if (!refreshMs || !url) return;
    const t = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load(true);
    }, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, url, load]);

  return { data, error, loading, reload: load };
}

const TZ = 'America/Bogota';

/** Fecha y hora de Colombia (las columnas guardan UTC del servidor). */
export function fmtFechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** Fecha y hora con segundos (cronología del informe). */
export function fmtFechaHoraSeg(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso));
}

export function fmtHora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));
}

export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** «hace 2 h 15 min» desde la apertura. */
export function haceCuanto(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `hace ${h} h ${m} min` : `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export function turnoLabel(t: string): string {
  return OT_TURNO_LABEL[t as OtTurno] ?? t;
}

export function codigoOt(consecutivo: number): string {
  return `BP-${String(consecutivo).padStart(4, '0')}`;
}

export function otHref(path: string, idCompany: number | null | undefined): string {
  return idCompany ? `${path}?empresa=${idCompany}` : path;
}

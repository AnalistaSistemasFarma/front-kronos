'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SgcCompanyAccess } from '../../lib/sgc/permissions';

/**
 * Empresas del SGC de la persona (GET /api/sgc/access) y la empresa elegida.
 * La elección viaja en la URL (?empresa=3) y se recuerda en la pestaña
 * (sessionStorage), para que el listado, el mapa y la ficha sigan en la misma.
 */
export type SgcAccessState =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; companies: SgcCompanyAccess[] };

const STORAGE_KEY = 'sgc-documental:empresa';

function readPreferred(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location.search).get('empresa');
  if (fromUrl) return fromUrl;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useSgcCompany() {
  const [estado, setEstado] = useState<SgcAccessState>({ tipo: 'cargando' });
  const [companyId, setCompanyIdState] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    fetch('/api/sgc/access', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? 'Su sesión expiró.' : 'No se pudo cargar el acceso.');
        return (await res.json()) as { companies: SgcCompanyAccess[] };
      })
      .then((data) => {
        if (!activo) return;
        setEstado({ tipo: 'listo', companies: data.companies });
        const preferred = readPreferred();
        const match = data.companies.find((c) => String(c.idCompany) === preferred) ?? data.companies[0];
        if (match) setCompanyIdState(String(match.idCompany));
      })
      .catch((err: unknown) => {
        if (activo) setEstado({ tipo: 'error', mensaje: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      activo = false;
    };
  }, []);

  const setCompanyId = useCallback((value: string | null) => {
    setCompanyIdState(value);
    try {
      if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* sin almacenamiento: se usa solo la URL */
    }
  }, []);

  const company = useMemo(() => {
    if (estado.tipo !== 'listo') return null;
    return estado.companies.find((c) => String(c.idCompany) === companyId) ?? null;
  }, [estado, companyId]);

  return { estado, company, companyId, setCompanyId };
}

/** Enlace a una página del módulo conservando la empresa elegida. */
export function sgcHref(path: string, idCompany: number | null | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (idCompany) params.set('empresa', String(idCompany));
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

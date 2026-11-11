/**
 * «Qué ve en el portal» de los proveedores o clientes: lo pide al servidor de Kronos, que lo
 * consulta a la API de la landing (lib/api-permissions/portal-terceros.ts → fetchPortalAccess).
 * Lo usan la lista (resumen por fila) y el modal (detalle).
 */
import { MAX_PORTAL_ACCESS_NITS, type PortalAcceso } from '@/lib/api-permissions/subject-rules';

export type { PortalAcceso };

export type PortalAccessState =
  | { status: 'loading' }
  | { status: 'ok'; items: Record<string, PortalAcceso> }
  | { status: 'error' | 'not_configured'; message: string };

const URL_BASE = '/api/administration/api-clients/subjects/portal-terceros/accesos';
const FALLBACK = 'No se pudo consultar la API del portal. Intenta de nuevo.';

export async function loadPortalAccess(nits: string[], signal?: AbortSignal): Promise<PortalAccessState> {
  const unique = [...new Set(nits)];
  if (unique.length === 0) return { status: 'ok', items: {} };
  const items: Record<string, PortalAcceso> = {};
  try {
    for (let i = 0; i < unique.length; i += MAX_PORTAL_ACCESS_NITS) {
      const chunk = unique.slice(i, i + MAX_PORTAL_ACCESS_NITS);
      const res = await fetch(`${URL_BASE}?${new URLSearchParams({ nits: chunk.join(',') }).toString()}`, {
        cache: 'no-store',
        signal,
      });
      const body = (await res.json().catch(() => null)) as
        | { items?: Record<string, PortalAcceso>; error?: string; code?: string }
        | null;
      if (!res.ok || !body?.items) {
        return { status: body?.code === 'not_configured' ? 'not_configured' : 'error', message: body?.error || FALLBACK };
      }
      Object.assign(items, body.items);
    }
    return { status: 'ok', items };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { status: 'error', message: FALLBACK };
  }
}

/** «9 módulos · 2 usuarios». */
export function portalAccessSummary(access: PortalAcceso): string {
  return `${access.modulos} ${access.modulos === 1 ? 'módulo' : 'módulos'} · ${access.usuarios} ${
    access.usuarios === 1 ? 'usuario' : 'usuarios'
  }`;
}

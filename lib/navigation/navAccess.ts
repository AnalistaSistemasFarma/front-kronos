import { fetchWithRetry } from './fetchWithRetry';

/** Permisos del menú del hub, todos en una sola llamada (dashboard-access?kind=all). */
export interface NavAccess {
  solicitante: boolean;
  solicitado: boolean;
  equipo: boolean;
  dashboardAdmin: boolean;
}

export const NO_NAV_ACCESS: NavAccess = {
  solicitante: false,
  solicitado: false,
  equipo: false,
  dashboardAdmin: false,
};

/** Respuesta definitiva del servidor (sí/no) o falla temporal tras los reintentos. */
export type NavAccessResult = { ok: true; access: NavAccess } | { ok: false };

// El menú, el Dashboard y cada página de dashboard pedían lo mismo por separado (hasta 6
// llamadas al entrar). Se comparte una sola petición por usuario durante unos segundos.
const TTL_MS = 30_000;
let cached: { email: string; at: number; promise: Promise<NavAccessResult> } | null = null;

async function load(): Promise<NavAccessResult> {
  const res = await fetchWithRetry('/api/requests-general/dashboard-access?kind=all', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) return { ok: true, access: NO_NAV_ACCESS };
  if (!res.ok) return { ok: false };
  const data = await res.json().catch(() => null);
  if (!data) return { ok: false };
  return {
    ok: true,
    access: {
      solicitante: Boolean(data.solicitante),
      solicitado: Boolean(data.solicitado),
      equipo: Boolean(data.equipo),
      dashboardAdmin: Boolean(data.dashboardAdmin),
    },
  };
}

export function fetchNavAccess(email: string, { fresh = false }: { fresh?: boolean } = {}) {
  const now = Date.now();
  if (!fresh && cached && cached.email === email && now - cached.at < TTL_MS) {
    return cached.promise;
  }
  const promise = load().catch((): NavAccessResult => ({ ok: false }));
  cached = { email, at: now, promise };
  // Una falla no se guarda: el siguiente que pregunte vuelve a intentar.
  void promise.then((result) => {
    if (!result.ok && cached?.promise === promise) cached = null;
  });
  return promise;
}

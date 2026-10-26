'use client';

/**
 * Cliente HTTP del módulo «Proyectos». Todas las llamadas son a la MISMA
 * aplicación, con la cookie de sesión y sin caché. La reja de permisos está en
 * el servidor: aquí solo se traducen las respuestas a algo que la interfaz
 * pueda mostrar arriba y con color.
 */

export type Resultado<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

const ERROR_RED = 'No hay conexión con SynerLink. Revise su red e intente de nuevo.';

async function leer<T>(res: Response, porDefecto: string): Promise<Resultado<T>> {
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    const error = data && typeof data.error === 'string' && data.error ? data.error : porDefecto;
    return { ok: false, status: res.status, error };
  }
  return { ok: true, status: res.status, data: (data ?? ({} as T)) as T };
}

export async function apiGet<T>(url: string, porDefecto = 'No se pudo cargar la información.', signal?: AbortSignal): Promise<Resultado<T>> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal });
    return leer<T>(res, porDefecto);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return { ok: false, status: 0, error: '' };
    return { ok: false, status: 0, error: ERROR_RED };
  }
}

export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  porDefecto = 'No se pudo completar la acción.'
): Promise<Resultado<T>> {
  try {
    const esForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: esForm || body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : esForm ? (body as FormData) : JSON.stringify(body),
    });
    return leer<T>(res, porDefecto);
  } catch {
    return { ok: false, status: 0, error: ERROR_RED };
  }
}

/** Fecha corta en es-CO (13 oct. 2026, 3:45 p. m.). */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) {
    return d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: d.getFullYear() === hoy.getFullYear() ? undefined : 'numeric' });
}

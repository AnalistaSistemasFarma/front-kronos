/**
 * fetch que reintenta solo fallas TEMPORALES: red caída, 404 de una ruta que el servidor de
 * desarrollo aún está compilando, o 5xx. Un 401/403/400 es una respuesta definitiva y se
 * devuelve de inmediato.
 *
 * Existe porque al entrar (sobre todo en local, mientras Next compila) la verificación de
 * permisos fallaba una vez y la pantalla lo tomaba como "sin acceso": redirigía a Procesos.
 */
export function isTransientStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

export async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  { attempts = 3, delayMs = 800 }: { attempts?: number; delayMs?: number } = {}
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(input, init);
      if (!isTransientStatus(res.status) || attempt === attempts) return res;
    } catch (err) {
      if (init?.signal?.aborted) throw err;
      lastError = err;
      if (attempt === attempts) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
  }
  throw lastError ?? new Error('fetchWithRetry: sin respuesta');
}

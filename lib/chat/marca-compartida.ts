/**
 * MAX(id) compartido por instancia para el pulso del chat (app/api/chat/pulse).
 *
 * 2026-10-22, rendimiento: cada pestaña abierta tiene un long-poll que revisaba la base
 * CADA SEGUNDO (MAX de mensajes y de reacciones): con 50 pestañas eran ~100 consultas/s.
 * Igual que marcaGlobalEstados (lib/proyectos/estado-agente-servidor.ts), el valor se
 * comparte entre todas las peticiones de la instancia durante MARCA_PULSO_TTL_MS; solo
 * cuando avanza se hace la consulta filtrada de cada persona. La latencia sigue en ~1 s.
 */
export const MARCA_PULSO_TTL_MS = 900;

type Marca = { cache: { valor: unknown; en: number } | null; enVuelo: Promise<unknown> | null };

const marcas = ((globalThis as Record<string, unknown>).__kronosMarcasPulso ??= {}) as Record<string, Marca>;

export function marcaCompartida<T>(clave: string, leer: () => Promise<T>): Promise<T> {
  const m = (marcas[clave] ??= { cache: null, enVuelo: null });
  const ahora = Date.now();
  if (m.cache && ahora - m.cache.en < MARCA_PULSO_TTL_MS && ahora >= m.cache.en) {
    return Promise.resolve(m.cache.valor as T);
  }
  if (m.enVuelo) return m.enVuelo as Promise<T>;
  const p = leer()
    .then((valor) => {
      m.cache = { valor, en: Date.now() };
      return valor;
    })
    .finally(() => {
      m.enVuelo = null;
    });
  m.enVuelo = p;
  return p;
}

/** Para pruebas. */
export function __reiniciarMarcasPulso(): void {
  for (const k of Object.keys(marcas)) delete marcas[k];
}

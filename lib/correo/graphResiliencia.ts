/**
 * Resiliencia ante el «throttling» de Microsoft Graph (incidente 2026-10-16: «Microsoft limitó las consultas»).
 *
 * Exchange Online limita por app + buzón: ~10.000 peticiones en 10 min y, sobre todo, 4 peticiones
 * CONCURRENTES por buzón (MailboxConcurrency). La app del módulo Correo es la misma del conector
 * mcp-sharepoint-gss, así que su cupo se comparte. Aquí viven dos piezas puras y probadas aparte:
 *
 * - conReintentos: reintenta 429 (y 503 si la operación es idempotente) respetando Retry-After, con
 *   retroceso exponencial y «jitter», hasta 3 reintentos y un presupuesto total de espera.
 * - LimitadorConcurrencia: cola FIFO en memoria por buzón (máx. 3 llamadas a la vez, una menos que el
 *   límite de Exchange para dejar margen a los conectores que comparten la app).
 */

export interface PoliticaReintento {
  /** Reintentos después del primer intento. */
  reintentos: number;
  /** Base del retroceso exponencial cuando Graph no manda Retry-After. */
  baseMs: number;
  /** Tope de una espera; si Graph pide más, no se reintenta (se informa a la persona). */
  maxEsperaMs: number;
  /** Tope de la suma de esperas de una misma petición (la persona ve el esqueleto mientras tanto). */
  presupuestoMs: number;
}

export const POLITICA_GRAPH: PoliticaReintento = { reintentos: 3, baseMs: 500, maxEsperaMs: 10_000, presupuestoMs: 20_000 };

/** Retry-After de Graph: segundos o fecha HTTP. Devuelve ms, o null si no viene o no se entiende. */
export function leerRetryAfter(valor: string | null | undefined, ahora = Date.now()): number | null {
  if (valor == null || String(valor).trim() === '') return null;
  const s = Number(valor);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const fecha = Date.parse(String(valor));
  return Number.isNaN(fecha) ? null : Math.max(0, fecha - ahora);
}

/**
 * Espera antes del reintento `intento` (0 = primer reintento). Con Retry-After se respeta y se suma un
 * jitter pequeño (0–250 ms) para que las peticiones en cola no vuelvan todas a la vez; sin él, retroceso
 * exponencial con «equal jitter»: entre la mitad y el total de base·2^intento.
 */
export function esperaReintento(intento: number, retryAfterMs: number | null, politica: PoliticaReintento = POLITICA_GRAPH, azar: () => number = Math.random): number {
  if (retryAfterMs != null) return Math.round(retryAfterMs + azar() * 250);
  const techo = Math.min(politica.maxEsperaMs, politica.baseMs * 2 ** intento);
  return Math.round(techo / 2 + azar() * (techo / 2));
}

export interface OpcionesReintento {
  politica?: PoliticaReintento;
  /** 503 solo se reintenta si repetir la operación no puede duplicar efectos (GET, PATCH, DELETE, $batch de PATCH). */
  idempotente?: boolean;
  dormir?: (ms: number) => Promise<void>;
  azar?: () => number;
  /** Aviso de cada reintento (para el registro del servidor; sin contenido del correo). */
  alReintentar?: (info: { intento: number; status: number; esperaMs: number }) => void;
}

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function esReintentable(status: number, idempotente: boolean): boolean {
  return status === 429 || (status === 503 && idempotente);
}

/**
 * Ejecuta `intentar` y lo repite mientras Graph responda 429/503 (ver esReintentable). Devuelve la
 * ÚLTIMA respuesta: si se agotan los reintentos, el 429 llega al llamador, que lo traduce al mensaje.
 */
export async function conReintentos(intentar: () => Promise<Response>, o: OpcionesReintento = {}): Promise<Response> {
  const politica = o.politica ?? POLITICA_GRAPH;
  const dormir = o.dormir ?? dormirReal;
  let gastado = 0;
  for (let intento = 0; ; intento++) {
    const res = await intentar();
    if (!esReintentable(res.status, Boolean(o.idempotente)) || intento >= politica.reintentos) return res;
    const ra = leerRetryAfter(res.headers.get('retry-after'));
    if (ra != null && ra > politica.maxEsperaMs) return res;
    const espera = esperaReintento(intento, ra, politica, o.azar);
    if (gastado + espera > politica.presupuestoMs) return res;
    gastado += espera;
    o.alReintentar?.({ intento: intento + 1, status: res.status, esperaMs: espera });
    // El cuerpo de la respuesta descartada se libera (evita sockets colgados en undici).
    await res.body?.cancel().catch(() => undefined);
    await dormir(espera);
  }
}

/** Cola FIFO por clave (buzón) con un máximo de tareas simultáneas por clave. */
export class LimitadorConcurrencia {
  private readonly activos = new Map<string, number>();
  private readonly colas = new Map<string, Array<() => void>>();

  constructor(private readonly max = 3) {}

  /** Tareas en curso para la clave (pruebas y diagnóstico). */
  enCurso(clave: string): number {
    return this.activos.get(clave) ?? 0;
  }

  enEspera(clave: string): number {
    return this.colas.get(clave)?.length ?? 0;
  }

  async correr<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
    await this.entrar(clave);
    try {
      return await tarea();
    } finally {
      this.salir(clave);
    }
  }

  private entrar(clave: string): Promise<void> {
    const n = this.activos.get(clave) ?? 0;
    if (n < this.max) {
      this.activos.set(clave, n + 1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const cola = this.colas.get(clave) ?? [];
      // El cupo se transfiere directamente al siguiente: `activos` no cambia.
      cola.push(resolve);
      this.colas.set(clave, cola);
    });
  }

  private salir(clave: string): void {
    const cola = this.colas.get(clave);
    const siguiente = cola?.shift();
    if (siguiente) {
      if (cola!.length === 0) this.colas.delete(clave);
      siguiente();
      return;
    }
    const n = (this.activos.get(clave) ?? 1) - 1;
    if (n <= 0) this.activos.delete(clave);
    else this.activos.set(clave, n);
  }
}

/** Máximo de llamadas simultáneas a Graph por buzón desde este proceso. */
export const GRAPH_CONCURRENCIA_POR_BUZON = 3;

/** Un limitador por proceso (sobrevive a la recarga de módulos de Next en desarrollo). */
export const limitadorBuzones: LimitadorConcurrencia =
  ((globalThis as Record<string, unknown>).__correoLimitadorBuzones as LimitadorConcurrencia | undefined) ??
  ((globalThis as Record<string, unknown>).__correoLimitadorBuzones = new LimitadorConcurrencia(GRAPH_CONCURRENCIA_POR_BUZON));

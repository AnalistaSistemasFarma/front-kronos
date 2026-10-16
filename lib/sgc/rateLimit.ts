/**
 * Límite de tasa del SGC documental (Sprint 6, endurecimiento) — ventana
 * deslizante EN MEMORIA, por proceso.
 *
 * Protege las rutas caras o enumerables (descarga y estampado del PDF desde
 * OneDrive, verificación, iCal público, solicitudes de acceso) contra ráfagas
 * de una misma persona o IP. Es por instancia de Node: con las 2 instancias de
 * pm2 el techo real es, como mucho, el doble; basta para cortar abusos y no
 * necesita tablas ni servicios nuevos. El límite global del sitio sigue siendo
 * tarea de IIS/ARR (infraestructura).
 */

export interface SgcRateRule {
  /** Peticiones permitidas dentro de la ventana. */
  max: number;
  /** Tamaño de la ventana en milisegundos. */
  windowMs: number;
}

/** Reglas por tipo de ruta (generosas para el uso normal de una persona). */
export const SGC_RATE_RULES = {
  /** Abrir, descargar o imprimir un PDF controlado (descarga de OneDrive + estampado). */
  archivo: { max: 60, windowMs: 60_000 },
  /** Verificar una versión o un código (QR). */
  verificacion: { max: 60, windowMs: 60_000 },
  /** Feed iCal público por token (Outlook lo consulta cada pocos minutos). */
  ical: { max: 30, windowMs: 60_000 },
  /** Crear solicitudes de acceso (notifican a Calidad). */
  solicitudAcceso: { max: 10, windowMs: 10 * 60_000 },
} as const satisfies Record<string, SgcRateRule>;

export type SgcRateBucket = keyof typeof SGC_RATE_RULES;

export interface SgcRateDecision {
  allowed: boolean;
  /** Segundos sugeridos para reintentar (cabecera Retry-After). */
  retryAfterSeconds: number;
}

/** Limitador puro: el reloj se inyecta para probarlo sin esperas. */
export class SgcRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly maxKeys = 10_000) {}

  check(key: string, rule: SgcRateRule, nowMs: number): SgcRateDecision {
    const since = nowMs - rule.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= rule.max) {
      this.hits.set(key, list);
      const retry = Math.max(1, Math.ceil((list[0] + rule.windowMs - nowMs) / 1000));
      return { allowed: false, retryAfterSeconds: retry };
    }
    list.push(nowMs);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune(nowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Quita las claves sin actividad reciente (cota de memoria). */
  prune(nowMs: number, maxWindowMs = 10 * 60_000): void {
    for (const [k, list] of this.hits) {
      if (!list.length || list[list.length - 1] <= nowMs - maxWindowMs) this.hits.delete(k);
    }
    // Si todas siguen activas, se descartan las más antiguas.
    while (this.hits.size > this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first === undefined) break;
      this.hits.delete(first);
    }
  }

  size(): number {
    return this.hits.size;
  }
}

const shared = new SgcRateLimiter();

/** Consulta el limitador compartido del proceso para una persona (o IP) y un tipo de ruta. */
export function checkSgcRate(bucket: SgcRateBucket, who: string, nowMs = Date.now()): SgcRateDecision {
  return shared.check(`${bucket}:${who.trim().toLowerCase()}`, SGC_RATE_RULES[bucket], nowMs);
}

/** Tamaño máximo aceptado de un cuerpo multipart (archivo de 25 MB + campos). */
export const SGC_MAX_UPLOAD_BODY_BYTES = 26 * 1024 * 1024;

/**
 * true si el cuerpo declarado supera el máximo. Se revisa ANTES de leer el
 * formulario, para no cargar en memoria cuerpos enormes de quien no debe.
 */
export function bodyTooLarge(contentLength: string | null, maxBytes = SGC_MAX_UPLOAD_BODY_BYTES): boolean {
  if (contentLength === null || contentLength.trim() === '') return false;
  const n = Number(contentLength);
  return !Number.isFinite(n) || n < 0 || n > maxBytes;
}

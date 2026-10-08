/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — cuándo un material está "REVISADO".
 *
 * Pedido de Cristian Baldión (2026-10-08): la casilla de completado se marca
 * SOLA cuando el usuario revisa todo el material. El navegador reporta lo que
 * vio y el SERVIDOR decide; el cliente no puede autodeclararse "completado"
 * sin más: cada reporte se valida contra el tiempo real transcurrido desde
 * que el servidor registró la apertura del material.
 *
 * Reglas (todas configurables por entorno):
 *
 *   VIDEO (video/*)      Se cuentan los segundos REALMENTE reproducidos (no la
 *                        posición: adelantar no suma, y el reproductor además
 *                        impide saltar hacia adelante y fija la velocidad en
 *                        1×). Completo con ≥ PORTAL_TH_REVISION_VIDEO_PCT %
 *                        de la duración (90 por defecto). El servidor exige
 *                        que desde la apertura haya pasado al menos ese mismo
 *                        tiempo (menos una tolerancia de red).
 *   PDF                  Abierto en el visor del portal un tiempo mínimo
 *                        PROPORCIONAL a sus páginas (el servidor las cuenta):
 *                        PORTAL_TH_REVISION_PDF_SEG_POR_PAGINA × páginas
 *                        (6 s), entre PORTAL_TH_REVISION_PDF_MIN_SEG (15 s) y
 *                        PORTAL_TH_REVISION_PDF_MAX_SEG (300 s). Si no se
 *                        pueden contar las páginas, se usa el máximo.
 *   IMAGEN               Abierta en el visor PORTAL_TH_REVISION_IMAGEN_SEG
 *                        (10 s).
 *   OTROS DOCUMENTOS     Word, Excel y PowerPoint: el navegador no los
 *   (Office)             muestra dentro del portal, así que se abren o
 *                        descargan desde la ventana del material y cuentan
 *                        PORTAL_TH_REVISION_DOC_SEG (30 s) con esa ventana
 *                        abierta.
 *   ENLACE               Abierto (el servidor lo marca al registrar la
 *                        apertura). No hay forma de saber qué hace la persona
 *                        en un sitio externo.
 *
 * El tiempo de los documentos solo corre mientras la ventana del material
 * está abierta y la pestaña visible (lo controla el navegador); el servidor
 * verifica que entre la apertura y el reporte haya pasado al menos el mínimo.
 */

export type TipoRevision = 'video' | 'pdf' | 'imagen' | 'documento' | 'enlace';

export interface ReglaRevision {
  tipo: TipoRevision;
  /** Segundos mínimos con el material abierto (pdf, imagen, documento). */
  segundosMinimos: number;
  /** Fracción de la duración que hay que ver (video). */
  fraccionVideo: number;
}

/** Margen por latencia de red y relojes: unos segundos, nunca más. */
export const TOLERANCIA_SEG = 5;
/** Un video de formación de más de 12 horas es un dato falso. */
export const DURACION_MAXIMA_SEG = 12 * 3600;

function numero(env: NodeJS.ProcessEnv, nombre: string, porDefecto: number, min: number, max: number): number {
  const crudo = (env[nombre] ?? '').trim();
  const n = crudo ? Number(crudo) : Number.NaN;
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(max, Math.max(min, n));
}

export function configuracionRevision(env: NodeJS.ProcessEnv = process.env) {
  return {
    videoPct: numero(env, 'PORTAL_TH_REVISION_VIDEO_PCT', 90, 50, 100),
    pdfSegPorPagina: numero(env, 'PORTAL_TH_REVISION_PDF_SEG_POR_PAGINA', 6, 0, 600),
    pdfMinSeg: numero(env, 'PORTAL_TH_REVISION_PDF_MIN_SEG', 15, 0, 3600),
    pdfMaxSeg: numero(env, 'PORTAL_TH_REVISION_PDF_MAX_SEG', 300, 0, 7200),
    imagenSeg: numero(env, 'PORTAL_TH_REVISION_IMAGEN_SEG', 10, 0, 3600),
    docSeg: numero(env, 'PORTAL_TH_REVISION_DOC_SEG', 30, 0, 3600),
  };
}

/** Qué clase de revisión aplica a un material. */
export function tipoDeRevision(material: { type: string; mime: string | null }): TipoRevision {
  if (material.type === 'LINK') return 'enlace';
  const mime = (material.mime ?? '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'imagen';
  return 'documento';
}

/** La regla concreta de un material (`paginas` solo aplica a PDF). */
export function reglaDeRevision(
  material: { type: string; mime: string | null },
  paginas: number | null,
  env: NodeJS.ProcessEnv = process.env
): ReglaRevision {
  const c = configuracionRevision(env);
  const tipo = tipoDeRevision(material);
  const fraccionVideo = c.videoPct / 100;
  switch (tipo) {
    case 'pdf': {
      // Sin páginas conocidas se usa el máximo: no se regala el completado.
      const tope = Math.max(c.pdfMinSeg, c.pdfMaxSeg);
      const segundos = paginas && paginas > 0 ? Math.min(tope, Math.max(c.pdfMinSeg, paginas * c.pdfSegPorPagina)) : tope;
      return { tipo, segundosMinimos: Math.round(segundos), fraccionVideo };
    }
    case 'imagen':
      return { tipo, segundosMinimos: c.imagenSeg, fraccionVideo };
    case 'documento':
      return { tipo, segundosMinimos: c.docSeg, fraccionVideo };
    default:
      return { tipo, segundosMinimos: 0, fraccionVideo };
  }
}

/** Lo que reporta el navegador al terminar de revisar. */
export interface ReporteRevision {
  /** Video: segundos reproducidos de verdad. Documentos: segundos con la ventana abierta. */
  segundosVistos: number;
  /** Video: duración total en segundos. */
  duracion?: number | null;
}

/** Lee y normaliza el cuerpo JSON del reporte. */
export function leerReporte(cuerpo: unknown): ReporteRevision | null {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const segundosVistos = typeof c.segundosVistos === 'number' ? c.segundosVistos : Number.NaN;
  if (!Number.isFinite(segundosVistos) || segundosVistos < 0) return null;
  const duracion = c.duracion === undefined || c.duracion === null ? null : Number(c.duracion);
  if (duracion !== null && !Number.isFinite(duracion)) return null;
  return { segundosVistos, duracion };
}

/**
 * ¿El reporte es suficiente Y plausible?
 * `transcurridos` = segundos entre la apertura (registrada por el servidor) y
 * este reporte.
 */
export function validarRevision(
  regla: ReglaRevision,
  reporte: ReporteRevision,
  transcurridos: number
): { ok: true } | { ok: false; error: string } {
  if (regla.tipo === 'enlace') return { ok: true };

  if (regla.tipo === 'video') {
    const duracion = reporte.duracion ?? 0;
    if (!(duracion > 0) || duracion > DURACION_MAXIMA_SEG) {
      return { ok: false, error: 'No se pudo confirmar la duración del video.' };
    }
    if (reporte.segundosVistos > duracion + TOLERANCIA_SEG) {
      return { ok: false, error: 'El tiempo visto reportado no corresponde con la duración del video.' };
    }
    const requeridos = duracion * regla.fraccionVideo;
    if (reporte.segundosVistos + 0.5 < requeridos) {
      return { ok: false, error: `Aún no ha visto el ${Math.round(regla.fraccionVideo * 100)} % del video.` };
    }
    if (transcurridos + TOLERANCIA_SEG < requeridos) {
      return { ok: false, error: 'El video se reportó como visto en menos tiempo del que dura. Véalo completo, por favor.' };
    }
    return { ok: true };
  }

  if (reporte.segundosVistos + 0.5 < regla.segundosMinimos) {
    return { ok: false, error: `Revise el material al menos ${regla.segundosMinimos} segundos.` };
  }
  if (transcurridos + TOLERANCIA_SEG < regla.segundosMinimos) {
    return { ok: false, error: 'El material se reportó como revisado en menos tiempo del mínimo.' };
  }
  return { ok: true };
}

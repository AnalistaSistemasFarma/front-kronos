/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — cuándo un material está "REVISADO".
 *
 * Pedido de Cristian Baldión (2026-10-08): la casilla de completado se marca
 * SOLA cuando el usuario revisa el material. El SERVIDOR decide; el cliente no
 * puede autodeclararse "completado" sin más.
 *
 * AJUSTE del mismo día (Cristian, 2026-10-08): "en los tiempos que colocas
 * para cada material no coloques un límite de tiempo, que el usuario lo pueda
 * abrir y él mismo decida cuándo cerrarlo". Por eso los documentos ya NO
 * tienen tiempo mínimo: se marcan en cuanto se abren.
 *
 * Reglas (todas configurables por entorno):
 *
 *   VIDEO (video/*)      SIN CAMBIOS: no es un tiempo sino ver el contenido.
 *                        Se cuentan los segundos REALMENTE reproducidos (no la
 *                        posición: adelantar no suma, y el reproductor además
 *                        impide saltar hacia adelante y fija la velocidad en
 *                        1×). Completo con ≥ PORTAL_TH_REVISION_VIDEO_PCT %
 *                        de la duración (90 por defecto). El servidor exige
 *                        que desde la apertura haya pasado al menos ese mismo
 *                        tiempo (menos una tolerancia de red).
 *   PDF, IMAGEN y        SIN TIEMPO MÍNIMO por defecto: el servidor los marca
 *   OTROS DOCUMENTOS     al registrar la apertura en el visor
 *   (Word, Excel, PPT…)  (`POST .../vista`), igual que un enlace. La persona
 *                        cierra la ventana cuando quiera.
 *   ENLACE               Abierto (el servidor lo marca al registrar la
 *                        apertura).
 *
 * Las variables de los documentos se conservan, ahora con valor por defecto
 * 0 (= sin mínimo):
 *   PORTAL_TH_REVISION_PDF_SEG_POR_PAGINA, PORTAL_TH_REVISION_PDF_MIN_SEG,
 *   PORTAL_TH_REVISION_PDF_MAX_SEG, PORTAL_TH_REVISION_IMAGEN_SEG,
 *   PORTAL_TH_REVISION_DOC_SEG.
 * Antes eran 6 s/página (entre 15 y 300 s), 10 s y 30 s. Si alguna vez se les
 * vuelve a poner un valor mayor que 0, el visor cuenta ese tiempo y lo
 * reporta; aun así el servidor ya no compara contra el reloj transcurrido
 * desde la apertura para los documentos (esa validación se retiró con el
 * ajuste: solo se mantiene para el video).
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
    // Documentos: 0 = sin tiempo mínimo, se marcan al abrir (Cristian, 2026-10-08).
    pdfSegPorPagina: numero(env, 'PORTAL_TH_REVISION_PDF_SEG_POR_PAGINA', 0, 0, 600),
    pdfMinSeg: numero(env, 'PORTAL_TH_REVISION_PDF_MIN_SEG', 0, 0, 3600),
    pdfMaxSeg: numero(env, 'PORTAL_TH_REVISION_PDF_MAX_SEG', 0, 0, 7200),
    imagenSeg: numero(env, 'PORTAL_TH_REVISION_IMAGEN_SEG', 0, 0, 3600),
    docSeg: numero(env, 'PORTAL_TH_REVISION_DOC_SEG', 0, 0, 3600),
  };
}

/** ¿Hace falta contar las páginas del PDF? Solo si se configuró un tiempo para PDF. */
export function pdfRequierePaginas(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = configuracionRevision(env);
  return c.pdfSegPorPagina > 0 || c.pdfMinSeg > 0 || c.pdfMaxSeg > 0;
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
      // Sin páginas conocidas se usa el máximo (con los valores por defecto, 0).
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

/**
 * ¿El material se da por revisado con solo ABRIRLO? Enlaces siempre; los
 * documentos (PDF, imagen, Office…) cuando no tienen tiempo mínimo, que es lo
 * normal desde el ajuste del 2026-10-08. El video nunca.
 */
export function seMarcaAlAbrir(regla: ReglaRevision): boolean {
  if (regla.tipo === 'enlace') return true;
  if (regla.tipo === 'video') return false;
  return regla.segundosMinimos <= 0;
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
 * este reporte. Solo se usa para el VIDEO.
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

  // Documentos: ya no se valida el tiempo transcurrido en el servidor (ajuste
  // 2026-10-08). Solo si por entorno se configuró un mínimo > 0 se exige que
  // el reporte del visor lo alcance; con el valor por defecto (0) siempre pasa.
  if (reporte.segundosVistos + 0.5 < regla.segundosMinimos) {
    return { ok: false, error: `Revise el material al menos ${regla.segundosMinimos} segundos.` };
  }
  return { ok: true };
}

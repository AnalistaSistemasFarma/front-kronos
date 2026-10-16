/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — cuándo un material está "REVISADO".
 *
 * Pedido de Cristian Baldión (2026-10-08): la casilla de completado se marca
 * SOLA cuando el usuario revisa el material. El SERVIDOR decide; el cliente no
 * puede autodeclararse "completado" sin más.
 *
 * Ajustes del mismo día (Cristian, 2026-10-08):
 *   1. "en los tiempos que colocas para cada material no coloques un límite de
 *      tiempo, que el usuario lo pueda abrir y él mismo decida cuándo
 *      cerrarlo" → los documentos ya NO tienen tiempo mínimo.
 *   2. Videos: "que se abran en una ventana de vista previa así como los PDF;
 *      quítale la opción de que puedan adelantar el video y colócale un
 *      contador que sea equivalente al tiempo del video, para que cuando él
 *      detecte que llegó al límite marque la actividad como completada" →
 *      100 % visto (antes 90 %).
 *   3. PDF: "que salgan en vista previa, y si es de más de una página, que
 *      salga una barra que se vaya llenando de 0 a 100 % cada vez que el
 *      usuario le dé clic a un botón (…) para pasar la página" → se completa
 *      al llegar a la última página con el botón.
 *
 * Reglas (configurables por entorno donde se indica):
 *
 *   VIDEO (video/*)      Se cuentan los segundos REALMENTE reproducidos (no la
 *                        posición: adelantar no suma, el reproductor no tiene
 *                        barra para saltar y fija la velocidad en 1×; el
 *                        contador no corre en pausa ni con la pestaña oculta).
 *                        Completo con ≥ PORTAL_TH_REVISION_VIDEO_PCT % de la
 *                        duración: 100 por defecto (antes 90). El servidor
 *                        exige además que desde la apertura haya pasado al
 *                        menos ese mismo tiempo, con TOLERANCIA_SEG de margen.
 *   PDF                  Una página a la vez, con botones. Si tiene más de una
 *                        página, se completa cuando el visor reporta haber
 *                        llegado a la ÚLTIMA (página máxima vista = páginas que
 *                        el servidor contó). Si tiene una sola, se completa al
 *                        abrirlo.
 *   IMAGEN y OTROS       SIN TIEMPO MÍNIMO por defecto: el servidor los marca
 *   DOCUMENTOS           al registrar la apertura (`POST .../vista`), igual que
 *   (Word, Excel, PPT…)  un enlace. La persona cierra cuando quiera.
 *   ENLACE               Abierto (el servidor lo marca al registrar la
 *                        apertura).
 *
 * Variables de tiempo de documentos, conservadas con valor por defecto 0
 * (= sin mínimo): PORTAL_TH_REVISION_PDF_SEG_POR_PAGINA,
 * PORTAL_TH_REVISION_PDF_MIN_SEG, PORTAL_TH_REVISION_PDF_MAX_SEG,
 * PORTAL_TH_REVISION_IMAGEN_SEG y PORTAL_TH_REVISION_DOC_SEG (antes 6 s por
 * página entre 15 y 300 s, 10 s y 30 s). Si se les pone un valor > 0, el visor
 * cuenta ese tiempo y lo reporta; el servidor ya no lo compara contra el reloj
 * transcurrido desde la apertura (esa validación quedó solo para el video).
 */

export type TipoRevision = 'video' | 'pdf' | 'imagen' | 'documento' | 'enlace';

export interface ReglaRevision {
  tipo: TipoRevision;
  /** Segundos mínimos con el material abierto (pdf, imagen, documento). 0 = sin mínimo. */
  segundosMinimos: number;
  /** Fracción de la duración que hay que ver (video). */
  fraccionVideo: number;
  /** PDF: páginas que contó el servidor (null si no se pudo o no aplica). */
  paginas: number | null;
}

/** Margen por latencia de red y relojes entre apertura y reporte: unos segundos, nunca más. */
export const TOLERANCIA_SEG = 5;
/** Margen del contador del video frente a su duración (redondeo del reproductor). */
export const TOLERANCIA_VIDEO_SEG = 1;
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
    // Video: 100 % (el contador debe llegar a la duración), ajuste 2026-10-08.
    videoPct: numero(env, 'PORTAL_TH_REVISION_VIDEO_PCT', 100, 50, 100),
    // Documentos: 0 = sin tiempo mínimo (ajuste 2026-10-08).
    pdfSegPorPagina: numero(env, 'PORTAL_TH_REVISION_PDF_SEG_POR_PAGINA', 0, 0, 600),
    pdfMinSeg: numero(env, 'PORTAL_TH_REVISION_PDF_MIN_SEG', 0, 0, 3600),
    pdfMaxSeg: numero(env, 'PORTAL_TH_REVISION_PDF_MAX_SEG', 0, 0, 7200),
    imagenSeg: numero(env, 'PORTAL_TH_REVISION_IMAGEN_SEG', 0, 0, 3600),
    docSeg: numero(env, 'PORTAL_TH_REVISION_DOC_SEG', 0, 0, 3600),
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
      const conocidas = paginas && paginas > 0 ? paginas : null;
      // Sin páginas conocidas se usa el máximo (con los valores por defecto, 0).
      const tope = Math.max(c.pdfMinSeg, c.pdfMaxSeg);
      const segundos = conocidas ? Math.min(tope, Math.max(c.pdfMinSeg, conocidas * c.pdfSegPorPagina)) : tope;
      return { tipo, segundosMinimos: Math.round(segundos), fraccionVideo, paginas: conocidas };
    }
    case 'imagen':
      return { tipo, segundosMinimos: c.imagenSeg, fraccionVideo, paginas: null };
    case 'documento':
      return { tipo, segundosMinimos: c.docSeg, fraccionVideo, paginas: null };
    default:
      return { tipo, segundosMinimos: 0, fraccionVideo, paginas: null };
  }
}

/**
 * ¿El material se da por revisado con solo ABRIRLO?
 * - Enlace: siempre.
 * - Imagen y otros documentos: cuando no tienen tiempo mínimo (lo normal).
 * - PDF: cuando el servidor contó UNA sola página (y no hay tiempo mínimo).
 *   Con varias páginas, o si no se pudieron contar, decide el visor al llegar
 *   a la última.
 * - Video: nunca.
 */
export function seMarcaAlAbrir(regla: ReglaRevision): boolean {
  if (regla.tipo === 'enlace') return true;
  if (regla.tipo === 'video') return false;
  if (regla.tipo === 'pdf' && regla.paginas !== 1) return false;
  return regla.segundosMinimos <= 0;
}

/** Lo que reporta el navegador al terminar de revisar. */
export interface ReporteRevision {
  /** Video: segundos reproducidos de verdad. Documentos: segundos con la ventana abierta. */
  segundosVistos: number;
  /** Video: duración total en segundos. */
  duracion?: number | null;
  /** PDF: la página más alta a la que llegó con el botón "Página siguiente". */
  paginaMaxima?: number | null;
  /** PDF: total de páginas según el visor (solo se usa si el servidor no las pudo contar). */
  paginasTotales?: number | null;
}

function enteroOpcional(v: unknown): number | null | undefined {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Lee y normaliza el cuerpo JSON del reporte. */
export function leerReporte(cuerpo: unknown): ReporteRevision | null {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const segundosVistos = typeof c.segundosVistos === 'number' ? c.segundosVistos : Number.NaN;
  if (!Number.isFinite(segundosVistos) || segundosVistos < 0) return null;
  const duracion = c.duracion === undefined || c.duracion === null ? null : Number(c.duracion);
  if (duracion !== null && !Number.isFinite(duracion)) return null;
  const paginaMaxima = enteroOpcional(c.paginaMaxima);
  const paginasTotales = enteroOpcional(c.paginasTotales);
  if (paginaMaxima === undefined || paginasTotales === undefined) return null;
  return { segundosVistos, duracion, paginaMaxima, paginasTotales };
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
    if (reporte.segundosVistos + TOLERANCIA_VIDEO_SEG < requeridos) {
      return {
        ok: false,
        error:
          regla.fraccionVideo >= 1
            ? 'Aún no ha visto el video completo.'
            : `Aún no ha visto el ${Math.round(regla.fraccionVideo * 100)} % del video.`,
      };
    }
    if (transcurridos + TOLERANCIA_SEG < requeridos) {
      return { ok: false, error: 'El video se reportó como visto en menos tiempo del que dura. Véalo completo, por favor.' };
    }
    return { ok: true };
  }

  if (regla.tipo === 'pdf') {
    // Las páginas que cuenta el servidor mandan; si no las pudo contar, se usa
    // el total que leyó el visor (mejor esfuerzo).
    const total = regla.paginas ?? reporte.paginasTotales ?? null;
    if (!total || total < 1) return { ok: false, error: 'No se pudo confirmar el número de páginas del documento.' };
    if (total > 1 && (reporte.paginaMaxima ?? 0) < total) {
      return { ok: false, error: `Avance con "Página siguiente" hasta la página ${total}.` };
    }
    if ((reporte.paginaMaxima ?? 0) > total) {
      return { ok: false, error: 'La página reportada no corresponde con el documento.' };
    }
  }

  // Documentos: sin validación del reloj del servidor (ajuste 2026-10-08).
  // Solo si por entorno se configuró un mínimo > 0 se exige que el reporte del
  // visor lo alcance; con el valor por defecto (0) siempre pasa.
  if (reporte.segundosVistos + 0.5 < regla.segundosMinimos) {
    return { ok: false, error: `Revise el material al menos ${regla.segundosMinimos} segundos.` };
  }
  return { ok: true };
}

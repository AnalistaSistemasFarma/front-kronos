/**
 * PORTAL TH · FORMACIÓN — cálculos del VISOR de materiales (lado navegador).
 *
 * Funciones puras, sin React, para poder probarlas aparte (ajustes de
 * Cristian Baldión, 2026-10-08): video sin adelantar con contador, y PDF
 * página por página con barra de lectura.
 */

/** Margen para no pelear con el redondeo del reproductor al buscar. */
export const MARGEN_BUSQUEDA_SEG = 1;

/**
 * A dónde se deja ir el video cuando la persona busca: hacia atrás, a donde
 * quiera; hacia adelante, nunca más allá de lo ya visto.
 */
export function posicionPermitida(pedida: number, maximoVisto: number): number {
  if (!Number.isFinite(pedida) || pedida < 0) return 0;
  return pedida > maximoVisto + MARGEN_BUSQUEDA_SEG ? maximoVisto : pedida;
}

/**
 * Cuánto suma un `timeupdate` al contador. Solo cuenta reproducción real:
 * a 1×, con la pestaña visible, sin saltos (un delta grande es una búsqueda,
 * no tiempo visto).
 */
export function segundosQueSuman(delta: number, opciones: { velocidad: number; visible: boolean; pausado: boolean }): number {
  if (opciones.pausado || !opciones.visible || opciones.velocidad !== 1) return 0;
  return delta > 0 && delta <= 1.5 ? delta : 0;
}

/** "mm:ss" (o "h:mm:ss" si pasa de una hora). */
export function reloj(segundos: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(segundos) ? segundos : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

/** Contador del video: visto real frente a duración, p. ej. "02:15 / 05:40". */
export function contadorVideo(vistos: number, duracion: number): string {
  return `${reloj(Math.min(vistos, duracion || vistos))} / ${reloj(duracion)}`;
}

/** ¿El contador llegó al límite (la duración del video)? */
export function videoCompleto(vistos: number, duracion: number, fraccion = 1, margen = 0.5): boolean {
  return duracion > 0 && vistos + margen >= duracion * fraccion;
}

/** Barra de lectura del PDF: página máxima alcanzada entre el total, 0 a 100. */
export function progresoLectura(paginaMaxima: number, total: number): number {
  if (!(total > 0)) return 0;
  if (total === 1) return 100;
  return Math.max(0, Math.min(100, Math.round((Math.min(paginaMaxima, total) / total) * 100)));
}

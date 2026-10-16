/**
 * PORTAL TH — VENTANA EMERGENTE «HOY» (Cristian Baldión, 2026-10-15).
 *
 * Apenas alguien entra al portal se abre una ventana con los eventos del día, tomados del MISMO calendario (festivos, fechas
 * importantes, eventos de la empresa y cumpleaños). Si hay cumpleaños, lleva una imagen alusiva. Se cierra sola a los 15 segundos, o
 * antes si la persona la cierra. Este archivo es PURO: arma la lista del día y decide si se muestra.
 */
import { TITULO_CUMPLEANOS, eventosFijosPorDia, ordenarEventos, unirEventos, type EventoDia } from './calendario';

/** A los cuántos segundos se cierra sola. */
export const SEGUNDOS_VENTANA_HOY = 15;

/** Imagen del cumpleaños (decorativa; está en `public/portal-th`). */
export const IMAGEN_CUMPLEANOS = '/portal-th/cumpleanos.svg';

/**
 * Una vez por día y por navegador (localStorage): recargar la página, abrir otra pestaña o volver al portal el mismo día no la reabre
 * a cada rato. ⚠️ `playwright.config.ts` (proyecto «publico») repite este formato para dejarla marcada como ya vista: si cambia aquí,
 * cambia allá.
 */
export const claveVentanaHoy = (hoy: string) => `portal-th-ventana-hoy-${hoy}`;

/** Los eventos de UN día, en el orden del calendario (festivos, laborales, importantes, empresa). Los cumpleaños, al final. */
export function eventosDelDia(hoy: string, empresa: EventoDia[], cumpleanos: EventoDia[]): EventoDia[] {
  const año = Number(hoy.slice(0, 4));
  const todo = unirEventos(eventosFijosPorDia([año]), empresa.filter((e) => e.fecha === hoy));
  const fijos = (todo.get(hoy) ?? []).filter((e) => e.fecha === hoy);
  const cumples = cumpleanos.filter((e) => e.fecha === hoy && e.personas && e.personas.length > 0);
  return [...ordenarEventos(fijos), ...cumples];
}

export const hayCumpleanos = (eventos: EventoDia[]) => eventos.some((e) => e.titulo === TITULO_CUMPLEANOS && (e.personas?.length ?? 0) > 0);

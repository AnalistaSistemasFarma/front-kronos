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
 * Una vez por INICIO DE SESIÓN: recargar la página, abrir otra pestaña o volver al portal sin haber iniciado sesión de nuevo no la
 * reabre a cada rato (marca en localStorage con la fecha; ver `reiniciarVentanaHoy`). ⚠️ `playwright.config.ts` (proyecto «publico») repite este formato para dejarla marcada como ya vista: si cambia aquí,
 * cambia allá.
 */
export const claveVentanaHoy = (hoy: string) => `${PREFIJO_MARCA_VENTANA_HOY}${hoy}`;
export const PREFIJO_MARCA_VENTANA_HOY = 'portal-th-ventana-hoy-';

/**
 * «Cada vez que se inicie sesión» (Cristian, 2026-10-16): al iniciar o cerrar sesión se BORRA la marca de «ya vista», así que la
 * ventana vuelve a salir en el siguiente ingreso. Se llama al validar el código del portal abierto y al pulsar «Salir».
 * Sin almacenamiento disponible (modo privado estricto) no hace nada: ahí la ventana sale siempre.
 */
export function reiniciarVentanaHoy(almacen: Pick<Storage, 'length' | 'key' | 'removeItem'> | null = tryLocalStorage()): void {
  if (!almacen) return;
  try {
    const claves: string[] = [];
    for (let i = 0; i < almacen.length; i += 1) {
      const k = almacen.key(i);
      if (k && k.startsWith(PREFIJO_MARCA_VENTANA_HOY)) claves.push(k);
    }
    for (const k of claves) almacen.removeItem(k);
  } catch {
    // idem
  }
}

function tryLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Los eventos de UN día, en el orden del calendario (festivos, laborales, importantes, empresa). Los cumpleaños, al final. */
export function eventosDelDia(hoy: string, empresa: EventoDia[], cumpleanos: EventoDia[]): EventoDia[] {
  const año = Number(hoy.slice(0, 4));
  const todo = unirEventos(eventosFijosPorDia([año]), empresa.filter((e) => e.fecha === hoy));
  const fijos = (todo.get(hoy) ?? []).filter((e) => e.fecha === hoy);
  const cumples = cumpleanos.filter((e) => e.fecha === hoy && e.personas && e.personas.length > 0);
  return [...ordenarEventos(fijos), ...cumples];
}

export const hayCumpleanos = (eventos: EventoDia[]) => eventos.some((e) => e.titulo === TITULO_CUMPLEANOS && (e.personas?.length ?? 0) > 0);

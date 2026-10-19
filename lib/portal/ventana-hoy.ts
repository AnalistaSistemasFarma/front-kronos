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
 * Desde el 2026-10-16 (pedido de Cristian: «cada vez que yo actualice la página principal») la ventana sale EN CADA CARGA y ya nadie
 * escribe esta marca. Solo se LEE, como interruptor de las pruebas automáticas (ver `playwright.config.ts`); `reiniciarVentanaHoy` se
 * conserva para limpiar cualquier marca que haya quedado de la versión anterior. ⚠️ `playwright.config.ts` (proyecto «publico») repite este formato para dejarla marcada como ya vista: si cambia aquí,
 * cambia allá.
 */
export const claveVentanaHoy = (hoy: string) => `${PREFIJO_MARCA_VENTANA_HOY}${hoy}`;
export const PREFIJO_MARCA_VENTANA_HOY = 'portal-th-ventana-hoy-';

/**
 * ¿Se omite la ventana por la marca guardada? SOLO en un navegador AUTOMATIZADO (`navigator.webdriver`, que Playwright activa): la marca es
 * un interruptor de las pruebas. En un navegador real se IGNORA aunque exista: la versión anterior (una vez por día) la escribía en
 * `localStorage` y esas marcas viejas seguían ahí, así que a quien ya había visto la ventana ese día no le volvía a salir al actualizar
 * (Cristian, 2026-10-19).
 */
export const omitirPorMarca = (hayMarca: boolean, navegadorAutomatizado: boolean): boolean => hayMarca && navegadorAutomatizado;

/**
 * Una vez por CARGA de la página (en memoria, no en localStorage): recargar o entrar de nuevo la vuelve a mostrar, pero cambiar de
 * ruta DENTRO de SynerLink (p. ej. ir a otro módulo del hub y volver a `/process/portal-th`) no la reabre. Iniciar o cerrar sesión
 * (`reiniciarVentanaHoy`) también la habilita otra vez.
 */
let mostradaEnEstaCarga = false;
export const yaSeMostroEnEstaCarga = () => mostradaEnEstaCarga;
export const marcarMostradaEnEstaCarga = () => {
  mostradaEnEstaCarga = true;
};

/**
 * «Cada vez que se inicie sesión» (Cristian, 2026-10-16): al iniciar o cerrar sesión se BORRA la marca de «ya vista», así que la
 * ventana vuelve a salir en el siguiente ingreso. Se llama al validar el código del portal abierto y al pulsar «Salir».
 * Sin almacenamiento disponible (modo privado estricto) no hace nada: ahí la ventana sale siempre.
 */
export function reiniciarVentanaHoy(almacen: Pick<Storage, 'length' | 'key' | 'removeItem'> | null = tryLocalStorage()): void {
  mostradaEnEstaCarga = false;
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

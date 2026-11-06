/**
 * CARPETAS de los Archivos del proyecto (2026-11-06) — funciones PURAS
 * (cliente y servidor).
 *
 * Reunión de Nicolás Rivera con Juan Mora (2026-11-05): un proyecto sirve de
 * repositorio de documentación regulatoria (autorizaciones del INVIMA, fichas
 * técnicas, artes) organizado por carpetas, y se suben carpetas completas.
 *
 * Una carpeta es una RUTA «A/B/C» (sin barra inicial ni final). NULL o «» es
 * la raíz. Los nombres no llevan los caracteres que Windows/OneDrive no
 * admiten ni «.» o «..», para que la ruta no pueda salirse de su lugar.
 */

export const MAX_FOLDER_DEPTH = 8;
export const MAX_FOLDER_SEGMENT_CHARS = 100;
export const MAX_FOLDER_PATH_CHARS = 400;

const PROHIBIDOS = /[\u0000-\u001f<>:"|?*\\]/;

export class CarpetaInvalida extends Error {}

/** Normaliza una ruta de carpeta; null = la raíz. Lanza CarpetaInvalida si no es válida. */
export function normalizarCarpeta(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new CarpetaInvalida('La carpeta no es válida.');
  const partes = raw
    .normalize('NFC')
    .split('/')
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter((p) => p.length > 0);
  if (partes.length === 0) return null;
  if (partes.length > MAX_FOLDER_DEPTH) throw new CarpetaInvalida(`Máximo ${MAX_FOLDER_DEPTH} niveles de carpetas.`);
  for (const p of partes) {
    if (p === '.' || p === '..') throw new CarpetaInvalida('El nombre de la carpeta no es válido.');
    if (PROHIBIDOS.test(p)) throw new CarpetaInvalida('El nombre de la carpeta no puede llevar < > : " | ? * ni \\.');
    if (p.length > MAX_FOLDER_SEGMENT_CHARS) throw new CarpetaInvalida(`Cada carpeta admite máximo ${MAX_FOLDER_SEGMENT_CHARS} caracteres.`);
  }
  const ruta = partes.join('/');
  if (ruta.length > MAX_FOLDER_PATH_CHARS) throw new CarpetaInvalida(`La ruta de la carpeta admite máximo ${MAX_FOLDER_PATH_CHARS} caracteres.`);
  return ruta;
}

/** Une una carpeta base con una subruta (la de un archivo dentro de una carpeta subida). */
export function unirCarpetas(base: string | null, sub: string | null): string | null {
  return normalizarCarpeta([base ?? '', sub ?? ''].filter(Boolean).join('/'));
}

/**
 * Carpeta de un archivo que llega de «Cargar carpeta»: su ruta relativa del
 * navegador (webkitRelativePath, «Raíz/Sub/archivo.pdf») sin el nombre del archivo.
 */
export function carpetaDeRutaRelativa(rutaRelativa: unknown): string | null {
  if (typeof rutaRelativa !== 'string' || !rutaRelativa.includes('/')) return null;
  return normalizarCarpeta(rutaRelativa.slice(0, rutaRelativa.lastIndexOf('/')));
}

/** La carpeta y todas sus carpetas padre («A/B/C» → A, A/B, A/B/C). */
export function conPadres(ruta: string | null): string[] {
  if (!ruta) return [];
  const partes = ruta.split('/');
  return partes.map((_, i) => partes.slice(0, i + 1).join('/'));
}

/** Carpeta padre («A/B/C» → «A/B»; «A» → null). */
export function carpetaPadre(ruta: string | null): string | null {
  if (!ruta || !ruta.includes('/')) return null;
  return ruta.slice(0, ruta.lastIndexOf('/'));
}

/** Nombre visible de la carpeta (el último tramo). */
export function nombreCarpeta(ruta: string): string {
  return ruta.slice(ruta.lastIndexOf('/') + 1);
}

/** ¿La ruta está dentro de la carpeta (o es la misma)? */
export function estaDentro(ruta: string | null, carpeta: string): boolean {
  return ruta === carpeta || Boolean(ruta && ruta.startsWith(`${carpeta}/`));
}

/** Subcarpetas DIRECTAS de una carpeta (null = la raíz), en orden alfabético. */
export function subcarpetas(todas: readonly string[], actual: string | null): string[] {
  const out = new Set<string>();
  for (const r of todas) {
    if (actual && !r.startsWith(`${actual}/`)) continue;
    const resto = actual ? r.slice(actual.length + 1) : r;
    if (!resto) continue;
    out.add(actual ? `${actual}/${resto.split('/')[0]}` : resto.split('/')[0]);
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/** Migas de pan de una carpeta: [{ nombre, ruta }] desde la raíz. */
export function migas(ruta: string | null): { nombre: string; ruta: string }[] {
  return conPadres(ruta).map((r) => ({ nombre: nombreCarpeta(r), ruta: r }));
}

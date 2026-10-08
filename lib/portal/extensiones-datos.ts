/**
 * PORTAL DE TALENTO HUMANO — Extensiones Corporativas: limpieza y búsqueda.
 *
 * Funciones PURAS, sin red ni `server-only`: las usa el servidor para limpiar
 * las filas del Excel y el navegador para el buscador de la ventana de
 * Contactos. Así la regla de "cómo se busca" vive en un solo sitio.
 */

export interface Extension {
  nombre: string;
  extension: string;
}

/**
 * Texto de una celda sin espacios duros (`\xa0`, el Excel de Talento Humano
 * los trae al inicio de cada extensión), sin espacios a los lados y con los
 * espacios internos colapsados a uno.
 */
export function limpiarCelda(valor: unknown): string {
  return String(valor ?? '')
    .replace(/[   ​﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minúsculas y sin tildes, para comparar ("SELECCIÓN" ≈ "seleccion"). */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const comparador = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Orden alfabético por nombre (sin distinguir tildes ni mayúsculas). */
export function ordenarExtensiones(lista: Extension[]): Extension[] {
  return [...lista].sort((a, b) => comparador.compare(a.nombre, b.nombre) || comparador.compare(a.extension, b.extension));
}

/**
 * Filas de `usedRange.values` → lista limpia y ordenada.
 *
 * Tolerante, porque el archivo se mantiene a mano: busca las columnas por su
 * encabezado ("nombre" y "extensión"/"número"); si no hay encabezado
 * reconocible, toma las dos primeras columnas y no descarta la primera fila.
 * Se descartan las filas sin nombre o sin extensión.
 */
export function extensionesDeValores(valores: unknown[][]): Extension[] {
  if (!Array.isArray(valores) || valores.length === 0) return [];
  const cabecera = (Array.isArray(valores[0]) ? valores[0] : []).map((v) => normalizarBusqueda(limpiarCelda(v)));
  const colNombre = cabecera.findIndex((t) => t.includes('nombre'));
  const colExtension = cabecera.findIndex((t) => t.includes('extension') || t.includes('numero') || t === 'ext');
  const hayCabecera = colNombre >= 0 && colExtension >= 0;
  const iNombre = hayCabecera ? colNombre : 0;
  const iExtension = hayCabecera ? colExtension : 1;

  const salida: Extension[] = [];
  valores.forEach((fila, i) => {
    if (hayCabecera && i === 0) return;
    if (!Array.isArray(fila)) return;
    const nombre = limpiarCelda(fila[iNombre]);
    // Una extensión es un número corto: se le quita CUALQUIER espacio.
    const extension = limpiarCelda(fila[iExtension]).replace(/\s+/g, '');
    if (!nombre || !extension) return;
    salida.push({ nombre, extension });
  });
  return ordenarExtensiones(salida);
}

/**
 * Filtra por nombre o por número. Cada palabra escrita debe aparecer en el
 * nombre o en la extensión ("planta 2", "1143", "seleccion").
 */
export function filtrarExtensiones(lista: Extension[], consulta: string): Extension[] {
  const palabras = normalizarBusqueda(consulta).split(' ').filter(Boolean);
  if (palabras.length === 0) return lista;
  return lista.filter((e) => {
    const texto = `${normalizarBusqueda(e.nombre)} ${e.extension}`;
    return palabras.every((p) => texto.includes(p));
  });
}

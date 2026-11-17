/**
 * Esquema de la vista OLP_IND_VentasB1SLQuery y normalización de sus filas.
 *
 * La vista cambió en PROD el 2026-11-10 y no en todas las bases quedó igual:
 *
 *  - Esquema «nuevo» (PROD): `NDocumento` = tipo («Facturas » / «Notas Credito»)
 *    y `Documento` = número.
 *  - Esquema «viejo» (p. ej. z_PRUEBAS_OLP_02102026): `Documento` = tipo y
 *    `N° Documento` = número, sin varias columnas nuevas.
 *
 * El Service Layer guarda la estructura de la vista por NOMBRE, sin distinguir
 * la compañía, y la mezcla: consultar la vista sin `$select`, o pidiendo
 * `Documento` o `N° Documento`, termina en «El nombre de columna 'N° Documento'
 * no es válido» o en un 500. Por eso:
 *
 *  1. Toda consulta lleva un `$select` explícito y NUNCA pide `N° Documento`
 *     ni, en el esquema nuevo, `Documento`.
 *  2. Se detecta el esquema por empresa y ambiente (base URL + CompanyDB) y se
 *     guarda en memoria un rato.
 *  3. La fila se normaliza por el TIPO del valor, no por el nombre de la llave:
 *     verificado en PROD el 2026-11-12, el Service Layer a veces devuelve el
 *     campo pedido como `NDocumento` bajo la llave `Documento` y con el número
 *     del documento en vez del tipo. El texto «Factura/Nota» da el tipo; un
 *     número da el documento; si no llega el tipo, se deduce por el signo del
 *     total (en las notas crédito la vista entrega el total en negativo).
 *
 * Decisión sobre el número de documento: `Documento` y `N° Documento` no se
 * pueden pedir sin romper la consulta, y cuando el número llega «colado» en
 * otra llave no llega en todas las páginas. Para que una misma factura no se
 * cuente dos veces, la llave del documento es SIEMPRE el `Asiento` contable
 * (único por documento, presente en los dos esquemas). Solo si no hay asiento
 * se usa el número que haya llegado. El tablero muestra entonces el número de
 * asiento en la columna de documento, y la API lo avisa.
 */
import type { LineaVenta } from './lineas';

export type EsquemaVentas = 'nuevo' | 'viejo';

/** Campos que se piden en el esquema nuevo (sin `Documento`: ver arriba). */
export const SELECT_NUEVO = [
  'Fecha',
  'NDocumento',
  'Tipo',
  'NIT',
  'Codigo',
  'Nombre',
  'Asiento',
  'Referencia',
  'Descripcion_Articulo',
  'Cantidad',
  'Total',
  'Costo',
  'Vendedor',
  'U_IT_LineaTerapeutica',
  'Orden_Compra',
  'Municipio_Factura',
] as const;

/**
 * Campos del esquema viejo: solo columnas que existían antes del cambio y
 * NUNCA `N° Documento`. Línea terapéutica, municipio y orden de compra quedan
 * como «No disponible».
 */
export const SELECT_VIEJO = [
  'Fecha',
  'Documento',
  'Tipo',
  'NIT',
  'Codigo',
  'Nombre',
  'Asiento',
  'Referencia',
  'Descripción',
  'Cantidad',
  'Total',
  'Costo',
  'Vendedor',
] as const;

export const NO_DISPONIBLE = 'No disponible';

export const selectDe = (esquema: EsquemaVentas): readonly string[] => (esquema === 'nuevo' ? SELECT_NUEVO : SELECT_VIEJO);

/** ¿El error de SAP indica que la vista no tiene `NDocumento` (esquema viejo)? */
export function esErrorEsquemaViejo(status: number, mensaje: string): boolean {
  return status === 400 && /invalid property/i.test(mensaje) && /NDocumento/.test(mensaje);
}

/* ------------------------------------------------------------------ */
/* Caché en memoria de la detección (por empresa y ambiente)          */
/* ------------------------------------------------------------------ */

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { esquema: EsquemaVentas; hasta: number }>();

/** Llave de la caché: el Service Layer y la base de la compañía (distingue PROD de PRUEBAS). */
export const llaveEsquema = (baseUrl: string, companyDB: string) => `${baseUrl.replace(/\/+$/, '').toLowerCase()}|${companyDB.toLowerCase()}`;

export function esquemaEnCache(llave: string, ahora = Date.now()): EsquemaVentas | null {
  const c = cache.get(llave);
  if (!c) return null;
  if (c.hasta < ahora) {
    cache.delete(llave);
    return null;
  }
  return c.esquema;
}

export function guardarEsquema(llave: string, esquema: EsquemaVentas, ahora = Date.now()): void {
  cache.set(llave, { esquema, hasta: ahora + TTL_MS });
}

/** Solo para pruebas. */
export function limpiarCacheEsquema(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* Normalización                                                      */
/* ------------------------------------------------------------------ */

const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const numero = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
const esTipoDoc = (s: string) => /^(fact|nota)/i.test(s);

/**
 * Convierte una fila cruda de la vista (cualquiera de los dos esquemas, con o
 * sin la confusión de llaves del Service Layer) a la LineaVenta interna del
 * esquema nuevo: `NDocumento` = tipo y `Documento` = número.
 */
export function normalizarLinea(raw: Record<string, unknown>): LineaVenta {
  const candidatos = [raw.NDocumento, raw.Documento];
  const tipo = candidatos.map(txt).find(esTipoDoc) ?? '';
  const nro = numero(raw.Asiento) ?? candidatos.map(numero).find((n) => n != null) ?? null;
  const total = Number(raw.Total ?? 0);
  const nota = tipo ? tipo.toLowerCase().startsWith('nota') : Number.isFinite(total) && total < 0;
  const descripcion = txt(raw['Descripción']) || txt(raw.Descripcion);
  return {
    NDocumento: nota ? 'Notas Credito' : 'Facturas',
    Documento: nro ?? undefined,
    Tipo: txt(raw.Tipo) || undefined,
    Fecha: txt(raw.Fecha) || undefined,
    NIT: txt(raw.NIT) || undefined,
    Codigo: raw.Codigo == null ? undefined : String(raw.Codigo),
    Nombre: txt(raw.Nombre) || undefined,
    Referencia: raw.Referencia == null ? undefined : String(raw.Referencia),
    Descripción: descripcion || undefined,
    Descripcion_Articulo: txt(raw.Descripcion_Articulo) || undefined,
    Cantidad: raw.Cantidad as number | undefined,
    Total: raw.Total as number | undefined,
    Costo: raw.Costo as number | undefined,
    Vendedor: txt(raw.Vendedor) || undefined,
    U_IT_LineaTerapeutica: txt(raw.U_IT_LineaTerapeutica) || undefined,
    Orden_Compra: (raw.Orden_Compra as number | null | undefined) ?? null,
    Municipio_Factura: txt(raw.Municipio_Factura) || undefined,
  };
}

/**
 * Mapeo SAP → Nabuco (PURO, sin BD): filas editables desde la app.
 * Cada fila: { campo (nombre en Nabuco), origen: 'fijo' | 'campo_sap', valor }.
 * Con origen 'campo_sap' el valor es la ruta del campo en el documento SAP
 * (admite puntos, p. ej. «AddressExtension.ShipToStreet»).
 */
import { coleccionLineas } from './constants';

export type OrigenMapeo = 'fijo' | 'campo_sap';
export interface FilaMapeo {
  campo: string;
  origen: OrigenMapeo;
  valor: string;
}

/** Encabezado precargado al crear una configuración (lo que hacía la integración de SAPSEND). */
export const MAPEO_ENCABEZADO_DEFECTO: FilaMapeo[] = [
  { campo: 'asunto', origen: 'campo_sap', valor: 'Comments' },
  { campo: 'observaciones', origen: 'campo_sap', valor: 'DocNum' },
  { campo: 'fechaOrden', origen: 'campo_sap', valor: 'DocDate' },
  { campo: 'nombreCompletoCliente', origen: 'fijo', valor: '' },
  { campo: 'nombreTipoOrdenAlistamiento', origen: 'fijo', valor: 'Orden alistamiento por defecto' },
  { campo: 'nombreSedeOrigen', origen: 'fijo', valor: 'CELTA TRADE PARK' },
  { campo: 'nombreAlmacenOrigen', origen: 'fijo', valor: 'CELTA TRADE PARK Principal' },
  { campo: 'nombreDestinatarioCliente', origen: 'campo_sap', valor: 'CardName' },
  { campo: 'nombrePuntoEntregaDestinatario', origen: 'campo_sap', valor: 'ShipToCode' },
  { campo: 'prioridad', origen: 'fijo', valor: '1' },
  { campo: 'nombreEstadoBienOrigen', origen: 'fijo', valor: 'Aprobado' },
  { campo: 'claseSolicitud', origen: 'fijo', valor: 'C' },
  { campo: 'enviarA', origen: 'fijo', valor: 'D' },
];

export const MAPEO_LINEAS_DEFECTO: FilaMapeo[] = [
  { campo: 'codigoProducto', origen: 'campo_sap', valor: 'ItemCode' },
  { campo: 'cantidadRequerida', origen: 'campo_sap', valor: 'Quantity' },
  { campo: 'nombreUnidad', origen: 'campo_sap', valor: 'MeasureUnit' },
];

const CAMPO_RE = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const RUTA_SAP_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Normaliza y valida un mapeo recibido del front. Lanza Error con mensaje legible. */
export function validarMapeo(raw: unknown, nombre: string): FilaMapeo[] {
  if (!Array.isArray(raw)) throw new Error(`El mapeo de ${nombre} debe ser una lista.`);
  if (raw.length > 100) throw new Error(`El mapeo de ${nombre} admite máximo 100 filas.`);
  const vistos = new Set<string>();
  return raw.map((r, i) => {
    const f = (r ?? {}) as Record<string, unknown>;
    const campo = String(f.campo ?? '').trim();
    const origen = f.origen === 'campo_sap' ? 'campo_sap' : f.origen === 'fijo' ? 'fijo' : null;
    const valor = String(f.valor ?? '').trim();
    if (!CAMPO_RE.test(campo)) throw new Error(`Fila ${i + 1} de ${nombre}: el campo Nabuco «${campo}» no es válido.`);
    if (vistos.has(campo)) throw new Error(`Fila ${i + 1} de ${nombre}: el campo «${campo}» está repetido.`);
    vistos.add(campo);
    if (!origen) throw new Error(`Fila ${i + 1} de ${nombre}: el origen debe ser «fijo» o «campo_sap».`);
    if (origen === 'campo_sap' && !RUTA_SAP_RE.test(valor)) throw new Error(`Fila ${i + 1} de ${nombre}: el campo SAP «${valor}» no es válido.`);
    if (valor.length > 500) throw new Error(`Fila ${i + 1} de ${nombre}: el valor supera 500 caracteres.`);
    return { campo, origen, valor };
  });
}

/** Lee una ruta con puntos dentro de un objeto SAP. undefined → null. */
export function leerRuta(obj: unknown, ruta: string): unknown {
  let cur: unknown = obj;
  for (const parte of ruta.split('.')) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[parte];
  }
  return cur === undefined ? null : cur;
}

function aplicar(filas: FilaMapeo[], fuente: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of filas) out[f.campo] = f.origen === 'fijo' ? f.valor : leerRuta(fuente, f.valor);
  return out;
}

/** Campos SAP que hay que pedir en el $select del encabezado (raíz de cada ruta). */
export function camposSapEncabezado(filas: FilaMapeo[]): string[] {
  return [...new Set(filas.filter((f) => f.origen === 'campo_sap').map((f) => f.valor.split('.')[0]))];
}

/**
 * Construye el cuerpo que se envía a Nabuco: encabezado mapeado + lista de líneas
 * (bajo la clave configurada, por defecto «items»).
 */
export function construirPayload(
  doc: Record<string, unknown>,
  entidad: string,
  encabezado: FilaMapeo[],
  lineas: FilaMapeo[],
  claveLineas = 'items'
): Record<string, unknown> {
  const coleccion = coleccionLineas(entidad);
  const docLineas = Array.isArray(doc[coleccion]) ? (doc[coleccion] as unknown[]) : [];
  return { ...aplicar(encabezado, doc), [claveLineas]: docLineas.map((l) => aplicar(lineas, l)) };
}

/**
 * Etapa 2 del «Dashboard de gestión comercial»: desglose por PRODUCTO, LÍNEA
 * TERAPÉUTICA, PEDIDO y el DETALLE de líneas de venta, alimentado en vivo de SAP
 * con la vista semántica OLP_IND_VentasB1SLQuery (líneas de facturas y notas
 * crédito en una sola consulta, sin recorrer documento por documento).
 *
 * Funciones puras (sin Prisma, sin SAP, sin React) para que las use la API y se
 * puedan probar con vitest. Todas las fechas se manejan en hora de Colombia.
 *
 * La vista expone, por línea: NDocumento (Facturas / Notas Credito), Tipo,
 * Fecha, Codigo/Nombre/NIT del cliente, Documento, Linea, Referencia y
 * Descripción del artículo, Precio_Unitario, Cantidad, Descuento, Total (neto
 * con signo: negativo en nota crédito), Costo, Vendedor, U_IT_LineaTerapeutica,
 * Orden_Compra, Bodega y Municipio_Factura/Entrega. Verificado contra datos
 * reales de OLP (2026-11, facturas y notas crédito).
 */

/** Una línea de venta tal como la devuelve la vista OLP_IND_VentasB1SLQuery. */
export interface LineaVenta {
  NDocumento?: string; // 'Facturas ' | 'Notas Credito'
  Tipo?: string; // 'Articulos' | 'Servicios'
  Fecha?: string; // AAAA-MM-DD
  NIT?: string;
  Codigo?: string;
  Nombre?: string;
  Documento?: number;
  Linea?: number;
  Referencia?: string;
  Descripción?: string;
  Descripcion_Articulo?: string;
  Precio_Unitario?: number;
  Cantidad?: number;
  Descuento?: number;
  Total?: number; // neto con signo (negativo en nota crédito)
  Costo?: number;
  Vendedor?: string;
  U_IT_LineaTerapeutica?: string;
  Orden_Compra?: number | null;
  Bodega?: string | null;
  Municipio_Factura?: string;
  Municipio_Entrega?: string;
}

/** Nombre de la vista semántica de líneas de venta en el Service Layer. */
export const VISTA_LINEAS = 'OLP_IND_VentasB1SLQuery';

/**
 * Ruta OData de solo lectura de la vista de líneas de venta entre dos fechas.
 * El campo de fecha de la vista se llama `Fecha` (no `DocDate`). El conector
 * exige SIEMPRE un rango de fechas acotado en el $filter.
 */
export const rutaLineasVenta = (desde: string, hasta: string) =>
  `view.svc/${VISTA_LINEAS}?$filter=Fecha ge '${desde}' and Fecha le '${hasta}'`;

const esNota = (l: LineaVenta) => String(l.NDocumento ?? '').trim().toLowerCase().startsWith('nota');
const textoDe = (v: unknown, fallback: string | undefined = '') => {
  const t = String(v ?? '').trim();
  return t || (fallback ?? '');
};
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export interface FilaProducto {
  codigo: string;
  nombre: string;
  venta: number;
  unidades: number;
  costo: number;
  margen: number;
  margenPct: number | null;
  documentos: number;
  participacion: number;
}

export interface FilaLineaTerapeutica {
  nombre: string;
  venta: number;
  unidades: number;
  participacion: number;
}

export interface FilaPedido {
  ordenCompra: string;
  cliente: string;
  venta: number;
  lineas: number;
  fecha: string | null;
}

export interface FilaDetalle {
  fecha: string;
  tipo: string;
  documento: number | null;
  cliente: string;
  producto: string;
  lineaTerapeutica: string;
  cantidad: number;
  valor: number;
  vendedor: string;
}

export interface LineasResultado {
  desde: string;
  hasta: string;
  kpis: {
    ventaNetaLineas: number;
    unidades: number;
    costo: number;
    margen: number;
    margenPct: number | null;
    productosDistintos: number;
    lineasTerapeuticas: number;
    pedidos: number;
    totalLineas: number;
  };
  topProductos: FilaProducto[];
  lineasTerapeuticas: FilaLineaTerapeutica[];
  pedidos: FilaPedido[];
  detalle: FilaDetalle[];
}

/** Clave y nombre del producto a partir de la línea. */
function productoDe(l: LineaVenta): { codigo: string; nombre: string } {
  const codigo = textoDe(l.Referencia, textoDe(l.Descripcion_Articulo, l.Descripción));
  const nombre = textoDe(l.Descripcion_Articulo, textoDe(l.Descripción, codigo));
  return { codigo, nombre };
}

/** Agrupa venta neta por producto, con unidades, costo y margen. */
export function agruparProductos(lineas: LineaVenta[]): FilaProducto[] {
  const acc = new Map<string, { nombre: string; venta: number; unidades: number; costo: number; docs: Set<number> }>();
  for (const l of lineas) {
    const { codigo, nombre } = productoDe(l);
    if (!codigo) continue;
    const signo = esNota(l) ? -1 : 1;
    const cur = acc.get(codigo) ?? { nombre, venta: 0, unidades: 0, costo: 0, docs: new Set<number>() };
    cur.venta += num(l.Total);
    cur.unidades += num(l.Cantidad);
    // Costo viene como costo unitario; se pondera por la cantidad absoluta.
    cur.costo += num(l.Costo) * Math.abs(num(l.Cantidad)) * signo;
    if (typeof l.Documento === 'number') cur.docs.add(l.Documento);
    if (nombre) cur.nombre = nombre;
    acc.set(codigo, cur);
  }
  const total = [...acc.values()].reduce((s, c) => s + Math.max(0, c.venta), 0) || 1;
  return [...acc.entries()]
    .map(([codigo, c]) => {
      const margen = c.venta - c.costo;
      return {
        codigo,
        nombre: c.nombre,
        venta: c.venta,
        unidades: c.unidades,
        costo: c.costo,
        margen,
        margenPct: c.venta > 0 ? margen / c.venta : null,
        documentos: c.docs.size,
        participacion: c.venta > 0 ? c.venta / total : 0,
      };
    })
    .sort((a, b) => b.venta - a.venta);
}

/** Agrupa venta neta por línea terapéutica (U_IT_LineaTerapeutica). */
export function agruparLineasTerapeuticas(lineas: LineaVenta[]): FilaLineaTerapeutica[] {
  const acc = new Map<string, { venta: number; unidades: number }>();
  for (const l of lineas) {
    const nombre = textoDe(l.U_IT_LineaTerapeutica, 'Sin línea terapéutica');
    const cur = acc.get(nombre) ?? { venta: 0, unidades: 0 };
    cur.venta += num(l.Total);
    cur.unidades += num(l.Cantidad);
    acc.set(nombre, cur);
  }
  const total = [...acc.values()].reduce((s, c) => s + Math.max(0, c.venta), 0) || 1;
  return [...acc.entries()]
    .map(([nombre, c]) => ({
      nombre,
      venta: c.venta,
      unidades: c.unidades,
      participacion: c.venta > 0 ? c.venta / total : 0,
    }))
    .sort((a, b) => b.venta - a.venta);
}

/** Agrupa por orden de compra (pedido del cliente). */
export function agruparPedidos(lineas: LineaVenta[]): FilaPedido[] {
  const acc = new Map<string, { cliente: string; venta: number; lineas: number; fecha: string | null }>();
  for (const l of lineas) {
    const oc = l.Orden_Compra != null && num(l.Orden_Compra) > 0 ? String(l.Orden_Compra) : '';
    if (!oc) continue;
    const cliente = textoDe(l.Nombre, textoDe(l.Codigo));
    const fecha = textoDe(l.Fecha) || null;
    const cur = acc.get(oc) ?? { cliente, venta: 0, lineas: 0, fecha };
    cur.venta += num(l.Total);
    cur.lineas += 1;
    if (cliente) cur.cliente = cliente;
    if (fecha && (!cur.fecha || fecha > cur.fecha)) cur.fecha = fecha;
    acc.set(oc, cur);
  }
  return [...acc.entries()]
    .map(([ordenCompra, c]) => ({ ordenCompra, cliente: c.cliente, venta: c.venta, lineas: c.lineas, fecha: c.fecha }))
    .sort((a, b) => b.venta - a.venta);
}

/** Detalle de líneas (ordenado por fecha y valor), acotado a un tope de filas. */
export function construirDetalle(lineas: LineaVenta[], tope = 500): FilaDetalle[] {
  return lineas
    .map((l) => {
      const { nombre } = productoDe(l);
      return {
        fecha: textoDe(l.Fecha),
        tipo: textoDe(l.NDocumento),
        documento: typeof l.Documento === 'number' ? l.Documento : null,
        cliente: textoDe(l.Nombre, textoDe(l.Codigo)),
        producto: nombre,
        lineaTerapeutica: textoDe(l.U_IT_LineaTerapeutica, '—'),
        cantidad: num(l.Cantidad),
        valor: num(l.Total),
        vendedor: textoDe(l.Vendedor, 'Sin vendedor'),
      };
    })
    .sort((a, b) => (a.fecha === b.fecha ? Math.abs(b.valor) - Math.abs(a.valor) : a.fecha < b.fecha ? 1 : -1))
    .slice(0, tope);
}

/** Cálculo principal del desglose por líneas para un rango de fechas. */
export function calcularLineas(desde: string, hasta: string, lineas: LineaVenta[]): LineasResultado {
  const productos = agruparProductos(lineas);
  const terapeuticas = agruparLineasTerapeuticas(lineas);
  const pedidos = agruparPedidos(lineas);

  let ventaNeta = 0;
  let unidades = 0;
  let costo = 0;
  for (const l of lineas) {
    ventaNeta += num(l.Total);
    unidades += num(l.Cantidad);
    costo += num(l.Costo) * Math.abs(num(l.Cantidad)) * (esNota(l) ? -1 : 1);
  }
  const margen = ventaNeta - costo;

  return {
    desde,
    hasta,
    kpis: {
      ventaNetaLineas: ventaNeta,
      unidades,
      costo,
      margen,
      margenPct: ventaNeta > 0 ? margen / ventaNeta : null,
      productosDistintos: productos.length,
      lineasTerapeuticas: terapeuticas.length,
      pedidos: pedidos.length,
      totalLineas: lineas.length,
    },
    topProductos: productos.slice(0, 20),
    lineasTerapeuticas: terapeuticas.slice(0, 15),
    pedidos: pedidos.slice(0, 20),
    detalle: construirDetalle(lineas, 500),
  };
}

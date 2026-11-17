/**
 * Cálculo del «Dashboard de gestión comercial». Primera etapa: estructura
 * visual y funcional del tablero, alimentada en vivo de SAP con las facturas de
 * venta (Invoices) y las notas crédito (CreditNotes) agregadas EN EL SERVIDOR.
 *
 * Funciones puras (sin Prisma, sin SAP, sin React) para que las use la API y se
 * puedan probar con vitest. Todas las fechas se manejan en hora de Colombia.
 *
 * Nota (etapa 1): se agrega a nivel de CABECERA del documento (día, cliente,
 * vendedor, canal). El desglose por producto / línea terapéutica (DocumentLines)
 * y la trazabilidad de pedidos quedan preparados en la estructura y se
 * completan en la etapa 2 de validación de datos.
 */

export interface DocVenta {
  DocDate?: string;
  DocTotal?: number;
  VatSum?: number;
  CardCode?: string;
  CardName?: string;
  SalesPersonCode?: number;
  Cancelled?: string;
}

export interface Vendedor {
  SalesEmployeeCode?: number;
  SalesEmployeeName?: string;
}

export const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fecha de hoy en Colombia (AAAA-MM-DD); evita adelantarse un día de noche. */
export function hoyBogota(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora);
}

/** Corte válido (AAAA-MM-DD real) o null. Sin parámetro, hoy en Colombia. */
export function parseCorte(param: string | null | undefined, ahora: Date = new Date()): Date | null {
  const texto = param && param.trim() ? param.trim() : hoyBogota(ahora);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const d = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || iso(d) !== texto) return null; // descarta 2026-02-31
  return d;
}

/** Rango del mes del corte (del 1 al día del corte) y mismo lapso del mes anterior. */
export function rangosMes(corte: Date) {
  const y = corte.getUTCFullYear();
  const m = corte.getUTCMonth();
  const ultimoDiaAnterior = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const diaFin = Math.min(corte.getUTCDate(), ultimoDiaAnterior);
  return {
    actual: { desde: iso(new Date(Date.UTC(y, m, 1))), hasta: iso(corte) },
    anterior: { desde: iso(new Date(Date.UTC(y, m - 1, 1))), hasta: iso(new Date(Date.UTC(y, m - 1, diaFin))) },
  };
}

/** Ruta OData de solo lectura de facturas de venta entre dos fechas. */
export const rutaFacturas = (desde: string, hasta: string) =>
  `Invoices?$select=DocDate,DocTotal,VatSum,CardCode,CardName,SalesPersonCode,Cancelled` +
  `&$filter=DocDate ge '${desde}' and DocDate le '${hasta}'`;

/** Ruta OData de solo lectura de notas crédito entre dos fechas. */
export const rutaNotasCredito = (desde: string, hasta: string) =>
  `CreditNotes?$select=DocDate,DocTotal,VatSum,CardCode,CardName,SalesPersonCode,Cancelled` +
  `&$filter=DocDate ge '${desde}' and DocDate le '${hasta}'`;

/** Ruta OData de solo lectura de los vendedores activos. */
export const rutaVendedores = () =>
  `SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName&$filter=Active eq 'tYES'`;

const activo = (d: DocVenta) => d.Cancelled !== 'tYES';
const fechaDe = (d: DocVenta) => String(d.DocDate ?? '').slice(0, 10);

/** Días hábiles (lun-vie) entre dos fechas AAAA-MM-DD, inclusive. */
export function diasHabiles(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00Z`);
  const b = new Date(`${hasta}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || a > b) return 0;
  let n = 0;
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

export interface DiaPunto {
  dia: number;
  fecha: string;
  actual: number;
  anterior: number | null;
  acumActual: number;
  acumAnterior: number | null;
}

export interface FilaNombre {
  codigo: string;
  nombre: string;
  venta: number;
  participacion: number;
  documentos: number;
}

export interface FilaVendedor {
  codigo: number;
  nombre: string;
  venta: number;
  documentos: number;
  clientes: number;
  participacion: number;
  ultimaVenta: string | null;
}

export interface GestionComercialResultado {
  corte: string;
  actual: { desde: string; hasta: string };
  anterior: { desde: string; hasta: string };
  kpis: {
    ventaNeta: number;
    ventaBruta: number;
    notasCredito: number;
    ventaNetaAnterior: number;
    variacion: number | null;
    diferencia: number;
    facturas: number;
    clientes: number;
    diasConVenta: number;
    diasHabilesTranscurridos: number;
    diasHabilesMes: number;
    promedioDiaHabil: number;
    proyeccionCierre: number;
    ventaUltimoDia: number;
  };
  dias: DiaPunto[];
  topClientes: FilaNombre[];
  clientesPorRecuperar: FilaNombre[];
  vendedores: FilaVendedor[];
}

/** Total neto (facturas menos notas crédito) y bruto, sin cancelados. */
function totales(facturas: DocVenta[], notas: DocVenta[]) {
  let bruta = 0;
  for (const f of facturas) if (activo(f)) bruta += Number(f.DocTotal ?? 0);
  let nc = 0;
  for (const n of notas) if (activo(n)) nc += Number(n.DocTotal ?? 0);
  return { bruta, nc, neta: bruta - nc };
}

/** Suma neta por fecha (AAAA-MM-DD). Facturas suman; notas crédito restan. */
function porDia(facturas: DocVenta[], notas: DocVenta[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of facturas) {
    if (!activo(f)) continue;
    const k = fechaDe(f);
    if (k) map.set(k, (map.get(k) ?? 0) + Number(f.DocTotal ?? 0));
  }
  for (const n of notas) {
    if (!activo(n)) continue;
    const k = fechaDe(n);
    if (k) map.set(k, (map.get(k) ?? 0) - Number(n.DocTotal ?? 0));
  }
  return map;
}

/** Agrupa venta neta por cliente (CardCode), con nombre más frecuente y nº de documentos. */
export function agruparClientes(facturas: DocVenta[], notas: DocVenta[]): FilaNombre[] {
  const acc = new Map<string, { nombre: string; venta: number; docs: number }>();
  const add = (d: DocVenta, signo: number) => {
    if (!activo(d)) return;
    const codigo = String(d.CardCode ?? '').trim();
    if (!codigo) return;
    const cur = acc.get(codigo) ?? { nombre: String(d.CardName ?? codigo).trim(), venta: 0, docs: 0 };
    cur.venta += signo * Number(d.DocTotal ?? 0);
    if (signo > 0) cur.docs += 1;
    if (d.CardName) cur.nombre = String(d.CardName).trim();
    acc.set(codigo, cur);
  };
  for (const f of facturas) add(f, 1);
  for (const n of notas) add(n, -1);
  const total = [...acc.values()].reduce((s, c) => s + Math.max(0, c.venta), 0) || 1;
  return [...acc.entries()]
    .map(([codigo, c]) => ({
      codigo,
      nombre: c.nombre,
      venta: c.venta,
      documentos: c.docs,
      participacion: c.venta > 0 ? c.venta / total : 0,
    }))
    .sort((a, b) => b.venta - a.venta);
}

/** Agrupa venta neta por vendedor usando el catálogo de SalesPersons para el nombre. */
export function agruparVendedores(
  facturas: DocVenta[],
  notas: DocVenta[],
  vendedores: Vendedor[]
): FilaVendedor[] {
  const nombre = new Map<number, string>();
  for (const v of vendedores) {
    if (typeof v.SalesEmployeeCode === 'number') nombre.set(v.SalesEmployeeCode, String(v.SalesEmployeeName ?? '').trim());
  }
  const acc = new Map<number, { venta: number; docs: number; clientes: Set<string>; ultima: string | null }>();
  const add = (d: DocVenta, signo: number) => {
    if (!activo(d)) return;
    const code = Number(d.SalesPersonCode ?? -1);
    const cur = acc.get(code) ?? { venta: 0, docs: 0, clientes: new Set<string>(), ultima: null };
    cur.venta += signo * Number(d.DocTotal ?? 0);
    if (signo > 0) {
      cur.docs += 1;
      const cc = String(d.CardCode ?? '').trim();
      if (cc) cur.clientes.add(cc);
      const f = fechaDe(d);
      if (f && (!cur.ultima || f > cur.ultima)) cur.ultima = f;
    }
    acc.set(code, cur);
  };
  for (const f of facturas) add(f, 1);
  for (const n of notas) add(n, -1);
  const total = [...acc.values()].reduce((s, c) => s + Math.max(0, c.venta), 0) || 1;
  return [...acc.entries()]
    .map(([codigo, c]) => ({
      codigo,
      nombre: nombre.get(codigo) || (codigo === -1 ? 'Sin vendedor' : `Vendedor ${codigo}`),
      venta: c.venta,
      documentos: c.docs,
      clientes: c.clientes.size,
      participacion: c.venta > 0 ? c.venta / total : 0,
      ultimaVenta: c.ultima,
    }))
    .sort((a, b) => b.venta - a.venta);
}

/** Clientes que compraron el mes anterior y aún no compran en el mes actual. */
export function clientesPorRecuperar(
  clientesActual: FilaNombre[],
  clientesAnterior: FilaNombre[]
): FilaNombre[] {
  const compraronAhora = new Set(clientesActual.filter((c) => c.venta > 0).map((c) => c.codigo));
  return clientesAnterior
    .filter((c) => c.venta > 0 && !compraronAhora.has(c.codigo))
    .sort((a, b) => b.venta - a.venta);
}

/** Cálculo principal del tablero de gestión comercial para un corte. */
export function calcularGestionComercial(
  corte: Date,
  facturasActual: DocVenta[],
  notasActual: DocVenta[],
  facturasAnterior: DocVenta[],
  notasAnterior: DocVenta[],
  vendedores: Vendedor[]
): GestionComercialResultado {
  const rangos = rangosMes(corte);
  const y = corte.getUTCFullYear();
  const m = corte.getUTCMonth();
  const diaCorte = corte.getUTCDate();
  const ultimoDiaAnterior = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ultimoDiaMes = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  const tActual = totales(facturasActual, notasActual);
  const tAnterior = totales(facturasAnterior, notasAnterior);
  const diaActual = porDia(facturasActual, notasActual);
  const diaAnterior = porDia(facturasAnterior, notasAnterior);

  const dias: DiaPunto[] = [];
  let acumA = 0;
  let acumP = 0;
  let ultimoDiaConVenta = '';
  for (let d = 1; d <= diaCorte; d++) {
    const fa = iso(new Date(Date.UTC(y, m, d)));
    const vA = diaActual.get(fa) ?? 0;
    acumA += vA;
    if (vA !== 0) ultimoDiaConVenta = fa;
    let vP: number | null = null;
    let acP: number | null = null;
    if (d <= ultimoDiaAnterior) {
      const fp = iso(new Date(Date.UTC(y, m - 1, d)));
      vP = diaAnterior.get(fp) ?? 0;
      acumP += vP;
      acP = acumP;
    }
    dias.push({ dia: d, fecha: fa, actual: vA, anterior: vP, acumActual: acumA, acumAnterior: acP });
  }

  const diasConVenta = dias.filter((x) => x.actual > 0).length;
  const habilesTranscurridos = diasHabiles(rangos.actual.desde, rangos.actual.hasta);
  const habilesMes = diasHabiles(rangos.actual.desde, iso(new Date(Date.UTC(y, m, ultimoDiaMes))));
  const promedioDiaHabil = habilesTranscurridos ? tActual.neta / habilesTranscurridos : 0;
  const proyeccionCierre = promedioDiaHabil * habilesMes;

  const clientesActual = agruparClientes(facturasActual, notasActual);
  const clientesAnterior = agruparClientes(facturasAnterior, notasAnterior);

  return {
    corte: iso(corte),
    actual: rangos.actual,
    anterior: rangos.anterior,
    kpis: {
      ventaNeta: tActual.neta,
      ventaBruta: tActual.bruta,
      notasCredito: tActual.nc,
      ventaNetaAnterior: tAnterior.neta,
      variacion: tAnterior.neta > 0 ? (tActual.neta - tAnterior.neta) / tAnterior.neta : null,
      diferencia: tActual.neta - tAnterior.neta,
      facturas: facturasActual.filter(activo).length,
      clientes: clientesActual.filter((c) => c.venta > 0).length,
      diasConVenta,
      diasHabilesTranscurridos: habilesTranscurridos,
      diasHabilesMes: habilesMes,
      promedioDiaHabil,
      proyeccionCierre,
      ventaUltimoDia: ultimoDiaConVenta ? (diaActual.get(ultimoDiaConVenta) ?? 0) : 0,
    },
    dias,
    topClientes: clientesActual.filter((c) => c.venta > 0).slice(0, 10),
    clientesPorRecuperar: clientesPorRecuperar(clientesActual, clientesAnterior).slice(0, 15),
    vendedores: agruparVendedores(facturasActual, notasActual, vendedores),
  };
}

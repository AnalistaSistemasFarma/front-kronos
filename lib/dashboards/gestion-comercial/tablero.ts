/**
 * Tablero comercial (réplica del «Tablero Comercial» de BI, tema Insight).
 *
 * Fuente única: la vista OLP_IND_VentasB1SLQuery (líneas de facturas y notas
 * crédito). La API trae tres ventanas —mes del corte, mismo lapso del mes
 * anterior y mismo lapso del año anterior— y la página agrega en el navegador
 * según los filtros. Funciones puras, probadas con vitest. Fechas en hora de
 * Colombia (las de la vista ya vienen como AAAA-MM-DD locales).
 */
import { diasHabiles, iso, rangosMes } from './calculo';
import { VISTA_LINEAS, type LineaVenta } from './lineas';

/** Línea compacta que viaja al navegador. */
export interface Fila {
  /** Fecha AAAA-MM-DD */
  f: string;
  /** F = factura, N = nota crédito */
  t: 'F' | 'N';
  /** Número de documento */
  d: number | null;
  /** Código, nombre y NIT del cliente */
  cc: string;
  cn: string;
  nit: string;
  /** Vendedor */
  v: string;
  /** Código y nombre del producto */
  pc: string;
  pn: string;
  /** Línea terapéutica */
  lt: string;
  /** Cantidad (negativa en nota crédito) */
  q: number;
  /** Valor neto de la línea sin IVA (negativo en nota crédito) */
  val: number;
  /** Costo total de la línea (con el mismo signo de la cantidad) */
  cost: number;
  /** Orden de compra / pedido ('' si no tiene) */
  oc: string;
  /** Ciudad de facturación */
  ciu: string;
}

export interface Rango {
  desde: string;
  hasta: string;
}

export interface TableroDatos {
  corte: string;
  actual: Rango;
  anterior: Rango;
  anioAnterior: Rango;
  diasHabilesMes: number;
  diasHabilesTranscurridos: number;
  actualizado: string;
  filas: Fila[];
  filasAnterior: Fila[];
  filasAnio: Fila[];
  avisos: string[];
}

/**
 * Ruta OData (solo lectura) de la vista de líneas para un rango de fechas.
 * Sin $select: el Service Layer de OLP rechaza $select sobre esta vista
 * («invalid property 'NDocumento'», visto en PRUEBAS el 2026-11-12). La
 * reducción de campos se hace en el servidor con aFila antes de responder.
 */
export const rutaVistaVentas = (desde: string, hasta: string) =>
  `view.svc/${VISTA_LINEAS}?$filter=Fecha ge '${desde}' and Fecha le '${hasta}'`;

const txt = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Normaliza una línea de la vista a la fila compacta. */
export function aFila(l: LineaVenta): Fila {
  const nota = txt(l.NDocumento).toLowerCase().startsWith('nota');
  const q = num(l.Cantidad);
  const signo = nota ? -1 : 1;
  const pc = txt(l.Referencia);
  const pn = txt(l.Descripcion_Articulo) || txt(l.Descripción) || pc;
  const oc = l.Orden_Compra != null && num(l.Orden_Compra) > 0 ? String(l.Orden_Compra) : '';
  return {
    f: txt(l.Fecha).slice(0, 10),
    t: nota ? 'N' : 'F',
    d: typeof l.Documento === 'number' ? l.Documento : null,
    cc: txt(l.Codigo),
    cn: txt(l.Nombre) || txt(l.Codigo),
    nit: txt(l.NIT),
    v: txt(l.Vendedor) || 'Sin vendedor',
    pc: pc || pn,
    pn: pn || 'Sin descripción',
    lt: txt(l.U_IT_LineaTerapeutica) || 'Sin línea terapéutica',
    q,
    val: num(l.Total),
    cost: num(l.Costo) * Math.abs(q) * signo,
    oc,
    ciu: txt(l.Municipio_Factura) || 'Sin ciudad',
  };
}

/** Ruta de la vista con paginación explícita ($top/$skip), sin depender de nextLink. */
export const rutaVistaPagina = (desde: string, hasta: string, top: number, skip: number) =>
  `${rutaVistaVentas(desde, hasta)}&$top=${top}&$skip=${skip}`;

/** Cabecera de factura / nota crédito (Invoices / CreditNotes). */
export interface Cabecera {
  DocNum?: number;
  DocDate?: string;
  DocTotal?: number;
  VatSum?: number;
  CardCode?: string;
  CardName?: string;
  SalesPersonCode?: number;
  Cancelled?: string;
}

/**
 * Plan B cuando la vista de líneas no responde: una fila por documento, armada
 * con las cabeceras de Invoices / CreditNotes (fuente que usa también el
 * dashboard de venta diaria). Valor sin IVA = DocTotal - VatSum. Sin detalle
 * de producto, línea terapéutica ni ciudad.
 */
export function filasDesdeCabeceras(
  facturas: Cabecera[],
  notas: Cabecera[],
  vendedores: Map<number, string>
): Fila[] {
  const una = (c: Cabecera, t: 'F' | 'N'): Fila | null => {
    if (c.Cancelled === 'tYES') return null;
    const neto = num(c.DocTotal) - num(c.VatSum);
    const val = t === 'N' ? -Math.abs(neto) : neto;
    return {
      f: txt(c.DocDate).slice(0, 10),
      t,
      d: typeof c.DocNum === 'number' ? c.DocNum : null,
      cc: txt(c.CardCode),
      cn: txt(c.CardName) || txt(c.CardCode),
      nit: txt(c.CardCode),
      v: vendedores.get(num(c.SalesPersonCode)) || 'Sin vendedor',
      pc: 'SIN-DETALLE',
      pn: 'Sin detalle de producto',
      lt: 'Sin línea terapéutica',
      q: 0,
      val,
      cost: 0,
      oc: '',
      ciu: 'Sin ciudad',
    };
  };
  const out: Fila[] = [];
  for (const c of facturas) {
    const f = una(c, 'F');
    if (f) out.push(f);
  }
  for (const c of notas) {
    const f = una(c, 'N');
    if (f) out.push(f);
  }
  return out;
}

/** Rangos del tablero: mes del corte, mismo lapso mes anterior y año anterior. */
export function rangosTablero(corte: Date): { actual: Rango; anterior: Rango; anioAnterior: Rango } {
  const base = rangosMes(corte);
  const y = corte.getUTCFullYear();
  const m = corte.getUTCMonth();
  const ultimoDiaAnio = new Date(Date.UTC(y - 1, m + 1, 0)).getUTCDate();
  const dia = Math.min(corte.getUTCDate(), ultimoDiaAnio);
  return {
    actual: base.actual,
    anterior: base.anterior,
    anioAnterior: { desde: iso(new Date(Date.UTC(y - 1, m, 1))), hasta: iso(new Date(Date.UTC(y - 1, m, dia))) },
  };
}

/** Días hábiles del mes completo del corte y transcurridos hasta el corte. */
export function habilesDelMes(corte: Date) {
  const y = corte.getUTCFullYear();
  const m = corte.getUTCMonth();
  const desde = iso(new Date(Date.UTC(y, m, 1)));
  const fin = iso(new Date(Date.UTC(y, m + 1, 0)));
  return { mes: diasHabiles(desde, fin), transcurridos: diasHabiles(desde, iso(corte)) };
}

/* ------------------------------------------------------------------ */
/* Filtros y medidas                                                  */
/* ------------------------------------------------------------------ */

export type Medida = 'neta' | 'bruta' | 'notas';

export interface Filtros {
  vendedor: string | null;
  linea: string | null;
  ciudad: string | null;
  cliente: string | null;
}

export const FILTROS_VACIOS: Filtros = { vendedor: null, linea: null, ciudad: null, cliente: null };

export function filtrar(filas: Fila[], fl: Filtros): Fila[] {
  return filas.filter(
    (r) =>
      (!fl.vendedor || r.v === fl.vendedor) &&
      (!fl.linea || r.lt === fl.linea) &&
      (!fl.ciudad || r.ciu === fl.ciudad) &&
      (!fl.cliente || r.cc === fl.cliente)
  );
}

/** Valor de una fila según la medida: neta (todo), bruta (solo facturas), notas (solo NC). */
export function valor(r: Fila, med: Medida): number {
  if (med === 'bruta') return r.t === 'F' ? r.val : 0;
  if (med === 'notas') return r.t === 'N' ? r.val : 0;
  return r.val;
}

export function incluye(r: Fila, med: Medida): boolean {
  if (med === 'bruta') return r.t === 'F';
  if (med === 'notas') return r.t === 'N';
  return true;
}

export interface Totales {
  neta: number;
  bruta: number;
  notas: number;
  costo: number;
  margen: number;
  unidades: number;
  facturas: number;
  clientes: number;
  diasConVenta: number;
}

export function totales(filas: Fila[]): Totales {
  let neta = 0;
  let bruta = 0;
  let notas = 0;
  let costo = 0;
  let unidades = 0;
  const facturas = new Set<number>();
  const clientes = new Set<string>();
  const dias = new Set<string>();
  for (const r of filas) {
    neta += r.val;
    costo += r.cost;
    unidades += r.q;
    if (r.t === 'F') {
      bruta += r.val;
      if (r.d != null) facturas.add(r.d);
      if (r.cc) clientes.add(r.cc);
      if (r.f) dias.add(r.f);
    } else {
      notas += r.val;
    }
  }
  return {
    neta,
    bruta,
    notas,
    costo,
    margen: neta - costo,
    unidades,
    facturas: facturas.size,
    clientes: clientes.size,
    diasConVenta: dias.size,
  };
}

/* ------------------------------------------------------------------ */
/* Agrupaciones                                                       */
/* ------------------------------------------------------------------ */

export interface Grupo {
  clave: string;
  nombre: string;
  venta: number;
  unidades: number;
  costo: number;
  documentos: number;
  clientes: number;
  productos: number;
  ultima: string | null;
  participacion: number;
}

type Llave = (r: Fila) => { clave: string; nombre: string };

export const porCliente: Llave = (r) => ({ clave: r.cc, nombre: r.cn });
export const porProducto: Llave = (r) => ({ clave: r.pc, nombre: r.pn });
export const porVendedor: Llave = (r) => ({ clave: r.v, nombre: r.v });
export const porLinea: Llave = (r) => ({ clave: r.lt, nombre: r.lt });
export const porCiudad: Llave = (r) => ({ clave: r.ciu, nombre: r.ciu });
export const porPedido: Llave = (r) => ({ clave: r.oc, nombre: r.cn });

/** Agrupa por una llave con la medida elegida; ordena de mayor a menor venta. */
export function agrupar(filas: Fila[], llave: Llave, med: Medida = 'neta'): Grupo[] {
  const acc = new Map<
    string,
    { nombre: string; venta: number; unidades: number; costo: number; docs: Set<number>; cli: Set<string>; pro: Set<string>; ultima: string | null }
  >();
  for (const r of filas) {
    if (!incluye(r, med)) continue;
    const { clave, nombre } = llave(r);
    if (!clave) continue;
    const cur =
      acc.get(clave) ??
      { nombre, venta: 0, unidades: 0, costo: 0, docs: new Set<number>(), cli: new Set<string>(), pro: new Set<string>(), ultima: null };
    cur.venta += r.val;
    cur.unidades += r.q;
    cur.costo += r.cost;
    if (r.d != null) cur.docs.add(r.d);
    if (r.cc) cur.cli.add(r.cc);
    if (r.pc) cur.pro.add(r.pc);
    if (r.t === 'F' && r.f && (!cur.ultima || r.f > cur.ultima)) cur.ultima = r.f;
    if (nombre) cur.nombre = nombre;
    acc.set(clave, cur);
  }
  const total = [...acc.values()].reduce((s, c) => s + Math.abs(c.venta), 0) || 1;
  return [...acc.entries()]
    .map(([clave, c]) => ({
      clave,
      nombre: c.nombre,
      venta: c.venta,
      unidades: c.unidades,
      costo: c.costo,
      documentos: c.docs.size,
      clientes: c.cli.size,
      productos: c.pro.size,
      ultima: c.ultima,
      participacion: Math.abs(c.venta) / total,
    }))
    .sort((a, b) => Math.abs(b.venta) - Math.abs(a.venta));
}

/** Índice clave → venta, para comparativos. */
export function indice(grupos: Grupo[]): Map<string, number> {
  return new Map(grupos.map((g) => [g.clave, g.venta]));
}

/** Variación relativa (null si la base es 0 o negativa). */
export function variacion(actual: number, base: number): number | null {
  return base > 0 ? (actual - base) / base : null;
}

/* ------------------------------------------------------------------ */
/* Series                                                             */
/* ------------------------------------------------------------------ */

export interface PuntoDia {
  dia: number;
  actual: number;
  anterior: number | null;
  anio: number | null;
  acumActual: number;
  acumAnterior: number | null;
  acumAnio: number | null;
}

function sumaPorDia(filas: Fila[], med: Medida): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of filas) {
    if (!incluye(r, med)) continue;
    const dia = Number(r.f.slice(8, 10));
    if (!dia) continue;
    m.set(dia, (m.get(dia) ?? 0) + r.val);
  }
  return m;
}

/** Serie día a día (1..día del corte) de las tres ventanas, con acumulados. */
export function serieDiaria(
  actual: Fila[],
  anterior: Fila[],
  anio: Fila[],
  datos: Pick<TableroDatos, 'actual' | 'anterior' | 'anioAnterior'>,
  med: Medida = 'neta'
): PuntoDia[] {
  const diaCorte = Number(datos.actual.hasta.slice(8, 10));
  const diaAnt = Number(datos.anterior.hasta.slice(8, 10));
  const diaAnio = Number(datos.anioAnterior.hasta.slice(8, 10));
  const a = sumaPorDia(actual, med);
  const p = sumaPorDia(anterior, med);
  const y = sumaPorDia(anio, med);
  const out: PuntoDia[] = [];
  let acA = 0;
  let acP = 0;
  let acY = 0;
  for (let d = 1; d <= diaCorte; d++) {
    const vA = a.get(d) ?? 0;
    acA += vA;
    let vP: number | null = null;
    let vY: number | null = null;
    if (d <= diaAnt) {
      vP = p.get(d) ?? 0;
      acP += vP;
    }
    if (d <= diaAnio) {
      vY = y.get(d) ?? 0;
      acY += vY;
    }
    out.push({
      dia: d,
      actual: vA,
      anterior: vP,
      anio: vY,
      acumActual: acA,
      acumAnterior: d <= diaAnt ? acP : null,
      acumAnio: d <= diaAnio ? acY : null,
    });
  }
  return out;
}

/** Venta por semana del mes (1: días 1-7, 2: 8-14, …). */
export function porSemana(filas: Fila[], med: Medida = 'neta'): number[] {
  const out = [0, 0, 0, 0, 0];
  for (const r of filas) {
    if (!incluye(r, med)) continue;
    const dia = Number(r.f.slice(8, 10));
    if (!dia) continue;
    out[Math.min(4, Math.floor((dia - 1) / 7))] += r.val;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Clientes, pedidos e insights                                       */
/* ------------------------------------------------------------------ */

/** Clientes con compra en la ventana anterior que no compran en la actual. */
export function porRecuperar(actual: Fila[], anterior: Fila[]): Grupo[] {
  const compraron = new Set(actual.filter((r) => r.t === 'F').map((r) => r.cc));
  return agrupar(anterior, porCliente).filter((g) => g.venta > 0 && !compraron.has(g.clave));
}

export interface Pedido {
  oc: string;
  cliente: string;
  vendedor: string;
  primera: string;
  ultima: string;
  facturas: number[];
  lineas: number;
  unidades: number;
  valor: number;
}

export function pedidos(filas: Fila[]): Pedido[] {
  const acc = new Map<string, Pedido & { set: Set<number> }>();
  for (const r of filas) {
    if (!r.oc || r.t !== 'F') continue;
    const cur =
      acc.get(r.oc) ??
      { oc: r.oc, cliente: r.cn, vendedor: r.v, primera: r.f, ultima: r.f, facturas: [], lineas: 0, unidades: 0, valor: 0, set: new Set<number>() };
    if (r.f < cur.primera) cur.primera = r.f;
    if (r.f > cur.ultima) cur.ultima = r.f;
    if (r.d != null) cur.set.add(r.d);
    cur.lineas += 1;
    cur.unidades += r.q;
    cur.valor += r.val;
    acc.set(r.oc, cur);
  }
  return [...acc.values()]
    .map(({ set, ...p }) => ({ ...p, facturas: [...set].sort((a, b) => a - b) }))
    .sort((a, b) => (a.ultima === b.ultima ? b.valor - a.valor : a.ultima < b.ultima ? 1 : -1));
}

export interface Insight {
  tono: 'ok' | 'warn' | 'crit' | 'info';
  titulo: string;
  texto: string;
}

const pctTxt = (v: number) => `${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
const mm = (v: number) => `$ ${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;

/** Hallazgos automáticos para el panel de insights. */
export function insights(actual: Fila[], anterior: Fila[], anio: Fila[]): Insight[] {
  const out: Insight[] = [];
  const tA = totales(actual);
  const tP = totales(anterior);
  const tY = totales(anio);
  const vMes = variacion(tA.neta, tP.neta);
  if (vMes != null) {
    out.push({
      tono: vMes >= 0 ? 'ok' : vMes > -0.1 ? 'warn' : 'crit',
      titulo: vMes >= 0 ? 'Por encima del mes anterior' : 'Por debajo del mes anterior',
      texto: `La venta neta va ${vMes >= 0 ? '+' : ''}${pctTxt(vMes)} frente al mismo corte del mes anterior (${mm(tA.neta)} vs ${mm(tP.neta)}).`,
    });
  }
  const vAnio = variacion(tA.neta, tY.neta);
  if (vAnio != null) {
    out.push({
      tono: vAnio >= 0 ? 'ok' : 'warn',
      titulo: 'Comparativo anual',
      texto: `Frente al mismo corte del año anterior la venta neta varía ${vAnio >= 0 ? '+' : ''}${pctTxt(vAnio)}.`,
    });
  }
  const clientes = agrupar(actual, porCliente).filter((g) => g.venta > 0);
  if (clientes.length >= 5) {
    const top5 = clientes.slice(0, 5).reduce((s, g) => s + g.venta, 0);
    const conc = tA.neta > 0 ? top5 / tA.neta : 0;
    if (conc >= 0.5) {
      out.push({ tono: 'warn', titulo: 'Venta concentrada', texto: `Los 5 primeros clientes suman ${pctTxt(conc)} de la venta neta del mes.` });
    }
  }
  const recuperar = porRecuperar(actual, anterior);
  if (recuperar.length) {
    const valor = recuperar.reduce((s, g) => s + g.venta, 0);
    out.push({
      tono: 'crit',
      titulo: `${recuperar.length} clientes por recuperar`,
      texto: `Compraron ${mm(valor)} el mes anterior y aún no compran en este mes. El mayor: ${recuperar[0].nombre}.`,
    });
  }
  if (tA.bruta > 0 && Math.abs(tA.notas) / tA.bruta >= 0.05) {
    out.push({ tono: 'warn', titulo: 'Notas crédito altas', texto: `Las notas crédito equivalen al ${pctTxt(Math.abs(tA.notas) / tA.bruta)} de la venta bruta.` });
  }
  const lineas = agrupar(actual, porLinea).filter((g) => g.venta > 0);
  if (lineas.length) {
    out.push({ tono: 'info', titulo: 'Línea terapéutica líder', texto: `${lineas[0].nombre} aporta ${pctTxt(lineas[0].participacion)} de la venta.` });
  }
  if (tA.neta > 0) {
    const margen = tA.margen / tA.neta;
    out.push({ tono: margen >= 0.15 ? 'ok' : 'warn', titulo: 'Margen bruto', texto: `El margen sobre costo del periodo es ${pctTxt(margen)} (${mm(tA.margen)}).` });
  }
  return out;
}

/** Último día de un mes AAAA-MM. */
export function finDeMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
}

/** Últimos n meses cerrados (AAAA-MM), del más reciente al más antiguo. */
export function mesesCerrados(hoy: string, n = 12): string[] {
  const [y, m] = hoy.split('-').map(Number);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(iso(d).slice(0, 7));
  }
  return out;
}

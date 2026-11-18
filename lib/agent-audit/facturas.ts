/**
 * AUDITORÍA DE AGENTES → FACTURAS DE IA (Nicolás, 2026-11-17). Reglas puras:
 *   - leer una factura (texto del PDF) de Anthropic y sacar sus campos;
 *   - sugerir el reparto interno por empresa según las licencias de la organización;
 *   - totales del año por empresa, por mes y por proveedor.
 * Lectura y escritura en ./facturas-db.ts.
 *
 * DOS MIRADAS DEL GASTO: lo que cada empresa PAGÓ directamente (la factura llega a su
 * nombre) y lo que le CORRESPONDE (reparto interno). Una factura del plan Team llega
 * toda a Gsslatam aunque traiga puestos de Ryan, Farmalógica u OLP, y la regla de
 * negocio es que cada empresa paga lo suyo.
 */

export interface LineaFacturaDto {
  descripcion: string;
  periodo: string | null;
  cantidad: number | null;
  precioUnitario: number | null;
  monto: number;
}

export interface FacturaLeidaDto {
  proveedor: string | null;
  numero: string | null;
  fecha: string | null; // AAAA-MM-DD
  vence: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  facturadoA: string | null;
  correoCuenta: string | null;
  moneda: string | null;
  subtotal: number | null;
  impuestos: number | null;
  total: number | null;
  lineas: LineaFacturaDto[];
}

const MESES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const dinero = (s: string) => Number(s.replace(/,/g, ''));

/** «October 22, 2026» → 2026-10-22. */
export function fechaIngles(s: string | null | undefined): string | null {
  const m = s?.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mes = MESES[m[1].toLowerCase()];
  return mes ? `${m[3]}-${pad(mes)}-${pad(Number(m[2]))}` : null;
}

/** «Oct 22–Nov 22, 2026» → { desde: 2026-10-22, hasta: 2026-11-22 } (el año va al final). */
export function periodoIngles(s: string | null | undefined): { desde: string; hasta: string } | null {
  const partes = (s ?? '').replace(/\s+/g, ' ').split(/[–—-]/);
  if (partes.length !== 2) return null;
  const izq = partes[0].trim().match(/^([A-Za-z]{3,9})[.]? (\d{1,2})/);
  const der = partes[1].trim().match(/^([A-Za-z]{3,9})[.]? (\d{1,2}), (\d{4})/);
  const anioIzq = partes[0].match(/, (\d{4})/);
  if (!izq || !der) return null;
  const m1 = MESES[izq[1].toLowerCase()];
  const m2 = MESES[der[1].toLowerCase()];
  if (!m1 || !m2) return null;
  const a2 = Number(der[3]);
  const a1 = anioIzq ? Number(anioIzq[1]) : m1 > m2 ? a2 - 1 : a2;
  return { desde: `${a1}-${pad(m1)}-${pad(Number(izq[2]))}`, hasta: `${a2}-${pad(m2)}-${pad(Number(der[2]))}` };
}

const RX_PERIODO = /[A-Z][a-z]{2,8} \d{1,2},? ?\d{0,4} ?[–—-] ?[A-Z][a-z]{2,8} \d{1,2}, \d{4}/;

/**
 * Lee el texto de una factura de Anthropic (PDF de Stripe). Tolera el texto plano
 * (pdftotext) y el del navegador (celdas unidas con « | »). Lo que no encuentra
 * queda en null para que la persona lo complete.
 */
export function leerFacturaAnthropic(texto: string): FacturaLeidaDto {
  const t = texto.replace(/\s*\|\s*/g, ' ').replace(/[ \t]+/g, ' ');
  const plano = t.replace(/\s*\n\s*/g, '\n');
  const una = plano.replace(/\n/g, ' ');
  const g = (rx: RegExp) => una.match(rx)?.[1]?.trim() ?? null;

  const numero = g(/(?:Invoice|Receipt) number\s+([A-Z0-9][A-Z0-9-]{3,})/i);
  const fecha = fechaIngles(g(/Date (?:of issue|paid)\s+([A-Za-z]+\.? \d{1,2}, \d{4})/i));
  const vence = fechaIngles(g(/Date due\s+([A-Za-z]+\.? \d{1,2}, \d{4})/i));
  const total = g(/(?:^|\s)Total\s+\$([\d,]+\.\d{2})/);
  const subtotal = g(/Subtotal\s+\$([\d,]+\.\d{2})/);
  const impuestos = g(/(?:Tax|VAT|IVA)[^$]{0,40}\$([\d,]+\.\d{2})/i);
  const moneda = g(/\$[\d,]+\.\d{2}\s+([A-Z]{3})\b/) ?? (/\$/.test(una) ? 'USD' : null);

  // «Bill to» → primera línea con texto; correo = el primero que no es de Anthropic.
  const lineasTexto = plano.split('\n').map((l) => l.trim()).filter(Boolean);
  const iBill = lineasTexto.findIndex((l) => /^bill to\b/i.test(l));
  let facturadoA: string | null = null;
  if (iBill >= 0) {
    const resto = lineasTexto[iBill].replace(/^bill to\s*/i, '').trim();
    facturadoA = resto || lineasTexto[iBill + 1] || null;
  }
  const correos = [...una.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
  const correoCuenta = correos.find((c) => !/anthropic\.com$/i.test(c)) ?? null;

  // Líneas: entre el encabezado de la tabla y «Subtotal».
  const ini = una.search(/Description\s+Qty\s+Unit price\s+Amount/i);
  const fin = una.search(/\bSubtotal\b/);
  const lineas: LineaFacturaDto[] = [];
  if (ini >= 0 && fin > ini) {
    const seccion = una.slice(ini).replace(/^Description\s+Qty\s+Unit price\s+Amount/i, '').slice(0, fin - ini).replace(/\bSubtotal\b[\s\S]*$/, '');
    const rx = /(\d+[.]?\d*) \$([\d,]+\.\d{2}) \$([\d,]+\.\d{2})/g;
    let previo = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(seccion))) {
      let pre = seccion.slice(previo, m.index).trim();
      // Un período al COMIENZO pertenece a la línea anterior (orden del navegador: fila, luego período).
      const pIni = pre.match(RX_PERIODO);
      if (pIni && pIni.index === 0 && lineas.length && !lineas[lineas.length - 1].periodo) {
        lineas[lineas.length - 1].periodo = pIni[0];
        pre = pre.slice(pIni[0].length).trim();
      }
      const pDentro = pre.match(RX_PERIODO);
      const periodo = pDentro ? pDentro[0] : null;
      const descripcion = (pDentro ? pre.replace(pDentro[0], '') : pre).replace(/\s+/g, ' ').trim();
      lineas.push({ descripcion: descripcion || 'Sin descripción', periodo, cantidad: Number(m[1]), precioUnitario: dinero(m[2]), monto: dinero(m[3]) });
      previo = m.index + m[0].length;
    }
    const cola = seccion.slice(previo).match(RX_PERIODO);
    if (cola && lineas.length && !lineas[lineas.length - 1].periodo) lineas[lineas.length - 1].periodo = cola[0];
  }
  const per = periodoIngles(lineas.find((l) => l.periodo)?.periodo ?? una.match(RX_PERIODO)?.[0]);

  return {
    proveedor: /anthropic/i.test(una) ? 'Anthropic' : null,
    numero,
    fecha,
    vence,
    periodoDesde: per?.desde ?? null,
    periodoHasta: per?.hasta ?? null,
    facturadoA,
    correoCuenta,
    moneda,
    subtotal: subtotal ? dinero(subtotal) : null,
    impuestos: impuestos ? dinero(impuestos) : null,
    total: total ? dinero(total) : lineas.length ? lineas.reduce((s, l) => s + l.monto, 0) : null,
    lineas,
  };
}

export interface RepartoDto {
  idEmpresa: number;
  empresa: string;
  monto: number;
}

/**
 * Reparto interno sugerido de una factura: proporcional al costo de las licencias
 * de esa organización por empresa (la que paga cada licencia). Sin licencias con
 * costo en la organización, todo queda a cargo de la empresa que pagó la factura.
 * Redondea a centavos y ajusta la diferencia en la empresa con más peso.
 */
export function sugerirReparto(
  total: number,
  pagadora: { idEmpresa: number; empresa: string },
  licencias: { idEmpresa: number; empresa: string; costoMensual: number | null }[],
): RepartoDto[] {
  const pesos = new Map<number, { empresa: string; peso: number }>();
  for (const l of licencias) {
    if (!l.costoMensual) continue;
    const p = pesos.get(l.idEmpresa) ?? { empresa: l.empresa, peso: 0 };
    p.peso += l.costoMensual;
    pesos.set(l.idEmpresa, p);
  }
  const suma = [...pesos.values()].reduce((s, p) => s + p.peso, 0);
  if (!suma) return [{ idEmpresa: pagadora.idEmpresa, empresa: pagadora.empresa, monto: Math.round(total * 100) / 100 }];
  const reparto = [...pesos.entries()]
    .map(([idEmpresa, p]) => ({ idEmpresa, empresa: p.empresa, monto: Math.round((total * p.peso * 100) / suma) / 100 }))
    .sort((a, b) => b.monto - a.monto);
  const dif = Math.round((total - reparto.reduce((s, r) => s + r.monto, 0)) * 100) / 100;
  if (dif) reparto[0].monto = Math.round((reparto[0].monto + dif) * 100) / 100;
  return reparto;
}

export interface FacturaResumenDto {
  idFactura: number;
  proveedor: string;
  numero: string;
  fecha: string;
  vence: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  facturadoA: string | null;
  correoCuenta: string | null;
  organizacion: string | null;
  idEmpresa: number;
  empresa: string;
  moneda: string;
  subtotal: number | null;
  impuestos: number | null;
  total: number;
  estado: string;
  notas: string | null;
  tienePdf: boolean;
  pdfNombre: string | null;
  lineas: LineaFacturaDto[];
  reparto: (RepartoDto & { fuente: string })[];
}

export interface EmpresaAnioDto {
  idEmpresa: number;
  empresa: string;
  pagado: number;
  corresponde: number;
  facturas: number;
}

export interface FacturasAnioDto {
  anio: number;
  anios: number[];
  moneda: string;
  facturas: FacturaResumenDto[];
  porEmpresa: EmpresaAnioDto[];
  porMes: { mes: number; total: number }[];
  porProveedor: { proveedor: string; total: number; facturas: number }[];
  total: number;
  sinReparto: number;
  empresas: { idEmpresa: number; empresa: string }[];
  organizaciones: string[];
}

/** Totales del año. Una factura sin reparto guardado cuenta completa para la empresa que la pagó. */
export function totalesDelAnio(
  anio: number,
  facturas: FacturaResumenDto[],
): Pick<FacturasAnioDto, 'porEmpresa' | 'porMes' | 'porProveedor' | 'total' | 'sinReparto'> {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const delAnio = facturas.filter((f) => f.fecha.startsWith(`${anio}-`));
  const emp = new Map<number, EmpresaAnioDto>();
  const fila = (id: number, nombre: string) => {
    const e = emp.get(id) ?? { idEmpresa: id, empresa: nombre, pagado: 0, corresponde: 0, facturas: 0 };
    emp.set(id, e);
    return e;
  };
  const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, total: 0 }));
  const prov = new Map<string, { proveedor: string; total: number; facturas: number }>();
  let sinReparto = 0;
  for (const f of delAnio) {
    const p = fila(f.idEmpresa, f.empresa);
    p.pagado = r2(p.pagado + f.total);
    p.facturas += 1;
    if (f.reparto.length) {
      for (const r of f.reparto) {
        const e = fila(r.idEmpresa, r.empresa);
        e.corresponde = r2(e.corresponde + r.monto);
      }
    } else {
      sinReparto += 1;
      p.corresponde = r2(p.corresponde + f.total);
    }
    const m = Number(f.fecha.slice(5, 7));
    if (m >= 1 && m <= 12) meses[m - 1].total = r2(meses[m - 1].total + f.total);
    const pv = prov.get(f.proveedor) ?? { proveedor: f.proveedor, total: 0, facturas: 0 };
    pv.total = r2(pv.total + f.total);
    pv.facturas += 1;
    prov.set(f.proveedor, pv);
  }
  return {
    porEmpresa: [...emp.values()].sort((a, b) => b.corresponde - a.corresponde || b.pagado - a.pagado),
    porMes: meses,
    porProveedor: [...prov.values()].sort((a, b) => b.total - a.total),
    total: r2(delAnio.reduce((s, f) => s + f.total, 0)),
    sinReparto,
  };
}

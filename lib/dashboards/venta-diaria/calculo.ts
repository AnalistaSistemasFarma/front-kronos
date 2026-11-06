/**
 * Cálculo del «Dashboard de venta diaria»: mes actual contra el MISMO LAPSO del
 * mes anterior (del día 1 al día del corte en ambos meses; si el mes anterior es
 * más corto, hasta su último día). Funciones puras; las usa la API.
 */

export interface FacturaVenta {
  DocDate?: string;
  DocTotal?: number;
  Cancelled?: string;
}

export interface DiaPunto {
  dia: number;
  fechaActual: string;
  fechaAnterior: string | null;
  actual: number;
  anterior: number | null;
}

export interface VentaDiariaResultado {
  corte: string;
  actual: { desde: string; hasta: string; total: number };
  anterior: { desde: string; hasta: string; total: number };
  dias: DiaPunto[];
  kpis: {
    totalActual: number;
    totalAnterior: number;
    variacion: number | null;
    diferencia: number;
    promedioDiarioActual: number;
    diasConVenta: number;
  };
}

export const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fecha de hoy en Colombia (AAAA-MM-DD), para no adelantarse un día después de las 7 p. m. */
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

/** Rangos a consultar: mes actual (1 → corte) y mismo lapso del mes anterior. */
export function rangosVentaDiaria(corte: Date) {
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
  `Invoices?$select=DocDate,DocTotal,Cancelled&$filter=DocDate ge '${desde}' and DocDate le '${hasta}'`;

/** Suma DocTotal por fecha (AAAA-MM-DD), ignorando documentos cancelados. */
export function sumarPorDia(rows: FacturaVenta[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.Cancelled === 'tYES') continue;
    const fecha = String(r.DocDate ?? '').slice(0, 10);
    if (!fecha) continue;
    map.set(fecha, (map.get(fecha) ?? 0) + Number(r.DocTotal ?? 0));
  }
  return map;
}

/** Serie alineada por número de día del mes y KPIs del comparativo. */
export function calcularVentaDiaria(
  corte: Date,
  facturasActual: FacturaVenta[],
  facturasAnterior: FacturaVenta[]
): VentaDiariaResultado {
  const rangos = rangosVentaDiaria(corte);
  const porDiaActual = sumarPorDia(facturasActual);
  const porDiaAnterior = sumarPorDia(facturasAnterior);

  const y = corte.getUTCFullYear();
  const m = corte.getUTCMonth();
  const ultimoDiaAnterior = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const dias: DiaPunto[] = [];
  let totalActual = 0;
  let totalAnterior = 0;
  for (let d = 1; d <= corte.getUTCDate(); d++) {
    const fa = iso(new Date(Date.UTC(y, m, d)));
    const vActual = porDiaActual.get(fa) ?? 0;
    totalActual += vActual;
    let fp: string | null = null;
    let vAnterior: number | null = null;
    if (d <= ultimoDiaAnterior) {
      fp = iso(new Date(Date.UTC(y, m - 1, d)));
      vAnterior = porDiaAnterior.get(fp) ?? 0;
      totalAnterior += vAnterior;
    }
    dias.push({ dia: d, fechaActual: fa, fechaAnterior: fp, actual: vActual, anterior: vAnterior });
  }

  const diasConVenta = dias.filter((x) => x.actual > 0).length;
  return {
    corte: iso(corte),
    actual: { ...rangos.actual, total: totalActual },
    anterior: { ...rangos.anterior, total: totalAnterior },
    dias,
    kpis: {
      totalActual,
      totalAnterior,
      variacion: totalAnterior > 0 ? (totalActual - totalAnterior) / totalAnterior : null,
      diferencia: totalActual - totalAnterior,
      promedioDiarioActual: diasConVenta ? totalActual / diasConVenta : 0,
      diasConVenta,
    },
  };
}

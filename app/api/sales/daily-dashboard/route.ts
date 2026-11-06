import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { sapGetAll, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Dashboard gerencial de venta diaria (trazabilidad del mes actual vs. el mismo
 * lapso del mes anterior). Lee las facturas de venta de SAP (Invoices) en vivo y
 * las agrega por día en el servidor. Solo lectura.
 *
 *   GET ?companyId[&corte=AAAA-MM-DD]
 *     -> { corte, actual:{...}, anterior:{...}, dias:[{dia, fecha, actual, anterior}], kpis:{...} }
 *
 * «Mismo lapso»: ambos meses se comparan desde el día 1 hasta el día del corte
 * (p. ej. corte el 06 → actual 01–06 del mes en curso, anterior 01–06 del mes
 * previo). El corte por defecto es hoy.
 *
 * Requiere «Ventas · Ofertas» (lectura) en la empresa. Las credenciales SAP solo
 * viven del lado del servidor.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Primer día del mes de `d`. */
function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Mismo lapso: el mes anterior acotado hasta el mismo día del corte (o fin de mes si no existe). */
function prevMonthRange(corte: Date): { start: Date; end: Date } {
  const y = corte.getUTCFullYear();
  const m = corte.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 1, 1));
  // Último día del mes anterior (para no pasarnos si el mes previo es más corto).
  const lastDayPrev = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(corte.getUTCDate(), lastDayPrev);
  const end = new Date(Date.UTC(y, m - 1, day));
  return { start, end };
}

interface Invoice {
  DocDate?: string;
  DocTotal?: number;
  Cancelled?: string;
}

/** Suma DocTotal por fecha (AAAA-MM-DD), ignorando documentos cancelados. */
function sumByDay(rows: Invoice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.Cancelled === 'tYES') continue;
    const fecha = String(r.DocDate ?? '').slice(0, 10);
    if (!fecha) continue;
    map.set(fecha, (map.get(fecha) ?? 0) + Number(r.DocTotal ?? 0));
  }
  return map;
}

const invoicesPath = (desde: string, hasta: string) =>
  `Invoices?$select=DocDate,DocTotal,Cancelled&$filter=DocDate ge '${desde}' and DocDate le '${hasta}'`;

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });

    const corteParam = sp.get('corte');
    const corte = corteParam && /^\d{4}-\d{2}-\d{2}$/.test(corteParam) ? new Date(`${corteParam}T00:00:00Z`) : new Date();
    if (Number.isNaN(corte.getTime())) return NextResponse.json({ error: 'Corte inválido' }, { status: 400 });

    const a = await salesEndpointForUser(session.user.email, companyId);
    if (!a?.endpoint) {
      return NextResponse.json({ error: 'Sin acceso a Ventas en esta empresa («Ventas · Ofertas»).' }, { status: 403 });
    }

    const actualStart = monthStart(corte);
    const { start: prevStart, end: prevEnd } = prevMonthRange(corte);

    const sap = await sapLogin(a.endpoint);
    let actualRows: Invoice[];
    let prevRows: Invoice[];
    try {
      actualRows = await sapGetAll<Invoice>(sap, invoicesPath(iso(actualStart), iso(corte)), { cap: 20000 });
      prevRows = await sapGetAll<Invoice>(sap, invoicesPath(iso(prevStart), iso(prevEnd)), { cap: 20000 });
    } finally {
      await sapLogout(sap);
    }

    const actualByDay = sumByDay(actualRows);
    const prevByDay = sumByDay(prevRows);

    // Serie alineada por número de día del mes (día 1..N del corte).
    const diasCorte = corte.getUTCDate();
    const y = corte.getUTCFullYear();
    const m = corte.getUTCMonth();
    const lastDayPrev = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const dias: { dia: number; fechaActual: string; fechaAnterior: string | null; actual: number; anterior: number | null }[] = [];
    let totalActual = 0;
    let totalAnterior = 0;
    for (let d = 1; d <= diasCorte; d++) {
      const fa = iso(new Date(Date.UTC(y, m, d)));
      const vActual = actualByDay.get(fa) ?? 0;
      totalActual += vActual;
      let fp: string | null = null;
      let vAnterior: number | null = null;
      if (d <= lastDayPrev) {
        fp = iso(new Date(Date.UTC(y, m - 1, d)));
        vAnterior = prevByDay.get(fp) ?? 0;
        totalAnterior += vAnterior;
      }
      dias.push({ dia: d, fechaActual: fa, fechaAnterior: fp, actual: vActual, anterior: vAnterior });
    }

    const variacion = totalAnterior > 0 ? (totalActual - totalAnterior) / totalAnterior : null;
    const diasConVenta = dias.filter((x) => x.actual > 0).length;

    return NextResponse.json(
      {
        corte: iso(corte),
        actual: { desde: iso(actualStart), hasta: iso(corte), total: totalActual },
        anterior: { desde: iso(prevStart), hasta: iso(prevEnd), total: totalAnterior },
        dias,
        kpis: {
          totalActual,
          totalAnterior,
          variacion,
          diferencia: totalActual - totalAnterior,
          promedioDiarioActual: diasConVenta ? totalActual / diasConVenta : 0,
          diasConVenta,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en dashboard de venta diaria:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { accesoVentaDiaria, getVentaDiariaEmpresas } from '../../../../lib/dashboards/venta-diaria/access';
import {
  calcularVentaDiaria,
  parseCorte,
  rangosVentaDiaria,
  rutaFacturas,
  type FacturaVenta,
} from '../../../../lib/dashboards/venta-diaria/calculo';
import { sapGetAll, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Dashboard gerencial de venta diaria (mes actual vs. el mismo lapso del mes
 * anterior). Lee las facturas de venta de SAP (Invoices) en vivo por Service Layer
 * y las agrega por día en el servidor. SOLO LECTURA (GET).
 *
 *   GET                          -> { empresas:[{ id, nombre, lista }] }   (empresas permitidas)
 *   GET ?companyId[&corte=AAAA-MM-DD]
 *     -> { corte, actual:{...}, anterior:{...}, dias:[...], kpis:{...} }
 *
 * Acceso: subproceso «Dashboard de venta diaria» (/process/dashboards/venta-diaria)
 * asignado al usuario en la empresa. 401 sin sesión; 403 sin permiso.
 * Las credenciales SAP solo viven del lado del servidor.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const email = session.user.email;

    const sp = new URL(request.url).searchParams;
    const companyParam = sp.get('companyId');

    if (!companyParam) {
      const empresas = await getVentaDiariaEmpresas(email);
      if (empresas.length === 0) {
        return NextResponse.json({ error: 'No tiene acceso a este tablero.' }, { status: 403 });
      }
      return NextResponse.json({ empresas }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const companyId = Number(companyParam);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'Empresa inválida' }, { status: 400 });
    }

    const acceso = await accesoVentaDiaria(email, companyId);
    if (!acceso.permitido) {
      return NextResponse.json({ error: 'No tiene acceso a este tablero en esta empresa.' }, { status: 403 });
    }
    if (!acceso.endpoint) {
      return NextResponse.json({ error: 'La empresa no tiene Service Layer de SAP configurado.' }, { status: 409 });
    }

    const corte = parseCorte(sp.get('corte'));
    if (!corte) return NextResponse.json({ error: 'Corte inválido' }, { status: 400 });

    const rangos = rangosVentaDiaria(corte);
    const sap = await sapLogin(acceso.endpoint);
    let facturasActual: FacturaVenta[];
    let facturasAnterior: FacturaVenta[];
    try {
      facturasActual = await sapGetAll<FacturaVenta>(sap, rutaFacturas(rangos.actual.desde, rangos.actual.hasta), { cap: 20000 });
      facturasAnterior = await sapGetAll<FacturaVenta>(sap, rutaFacturas(rangos.anterior.desde, rangos.anterior.hasta), { cap: 20000 });
    } finally {
      await sapLogout(sap);
    }

    return NextResponse.json(calcularVentaDiaria(corte, facturasActual, facturasAnterior), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en dashboard de venta diaria:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

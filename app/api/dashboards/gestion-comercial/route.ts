import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  accesoGestionComercial,
  getGestionComercialEmpresas,
} from '../../../../lib/dashboards/gestion-comercial/access';
import {
  calcularGestionComercial,
  parseCorte,
  rangosMes,
  rutaFacturas,
  rutaNotasCredito,
  rutaVendedores,
  type DocVenta,
  type Vendedor,
} from '../../../../lib/dashboards/gestion-comercial/calculo';
import {
  calcularLineas,
  rutaLineasVenta,
  type LineaVenta,
  type LineasResultado,
} from '../../../../lib/dashboards/gestion-comercial/lineas';
import { sapGetAll, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Dashboard de gestión comercial (etapa 1: estructura + datos en vivo de SAP).
 * Lee facturas (Invoices) y notas crédito (CreditNotes) del mes del corte y del
 * mismo lapso del mes anterior, más el catálogo de vendedores, y agrega todo EN
 * EL SERVIDOR. SOLO LECTURA (GET).
 *
 *   GET                         -> { empresas:[{ id, nombre, lista }] }
 *   GET ?companyId[&corte=AAAA-MM-DD]
 *     -> GestionComercialResultado (KPIs, serie diaria, top clientes, vendedores…)
 *
 * Acceso: subproceso «Dashboard de gestión comercial»
 * (/process/dashboards/gestion-comercial) asignado al usuario en la empresa.
 * 401 sin sesión; 403 sin permiso; 409 sin Service Layer. Credenciales SAP solo
 * en el servidor.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const email = session.user.email;

    const sp = new URL(request.url).searchParams;
    const companyParam = sp.get('companyId');

    if (!companyParam) {
      const empresas = await getGestionComercialEmpresas(email);
      if (empresas.length === 0) {
        return NextResponse.json({ error: 'No tiene acceso a este tablero.' }, { status: 403 });
      }
      return NextResponse.json({ empresas }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const companyId = Number(companyParam);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'Empresa inválida' }, { status: 400 });
    }

    const acceso = await accesoGestionComercial(email, companyId);
    if (!acceso.permitido) {
      return NextResponse.json({ error: 'No tiene acceso a este tablero en esta empresa.' }, { status: 403 });
    }
    if (!acceso.endpoint) {
      return NextResponse.json({ error: 'La empresa no tiene Service Layer de SAP configurado.' }, { status: 409 });
    }

    const corte = parseCorte(sp.get('corte'));
    if (!corte) return NextResponse.json({ error: 'Corte inválido' }, { status: 400 });

    const rangos = rangosMes(corte);
    const sap = await sapLogin(acceso.endpoint);
    let facturasActual: DocVenta[];
    let facturasAnterior: DocVenta[];
    let notasActual: DocVenta[];
    let notasAnterior: DocVenta[];
    let vendedores: Vendedor[];
    // Etapa 2: desglose por producto / línea terapéutica / pedido / detalle, desde
    // la vista OLP_IND_VentasB1SLQuery (líneas del mes del corte). Es tolerante a
    // fallos: si la vista no está disponible, el tablero responde igual sin ese bloque.
    let lineas: LineasResultado | null = null;
    try {
      facturasActual = await sapGetAll<DocVenta>(sap, rutaFacturas(rangos.actual.desde, rangos.actual.hasta), { cap: 30000 });
      facturasAnterior = await sapGetAll<DocVenta>(sap, rutaFacturas(rangos.anterior.desde, rangos.anterior.hasta), { cap: 30000 });
      notasActual = await sapGetAll<DocVenta>(sap, rutaNotasCredito(rangos.actual.desde, rangos.actual.hasta), { cap: 30000 });
      notasAnterior = await sapGetAll<DocVenta>(sap, rutaNotasCredito(rangos.anterior.desde, rangos.anterior.hasta), { cap: 30000 });
      vendedores = await sapGetAll<Vendedor>(sap, rutaVendedores(), { cap: 5000 });
      try {
        const filasLineas = await sapGetAll<LineaVenta>(
          sap,
          rutaLineasVenta(rangos.actual.desde, rangos.actual.hasta),
          { cap: 60000 }
        );
        lineas = calcularLineas(rangos.actual.desde, rangos.actual.hasta, filasLineas);
      } catch (errLineas) {
        console.error('Vista de líneas de venta no disponible (etapa 2):', errLineas);
        lineas = null;
      }
    } finally {
      await sapLogout(sap);
    }

    const base = calcularGestionComercial(corte, facturasActual, notasActual, facturasAnterior, notasAnterior, vendedores);
    return NextResponse.json({ ...base, lineas }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en dashboard de gestión comercial:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

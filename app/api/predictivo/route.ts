import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { hasPrediccionesAccess, PREDICCIONES_COMPANY_ID } from '../../../lib/predictivo/access';
import { getPrediccion } from '../../../lib/predictivo/snapshot';

/**
 * GET /api/predictivo?companyId=N — pronóstico precalculado de una empresa
 * (por defecto Farmalógica). El usuario debe tener el subproceso asignado en
 * esa empresa.
 *
 * El JSON lo genera analytics/predictivo/generar_farmalogica.py a partir de
 * las listas SharePoint FAR-VENTAS / FAR-INVENTARIO / FAR-LOTES / FAR-REGISTRO
 * SANITARIO (ventas desde SAP); el de las demás empresas, generar_empresa.py
 * (ventas desde SAP). Se lee el último snapshot publicado en la tabla
 * predictivo_snapshots; si no hay, el JSON del repo (solo Farmalógica).
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const param = new URL(request.url).searchParams.get('companyId');
    const companyId = param === null ? PREDICCIONES_COMPANY_ID : Number(param);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'companyId inválido' }, { status: 400 });
    }
    const allowed = await hasPrediccionesAccess(session.user.email, companyId);
    if (!allowed) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }
    const { data, origen } = await getPrediccion(companyId);
    return NextResponse.json({ data, origen });
  } catch (error) {
    console.error('Error entregando Predicciones:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

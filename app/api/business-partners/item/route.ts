import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/business-partners/access';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Detalle COMPLETO de un socio de negocio (entidad BusinessPartners / OCRD de
 * SAP B1). Modulo SOLO LECTURA.
 *
 * A diferencia del listado, hace un GET de BusinessPartners('CardCode') SIN
 * $select, de modo que SAP devuelve el objeto entero (todos los campos
 * escalares estandar). La UI usa esto para mostrar la ficha del socio.
 *
 * Requiere permiso de LECTURA en la empresa. NO trae las colecciones hijas
 * pesadas (direcciones, personas de contacto, etc.): el GET por clave devuelve
 * el cabezal del socio, suficiente para el detalle.
 */

/** Escapa comillas simples para claves literales OData. */
function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const cardCode = String(searchParams.get('cardCode') ?? '').trim();
    if (!companyId || !cardCode) {
      return NextResponse.json({ error: 'Falta companyId o cardCode' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId);
    if (!company || !company.endpoint) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      // GET por clave SIN $select -> objeto BusinessPartners completo.
      const item = await sapGet<Record<string, unknown>>(
        sap,
        `BusinessPartners('${escapeOData(cardCode)}')`
      );
      return NextResponse.json({ item });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      const status = error.status === 404 ? 404 : error.status;
      const message = error.status === 404 ? 'Socio de negocio no encontrado' : error.message;
      return NextResponse.json({ error: message, detail: error.detail }, { status });
    }
    console.error('Error consultando detalle de socio de negocio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/purchases/access';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Detalle COMPLETO de un Draft de compras (Solicitud u Orden) de SAP B1.
 *
 * A diferencia del listado, hace un GET de Drafts(DocEntry) SIN $select, de modo
 * que SAP devuelve el objeto entero: todos los campos escalares de cabecera mas
 * la familia U_SEND_*. La UI (DetailModal, solo lectura) lo usa para mostrar
 * toda la informacion de cabecera.
 *
 * La clave real de un Draft es DocEntry (DocNum se repite entre series). El GET
 * por clave es Drafts(DocEntry), entero, sin comillas.
 *
 * Requiere permiso de LECTURA en la empresa. NO trae DocumentLines (el wrapper
 * no admite $expand y las lineas quedan fuera del MVP).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const docEntry = Number(searchParams.get('docEntry'));
    if (!companyId || !Number.isInteger(docEntry)) {
      return NextResponse.json({ error: 'Falta companyId o docEntry' }, { status: 400 });
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
      // GET por clave SIN $select -> Draft completo (cabecera estandar + U_SEND_*).
      const item = await sapGet<Record<string, unknown>>(sap, `Drafts(${docEntry})`);
      return NextResponse.json({ item });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      const status = error.status === 404 ? 404 : error.status;
      const message = error.status === 404 ? 'Documento no encontrado' : error.message;
      return NextResponse.json({ error: message, detail: error.detail }, { status });
    }
    console.error('Error consultando detalle de compra:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

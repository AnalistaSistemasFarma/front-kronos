import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/articles/access';
import { escapeOData } from '../../../../lib/articles/articles';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Detalle COMPLETO de un articulo (entidad Items / OITM de SAP B1).
 *
 * A diferencia del listado, hace un GET de Items('ItemCode') SIN $select, de
 * modo que SAP devuelve el objeto entero: todos los campos escalares estandar
 * mas la familia U_* personalizada de la empresa. La UI usa esto para mostrar
 * "toda la informacion" del articulo y permitir editar lo que corresponda.
 *
 * Requiere permiso de LECTURA en la empresa. NO trae las colecciones hijas
 * pesadas (precios, info por almacen, etc.): el GET por clave de SAP devuelve
 * solo el cabezal de Items, que es lo que necesita el modal.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const itemCode = String(searchParams.get('itemCode') ?? '').trim();
    if (!companyId || !itemCode) {
      return NextResponse.json({ error: 'Falta companyId o itemCode' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'read');
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
      // GET por clave SIN $select -> objeto Items completo (estandar + U_*).
      const item = await sapGet<Record<string, unknown>>(
        sap,
        `Items('${escapeOData(itemCode)}')`
      );
      return NextResponse.json({ item });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      const status = error.status === 404 ? 404 : error.status;
      const message = error.status === 404 ? 'Articulo no encontrado' : error.message;
      return NextResponse.json({ error: message, detail: error.detail }, { status });
    }
    console.error('Error consultando detalle de articulo:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

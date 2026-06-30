import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/articles/access';
import { crearArticulo, itemExiste, sanitizeItem } from '../../../../lib/articles/articles';
import { REQUIRED_ON_CREATE } from '../../../../lib/articles/fields';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Crea un articulo (Item) en la base SAP de la empresa indicada. El usuario debe
 * tener permiso de ESCRITURA en esa empresa. Valida el set minimo y que el
 * ItemCode NO exista. El Login y la creacion ocurren solo en el servidor.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    if (!companyId) {
      return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en esta empresa o no esta configurada' },
        { status: 403 }
      );
    }

    const item = sanitizeItem(body.item ?? {}, company.companyName);

    // Set minimo de creacion.
    const faltantes = REQUIRED_ON_CREATE.filter((f) => item[f] === undefined || item[f] === '');
    if (faltantes.length > 0) {
      return NextResponse.json(
        { error: `Datos obligatorios faltantes: ${faltantes.join(', ')}` },
        { status: 400 }
      );
    }

    const itemCode = String(item.ItemCode);

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      if (await itemExiste(sap, itemCode)) {
        return NextResponse.json(
          { error: `Ya existe un articulo con el codigo ${itemCode}` },
          { status: 409 }
        );
      }

      const created = await crearArticulo(sap, item);
      return NextResponse.json({ ok: true, itemCode: created, companyId });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error creando articulo:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

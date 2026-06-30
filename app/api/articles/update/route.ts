import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/articles/access';
import { actualizarArticulo, sanitizeItem } from '../../../../lib/articles/articles';
import { registrarCambioArticulo } from '../../../../lib/articles/log';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Edita un articulo existente (PATCH Items('ItemCode')) con SOLO los campos
 * cambiados. Requiere permiso de escritura. El ItemCode (clave) no es editable.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const itemCode = String(body.itemCode ?? '').trim();
    if (!companyId || !itemCode) {
      return NextResponse.json({ error: 'Falta companyId o itemCode' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en esta empresa o no esta configurada' },
        { status: 403 }
      );
    }

    const changes = sanitizeItem(body.changes ?? {}, company.companyName);
    // El ItemCode es la clave, nunca se cambia via PATCH del cuerpo.
    delete changes.ItemCode;

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ error: 'No hay cambios para guardar' }, { status: 400 });
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      await actualizarArticulo(sap, itemCode, changes);
      // Bitácora de cambios (best-effort): solo si la empresa tiene log configurado.
      await registrarCambioArticulo(sap, company.endpoint.logObject, {
        itemCode,
        action: 'actualizar',
        changes,
        userEmail: session.user.email,
      });
      return NextResponse.json({ ok: true, itemCode, companyId });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error editando articulo:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

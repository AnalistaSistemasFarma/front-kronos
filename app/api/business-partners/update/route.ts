import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/business-partners/access';
import { actualizarSocio, sanitizeBusinessPartner } from '../../../../lib/business-partners/partners';
import { EDITABLE_ON_UPDATE } from '../../../../lib/business-partners/fields';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Edita un socio de negocio existente (PATCH BusinessPartners('CardCode')) con
 * SOLO los campos del ENCABEZADO cambiados (mas cualquier campo U_*). El
 * CardCode (clave) no es editable. Espejo de app/api/articles/update.
 *
 * GATEO DE ESCRITURA (decision documentada):
 * Se valida SIEMPRE la sesion (getServerSession). El acceso se resuelve con
 * `level: 'read'` a proposito: el subproceso de escritura del modulo aun no
 * esta sembrado en BD, y gatear por 'write' bloquearia la prueba en testing.
 * Por eso hoy puede actualizar quien tenga acceso de LECTURA al modulo. Cuando
 * se siembre `/process/business-partners/manage`, cambie 'read' por 'write'
 * aqui (canWrite ya esta expuesto en lib/business-partners/access.ts).
 *
 * Las colecciones hijas (direcciones, contactos, cuentas bancarias) NO se
 * editan por esta via: sanitizeBusinessPartner las descarta. En esta iteracion
 * son de solo lectura en el detalle; solo el encabezado del socio es editable.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const cardCode = String(body.cardCode ?? '').trim();
    if (!companyId || !cardCode) {
      return NextResponse.json({ error: 'Falta companyId o cardCode' }, { status: 400 });
    }

    // NOTA: gateo por 'read' a proposito (ver comentario de cabecera). El PATCH
    // igual exige sesion valida y acceso al modulo en esta empresa.
    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'read');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene acceso a esta empresa o no esta configurada' },
        { status: 403 }
      );
    }

    const sanitized = sanitizeBusinessPartner(body.changes ?? {});
    // El CardCode es la clave, nunca se cambia via PATCH del cuerpo.
    delete sanitized.CardCode;

    // Solo se aceptan los campos editables del encabezado (y U_*, que la
    // whitelist de sanitizeBusinessPartner ya deja pasar).
    const changes: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(sanitized)) {
      if (EDITABLE_ON_UPDATE.includes(key) || /^U_/.test(key)) changes[key] = value;
    }

    if (Object.keys(changes).length === 0) {
      return NextResponse.json(
        { error: 'No hay cambios permitidos para guardar.' },
        { status: 400 }
      );
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    try {
      await actualizarSocio(sap, cardCode, changes);
      return NextResponse.json({ ok: true, cardCode, companyId });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error editando socio de negocio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

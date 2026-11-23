import { NextResponse } from 'next/server';
import { NO_STORE, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { PORTAL_ACCESS_ERROR_MESSAGE, PORTAL_ACCESS_NOT_CONFIGURED_MESSAGE } from '@/lib/api-permissions/constants';
import { fetchPortalAccess } from '@/lib/api-permissions/portal-terceros';
import { parseNitList } from '@/lib/api-permissions/subject-rules';

export const dynamic = 'force-dynamic';

/**
 * GET /api/administration/api-clients/subjects/portal-terceros/accesos?nits=a,b → { items: { [nit]: PortalAcceso } }
 * Qué ve cada proveedor o cliente en el portal (usuarios y módulos por empresa), desde la API de
 * la landing. Solo lectura: se edita en la landing. La llave nunca llega al navegador.
 * 503 { error, code: 'not_configured' } si faltan PORTAL_TERCEROS_URL / PORTAL_TERCEROS_KEY; 502 si no responde.
 */
export async function GET(request: Request) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  const nits = parseNitList(new URL(request.url).searchParams.get('nits'));
  if (!nits) {
    return NextResponse.json({ error: 'NIT no válidos' }, { status: 400, headers: NO_STORE });
  }
  const result = await fetchPortalAccess(nits);
  if (result.status === 'not_configured') {
    return NextResponse.json(
      { error: PORTAL_ACCESS_NOT_CONFIGURED_MESSAGE, code: 'not_configured' },
      { status: 503, headers: NO_STORE }
    );
  }
  if (result.status === 'error') {
    return NextResponse.json({ error: PORTAL_ACCESS_ERROR_MESSAGE }, { status: 502, headers: NO_STORE });
  }
  return NextResponse.json({ items: result.value }, { headers: NO_STORE });
}

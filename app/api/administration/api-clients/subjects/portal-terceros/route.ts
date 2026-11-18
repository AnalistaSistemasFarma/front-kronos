import { NextResponse } from 'next/server';
import { NO_STORE, requireApiClientAdmin } from '@/lib/api-permissions/access';
import {
  PORTAL_TERCEROS_NOT_CONFIGURED_MESSAGE,
  PORTAL_TERCEROS_SEARCH_ERROR_MESSAGE,
} from '@/lib/api-permissions/constants';
import { searchPortalTerceros } from '@/lib/api-permissions/portal-terceros';
import { parseSearchQuery } from '@/lib/api-permissions/subject-rules';

export const dynamic = 'force-dynamic';

/**
 * GET /api/administration/api-clients/subjects/portal-terceros?q= → { items: [{ nit, nombre, empresas, tipo }] }
 * Puente del lado del servidor a la API SAP: proveedores y clientes (la llave nunca llega al navegador).
 * 503 { error, code: 'not_configured' } si faltan SAP_API_URL / SAP_API_SYNERLINK_PRIVATE_KEY;
 * 502 genérico si la API SAP no responde.
 */
export async function GET(request: Request) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  const q = parseSearchQuery(new URL(request.url).searchParams.get('q'));
  if (q === null) {
    return NextResponse.json({ error: 'Escribe entre 2 y 60 caracteres' }, { status: 400, headers: NO_STORE });
  }
  const result = await searchPortalTerceros(q);
  if (result.status === 'not_configured') {
    return NextResponse.json(
      { error: PORTAL_TERCEROS_NOT_CONFIGURED_MESSAGE, code: 'not_configured' },
      { status: 503, headers: NO_STORE }
    );
  }
  if (result.status === 'error') {
    return NextResponse.json({ error: PORTAL_TERCEROS_SEARCH_ERROR_MESSAGE }, { status: 502, headers: NO_STORE });
  }
  return NextResponse.json({ items: result.value }, { headers: NO_STORE });
}

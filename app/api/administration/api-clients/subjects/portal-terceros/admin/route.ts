import { NextResponse } from 'next/server';
import { NO_STORE, readJsonBody, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { PORTAL_ACCESS_ERROR_MESSAGE, PORTAL_ACCESS_NOT_CONFIGURED_MESSAGE } from '@/lib/api-permissions/constants';
import { parsePortalAdminBody } from '@/lib/api-permissions/portal-admin-rules';
import { callPortalAdmin } from '@/lib/api-permissions/portal-terceros';
import { NIT_PATTERN } from '@/lib/api-permissions/subject-rules';

export const dynamic = 'force-dynamic';

/**
 * Administración del portal de proveedores desde SynerLink (2026-11-09). Puente a la API de la landing.
 *   GET  ?nit=        → usuarios del proveedor, sus empresas y módulos, cupo y catálogo.
 *   POST { action, nit, … } → crear / editar / desactivar usuarios, restablecer contraseña,
 *        vincular o quitar empresas y marcar módulos (lib/api-permissions/portal-admin-rules.ts).
 * Misma reja que el resto de Permisos API. La contraseña temporal de crear / restablecer viaja una
 * sola vez en la respuesta y no se guarda ni se registra en Kronos.
 */
function notConfigured() {
  return NextResponse.json(
    { error: PORTAL_ACCESS_NOT_CONFIGURED_MESSAGE, code: 'not_configured' },
    { status: 503, headers: NO_STORE }
  );
}

function unreachable() {
  return NextResponse.json({ error: PORTAL_ACCESS_ERROR_MESSAGE }, { status: 502, headers: NO_STORE });
}

export async function GET(request: Request) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  const nit = new URL(request.url).searchParams.get('nit')?.trim() ?? '';
  if (!NIT_PATTERN.test(nit)) return NextResponse.json({ error: 'NIT no válido' }, { status: 400, headers: NO_STORE });
  const result = await callPortalAdmin({ method: 'GET', nit });
  if (result.status === 'not_configured') return notConfigured();
  if (result.status === 'error') return unreachable();
  return NextResponse.json(result.value.body ?? { error: PORTAL_ACCESS_ERROR_MESSAGE }, {
    status: result.value.body ? result.value.status : 502,
    headers: NO_STORE,
  });
}

export async function POST(request: Request) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  const parsed = parsePortalAdminBody(await readJsonBody(request));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  const result = await callPortalAdmin({ method: 'POST', body: parsed.value, actor: admin.email });
  if (result.status === 'not_configured') return notConfigured();
  if (result.status === 'error') return unreachable();
  return NextResponse.json(result.value.body ?? { error: PORTAL_ACCESS_ERROR_MESSAGE }, {
    status: result.value.body ? result.value.status : 502,
    headers: NO_STORE,
  });
}

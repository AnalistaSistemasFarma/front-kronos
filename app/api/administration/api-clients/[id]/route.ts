import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, readJsonBody, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { deleteApiClient, getApiClient, updateApiClient } from '@/lib/api-permissions/db';
import { parseRouteId } from '@/lib/api-permissions/rules';
import { validateApiClientBody } from '@/lib/api-permissions/validate';

export const dynamic = 'force-dynamic';

/** PATCH /api/administration/api-clients/[id] — edita el cliente (objeto completo: datos, empresas, permisos, activo). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const id = parseRouteId((await params).id);
    if (!id) return NextResponse.json({ error: 'Cliente no válido' }, { status: 400, headers: NO_STORE });
    const parsed = await validateApiClientBody(await readJsonBody(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
    const updated = await updateApiClient(id, parsed.value, admin.email);
    if (!updated) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true, client: await getApiClient(id) }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'update');
  }
}

/**
 * DELETE /api/administration/api-clients/[id] — elimina el cliente de API con sus llaves, empresas y
 * permisos (no el agente de IA). Lo que use sus llaves deja de funcionar en máximo 1 minuto.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const id = parseRouteId((await params).id);
    if (!id) return NextResponse.json({ error: 'Cliente no válido' }, { status: 400, headers: NO_STORE });
    const deleted = await deleteApiClient(id, admin.email);
    if (!deleted) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'delete');
  }
}

import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, readJsonBody, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { isUniqueViolation, updateExternalSystem } from '@/lib/api-permissions/db';
import { parseRouteId } from '@/lib/api-permissions/rules';
import { parseExternalSystemPatch } from '@/lib/api-permissions/subject-rules';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/administration/api-clients/external-systems/[id] — renombra, cambia la descripción o
 * activa/desactiva un sistema. Al renombrar se actualiza el nombre visible de los clientes que lo usan.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const id = parseRouteId((await params).id);
    if (!id) return NextResponse.json({ error: 'Sistema no válido' }, { status: 400, headers: NO_STORE });
    const parsed = parseExternalSystemPatch(await readJsonBody(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
    const updated = await updateExternalSystem(id, parsed.value, admin.email);
    if (!updated) return NextResponse.json({ error: 'Sistema no encontrado' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'Ya existe un sistema con ese nombre' }, { status: 409, headers: NO_STORE });
    }
    return adminErrorResponse(error, 'external-systems:update');
  }
}

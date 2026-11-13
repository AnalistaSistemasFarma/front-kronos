import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, readJsonBody, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { createExternalSystem, isUniqueViolation, listExternalSystems } from '@/lib/api-permissions/db';
import { parseExternalSystemCreate } from '@/lib/api-permissions/subject-rules';

export const dynamic = 'force-dynamic';

/** GET /api/administration/api-clients/external-systems → { items } (activos e inactivos, con cuántos clientes lo usan). */
export async function GET() {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json({ items: await listExternalSystems() }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'external-systems:list');
  }
}

/** POST /api/administration/api-clients/external-systems — crea un sistema (nombre único). */
export async function POST(request: Request) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const parsed = parseExternalSystemCreate(await readJsonBody(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
    const id = await createExternalSystem(parsed.value, admin.email);
    return NextResponse.json({ id }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'Ya existe un sistema con ese nombre' }, { status: 409, headers: NO_STORE });
    }
    return adminErrorResponse(error, 'external-systems:create');
  }
}

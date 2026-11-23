import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { searchSynerlinkUsers } from '@/lib/api-permissions/db';
import { parseSearchQuery } from '@/lib/api-permissions/subject-rules';

export const dynamic = 'force-dynamic';

/**
 * GET /api/administration/api-clients/subjects/synerlink-users?q= → { items: [{ id, name, email }] }
 * Hasta 20 usuarios ACTIVOS por nombre o correo, para elegir el sujeto de un cliente tipo «synerlink».
 */
export async function GET(request: Request) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  const q = parseSearchQuery(new URL(request.url).searchParams.get('q'));
  if (q === null) {
    return NextResponse.json({ error: 'Escribe entre 2 y 60 caracteres' }, { status: 400, headers: NO_STORE });
  }
  try {
    const items = await searchSynerlinkUsers(q);
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'synerlink-users');
  }
}

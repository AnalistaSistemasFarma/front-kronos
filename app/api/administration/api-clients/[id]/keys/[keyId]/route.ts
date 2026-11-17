import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { getApiClient, revokeApiClientKey } from '@/lib/api-permissions/db';
import { parseRouteId } from '@/lib/api-permissions/rules';

export const dynamic = 'force-dynamic';

/** DELETE /api/administration/api-clients/[id]/keys/[keyId] — revoca la llave (no se borra: queda para auditoría). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const { id: rawId, keyId: rawKeyId } = await params;
    const id = parseRouteId(rawId);
    const keyId = parseRouteId(rawKeyId);
    if (!id || !keyId) return NextResponse.json({ error: 'Llave no válida' }, { status: 400, headers: NO_STORE });
    const revoked = await revokeApiClientKey(id, keyId, admin.email);
    if (!revoked) return NextResponse.json({ error: 'La llave no existe o ya estaba revocada' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true, client: await getApiClient(id) }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'revoke-key');
  }
}

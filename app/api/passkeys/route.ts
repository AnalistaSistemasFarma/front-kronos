import { NextResponse } from 'next/server';
import { passkeyErrorResponse } from '../../../lib/auth/passkeys/http';
import { listPasskeys } from '../../../lib/auth/passkeys/service';
import { passkeySessionUser } from '../../../lib/auth/passkeys/session';

/**
 * GET /api/passkeys → { available, passkeys } de la persona de la sesión (Mi perfil).
 * available = false si la tabla aún no existe (pase sin el SQL).
 */
export async function GET() {
  try {
    const user = await passkeySessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const passkeys = await listPasskeys(user.id);
    return NextResponse.json({ available: true, passkeys }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return passkeyErrorResponse(error, 'GET /api/passkeys');
  }
}

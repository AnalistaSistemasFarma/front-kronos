import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { passkeyErrorResponse } from '../../../../lib/auth/passkeys/http';
import { deletePasskey } from '../../../../lib/auth/passkeys/service';
import { passkeySessionUser } from '../../../../lib/auth/passkeys/session';

/** DELETE /api/passkeys/:id → elimina un dispositivo propio (queda en la bitácora del usuario). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await passkeySessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const { id } = await ctx.params;
    const passkeyId = Number(id);
    if (!Number.isInteger(passkeyId) || passkeyId <= 0) {
      return NextResponse.json({ error: 'Dispositivo no válido' }, { status: 400 });
    }
    const removed = await deletePasskey(user.id, passkeyId);
    if (!removed) return NextResponse.json({ error: 'Dispositivo no encontrado' }, { status: 404 });
    await prisma.userAuditLog.create({
      data: {
        user_id: user.id,
        action: 'PASSKEY_REMOVED',
        performed_by: user.email,
        details: `Biométrico eliminado: ${removed.name}`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return passkeyErrorResponse(error, 'DELETE /api/passkeys/[id]');
  }
}

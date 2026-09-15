import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { userHasDeleteAttachmentsPermission } from '@/lib/attachments/permissions';

/** GET: ¿el usuario actual puede eliminar adjuntos? */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const userId = session.user.id != null ? String(session.user.id) : '';
    const canDelete = userId
      ? await withMssqlPool((pool) => userHasDeleteAttachmentsPermission(pool, userId))
      : false;
    return NextResponse.json({ canDeleteAttachments: canDelete });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { checkAdminPrivileges } from '@/lib/access-control';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import { syncAllUsersToOrion } from '@/lib/orion/userSync';

/**
 * POST /api/integrations/orion/users/sync
 * Crea/actualiza en Orion todos los usuarios SynerLink con el rol Firmante
 * (firmar y ver sus firmas). Solo administradores.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await checkAdminPrivileges(session.user.email))) {
      return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
    }
    if (!getOrionConfig().enabled) {
      return NextResponse.json({ error: 'Integración Orion no configurada' }, { status: 503 });
    }

    const summary = await withMssqlPool((pool) => syncAllUsersToOrion(pool));
    return NextResponse.json({ ok: summary.failed === 0, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

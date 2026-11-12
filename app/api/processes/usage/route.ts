import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { resolveUserIdByEmail } from '../../../../lib/request-general/dashboardAccess';
import {
  ProcessUsageStoreUnavailableError,
  listProcessUsage,
  recordProcessOpen,
} from '../../../../lib/process/processUsageDb';

/**
 * Recurrencia del hub de procesos (orden de las tarjetas por lo que más abre cada persona).
 * GET  → { available, entries }   · available=false: la tabla aún no existe (usa el navegador).
 * POST { id_subprocess } → suma una apertura. La persona sale siempre de la sesión.
 */

export const dynamic = 'force-dynamic';

async function sessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return resolveUserIdByEmail(email);
}

export async function GET() {
  try {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const entries = await listProcessUsage(userId);
    return NextResponse.json({ available: true, entries }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ProcessUsageStoreUnavailableError) {
      return NextResponse.json({ available: false, entries: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('Error GET /api/processes/usage:', error);
    return NextResponse.json({ error: 'No se pudo cargar el uso de procesos' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { id_subprocess?: unknown } | null;
    const idSubprocess = Number(body?.id_subprocess);
    if (!Number.isInteger(idSubprocess) || idSubprocess <= 0) {
      return NextResponse.json({ error: 'Acceso no válido' }, { status: 400 });
    }

    const saved = await recordProcessOpen(userId, idSubprocess);
    if (!saved) return NextResponse.json({ error: 'Acceso no encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ProcessUsageStoreUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error('Error POST /api/processes/usage:', error);
    return NextResponse.json({ error: 'No se pudo guardar el uso' }, { status: 500 });
  }
}

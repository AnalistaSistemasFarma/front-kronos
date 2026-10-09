import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { hasSystemMetricsAccess } from '../../../../lib/system-metrics/access';
import {
  isAlertSubscriber,
  isMissingTableError,
  setAlertSubscription,
} from '../../../../lib/system-metrics/store';

/**
 * «Recibir alertas» del monitor, por persona (la de la sesión).
 *   GET → { subscribed, tableMissing }
 *   PUT { enabled: boolean } → { subscribed }
 * Sin la tabla (2026-10-09-system-metrics-alertas-suscriptores.sql) responde tableMissing.
 */
async function currentEmail(): Promise<string | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!(await hasSystemMetricsAccess(session!.user!.email!))) {
    return NextResponse.json({ error: 'Sin acceso al monitor' }, { status: 403 });
  }
  return email;
}

export async function GET() {
  try {
    const email = await currentEmail();
    if (typeof email !== 'string') return email;
    const subscribed = await withMssqlPool((pool) => isAlertSubscriber(pool, email));
    return NextResponse.json({ subscribed, tableMissing: false });
  } catch (error) {
    if (isMissingTableError(error)) return NextResponse.json({ subscribed: false, tableMissing: true });
    console.error('[system-metrics] alert-subscription GET:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const email = await currentEmail();
    if (typeof email !== 'string') return email;
    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Falta enabled (true/false)' }, { status: 400 });
    }
    await withMssqlPool((pool) => setAlertSubscription(pool, email, body.enabled as boolean));
    return NextResponse.json({ subscribed: body.enabled });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: 'Falta la tabla de suscriptores (2026-10-09-system-metrics-alertas-suscriptores.sql)', tableMissing: true },
        { status: 409 }
      );
    }
    console.error('[system-metrics] alert-subscription PUT:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

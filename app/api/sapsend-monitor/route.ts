import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { hasSapsendMonitorAccess } from '../../../lib/sapsend/access';
import { buildSapsendLiveSnapshot } from '../../../lib/sapsend/live';

/** GET /api/sapsend-monitor — foto en vivo SynerLink → SAPSEND. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowed = await hasSapsendMonitorAccess(session.user.email);
    if (!allowed) {
      return NextResponse.json({ error: 'No tiene acceso a este módulo' }, { status: 403 });
    }

    const snapshot = await buildSapsendLiveSnapshot();
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[sapsend-monitor]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

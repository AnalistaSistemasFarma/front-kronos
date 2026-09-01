import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import { finalizeSignerTurn } from '@/lib/orion/service';

/**
 * Confirma la firma del firmante actual: sincroniza Orion, cierra su tarea
 * y abre la del siguiente firmante en la secuencia.
 * POST /api/integrations/orion/complete-sign
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    const userId = session?.user?.id;
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const cfg = getOrionConfig();
    if (!cfg.enabled) {
      return NextResponse.json(
        { error: 'Integración Orion no configurada en el servidor' },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    const result = await withMssqlPool((pool) =>
      finalizeSignerTurn(pool, {
        requestId,
        userId: String(userId),
        userEmail: email,
      })
    );

    return NextResponse.json(
      {
        success: true,
        state: result.state,
        signerCompleted: result.signerCompleted,
        tasksUpdated: result.tasksUpdated,
        requestClosed: result.requestClosed,
        signerTasksClosed: result.signerTasksClosed,
        signerTasksOpened: result.signerTasksOpened,
        currentSignerEmail: result.currentSignerEmail,
        message: result.signerCompleted
          ? 'Firma registrada. Su tarea fue cerrada y el flujo continúa con el siguiente firmante.'
          : 'Estado sincronizado. La firma aún no aparece como completada en Orion.',
      },
      { status: 200 }
    );
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}

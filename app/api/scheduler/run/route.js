import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  extractBearer,
  isValidIntegrationApiKey,
} from '../../../../lib/integration/apiKeyAuth';
import { runDueJobs } from '../../../../lib/scheduler/runner.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/scheduler/run — ejecuta los jobs vencidos del servicio central de tareas
 * automáticas. Invocadores: la tarea programada de Windows (Bearer INTEGRATION_API_KEYS),
 * el botón "Ejecutar ahora" de la UI (sesión) y el respaldo oportunista (interno).
 * Concurrencia segura: el runner reclama cada job con un UPDATE atómico.
 */
export async function POST(req) {
  try {
    const bearer = extractBearer(req.headers.get('authorization'));
    let authorized = isValidIntegrationApiKey(bearer);

    if (!authorized) {
      const session = await getServerSession(authOptions);
      authorized = Boolean(session?.user?.email);
    }

    if (!authorized) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const summary = await runDueJobs();
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    console.error('[POST /api/scheduler/run] Error:', err);
    return NextResponse.json(
      { error: 'Error ejecutando el scheduler', details: err.message },
      { status: 500 }
    );
  }
}

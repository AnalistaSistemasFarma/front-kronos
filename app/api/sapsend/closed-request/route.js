import { NextResponse } from 'next/server';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { isValidSapsendApiKey } from '../../../../lib/sapsend/config.js';
import { closedSapsendRequest } from '../../../../lib/sapsend/resolveWorkflowTask.js';
import {
  fireAndForgetNotification,
  notifyRequestClosed,
} from '../../../../lib/notificationEvents.js';

// Endpoint ENTRANTE: cuando SAPSEND cancela una solicitud, llama a SynerLink con { id_request } para
// reflejar la cancelación: solicitud → status_req=3, tareas abiertas → id_status=3, nota
// "Solicitud Cancelada" y notificación al solicitante.
// Autenticado por x-api-key (secreto compartido), sin sesión. Idempotente.

const TAG = '[sapsend/cancel-request]';

export async function POST(req) {
  try {
    // 1) Auth por API-key (SAPSEND es una máquina, no hay sesión de navegador).
    if (!isValidSapsendApiKey(req)) {
      console.warn(`${TAG} ✖ x-api-key inválido o ausente.`);
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // 2) Body.
    const body = await req.json().catch(() => null);
    const id_request = Number(body?.id_request ?? body?.id);
    if (!Number.isInteger(id_request) || id_request <= 0) {
      return NextResponse.json(
        { error: 'Se requiere un id_request válido' },
        { status: 400 }
      );
    }

    console.log(`${TAG} ▶ POST id_request=${id_request}`);

    const outcome = await withMssqlPool((pool) => closedSapsendRequest(pool, { id_request }));

    if (outcome.notFound) {
      return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        cancelled: !!outcome.cancelled,
        ...(outcome.cancelled ? { tasksCancelled: outcome.tasksCancelled } : {}),
        ...(outcome.alreadyClosed ? { alreadyClosed: true } : {}),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(`${TAG} ✖ Error:`, err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}

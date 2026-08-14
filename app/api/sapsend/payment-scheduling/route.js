import { NextResponse } from 'next/server';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { isValidSapsendApiKey } from '../../../../lib/sapsend/config.js';
import { resolveSapsendTask } from '../../../../lib/sapsend/resolveWorkflowTask.js';
import {
  fireAndForgetNotification,
  notifyActivityResolved,
  notifyRequestClosed,
} from '../../../../lib/notificationEvents.js';

// Endpoint ENTRANTE: contraparte del `updatePay` de SAPSEND. Cuando SAPSEND marca los treasury_requests
// como 'Pago Realizado', llama a SynerLink con { id_request } para resolver la tarea del workflow
// "Programación de Pago", dejar la nota "Pago Realizado Correctamente", avanzar el flujo y CERRAR la
// solicitud completa (es la última etapa del flujo de tesorería).
// Autenticado por x-api-key (secreto compartido), sin sesión. Idempotente.

const TAG = '[sapsend/payment-scheduling]';
const TASK_NAME = 'Programación de Pago';
const TEXT = 'Pago Realizado Correctamente';

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

    const outcome = await withMssqlPool((pool) =>
      resolveSapsendTask(pool, { id_request, taskName: TASK_NAME, text: TEXT, closeRequest: true })
    );

    if (outcome.notFound) {
      return NextResponse.json(
        { error: `La solicitud no tiene la tarea "${TASK_NAME}"` },
        { status: 404 }
      );
    }

    // Notificación "Actividad resuelta" a los interesados (igual que el tablero). Solo si se resolvió algo.
    if (outcome.resolved > 0) {
      fireAndForgetNotification(
        notifyActivityResolved({
          taskId: outcome.prevRow.id,
          requestId: outcome.prevRow.id_request_general,
          subject: outcome.prevRow.subject_request,
          taskName: TASK_NAME,
        })
      );
    }

    // Notificación de cierre de la solicitud al solicitante (solo en la transición a cerrada).
    if (outcome.requestClosed) {
      fireAndForgetNotification(
        notifyRequestClosed({
          requestId: id_request,
          subject: outcome.subject,
          requesterUserId: outcome.requesterUserId,
          statusId: 2,
        })
      );
    }

    return NextResponse.json(
      {
        success: true,
        resolved: outcome.resolved,
        requestClosed: !!outcome.requestClosed,
        ...(outcome.alreadyResolved ? { alreadyResolved: true } : {}),
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

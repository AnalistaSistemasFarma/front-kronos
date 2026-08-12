import { NextResponse } from 'next/server';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import { isValidSapsendApiKey } from '../../../../lib/sapsend/config.js';
import { resolveSapsendTask } from '../../../../lib/sapsend/resolveWorkflowTask.js';
import {
  fireAndForgetNotification,
  notifyActivityResolved,
} from '../../../../lib/notificationEvents.js';

// Endpoint ENTRANTE: SAPSEND llama a SynerLink con { id_request } para marcar como resuelta la tarea
// del workflow "Liquidación de Impuestos". Autenticado por x-api-key (secreto compartido), sin sesión
// (es una máquina). Idempotente: resuelve todas las instancias abiertas, deja una nota y avanza el flujo.

const TAG = '[sapsend/tax-settlement]';
const TASK_NAME = 'Liquidación de Impuestos';
const TEXT = 'Liquidación de Impuestos Realizada Correctamente';

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
      resolveSapsendTask(pool, { id_request, taskName: TASK_NAME, text: TEXT })
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

    return NextResponse.json(
      {
        success: true,
        resolved: outcome.resolved,
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

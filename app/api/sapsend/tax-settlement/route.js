import { NextResponse } from 'next/server';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { isValidSapsendApiKey } from '../../../../lib/sapsend/config.js';
import { advanceSequentialTask } from '../../../../lib/workflow/advanceSequentialTask.js';
import {
  fireAndForgetNotification,
  notifyActivityResolved,
} from '../../../../lib/notificationEvents.js';

// Endpoint ENTRANTE: SAPSEND llama a SynerLink con { id_request } para marcar como resuelta la tarea
// del workflow "Liquidación de Impuestos". Autenticado por x-api-key (secreto compartido), sin sesión
// (es una máquina). Idempotente: resuelve todas las instancias abiertas y avanza el flujo una vez.

const TAG = '[sapsend/tax-settlement]';
const TASK_NAME = 'Liquidación de Impuestos';
const RESOLUTION_TEXT = 'Liquidación de Impuestos Realizada Correctamente';

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

    const outcome = await withMssqlPool(async (pool) => {
      // a) Localizar las instancias de la tarea "Liquidación de Impuestos" de esa solicitud.
      const taskRes = await pool
        .request()
        .input('id_request', sql.Int, id_request)
        .input('task', sql.NVarChar(255), TASK_NAME)
        .query(`
          SELECT trg.id, trg.id_status, trg.id_task, trg.id_request_general,
                 rg.subject_request, tpc.id_process_category, tpc.display_order
          FROM task_request_general trg
          INNER JOIN requests_general rg ON rg.id = trg.id_request_general
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          WHERE trg.id_request_general = @id_request AND tpc.task = @task
        `);

      const rows = taskRes.recordset;
      if (rows.length === 0) {
        return { notFound: true };
      }

      const prevRow = rows[0];
      const openRows = rows.filter((r) => r.id_status !== 2 && r.id_status !== 3);

      // b) Idempotencia: si no hay instancias abiertas, ya estaba resuelta.
      if (openRows.length === 0) {
        console.log(`${TAG} La tarea ya estaba resuelta para la solicitud ${id_request}; no se re-avanza.`);
        return { prevRow, resolved: 0, alreadyResolved: true };
      }

      // c) Marcar como resueltas TODAS las instancias abiertas.
      const updateRes = await pool
        .request()
        .input('id_request', sql.Int, id_request)
        .input('task', sql.NVarChar(255), TASK_NAME)
        .input('resolution', sql.NVarChar(sql.MAX), RESOLUTION_TEXT)
        .query(`
          UPDATE trg
          SET id_status = 2,
              start_date = GETDATE(),
              end_date = GETDATE(),
              date_resolution = GETDATE(),
              resolution = @resolution
          FROM task_request_general trg
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          WHERE trg.id_request_general = @id_request AND tpc.task = @task
            AND trg.id_status NOT IN (2, 3)
        `);
      const resolved = updateRes.rowsAffected?.[0] ?? openRows.length;
      console.log(`${TAG} ✔ ${resolved} instancia(s) de "${TASK_NAME}" marcadas como resueltas.`);

      // d) Avanzar el flujo una vez (todas las instancias de la tarea ya están cerradas).
      await advanceSequentialTask(pool, {
        id_request_general: prevRow.id_request_general,
        id_task: prevRow.id_task,
        id_process_category: prevRow.id_process_category,
        display_order: prevRow.display_order,
        subject_request: prevRow.subject_request,
      });

      return { prevRow, resolved };
    });

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

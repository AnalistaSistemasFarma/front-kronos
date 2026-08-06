import { sql } from '../mssqlPool';
import { advanceSequentialTask } from '../workflow/advanceSequentialTask.js';

// Núcleo compartido de los endpoints ENTRANTES de SAPSEND que resuelven una tarea del workflow por
// nombre (p. ej. "Liquidación de Impuestos", "Programación de Pago"). Al resolver:
//   - marca como resueltas (id_status=2) TODAS las instancias abiertas de esa tarea + sella fechas
//     + escribe `resolution` con el texto,
//   - deja una NOTA en la tabla `notes` (equivalente al observations_logs de SAPSEND) a nombre del
//     encargado del proceso (mismo `IDassignedUserID` de view-request; fallback al solicitante),
//   - avanza el flujo (crea/activa la siguiente tarea secuencial y notifica),
//   - opcionalmente (closeRequest) cierra la solicitud completa (status_req=2) + deja una nota
//     "Se ha cerrado la solicitud".
// Idempotente. Recibe un pool ya conectado.

const TAG = '[sapsend/resolveWorkflowTask]';
const CLOSED_STATUSES = [2, 3];

// Encargado del proceso de la solicitud (= IDassignedUserID de view-request/route.js). Fallback al
// solicitante. Devuelve un [user].id (cuid) o null.
async function resolveNoteAuthor(pool, id_request, fallbackRequesterId) {
  const res = await pool
    .request()
    .input('id_request', sql.Int, id_request)
    .query(`
      SELECT TOP 1 upcrg.id_user AS author_id
      FROM requests_general rg
      INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
      INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
      INNER JOIN user_process_category_request_general upcrg ON upcrg.id_process_category = pc.id
      WHERE rg.id = @id_request AND upcrg.id_user IS NOT NULL
    `);
  return res.recordset[0]?.author_id ?? fallbackRequesterId ?? null;
}

// Inserta una nota en la tabla `notes` (contrato de notes/route.js). Tolerante a fallos: nunca lanza.
async function insertNote(pool, { id_request, note, author }) {
  if (!author || !note || !note.trim()) {
    console.warn(`${TAG} ⚠ Nota omitida para la solicitud ${id_request} (sin autor o texto vacío).`);
    return false;
  }
  try {
    await pool
      .request()
      .input('note', sql.Text, note.trim())
      .input('id_request', sql.Int, id_request)
      .input('created_by', sql.NVarChar, String(author))
      .query(`
        INSERT INTO notes (note, id_request, created_by)
        VALUES (@note, @id_request, @created_by)
      `);
    console.log(`${TAG} 📝 Nota "${note}" registrada (created_by=${author}).`);
    return true;
  } catch (noteErr) {
    // La resolución/cierre ya se confirmaron; no fallar por la nota.
    console.error(`${TAG} ✖ Error insertando la nota "${note}":`, noteErr);
    return false;
  }
}

/**
 * @param {import('mssql').ConnectionPool} pool  pool de mssql ya conectado
 * @param {{ id_request:number, taskName:string, text:string, closeRequest?:boolean }} opts
 * @returns {Promise<{ notFound?:boolean, prevRow?:object, resolved:number, alreadyResolved?:boolean,
 *                     noteCreated?:boolean, requestClosed?:boolean, requesterUserId?:string,
 *                     subject?:string }>}
 */
export async function resolveSapsendTask(pool, { id_request, taskName, text, closeRequest = false }) {
  // a) Localizar las instancias de la tarea para esa solicitud (+ datos de la solicitud para el cierre).
  const taskRes = await pool
    .request()
    .input('id_request', sql.Int, id_request)
    .input('task', sql.NVarChar(255), taskName)
    .query(`
      SELECT trg.id, trg.id_status, trg.id_task, trg.id_request_general,
             rg.subject_request, rg.id_requester, rg.status_req,
             tpc.id_process_category, tpc.display_order
      FROM task_request_general trg
      INNER JOIN requests_general rg ON rg.id = trg.id_request_general
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @id_request AND tpc.task = @task
    `);

  const rows = taskRes.recordset;
  if (rows.length === 0) {
    return { notFound: true, resolved: 0 };
  }

  const prevRow = rows[0];
  const openRows = rows.filter((r) => !CLOSED_STATUSES.includes(r.id_status));

  // Autor de las notas / id_executor_final del cierre: se calcula una vez y se reutiliza.
  const author = await resolveNoteAuthor(pool, id_request, prevRow.id_requester);

  let resolved = 0;
  let noteCreated = false;

  // b) Resolver la tarea solo si hay instancias abiertas (idempotente).
  if (openRows.length > 0) {
    // c) Marcar como resueltas TODAS las instancias abiertas (con resolution).
    const updateRes = await pool
      .request()
      .input('id_request', sql.Int, id_request)
      .input('task', sql.NVarChar(255), taskName)
      .input('resolution', sql.NVarChar(sql.MAX), text)
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
    resolved = updateRes.rowsAffected?.[0] ?? openRows.length;
    console.log(`${TAG} ✔ ${resolved} instancia(s) de "${taskName}" marcadas como resueltas.`);

    // d/e) Nota de la tarea (equivalente al observations_logs de SAPSEND).
    noteCreated = await insertNote(pool, { id_request, note: text, author });

    // f) Avanzar el flujo (todas las instancias de la tarea ya están cerradas).
    await advanceSequentialTask(pool, {
      id_request_general: prevRow.id_request_general,
      id_task: prevRow.id_task,
      id_process_category: prevRow.id_process_category,
      display_order: prevRow.display_order,
      subject_request: prevRow.subject_request,
    });
  } else {
    console.log(`${TAG} "${taskName}" ya estaba resuelta para la solicitud ${id_request}.`);
  }

  // g) Cierre de la solicitud completa (si aplica). Se evalúa por el estado de la solicitud, no por la
  //    tarea, para que sea idempotente y robusto ante reintentos.
  let requestClosed = false;
  if (closeRequest && !CLOSED_STATUSES.includes(prevRow.status_req)) {
    await pool
      .request()
      .input('id_request', sql.Int, id_request)
      .input('resolution', sql.NVarChar(255), text)
      .input('executor', sql.NVarChar(1000), author != null ? String(author) : null)
      .query(`
        UPDATE requests_general
        SET status_req = 2,
            resolution = @resolution,
            id_executor_final = @executor,
            date_resolution = GETDATE()
        WHERE id = @id_request
      `);
    requestClosed = true;
    console.log(`${TAG} 🔒 Solicitud ${id_request} cerrada (status_req=2).`);

    // Nota de cierre.
    await insertNote(pool, { id_request, note: 'Se ha cerrado la solicitud', author });
  }

  return {
    prevRow,
    resolved,
    alreadyResolved: openRows.length === 0,
    noteCreated,
    requestClosed,
    requesterUserId: prevRow.id_requester,
    subject: prevRow.subject_request,
  };
}

/**
 * Cancela una solicitud completa desde SAPSEND: pone la solicitud en estado Cancelada (status_req=3),
 * cancela sus tareas ABIERTAS (id_status=3), deja una nota "Solicitud Cancelada" y devuelve los datos
 * para notificar al solicitante. Idempotente (evalúa por status_req). No avanza flujo.
 *
 * @param {import('mssql').ConnectionPool} pool  pool de mssql ya conectado
 * @param {{ id_request:number }} opts
 * @returns {Promise<{ notFound?:boolean, cancelled:boolean, alreadyClosed?:boolean,
 *                     tasksCancelled?:number, requesterUserId?:string, subject?:string }>}
 */
export async function cancelSapsendRequest(pool, { id_request }) {
  // a) Datos de la solicitud.
  const reqRes = await pool
    .request()
    .input('id_request', sql.Int, id_request)
    .query(`
      SELECT status_req, id_requester, subject_request
      FROM requests_general
      WHERE id = @id_request
    `);
  const row = reqRes.recordset[0];
  if (!row) {
    return { notFound: true, cancelled: false };
  }

  // b) Idempotencia: si ya está resuelta/cancelada, no hacer nada.
  if (CLOSED_STATUSES.includes(row.status_req)) {
    console.log(`${TAG} La solicitud ${id_request} ya estaba cerrada (status_req=${row.status_req}); no se cancela.`);
    return {
      cancelled: false,
      alreadyClosed: true,
      requesterUserId: row.id_requester,
      subject: row.subject_request,
    };
  }

  // c) Autor de la nota / id_executor_final: encargado del proceso → fallback solicitante.
  const author = await resolveNoteAuthor(pool, id_request, row.id_requester);

  // d) Cancelar la solicitud.
  await pool
    .request()
    .input('id_request', sql.Int, id_request)
    .input('executor', sql.NVarChar(1000), author != null ? String(author) : null)
    .query(`
      UPDATE requests_general
      SET status_req = 3,
          resolution = 'Solicitud Cancelada',
          id_executor_final = @executor,
          date_resolution = GETDATE()
      WHERE id = @id_request
    `);

  // e) Cancelar SOLO las tareas abiertas de la solicitud.
  const tasksRes = await pool
    .request()
    .input('id_request', sql.Int, id_request)
    .query(`
      UPDATE task_request_general
      SET id_status = 3
      WHERE id_request_general = @id_request AND id_status NOT IN (2, 3)
    `);
  const tasksCancelled = tasksRes.rowsAffected?.[0] ?? 0;
  console.log(`${TAG} 🚫 Solicitud ${id_request} cancelada (status_req=3); ${tasksCancelled} tarea(s) abiertas canceladas.`);

  // f) Nota de cancelación.
  await insertNote(pool, { id_request, note: 'Solicitud Cancelada', author });

  return {
    cancelled: true,
    tasksCancelled,
    requesterUserId: row.id_requester,
    subject: row.subject_request,
  };
}

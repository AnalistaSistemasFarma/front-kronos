import sql from 'mssql';
import { NextResponse } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import { ORION_SIGNATURE_FIELD_TYPE } from '@/lib/orion/fieldType';
import { getOrionDocumentFromBag, parseOrionSignatureBagBag } from '@/lib/orion/formValue';
import { isOrionReviewResolution, parseOrionReviewFileId } from '@/lib/orion/signerAuthMarkers';
import { resolveSessionUser } from '@/lib/chat/http';

// Las fechas DATETIME de BD son hora Colombia leída como UTC; `submittedAt` es UTC real.
const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * La primera validación de cada ronda nace al enviar el documento a validación (no al
 * resolver otra tarea): se toma `review.submittedAt` si es posterior al paso anterior.
 * Solo filas pendientes (el ajuste no cambia el listado ya resuelto) y bags en UNA query.
 */
async function applyReviewSubmittedAt(pool, rows) {
  const reviewRows = rows.filter(
    (r) => isOrionReviewResolution(r.resolution) && (Number(r.id_status) === 4 || Number(r.id_status) === 1)
  );
  if (reviewRows.length === 0) return;

  const requestIds = [...new Set(reviewRows.map((r) => Number(r.id_request_general)).filter((id) => id > 0))];
  if (requestIds.length === 0) return;

  const req = pool.request().input('fieldType', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE);
  const params = requestIds.map((id, i) => {
    req.input(`r${i}`, sql.Int, id);
    return `@r${i}`;
  });
  const bagResult = await req.query(`
    SELECT rfv.id_request_general, rfv.value_text
      FROM request_form_value rfv
      INNER JOIN process_form_field pff
        ON pff.id = rfv.id_form_field
       AND pff.field_type = @fieldType
       AND pff.active = 1
     WHERE rfv.id_request_general IN (${params.join(', ')})
       AND rfv.value_text IS NOT NULL
  `);

  const bags = new Map();
  for (const row of bagResult.recordset ?? []) {
    const id = Number(row.id_request_general);
    if (!bags.has(id)) bags.set(id, parseOrionSignatureBagBag(row.value_text));
  }

  for (const row of reviewRows) {
    const fileId = parseOrionReviewFileId(row.resolution);
    const bag = bags.get(Number(row.id_request_general));
    if (!fileId || !bag) continue;
    const submittedAt = Date.parse(getOrionDocumentFromBag(bag, fileId).review?.submittedAt ?? '');
    if (!Number.isFinite(submittedAt)) continue;
    const submitted = new Date(submittedAt - COLOMBIA_OFFSET_MS);
    const resolved = row.date_resolution ? new Date(row.date_resolution) : null;
    const arrived = row.arrived_at ? new Date(row.arrived_at) : null;
    if (resolved && submitted > resolved) continue;
    if (!arrived || submitted > arrived) row.arrived_at = submitted;
  }
}

export async function GET(req) {
  try {
    // El usuario sale SIEMPRE de la sesión del servidor. El parámetro `idUser` que
    // envía el cliente se ignora: aceptarlo permitía consultar la bandeja de otra persona.
    const sessionUser = await resolveSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const idUser = sessionUser.id;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const status = searchParams.get('status');
    const company = searchParams.get('company');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const assigned_to = searchParams.get('assigned_to');
    const countsOnly = searchParams.get('counts') === '1';

    // Enrutamiento:
    //  - Autorizaciones asignadas directamente al usuario (firma Orion por firmante):
    //    siempre visibles, sin filtrar por empresa/subprocess.
    //  - Pool por tipo en user_types_authorization + mismo departamento + empresa accesible,
    //    SOLO para tareas sin persona asignada: si la tarea es de alguien, solo la ve su asignado.
    // Scope de visibilidad (compartido entre listado y conteos).
    const visibilitySql = `
          tpc.is_authorization = 1
          AND tpc.type_authorization IS NOT NULL
          AND (
            trg.id_assigned = @idUser
            OR (
              trg.id_assigned IS NULL
              AND c.id_company IN (
                SELECT cu.id_company
                FROM company_user cu
                INNER JOIN subprocess_user_company suc ON suc.id_company_user = cu.id_company_user
                WHERE cu.id_user = @idUser
              )
              AND tpc.type_authorization IN (
                SELECT ut.type_authorization
                FROM user_types_authorization ut
                WHERE ut.id_user = @idUser
              )
              AND EXISTS (
                SELECT 1
                FROM department_user du_c
                INNER JOIN department_user du_a ON du_a.id_department = du_c.id_department
                WHERE du_c.id_user = rg.id_requester
                  AND du_a.id_user = @idUser
              )
            )
          )`;

    // Conteos rápidos para las tarjetas (sin OUTER APPLY ni bags Orion).
    if (countsOnly) {
      const counts = await withMssqlPool(async (pool) => {
        const request = pool.request();
        request.input('idUser', sql.NVarChar, idUser);
        if (company) request.input('company', sql.Int, parseInt(company, 10));
        if (id) request.input('id', sql.Int, parseInt(id, 10));
        let countQuery = `
          SELECT trg.id_status, COUNT_BIG(*) AS n
            FROM task_request_general trg
           INNER JOIN requests_general rg ON rg.id = trg.id_request_general
           INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
           INNER JOIN types_authorization tp ON tp.id = tpc.type_authorization
           INNER JOIN company c ON c.id_company = rg.id_company
           WHERE ${visibilitySql}`;
        if (company) countQuery += ` AND rg.id_company = @company`;
        if (id) countQuery += ` AND rg.id = @id`;
        countQuery += ` GROUP BY trg.id_status`;
        const result = await request.query(countQuery);
        let pendientes = 0;
        let autorizadas = 0;
        let rechazadas = 0;
        for (const row of result.recordset ?? []) {
          const n = Number(row.n) || 0;
          const st = Number(row.id_status);
          if (st === 2) autorizadas += n;
          else if (st === 3) rechazadas += n;
          else pendientes += n;
        }
        return {
          total: pendientes + autorizadas + rechazadas,
          pendientes,
          autorizadas,
          rechazadas,
        };
      });
      return NextResponse.json({ counts }, { status: 200 });
    }

    // arrived_at: TOP 1 del paso anterior (más barato que MAX correlacionado sobre toda la historia).
    let query = `
        SELECT
            trg.id as id_task_request, trg.id_request_general, trg.id_status, trg.resolution,
            COALESCE(trg.date_resolution, trg.end_date) as date_resolution, tpc.task,
            sc.status as status_task, u.name as assigned_task,
            tp.type_authorization, rg.subject_request, rg.description, rg.id_company, c.company,
            rg.created_at, COALESCE(arrival.arrived_at, rg.created_at) as arrived_at,
            rg.id_requester as id_creator_request, ucr.name as creator_request
        FROM
            task_request_general trg
        INNER JOIN requests_general rg ON rg.id = trg.id_request_general
        OUTER APPLY (
            SELECT TOP 1 COALESCE(p.date_resolution, p.end_date) AS arrived_at
              FROM task_request_general p
             WHERE p.id_request_general = trg.id_request_general
               AND p.id < trg.id
               AND COALESCE(p.date_resolution, p.end_date) IS NOT NULL
               AND COALESCE(p.date_resolution, p.end_date) <= COALESCE(trg.date_resolution, trg.end_date, '9999-12-31')
             ORDER BY p.id DESC
        ) arrival
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
        LEFT JOIN [user] u ON u.id = trg.id_assigned
        INNER JOIN types_authorization tp ON tp.id = tpc.type_authorization
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] ucr ON ucr.id = rg.id_requester
        WHERE ${visibilitySql}
    `;

    if (status && status !== '0') {
      query += ` AND trg.id_status = @status`;
    } else if (!status) {
      query += ` AND sc.id_status_case = 4`;
    }

    if (id) {
      query += ` AND rg.id = @id`;
    }

    if (company) {
      query += ` AND rg.id_company = @company`;
    }

    if (date_from) {
      query += ` AND COALESCE(arrival.arrived_at, rg.created_at) >= @date_from`;
    }

    if (date_to) {
      query += ` AND COALESCE(arrival.arrived_at, rg.created_at) < @date_to`;
    }

    if (assigned_to) {
      query += ` AND rg.[user] = @assigned_to`;
    }

    query += ` ORDER BY trg.id DESC`;

    const rows = await withMssqlPool(async (pool) => {
      const request = pool.request();
      request.input('idUser', sql.NVarChar, idUser);

      if (status) {
        request.input('status', sql.Int, parseInt(status, 10));
      }
      if (id) {
        request.input('id', sql.Int, parseInt(id, 10));
      }
      if (company) {
        request.input('company', sql.Int, parseInt(company, 10));
      }
      if (date_from) {
        request.input('date_from', sql.DateTime, new Date(date_from));
      }
      if (date_to) {
        const nextDay = new Date(date_to);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        request.input('date_to', sql.DateTime, nextDay);
      }
      if (assigned_to) {
        request.input('assigned_to', sql.NVarChar, assigned_to);
      }

      const result = await request.query(query);
      await applyReviewSubmittedAt(pool, result.recordset).catch((err) =>
        console.warn('API activities: no se pudo ajustar la llegada de validaciones', err)
      );
      return result.recordset;
    });

    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json({ error: 'Error procesando la solicitud' }, { status: 500 });
  }
}

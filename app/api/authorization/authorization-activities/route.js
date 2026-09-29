import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';
import { loadOrionFormBag } from '@/lib/orion/service';
import { getOrionDocumentFromBag } from '@/lib/orion/formValue';
import { isOrionReviewResolution, parseOrionReviewFileId } from '@/lib/orion/signerAuthMarkers';

// Las fechas DATETIME de BD son hora Colombia leída como UTC; `submittedAt` es UTC real.
const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * La primera validación de cada ronda nace al enviar el documento a validación (no al
 * resolver otra tarea): se toma `review.submittedAt` si es posterior al paso anterior.
 */
async function applyReviewSubmittedAt(pool, rows) {
  const reviewRows = rows.filter((r) => isOrionReviewResolution(r.resolution));
  if (reviewRows.length === 0) return;
  const requestIds = [...new Set(reviewRows.map((r) => r.id_request_general))];
  const bags = new Map(
    await Promise.all(
      requestIds.map(async (id) => [id, await loadOrionFormBag(pool, id).catch(() => null)])
    )
  );
  for (const row of reviewRows) {
    const fileId = parseOrionReviewFileId(row.resolution);
    const loaded = bags.get(row.id_request_general);
    if (!fileId || !loaded) continue;
    const submittedAt = Date.parse(getOrionDocumentFromBag(loaded.bag, fileId).review?.submittedAt ?? '');
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
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idUser = searchParams.get('idUser');
    const id = searchParams.get('id');
    const status = searchParams.get('status');
    const company = searchParams.get('company');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const assigned_to = searchParams.get('assigned_to');

    console.log('API: idUser recibido:', idUser);

    if (!idUser) {
      console.log('API activities: No se proporcionó idUser, devolviendo error');
      return NextResponse.json(
        { error: 'Se requiere el parámetro idUser para filtrar actividades asignados' },
        { status: 400 }
      );
    }

    // Enrutamiento:
    //  - Autorizaciones asignadas directamente al usuario (firma Orion por firmante):
    //    siempre visibles, sin filtrar por empresa/subprocess.
    //  - Pool por tipo en user_types_authorization + mismo departamento + empresa accesible.
    let query = `
        SELECT
            trg.id as id_task_request, trg.id_request_general, trg.id_status, trg.resolution,
            COALESCE(trg.date_resolution, trg.end_date) as date_resolution, tpc.task,
            sc.status as status_task, u.name as assigned_task,
            tp.type_authorization, rg.subject_request, rg.description, rg.id_company, c.company,
            rg.created_at, arrival.arrived_at,
            rg.id_requester as id_creator_request, ucr.name as creator_request
        FROM
            task_request_general trg
        INNER JOIN requests_general rg ON rg.id = trg.id_request_general
        -- La tabla de tareas no guarda su creación: la autorización llega cuando se resuelve
        -- el paso anterior de la misma solicitud (o al crear la solicitud si es la primera).
        OUTER APPLY (
            SELECT COALESCE(
                (SELECT MAX(COALESCE(p.date_resolution, p.end_date))
                   FROM task_request_general p
                  WHERE p.id_request_general = trg.id_request_general
                    AND p.id < trg.id
                    AND COALESCE(p.date_resolution, p.end_date) <= COALESCE(trg.date_resolution, trg.end_date, '9999-12-31')),
                rg.created_at
            ) AS arrived_at
        ) arrival
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
        LEFT JOIN [user] u ON u.id = trg.id_assigned
        INNER JOIN types_authorization tp ON tp.id = tpc.type_authorization
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] ucr ON ucr.id = rg.id_requester
        WHERE tpc.is_authorization = 1
          AND tpc.type_authorization IS NOT NULL
          AND (
            trg.id_assigned = @idUser
            OR (
              c.id_company IN (
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
          )
    `;

    if (status && status !== '0') {
      query += ` AND trg.id_status = @status`;
      console.log('API activities: Agregando filtro por status:', status);
    }

    else if (!status) query += ` AND sc.id_status_case = 4`;

    if (id) {
      query += ` AND rg.id = @id`;
    }

    if (company) {
      query += ` AND rg.id_company = @company`;
    }

    if (date_from) {
      query += ` AND arrival.arrived_at >= @date_from`;
    }

    if (date_to) {
      query += ` AND arrival.arrived_at < @date_to`;
    }

    if (assigned_to) {
      query += ` AND rg.[user] = @assigned_to`;
    }

    const request = pool.request();

    request.input('idUser', sql.NVarChar, idUser);
    
    if (assigned_to) {
      request.input('assignedTo', sql.NVarChar, assigned_to);
    }

    if (status) {
      request.input('status', sql.Int, parseInt(status));
    }

    if (id) {
      request.input('id', sql.Int, parseInt(id));
    }

    if (company) {
      request.input('company', sql.Int, parseInt(company));
    }

    if (date_from) {
      request.input('date_from', sql.DateTime, new Date(date_from));
    }

    if (date_to) {
      // 'YYYY-MM-DD' se interpreta como medianoche UTC, igual que la hora guardada en BD.
      const nextDay = new Date(date_to);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      request.input('date_to', sql.DateTime, nextDay);
    }

    if (assigned_to) {
      request.input('assigned_to', sql.NVarChar, assigned_to);
    }

    console.log('API activities: Ejecutando consulta:', query);
    query += ` ORDER BY trg.id DESC`;
    const result = await request.query(query);
    console.log(
      'API activities: Resultados obtenidos:',
      result.recordset.length,
      'registros'
    );
    await applyReviewSubmittedAt(pool, result.recordset).catch((err) =>
      console.warn('API activities: no se pudo ajustar la llegada de validaciones', err)
    );

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}

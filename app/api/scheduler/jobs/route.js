import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, getPool } from '../../../../lib/mssqlPool';
import { JOB_HANDLERS } from '../../../../lib/scheduler/handlers.js';
import {
  getNextRunDate,
  validateCronExpression,
} from '../../../../lib/scheduler/runner.js';

export const dynamic = 'force-dynamic';

/**
 * CRUD de jobs del servicio central de tareas automáticas (scheduled_job).
 * Gated por sesión: lo consumen los mini-módulos de cada proceso (ej. "Tareas
 * Periódicas" en admin-workflow con job_type=create_general_request).
 */

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return session;
}

// GET ?job_type=  → lista de jobs (filtrada por tipo si viene)
// GET ?runs=<id_job> → últimas 20 ejecuciones del log de ese job
export async function GET(req) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const runsFor = searchParams.get('runs');
    const jobType = searchParams.get('job_type');

    const pool = await getPool();

    if (runsFor) {
      const runs = await pool
        .request()
        .input('id_job', sql.Int, parseInt(runsFor, 10))
        .query(`
          SELECT TOP 20 id, id_job, run_at, status, detail, result_ref
          FROM scheduled_job_run
          WHERE id_job = @id_job
          ORDER BY run_at DESC
        `);
      return NextResponse.json({ runs: runs.recordset }, { status: 200 });
    }

    let query = `
      SELECT id, name, job_type, payload, cron_expression, next_run_date,
             last_run_date, last_status, active, source_module, created_by, created_at
      FROM scheduled_job
    `;
    const request = pool.request();
    if (jobType) {
      query += ` WHERE job_type = @job_type`;
      request.input('job_type', sql.NVarChar(50), jobType);
    }
    query += ` ORDER BY id DESC`;

    const result = await request.query(query);
    return NextResponse.json({ jobs: result.recordset }, { status: 200 });
  } catch (err) {
    console.error('[GET /api/scheduler/jobs] Error:', err);
    return NextResponse.json(
      { error: 'Error consultando los jobs', details: err.message },
      { status: 500 }
    );
  }
}

function validateJobBody(body) {
  const { name, job_type, cron_expression } = body || {};
  if (!name || !String(name).trim()) return 'El nombre es obligatorio';
  if (!job_type || !JOB_HANDLERS[job_type]) {
    return `job_type inválido. Válidos: ${Object.keys(JOB_HANDLERS).join(', ')}`;
  }
  if (!cron_expression || !String(cron_expression).trim()) {
    return 'La expresión cron es obligatoria';
  }
  const cronError = validateCronExpression(String(cron_expression).trim());
  if (cronError) return `Expresión cron inválida: ${cronError}`;
  return null;
}

// POST {name, job_type, cron_expression, payload?, active?, source_module?}
export async function POST(req) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json();
    const validationError = validateJobBody(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const cron = String(body.cron_expression).trim();
    const nextRun = getNextRunDate(cron);

    const pool = await getPool();
    const result = await pool
      .request()
      .input('name', sql.NVarChar(255), String(body.name).trim())
      .input('job_type', sql.NVarChar(50), body.job_type)
      .input(
        'payload',
        sql.NVarChar(sql.MAX),
        body.payload != null ? JSON.stringify(body.payload) : null
      )
      .input('cron_expression', sql.NVarChar(100), cron)
      .input('next_run_date', sql.DateTime, nextRun)
      .input('active', sql.Bit, body.active === false ? 0 : 1)
      .input('source_module', sql.NVarChar(50), body.source_module || null)
      .input('created_by', sql.NVarChar(1000), session.user.email)
      .query(`
        INSERT INTO scheduled_job
          (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by)
        OUTPUT INSERTED.id
        VALUES
          (@name, @job_type, @payload, @cron_expression, @next_run_date, @active, @source_module, @created_by)
      `);

    return NextResponse.json(
      { id: result.recordset[0].id, next_run_date: nextRun },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/scheduler/jobs] Error:', err);
    return NextResponse.json(
      { error: 'Error creando el job', details: err.message },
      { status: 500 }
    );
  }
}

// PUT {id, name, job_type, cron_expression, payload?, active?, source_module?}
export async function PUT(req) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json();
    const id = parseInt(body?.id, 10);
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const validationError = validateJobBody(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const pool = await getPool();
    const existing = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`SELECT id, cron_expression FROM scheduled_job WHERE id = @id`);
    if (existing.recordset.length === 0) {
      return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 });
    }

    const cron = String(body.cron_expression).trim();
    // Si cambia el cron, la próxima fecha se recalcula desde ahora.
    const cronChanged = existing.recordset[0].cron_expression !== cron;
    const request = pool
      .request()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar(255), String(body.name).trim())
      .input('job_type', sql.NVarChar(50), body.job_type)
      .input(
        'payload',
        sql.NVarChar(sql.MAX),
        body.payload != null ? JSON.stringify(body.payload) : null
      )
      .input('cron_expression', sql.NVarChar(100), cron)
      .input('active', sql.Bit, body.active === false ? 0 : 1)
      .input('source_module', sql.NVarChar(50), body.source_module || null);

    let setNext = '';
    if (cronChanged) {
      request.input('next_run_date', sql.DateTime, getNextRunDate(cron));
      setNext = ', next_run_date = @next_run_date';
    }

    await request.query(`
      UPDATE scheduled_job
      SET name = @name, job_type = @job_type, payload = @payload,
          cron_expression = @cron_expression, active = @active,
          source_module = @source_module${setNext}
      WHERE id = @id
    `);

    return NextResponse.json({ message: 'Job actualizado' }, { status: 200 });
  } catch (err) {
    console.error('[PUT /api/scheduler/jobs] Error:', err);
    return NextResponse.json(
      { error: 'Error actualizando el job', details: err.message },
      { status: 500 }
    );
  }
}

// DELETE ?id= — borra el job y sus filas de log
export async function DELETE(req) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = parseInt(searchParams.get('id') || '', 10);
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        DELETE FROM scheduled_job_run WHERE id_job = @id;
        DELETE FROM scheduled_job WHERE id = @id;
      `);

    const deleted = result.rowsAffected[result.rowsAffected.length - 1] || 0;
    if (!deleted) {
      return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Job eliminado' }, { status: 200 });
  } catch (err) {
    console.error('[DELETE /api/scheduler/jobs] Error:', err);
    return NextResponse.json(
      { error: 'Error eliminando el job', details: err.message },
      { status: 500 }
    );
  }
}

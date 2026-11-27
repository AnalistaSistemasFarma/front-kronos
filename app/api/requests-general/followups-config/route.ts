import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { flowEditDecision, logFlowChange, requireFlowEditor } from '../../../../lib/workflow/flowAccess';

export const dynamic = 'force-dynamic';

const COL_RE = /^[A-Za-z0-9_]{1,60}$/;

/**
 * «Seguimiento de fechas» of a flow (2026-11-26).
 * GET ?id=ID → { canEdit, tableFields[{ id, label, columns[{ key, label, type }] }], tracking, tasks[{ id, task, startDelayDays }] }
 * PUT { id, tracking: { idFormField, dateCol, extensionCol, statusCol, doneValue, warnBusinessDays, singleExtension } | null,
 *       delays: [{ id, days }] }
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ? String(session.user.email) : null;
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Flujo no válido' }, { status: 400 });
  try {
    const d = await flowEditDecision(email, id);
    if (!d.flags) return NextResponse.json({ error: 'Flujo no encontrado' }, { status: 404 });
    const data = await withMssqlPool(async (pool) => {
      const q = (text: string) => pool.request().input('p', sql.Int, id).query(text);
      const [fields, tr, tasks] = await Promise.all([
        q(`SELECT id, field_label, config_json FROM process_form_field WHERE id_process_category = @p AND active = 1 AND field_type = N'table' ORDER BY display_order, id`),
        q('SELECT id_form_field, date_col, extension_col, status_col, done_value, warn_business_days, single_extension FROM dbo.process_date_tracking WHERE id_process_category = @p'),
        q('SELECT id, task, start_delay_days FROM task_process_category WHERE id_process_category = @p AND active = 1 ORDER BY display_order, id'),
      ]);
      // 2026-11-26: annual calendar (date field + list field for the rows).
      const cal = await q(`SELECT pc.calendar_field, pc.calendar_group_field FROM process_category pc WHERE pc.id = @p`);
      const other = await q(`SELECT id, field_label, field_type FROM process_form_field WHERE id_process_category = @p AND active = 1 AND field_type IN (N'date', N'select') ORDER BY display_order, id`);
      const tableFields = (fields.recordset as { id: number; field_label: string; config_json: string | null }[]).map((f) => {
        let columns: { key: string; label: string; type: string }[] = [];
        try {
          columns = (JSON.parse(f.config_json ?? '{}').columns ?? []).map((c: { key: string; label: string; type: string }) => ({ key: c.key, label: c.label, type: c.type }));
        } catch {
          columns = [];
        }
        return { id: f.id, label: f.field_label, columns };
      });
      const t = tr.recordset[0] as Record<string, unknown> | undefined;
      return {
        tableFields,
        tracking: t
          ? { idFormField: t.id_form_field, dateCol: t.date_col, extensionCol: t.extension_col, statusCol: t.status_col, doneValue: t.done_value, warnBusinessDays: t.warn_business_days, singleExtension: Boolean(t.single_extension) }
          : null,
        calendarField: (cal.recordset[0] as { calendar_field: number | null } | undefined)?.calendar_field ?? null,
        calendarGroupField: (cal.recordset[0] as { calendar_group_field: number | null } | undefined)?.calendar_group_field ?? null,
        dateFields: (other.recordset as { id: number; field_label: string; field_type: string }[]).filter((f) => f.field_type === 'date').map((f) => ({ id: f.id, label: f.field_label })),
        selectFields: (other.recordset as { id: number; field_label: string; field_type: string }[]).filter((f) => f.field_type === 'select').map((f) => ({ id: f.id, label: f.field_label })),
        tasks: (tasks.recordset as { id: number; task: string; start_delay_days: number | null }[]).map((x) => ({ id: x.id, task: x.task, startDelayDays: x.start_delay_days })),
      };
    });
    return NextResponse.json({ canEdit: d.canEdit, ...data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Error followups-config GET:', e);
    return NextResponse.json({ error: 'No se pudo consultar el seguimiento del flujo' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(body?.id);
  const guard = await requireFlowEditor(id);
  if (guard instanceof Response) return guard;
  const t = body?.tracking as Record<string, unknown> | null | undefined;
  const delays = (Array.isArray(body?.delays) ? (body!.delays as Record<string, unknown>[]) : [])
    .map((x) => ({ id: Number(x.id), days: x.days === null || x.days === '' || x.days === undefined ? null : Number(x.days) }))
    .filter((x) => Number.isInteger(x.id));
  if (delays.some((x) => x.days !== null && (!Number.isInteger(x.days) || x.days < 1 || x.days > 730))) return NextResponse.json({ error: 'El diferido va de 1 a 730 días.' }, { status: 400 });
  let tracking: { f: number; date: string; ext: string | null; status: string | null; done: string | null; warn: number; single: boolean } | null = null;
  if (t) {
    const f = Number(t.idFormField);
    const date = String(t.dateCol ?? '');
    const ext = t.extensionCol ? String(t.extensionCol) : null;
    const status = t.statusCol ? String(t.statusCol) : null;
    const warn = Number(t.warnBusinessDays ?? 7);
    if (!Number.isInteger(f) || !COL_RE.test(date) || (ext && !COL_RE.test(ext)) || (status && !COL_RE.test(status)) || !Number.isInteger(warn) || warn < 0 || warn > 60) {
      return NextResponse.json({ error: 'Configuración de seguimiento no válida.' }, { status: 400 });
    }
    tracking = { f, date, ext, status, done: t.doneValue ? String(t.doneValue).slice(0, 100) : null, warn, single: t.singleExtension !== false };
  }
  try {
    const err = await withMssqlPool(async (pool) => {
      if (tracking) {
        const own = await pool.request().input('p', sql.Int, id).input('f', sql.Int, tracking.f).query(`SELECT 1 AS ok FROM process_form_field WHERE id = @f AND id_process_category = @p AND field_type = N'table'`);
        if (!own.recordset.length) return 'El campo de seguimiento debe ser una tabla de este flujo.';
      }
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).input('p', sql.Int, id).query('DELETE FROM dbo.process_date_tracking WHERE id_process_category = @p');
        if (tracking) {
          await new sql.Request(tx)
            .input('p', sql.Int, id)
            .input('f', sql.Int, tracking.f)
            .input('d', sql.NVarChar(60), tracking.date)
            .input('e', sql.NVarChar(60), tracking.ext)
            .input('s', sql.NVarChar(60), tracking.status)
            .input('dv', sql.NVarChar(100), tracking.done)
            .input('w', sql.Int, tracking.warn)
            .input('one', sql.Bit, tracking.single ? 1 : 0)
            .input('by', sql.NVarChar(255), guard.email)
            .query('INSERT INTO dbo.process_date_tracking (id_process_category, id_form_field, date_col, extension_col, status_col, done_value, warn_business_days, single_extension, updated_by) VALUES (@p, @f, @d, @e, @s, @dv, @w, @one, @by)');
        }
        const calField = body?.calendarField ? Number(body.calendarField) : null;
        const calGroup = body?.calendarGroupField ? Number(body.calendarGroupField) : null;
        await new sql.Request(tx)
          .input('p', sql.Int, id)
          .input('cf', sql.Int, calField)
          .input('cg', sql.Int, calGroup)
          .query(`UPDATE process_category SET
              calendar_field = (SELECT id FROM process_form_field WHERE id = @cf AND id_process_category = @p AND field_type = N'date'),
              calendar_group_field = (SELECT id FROM process_form_field WHERE id = @cg AND id_process_category = @p AND field_type = N'select')
            WHERE id = @p`);
        for (const x of delays) {
          await new sql.Request(tx).input('t', sql.Int, x.id).input('p', sql.Int, id).input('d', sql.Int, x.days).query('UPDATE task_process_category SET start_delay_days = @d WHERE id = @t AND id_process_category = @p');
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      }
      return null;
    });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    await logFlowChange(id, guard.email, 'seguimiento', `${tracking ? `Fechas comprometidas en el campo ${tracking.f} (aviso ${tracking.warn} días hábiles antes${tracking.single ? ', una prórroga' : ''})` : 'Sin seguimiento de fechas'}; ${delays.filter((x) => x.days).length} tarea(s) diferida(s).`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Error followups-config PUT:', e);
    return NextResponse.json({ error: 'No se pudo guardar el seguimiento' }, { status: 500 });
  }
}

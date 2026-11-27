import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { flowEditDecision, logFlowChange, requireFlowEditor } from '../../../../lib/workflow/flowAccess';
import { normalizePrefix } from '../../../../lib/workflow/optionRules';
import { parseSlaInput } from '../../../../lib/requests-general/sla';

export const dynamic = 'force-dynamic';

/**
 * Option rules of a flow (2026-11-24).
 * GET ?id=ID → { canEdit, defaultPrefix, fields[{id,label,options[{id,label}]}], tasks[{id,task}], rules[], assignees[] }
 * PUT { id, defaultPrefix, rules[{ idOption, prefix, slaValue, slaUnit }], assignees[{ idTask, idOption, idUser }] }
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
      const [pc, opts, tasks, rules, asg] = await Promise.all([
        q('SELECT consecutive_prefix FROM dbo.process_category WHERE id = @p'),
        q(`SELECT f.id AS id_field, f.field_label, o.id AS id_option, o.option_label
           FROM process_form_field f INNER JOIN process_form_field_option o ON o.id_form_field = f.id AND o.active = 1
           WHERE f.id_process_category = @p AND f.active = 1 AND f.field_type = N'select'
           ORDER BY f.display_order, f.id, o.display_order, o.id`),
        q('SELECT id, task FROM task_process_category WHERE id_process_category = @p AND active = 1 ORDER BY display_order, id'),
        q('SELECT id_option, prefix, sla_value, sla_unit FROM dbo.process_option_rule WHERE id_process_category = @p'),
        q(`SELECT toa.id_task, toa.id_option, toa.id_user, u.name, u.email
           FROM dbo.task_option_assignee toa INNER JOIN task_process_category t ON t.id = toa.id_task AND t.id_process_category = @p
           LEFT JOIN [user] u ON u.id = toa.id_user`),
      ]);
      const fields: { id: number; label: string; options: { id: number; label: string }[] }[] = [];
      for (const r of opts.recordset as { id_field: number; field_label: string; id_option: number; option_label: string }[]) {
        let f = fields.find((x) => x.id === r.id_field);
        if (!f) fields.push((f = { id: r.id_field, label: r.field_label, options: [] }));
        f.options.push({ id: r.id_option, label: r.option_label });
      }
      return { defaultPrefix: pc.recordset[0]?.consecutive_prefix ?? null, fields, tasks: tasks.recordset, rules: rules.recordset, assignees: asg.recordset };
    });
    return NextResponse.json({ canEdit: d.canEdit, ...data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Error option-rules GET:', e);
    return NextResponse.json({ error: 'No se pudieron consultar las reglas del flujo' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(body?.id);
  const guard = await requireFlowEditor(id);
  if (guard instanceof Response) return guard;
  try {
    const defaultPrefix = normalizePrefix(body?.defaultPrefix);
    const rawRules = Array.isArray(body?.rules) ? (body!.rules as Record<string, unknown>[]) : [];
    const rules = rawRules
      .map((r) => {
        const sla = parseSlaInput({ value: r.slaValue, unit: r.slaUnit });
        if (!sla.ok) throw new Error(sla.error);
        return { idOption: Number(r.idOption), prefix: normalizePrefix(r.prefix), slaValue: sla.value, slaUnit: sla.unit };
      })
      .filter((r) => Number.isInteger(r.idOption) && (r.prefix || r.slaValue));
    const rawAsg = Array.isArray(body?.assignees) ? (body!.assignees as Record<string, unknown>[]) : [];
    const assignees = rawAsg
      .map((a) => ({ idTask: Number(a.idTask), idOption: Number(a.idOption), idUser: String(a.idUser ?? '') }))
      .filter((a) => Number.isInteger(a.idTask) && Number.isInteger(a.idOption) && /^[A-Za-z0-9_-]{1,50}$/.test(a.idUser));
    if (rules.length > 300 || assignees.length > 1000) return NextResponse.json({ error: 'Demasiadas reglas.' }, { status: 400 });

    const err = await withMssqlPool(async (pool) => {
      // Options and tasks must belong to THIS flow.
      const own = await pool.request().input('p', sql.Int, id).query<{ kind: string; id: number }>(`
        SELECT N'o' AS kind, o.id FROM process_form_field_option o INNER JOIN process_form_field f ON f.id = o.id_form_field WHERE f.id_process_category = @p
        UNION ALL SELECT N't', t.id FROM task_process_category t WHERE t.id_process_category = @p`);
      const opts = new Set(own.recordset.filter((x) => x.kind === 'o').map((x) => x.id));
      const tasks = new Set(own.recordset.filter((x) => x.kind === 't').map((x) => x.id));
      if (rules.some((r) => !opts.has(r.idOption)) || assignees.some((a) => !opts.has(a.idOption) || !tasks.has(a.idTask))) return 'Hay opciones o tareas que no son de este flujo.';
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).input('p', sql.Int, id).input('dp', sql.NVarChar(10), defaultPrefix).query('UPDATE dbo.process_category SET consecutive_prefix = @dp WHERE id = @p');
        await new sql.Request(tx).input('p', sql.Int, id).query('DELETE FROM dbo.process_option_rule WHERE id_process_category = @p');
        for (const r of rules) {
          await new sql.Request(tx)
            .input('p', sql.Int, id)
            .input('o', sql.Int, r.idOption)
            .input('pre', sql.NVarChar(10), r.prefix)
            .input('v', sql.Int, r.slaValue)
            .input('u', sql.NVarChar(16), r.slaUnit)
            .input('by', sql.NVarChar(255), guard.email)
            .query('INSERT INTO dbo.process_option_rule (id_process_category, id_option, prefix, sla_value, sla_unit, updated_by) VALUES (@p, @o, @pre, @v, @u, @by)');
        }
        await new sql.Request(tx).input('p', sql.Int, id).query('DELETE toa FROM dbo.task_option_assignee toa INNER JOIN task_process_category t ON t.id = toa.id_task WHERE t.id_process_category = @p');
        for (const a of assignees) {
          await new sql.Request(tx)
            .input('t', sql.Int, a.idTask)
            .input('o', sql.Int, a.idOption)
            .input('u', sql.NVarChar(50), a.idUser)
            .input('by', sql.NVarChar(255), guard.email)
            .query('INSERT INTO dbo.task_option_assignee (id_task, id_option, id_user, updated_by) VALUES (@t, @o, @u, @by)');
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      }
      return null;
    });
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    await logFlowChange(id, guard.email, 'reglas por opción', `Prefijo por defecto ${defaultPrefix ?? '—'}; ${rules.length} regla(s) de opción; ${assignees.length} responsable(s) por opción.`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/prefijo|ANS|número|unidad/i.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    console.error('Error option-rules PUT:', e);
    return NextResponse.json({ error: 'No se pudieron guardar las reglas del flujo' }, { status: 500 });
  }
}

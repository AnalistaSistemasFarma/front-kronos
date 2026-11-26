import { getServerSession } from 'next-auth';
import { logFlowChange, requireFlowEditor } from '../../../../lib/workflow/flowAccess';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { canManageWorkflows, userIdOf } from '../../../../lib/workflow-doc/access';
import { parseSlaInput } from '../../../../lib/requests-general/sla';

/**
 * SLA (ANS) of a subprocess (process_category).
 * GET  /api/requests-general/process-sla?id=ID → { available, sla_value, sla_unit, sla_warn_pct, sla_source, sla_updated_at }
 * PUT  /api/requests-general/process-sla { id, value, unit, warnPct } (workflow admins only; empty value = no SLA)
 */
const isMissingSchema = (e: unknown) => [207, 208].includes(Number((e as { number?: number })?.number));

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const id = Number.parseInt(new URL(req.url).searchParams.get('id') || '', 10);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Subproceso no válido' }, { status: 400 });
  try {
    const row = await withMssqlPool(async (pool) => {
      const r = await pool.request().input('id', sql.Int, id).query(`
        SELECT sla_value, sla_unit, sla_warn_pct, sla_source, sla_updated_at FROM process_category WHERE id = @id`);
      return r.recordset[0] ?? null;
    });
    if (!row) return NextResponse.json({ error: 'Subproceso no encontrado' }, { status: 404 });
    const canEdit = await canManageWorkflows(session.user.email);
    return NextResponse.json({ available: true, canEdit, ...row });
  } catch (e) {
    if (isMissingSchema(e)) return NextResponse.json({ available: false, canEdit: false });
    console.error('Error process-sla GET:', e);
    return NextResponse.json({ error: 'Error al leer el ANS' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!(await canManageWorkflows(email))) {
    return NextResponse.json({ error: 'Solo quien administra los flujos puede cambiar el ANS' }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Subproceso no válido' }, { status: 400 });
  // 2026-11-24: a restricted flow only accepts changes from its editors.
  const guard = await requireFlowEditor(id);
  if (guard instanceof Response) return guard as NextResponse;
  const parsed = parseSlaInput({ value: body?.value, unit: body?.unit, warnPct: body?.warnPct });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const by = await userIdOf(email);
    const updated = await withMssqlPool(async (pool) => {
      const r = await pool
        .request()
        .input('id', sql.Int, id)
        .input('value', sql.Int, parsed.value)
        .input('unit', sql.NVarChar(16), parsed.unit)
        .input('warn', sql.TinyInt, parsed.warnPct)
        .input('by', sql.NVarChar(255), by)
        .query(`
          UPDATE process_category
          SET sla_value = @value, sla_unit = @unit, sla_warn_pct = @warn,
              sla_source = CASE WHEN @value IS NULL THEN NULL ELSE N'manual' END,
              sla_updated_at = GETDATE(), sla_updated_by = @by
          WHERE id = @id`);
      return r.rowsAffected?.[0] ?? 0;
    });
    if (!updated) return NextResponse.json({ error: 'Subproceso no encontrado' }, { status: 404 });
    await logFlowChange(id, email, 'ANS', parsed.value === null ? 'Sin ANS' : `${parsed.value} ${parsed.unit}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isMissingSchema(e)) return NextResponse.json({ error: 'El ANS aún no está habilitado en esta base' }, { status: 409 });
    console.error('Error process-sla PUT:', e);
    return NextResponse.json({ error: 'Error al guardar el ANS' }, { status: 500 });
  }
}

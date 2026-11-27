import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { createGeneralRequest } from '../../../../lib/requests-general/createGeneralRequest.js';
import { notifyNewRequest } from '../../../../lib/notificationEvents.js';
import { flowEditDecision, logFlowChange } from '../../../../lib/workflow/flowAccess';
import { validatePlan } from '../../../../lib/workflow/calendar';

export const dynamic = 'force-dynamic';

/**
 * ANNUAL CALENDAR of a flow (2026-11-26).
 * GET ?id=ID&year=YYYY → { process, canPlan, dateField, groupField, items[] } — users of a company of the flow.
 * POST { id, year, company, items[{ date, groupOptionId, subject }] } → creates one request per item («Nuevo cronograma»);
 *   only who can change the flow or its process manager.
 */
async function context(email: string, id: number) {
  return withMssqlPool(async (pool) => {
    const pc = await pool.request().input('p', sql.Int, id).query<{ process: string; calendar_field: number | null; calendar_group_field: number | null }>(
      'SELECT process, calendar_field, calendar_group_field FROM process_category WHERE id = @p'
    );
    const row = pc.recordset[0];
    if (!row) return null;
    const companies = await pool.request().input('p', sql.Int, id).input('e', sql.NVarChar(255), email).query<{ id_company: number }>(`
      SELECT DISTINCT ccr.id_company FROM process_category pc
      INNER JOIN company_category_request ccr ON ccr.id_category_request = pc.id_category_request
      INNER JOIN company_user cu ON cu.id_company = ccr.id_company
      INNER JOIN [user] u ON u.id = cu.id_user AND u.email = @e
      WHERE pc.id = @p`);
    const manager = await pool.request().input('p', sql.Int, id).input('e', sql.NVarChar(255), email).query(
      'SELECT TOP 1 1 AS ok FROM user_process_category_request_general up INNER JOIN [user] u ON u.id = up.id_user WHERE up.id_process_category = @p AND u.email = @e'
    );
    let groupField: { id: number; label: string; options: { id: number; label: string }[] } | null = null;
    if (row.calendar_group_field) {
      const g = await pool.request().input('f', sql.Int, row.calendar_group_field).query<{ field_label: string; id: number; option_label: string }>(`
        SELECT f.field_label, o.id, o.option_label FROM process_form_field f
        INNER JOIN process_form_field_option o ON o.id_form_field = f.id AND o.active = 1
        WHERE f.id = @f ORDER BY o.display_order, o.id`);
      groupField = { id: row.calendar_group_field, label: g.recordset[0]?.field_label ?? 'Grupo', options: g.recordset.map((x) => ({ id: x.id, label: x.option_label })) };
    }
    return { ...row, companies: companies.recordset.map((c) => c.id_company), isManager: manager.recordset.length > 0, groupField };
  });
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ? String(session.user.email) : null;
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
  if (!Number.isInteger(id) || id <= 0 || year < 2020 || year > 2100) return NextResponse.json({ error: 'Parámetros no válidos' }, { status: 400 });
  try {
    const c = await context(email, id);
    if (!c) return NextResponse.json({ error: 'Flujo no encontrado' }, { status: 404 });
    const d = await flowEditDecision(email, id);
    if (!c.companies.length && !d.canEdit) return NextResponse.json({ error: 'Sin acceso a este flujo' }, { status: 403 });
    if (!c.calendar_field) return NextResponse.json({ process: c.process, configured: false, canPlan: false, items: [] });
    const items = await withMssqlPool(async (pool) => {
      const r = await pool
        .request()
        .input('p', sql.Int, id)
        .input('f', sql.Int, c.calendar_field)
        .input('g', sql.Int, c.calendar_group_field)
        .input('y', sql.NVarChar(4), String(year))
        .query(`
          SELECT rg.id, rg.consecutive, rg.subject_request AS subject, LEFT(v.value_text, 10) AS date, rg.status_req, gv.id_option
          FROM process_category_request_general pcrg
          INNER JOIN requests_general rg ON rg.id = pcrg.id_request_general
          INNER JOIN request_form_value v ON v.id_request_general = rg.id AND v.id_form_field = @f
          LEFT JOIN request_form_value gv ON gv.id_request_general = rg.id AND gv.id_form_field = @g
          WHERE pcrg.id_process_category = @p AND LEFT(v.value_text, 4) = @y
          ORDER BY v.value_text`);
      return r.recordset;
    });
    return NextResponse.json(
      { process: c.process, configured: true, canPlan: d.canEdit || c.isManager, companies: c.companies, groupField: c.groupField, items },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    console.error('Error calendar GET:', e);
    return NextResponse.json({ error: 'No se pudo consultar el cronograma' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ? String(session.user.email) : null;
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(body?.id);
  const year = Number(body?.year);
  const company = Number(body?.company);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(year)) return NextResponse.json({ error: 'Parámetros no válidos' }, { status: 400 });
  try {
    const c = await context(email, id);
    if (!c || !c.calendar_field) return NextResponse.json({ error: 'El flujo no tiene cronograma configurado.' }, { status: 409 });
    const d = await flowEditDecision(email, id);
    if (!d.canEdit && !c.isManager) return NextResponse.json({ error: 'Solo quien gestiona el flujo programa el cronograma.' }, { status: 403 });
    if (!c.companies.includes(company)) return NextResponse.json({ error: 'Elija una empresa del flujo.' }, { status: 400 });
    const plan = validatePlan(body?.items, year, c.groupField ? new Set(c.groupField.options.map((o) => o.id)) : null);
    if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: 400 });
    const me = await withMssqlPool(async (pool) => (await pool.request().input('e', sql.NVarChar(255), email).query<{ id: string }>('SELECT TOP 1 id FROM [user] WHERE email = @e')).recordset[0]?.id);
    if (!me) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    const created: { id: number; consecutive: string | null }[] = [];
    for (const it of plan.items) {
      const formValues = [{ id_field: c.calendar_field, value_text: it.date }];
      if (c.groupField && it.groupOptionId) formValues.push({ id_field: c.groupField.id, id_option: it.groupOptionId } as never);
      const r = (await createGeneralRequest({ company, subject: it.subject, descripcion: `Programada en el cronograma ${year} para el ${it.date}.`, process: id, createdby: me, url: null, formValues } as never)) as { id_request: number; consecutive?: string | null; processEmail: string | null; taskEmails: string[] };
      created.push({ id: r.id_request, consecutive: r.consecutive ?? null });
      try {
        await notifyNewRequest({ requestId: r.id_request, subject: it.subject, processEmail: r.processEmail, taskEmails: r.taskEmails, requestUrl: null } as never);
      } catch (err) {
        console.error('[calendar] notifyNewRequest', err);
      }
    }
    await logFlowChange(id, email, 'cronograma', `Cronograma ${year}: ${created.length} programación(es).`);
    return NextResponse.json({ ok: true, created });
  } catch (e) {
    console.error('Error calendar POST:', e);
    return NextResponse.json({ error: 'No se pudo programar el cronograma' }, { status: 500 });
  }
}

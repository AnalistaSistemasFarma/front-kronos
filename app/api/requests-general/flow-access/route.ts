import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { flowEditDecision, logFlowChange } from '../../../../lib/workflow/flowAccess';

export const dynamic = 'force-dynamic';

/**
 * Restricted access of a flow (2026-11-24).
 * GET ?id=ID → { restricted, sgcOnly, canEdit, canManageAccess, reason, editors[], log[] }
 * PUT { id, restricted, sgcOnly, editors: userId[] } → system administrators only.
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
    const { editors, log } = await withMssqlPool(async (pool) => {
      const e = await pool.request().input('id', sql.Int, id).query<{ id: string; name: string | null; email: string | null }>(
        'SELECT u.id, u.name, u.email FROM dbo.process_category_editor pe INNER JOIN [user] u ON u.id = pe.id_user WHERE pe.id_process_category = @id ORDER BY u.name'
      );
      const l = await pool.request().input('id', sql.Int, id).query<{ id: number; actor_email: string; action: string; detail: string | null; created_at: Date }>(
        'SELECT TOP 30 id, actor_email, action, detail, created_at FROM dbo.process_category_change_log WHERE id_process_category = @id ORDER BY id DESC'
      );
      return { editors: e.recordset, log: l.recordset };
    });
    return NextResponse.json({ restricted: d.flags.restricted, sgcOnly: d.flags.sgcOnly, canEdit: d.canEdit, canManageAccess: d.canManageAccess, reason: d.reason, editors, log }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Error flow-access GET:', e);
    return NextResponse.json({ error: 'No se pudo consultar el acceso del flujo' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ? String(session.user.email) : null;
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Flujo no válido' }, { status: 400 });
  const d = await flowEditDecision(email, id);
  if (!d.flags) return NextResponse.json({ error: 'Flujo no encontrado' }, { status: 404 });
  if (!d.canManageAccess) return NextResponse.json({ error: 'Solo un administrador del sistema gestiona el acceso restringido y sus editores.' }, { status: 403 });
  const restricted = body?.restricted === true;
  const sgcOnly = body?.sgcOnly === true;
  const editors = Array.isArray(body?.editors) ? [...new Set((body!.editors as unknown[]).map(String).filter((x) => /^[A-Za-z0-9_-]{1,50}$/.test(x)))] : [];
  if (editors.length > 50) return NextResponse.json({ error: 'Máximo 50 editores por flujo.' }, { status: 400 });
  if (restricted && editors.length === 0) return NextResponse.json({ error: 'Un flujo restringido necesita al menos un editor.' }, { status: 400 });
  try {
    const result = await withMssqlPool(async (pool) => {
      if (editors.length) {
        const r = pool.request();
        editors.forEach((u, i) => r.input(`u${i}`, sql.NVarChar(50), u));
        const found = await r.query<{ id: string }>(`SELECT id FROM [user] WHERE id IN (${editors.map((_, i) => `@u${i}`).join(', ')})`);
        if (found.recordset.length !== editors.length) return { error: 'Alguno de los editores no existe.' };
      }
      const before = await pool.request().input('id', sql.Int, id).query<{ id_user: string }>('SELECT id_user FROM dbo.process_category_editor WHERE id_process_category = @id');
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).input('id', sql.Int, id).input('r', sql.Bit, restricted ? 1 : 0).input('s', sql.Bit, sgcOnly ? 1 : 0)
          .query('UPDATE dbo.process_category SET restricted_access = @r, sgc_templates_only = @s WHERE id = @id');
        await new sql.Request(tx).input('id', sql.Int, id).query('DELETE FROM dbo.process_category_editor WHERE id_process_category = @id');
        for (const u of editors) {
          await new sql.Request(tx).input('id', sql.Int, id).input('u', sql.NVarChar(50), u).input('by', sql.NVarChar(255), email)
            .query('INSERT INTO dbo.process_category_editor (id_process_category, id_user, created_by) VALUES (@id, @u, @by)');
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      }
      return { before: before.recordset.map((x) => x.id_user) };
    });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    const added = editors.filter((u) => !result.before.includes(u));
    const removed = result.before.filter((u) => !editors.includes(u));
    const cambios = [
      d.flags.restricted !== restricted ? `acceso restringido: ${restricted ? 'sí' : 'no'}` : null,
      d.flags.sgcOnly !== sgcOnly ? `solo plantillas del SGC: ${sgcOnly ? 'sí' : 'no'}` : null,
      added.length ? `editores agregados: ${added.length}` : null,
      removed.length ? `editores retirados: ${removed.length}` : null,
    ].filter(Boolean);
    if (cambios.length) await logFlowChange(id, email, 'acceso', cambios.join(' · '));
    return NextResponse.json({ ok: true, restricted, sgcOnly, editors: editors.length });
  } catch (e) {
    console.error('Error flow-access PUT:', e);
    return NextResponse.json({ error: 'No se pudo guardar el acceso del flujo' }, { status: 500 });
  }
}

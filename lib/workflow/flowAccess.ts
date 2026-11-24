import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { checkAdminPrivileges } from '../access-control';
import { sql, withMssqlPool } from '../mssqlPool';
import { canManageWorkflows } from '../workflow-doc/access';

/**
 * Who may change a flow (process_category) — 2026-11-24, Nicolás Rivera:
 *  - designing or changing ANY flow requires the workflow-administration permission (system administrators or the
 *    «flujos» subprocess); before this, any logged-in user could create or activate a flow;
 *  - a flow with «Acceso restringido» can only be changed by its editors (process_category_editor) and by system
 *    administrators; the editor list, the restriction and «solo plantillas del SGC» are managed by system administrators;
 *  - every configuration change is written to process_category_change_log (insert only).
 */

export interface FlowFlags {
  restricted: boolean;
  sgcOnly: boolean;
}

export interface FlowEditDecision {
  canEdit: boolean;
  canManageAccess: boolean;
  reason: string | null;
}

export const MSG_NOT_MANAGER = 'Solo quien administra los flujos puede diseñarlos o cambiarlos.';
export const MSG_RESTRICTED = 'Este flujo tiene acceso restringido: solo sus editores lo pueden cambiar.';

/** Pure rule (tested): who edits a flow and who manages its access. */
export function decideFlowEdit(p: { isSystemAdmin: boolean; isWorkflowManager: boolean; restricted: boolean; isEditor: boolean }): FlowEditDecision {
  const manager = p.isSystemAdmin || p.isWorkflowManager;
  if (!manager) return { canEdit: false, canManageAccess: false, reason: MSG_NOT_MANAGER };
  if (p.restricted && !p.isSystemAdmin && !p.isEditor) return { canEdit: false, canManageAccess: false, reason: MSG_RESTRICTED };
  return { canEdit: true, canManageAccess: p.isSystemAdmin, reason: null };
}

export async function flowFlags(idProcess: number): Promise<FlowFlags | null> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('id', sql.Int, idProcess)
      .query<{ restricted_access: boolean | null; sgc_templates_only: boolean | null }>(
        'SELECT restricted_access, sgc_templates_only FROM dbo.process_category WHERE id = @id'
      );
    const row = r.recordset[0];
    return row ? { restricted: Boolean(row.restricted_access), sgcOnly: Boolean(row.sgc_templates_only) } : null;
  });
}

async function isFlowEditor(idProcess: number, email: string): Promise<boolean> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('id', sql.Int, idProcess)
      .input('email', sql.NVarChar(255), email)
      .query('SELECT TOP 1 1 AS ok FROM dbo.process_category_editor e INNER JOIN [user] u ON u.id = e.id_user WHERE e.id_process_category = @id AND u.email = @email');
    return r.recordset.length > 0;
  });
}

export async function flowEditDecision(email: string, idProcess: number): Promise<FlowEditDecision & { flags: FlowFlags | null }> {
  const [isSystemAdmin, isWorkflowManager, flags] = await Promise.all([checkAdminPrivileges(email), canManageWorkflows(email), flowFlags(idProcess)]);
  const isEditor = flags?.restricted ? await isFlowEditor(idProcess, email) : false;
  return { ...decideFlowEdit({ isSystemAdmin: Boolean(isSystemAdmin), isWorkflowManager, restricted: Boolean(flags?.restricted), isEditor }), flags };
}

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email ? String(session.user.email) : null;
}

/** Guard for creating flows or categories: session + workflow-administration permission. */
export async function requireFlowManager(): Promise<Response | { email: string }> {
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!(await checkAdminPrivileges(email)) && !(await canManageWorkflows(email))) return NextResponse.json({ error: MSG_NOT_MANAGER }, { status: 403 });
  return { email };
}

/** Guard for changing an existing flow: session + permission + restricted access. */
export async function requireFlowEditor(rawIdProcess: unknown): Promise<Response | { email: string; flags: FlowFlags | null }> {
  const email = await sessionEmail();
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const idProcess = Number(rawIdProcess);
  if (!Number.isInteger(idProcess) || idProcess <= 0) return NextResponse.json({ error: 'Flujo no válido' }, { status: 400 });
  const d = await flowEditDecision(email, idProcess);
  if (!d.canEdit) return NextResponse.json({ error: d.reason }, { status: 403 });
  return { email, flags: d.flags };
}

/** Writes a line in the flow change log; never breaks the main action. */
export async function logFlowChange(idProcess: number, email: string, action: string, detail?: string | null): Promise<void> {
  try {
    await withMssqlPool((pool) =>
      pool
        .request()
        .input('id', sql.Int, idProcess)
        .input('email', sql.NVarChar(255), email.slice(0, 255))
        .input('action', sql.NVarChar(60), action.slice(0, 60))
        .input('detail', sql.NVarChar(2000), detail ? detail.slice(0, 2000) : null)
        .query('INSERT INTO dbo.process_category_change_log (id_process_category, actor_email, action, detail) VALUES (@id, @email, @action, @detail)')
    );
  } catch (e) {
    console.warn('[flujos] no se pudo registrar el cambio del flujo', idProcess, action, e);
  }
}

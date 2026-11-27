
export const TEMPLATE_ITEM = 'template_task';

/**
 * OUTER APPLY que trae `dlg.id_user`: el destino de la regla vigente para (plantilla, responsable
 * de la plantilla). Solo considera destinos activos; si no hay regla, dlg.id_user es NULL.
 * @param {string} templateIdExpr expresión SQL con el id de la plantilla (p. ej. 'tpc.id')
 * @param {string} userIdExpr     expresión SQL con el responsable de la plantilla (p. ej. 'utrg.id_user')
 */
export function delegatedAssigneeApply(templateIdExpr = 'tpc.id', userIdExpr = 'utrg.id_user') {
  return `
    OUTER APPLY (
      SELECT TOP 1 dlg_d.users_after AS id_user
      FROM workflow_task_reassignment_detail dlg_d
      INNER JOIN workflow_task_reassignment dlg_w ON dlg_w.id = dlg_d.id_reassignment
      INNER JOIN [user] dlg_u ON dlg_u.id = dlg_d.users_after AND dlg_u.isActive = 1
      WHERE dlg_d.item_type = '${TEMPLATE_ITEM}'
        AND dlg_d.id_item = ${templateIdExpr}
        AND dlg_d.users_before = ${userIdExpr}
        AND dlg_d.returned = 0
        AND dlg_w.active = 1 AND dlg_w.returned_at IS NULL
      ORDER BY dlg_d.id_reassignment DESC
    ) dlg`;
}

/** Responsable efectivo: el destino de la regla vigente o, si no hay, el de la plantilla. */
export function effectiveAssigneeSql(userIdExpr = 'utrg.id_user') {
  return `COALESCE(dlg.id_user, ${userIdExpr})`;
}

export function dedupeAssigneeRows(rows, taskKey = 'id_task', userKey = 'id_user') {
  const seen = new Set();
  return rows.filter((row) => {
    if (row[userKey] == null) return true;
    const key = `${row[taskKey]}|${String(row[userKey]).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findTemplateRulesToCreate(
  request,
  bind,
  { fromUserId, processIds = [], templateIds = [], all = false }
) {
  if (!fromUserId || (!all && !processIds.length && !templateIds.length)) return [];
  const req = request();
  req.input('dlgFrom', String(fromUserId));
  const filters = [];
  if (all) filters.push('1 = 1');
  if (processIds.length) filters.push(`tpc.id_process_category IN (${bind(req, 'dp', processIds)})`);
  if (templateIds.length) filters.push(`tpc.id IN (${bind(req, 'dt', templateIds)})`);
  const rows = (
    await req.query(`
      SELECT tpc.id AS id_task, tpc.task, tpc.id_process_category, pc.process,
             utrg.id_user AS original_user
      FROM task_process_category tpc
      INNER JOIN user_task_request_general utrg ON utrg.id_task = tpc.id
      LEFT JOIN process_category pc ON pc.id = tpc.id_process_category
      ${delegatedAssigneeApply('tpc.id', 'utrg.id_user')}
      WHERE tpc.active = 1
        AND (${filters.join(' OR ')})
        AND ${effectiveAssigneeSql('utrg.id_user')} = @dlgFrom
      ORDER BY tpc.id_process_category, tpc.display_order, tpc.id
    `)
  ).recordset;
  return rows.map((r) => ({ ...r, id_task: Number(r.id_task), original_user: String(r.original_user) }));
}

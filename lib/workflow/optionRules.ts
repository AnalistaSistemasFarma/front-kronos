import sql from 'mssql';

/**
 * OPTION RULES of a flow (2026-11-24; Calidad OLP meeting 2026-11-23). For an option of a list field the consultant
 * configures, without code:
 *  - the consecutive prefix (Origen = Auditoría → AU-0001; Proceso → NC-0001), else the flow default prefix;
 *  - the SLA of the request (Clasificación = Crítica → 8 business days), else the flow SLA;
 *  - who does each task (Área responsable = Producción → the production leader), replacing the task template assignees.
 */

type Executor = sql.ConnectionPool | sql.Transaction;
const req = (ex: Executor) => new sql.Request(ex as sql.ConnectionPool);

export const CONSECUTIVE_DIGITS = 4;
export const PREFIX_RE = /^[A-Z0-9]{1,10}$/;

/** AU + 7 → «AU-0007» (more digits when the number grows). */
export function formatConsecutive(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(CONSECUTIVE_DIGITS, '0')}`;
}

/** Normalizes a prefix typed by the consultant («au » → «AU»); null if empty, error if invalid. */
export function normalizePrefix(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return null;
  if (!PREFIX_RE.test(s)) throw new Error('El prefijo admite de 1 a 10 letras o números, sin espacios ni guiones.');
  return s;
}

export interface OptionRule {
  id_option: number;
  prefix: string | null;
  sla_value: number | null;
  sla_unit: string | null;
  /** Display order of the field and of the option (the first one wins when several apply). */
  order: number;
}

/** First rule (by field and option order) that defines the prefix, and the first one that defines an SLA. */
export function pickRules(rules: OptionRule[], defaultPrefix: string | null): { prefix: string | null; sla: { value: number; unit: string } | null } {
  const sorted = [...rules].sort((a, b) => a.order - b.order);
  const p = sorted.find((r) => r.prefix);
  const s = sorted.find((r) => r.sla_value && r.sla_unit);
  return { prefix: p?.prefix ?? defaultPrefix ?? null, sla: s ? { value: s.sla_value!, unit: s.sla_unit! } : null };
}

function optionList(r: sql.Request, ids: number[]): string {
  ids.forEach((id, i) => r.input(`o${i}`, sql.Int, id));
  return ids.map((_, i) => `@o${i}`).join(', ');
}

/** Rules that apply to the chosen options of a request of this flow. */
export async function rulesFor(ex: Executor, idProcess: number, optionIds: number[]): Promise<{ prefix: string | null; sla: { value: number; unit: string } | null }> {
  const r0 = req(ex).input('p', sql.Int, idProcess);
  const def = await r0.query<{ consecutive_prefix: string | null }>('SELECT consecutive_prefix FROM dbo.process_category WHERE id = @p');
  const defaultPrefix = def.recordset[0]?.consecutive_prefix ?? null;
  const ids = [...new Set(optionIds.filter((x) => Number.isInteger(x)))];
  if (!ids.length) return pickRules([], defaultPrefix);
  const r = req(ex).input('p', sql.Int, idProcess);
  const rows = await r.query<OptionRule>(`
    SELECT por.id_option, por.prefix, por.sla_value, por.sla_unit, (f.display_order * 1000 + o.display_order) AS [order]
    FROM dbo.process_option_rule por
    INNER JOIN process_form_field_option o ON o.id = por.id_option
    INNER JOIN process_form_field f ON f.id = o.id_form_field
    WHERE por.id_process_category = @p AND por.id_option IN (${optionList(r, ids)})`);
  return pickRules(rows.recordset, defaultPrefix);
}

/** Next consecutive of a company and prefix (inside the creation transaction: the row lock serializes it). */
export async function nextConsecutive(ex: Executor, idCompany: number, prefix: string): Promise<string> {
  const r = await req(ex)
    .input('c', sql.Int, idCompany)
    .input('p', sql.NVarChar(10), prefix)
    .query<{ last_value: number }>(`
      UPDATE dbo.request_consecutive_counter WITH (UPDLOCK, HOLDLOCK) SET last_value = last_value + 1
      OUTPUT INSERTED.last_value WHERE id_company = @c AND prefix = @p;
      IF @@ROWCOUNT = 0
        INSERT INTO dbo.request_consecutive_counter (id_company, prefix, last_value) OUTPUT INSERTED.last_value VALUES (@c, @p, 1);`);
  const sets = (r.recordsets as unknown as { last_value: number }[][]) ?? [];
  const row = sets.flat()[0] ?? r.recordset?.[0];
  if (!row) throw new Error('No se pudo asignar el consecutivo.');
  return formatConsecutive(prefix, row.last_value);
}

/** Assignees of a task chosen by option (they replace the template assignees); empty = use the template. */
export async function optionAssignees(ex: Executor, idTask: number, optionIds: number[]): Promise<{ id_user: string; email: string | null }[]> {
  const ids = [...new Set(optionIds.filter((x) => Number.isInteger(x)))];
  if (!ids.length) return [];
  const r = req(ex).input('t', sql.Int, idTask);
  const rows = await r.query<{ id_user: string; email: string | null }>(`
    SELECT DISTINCT toa.id_user, u.email
    FROM dbo.task_option_assignee toa INNER JOIN [user] u ON u.id = toa.id_user
    WHERE toa.id_task = @t AND toa.id_option IN (${optionList(r, ids)}) AND u.isActive = 1`);
  return rows.recordset;
}

/** Options chosen in a request (to apply the rules on tasks created later). */
export async function requestOptionIds(ex: Executor, idRequest: number): Promise<number[]> {
  const r = await req(ex).input('r', sql.Int, idRequest).query<{ id_option: number }>('SELECT id_option FROM request_form_value WHERE id_request_general = @r AND id_option IS NOT NULL');
  return r.recordset.map((x) => x.id_option);
}

/** All option assignees of the tasks of a flow for the chosen options, by task (one query). */
export async function optionAssigneesByTask(ex: Executor, idProcess: number, optionIds: number[]): Promise<Map<number, { id_user: string; email: string | null }[]>> {
  const out = new Map<number, { id_user: string; email: string | null }[]>();
  const ids = [...new Set(optionIds.filter((x) => Number.isInteger(x)))];
  if (!ids.length) return out;
  const r = req(ex).input('p', sql.Int, idProcess);
  const rows = await r.query<{ id_task: number; id_user: string; email: string | null }>(`
    SELECT DISTINCT toa.id_task, toa.id_user, u.email
    FROM dbo.task_option_assignee toa
    INNER JOIN task_process_category tpc ON tpc.id = toa.id_task AND tpc.id_process_category = @p
    INNER JOIN [user] u ON u.id = toa.id_user
    WHERE toa.id_option IN (${optionList(r, ids)}) AND u.isActive = 1`);
  for (const x of rows.recordset) out.set(x.id_task, [...(out.get(x.id_task) ?? []), { id_user: x.id_user, email: x.email }]);
  return out;
}

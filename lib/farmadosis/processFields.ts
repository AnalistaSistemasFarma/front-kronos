import { sql, getPool } from '../mssqlPool';
import { resolveProcessId, type FarmadosisConfig } from './config';
import { getFormDef } from './forms';
import type { ProcessField } from './mapFields';

export async function loadProcessFields(processId: number): Promise<ProcessField[]> {
  const pool = await getPool();
  const [fieldsResult, optionsResult] = await Promise.all([
    pool.request().input('idProcess', sql.Int, processId).query(`
      SELECT id, field_label, field_type, required, display_order
      FROM process_form_field
      WHERE active = 1 AND id_process_category = @idProcess
      ORDER BY display_order, id
    `),
    pool.request().input('idProcess', sql.Int, processId).query(`
      SELECT o.id, o.id_form_field, o.option_label, o.display_order
      FROM process_form_field_option o
      INNER JOIN process_form_field f ON f.id = o.id_form_field
      WHERE o.active = 1 AND f.active = 1 AND f.id_process_category = @idProcess
      ORDER BY o.display_order, o.id
    `),
  ]);

  const optionsByField: Record<number, { id: number; option_label: string }[]> = {};
  for (const opt of optionsResult.recordset) {
    (optionsByField[opt.id_form_field] ||= []).push({
      id: opt.id,
      option_label: opt.option_label,
    });
  }

  return fieldsResult.recordset.map((f: {
    id: number;
    field_label: string;
    field_type: string;
    required: boolean;
  }) => ({
    id: f.id,
    field_label: f.field_label,
    field_type: f.field_type,
    required: Boolean(f.required),
    options: optionsByField[f.id] || [],
  }));
}

export async function findUserIdByEmail(email: string | undefined): Promise<string | null> {
  const value = email?.trim();
  if (!value) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar(255), value)
    .query(`SELECT TOP 1 id FROM [user] WHERE email = @email`);
  return result.recordset[0]?.id ?? null;
}

export type ProcessRow = {
  id: number;
  process: string;
  active: boolean;
};

export async function getProcessById(processId: number): Promise<ProcessRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, processId)
    .query(`SELECT TOP 1 id, process, active FROM process_category WHERE id = @id`);
  const row = result.recordset[0];
  if (!row) return null;
  return { id: row.id, process: row.process, active: Boolean(row.active) };
}

export async function findProcessByName(name: string): Promise<ProcessRow | null> {
  const value = name?.trim();
  if (!value) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(1000), value)
    .query(`
      SELECT TOP 1 id, process, active
      FROM process_category
      WHERE LOWER(LTRIM(RTRIM(process))) = LOWER(@name)
      ORDER BY active DESC, id DESC
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return { id: row.id, process: row.process, active: Boolean(row.active) };
}

export async function processExists(processId: number): Promise<boolean> {
  const row = await getProcessById(processId);
  return Boolean(row?.active);
}

/** PROCESS_MAP / id explícito, o proceso con el nombre del catálogo (Contacto web, etc.). */
export async function resolveFarmadosisProcess(
  formKey: string,
  config: FarmadosisConfig
): Promise<ProcessRow | null> {
  const mappedId = resolveProcessId(formKey, config);
  if (mappedId) return getProcessById(mappedId);

  const def = getFormDef(formKey);
  if (def) return findProcessByName(def.processName);

  return null;
}

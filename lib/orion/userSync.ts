import 'server-only';
import sql from 'mssql';
import { syncOrionUsers, type OrionSyncUser } from './client';
import { getOrionConfig } from './config';
import {
  getKnownOrionTenantMap,
  provisionCompaniesInOrion,
  refreshOrionTenantMap,
  type OrionTenantProvisionSummary,
} from './tenantRegistry';

type SqlPool = import('mssql').ConnectionPool;

/** Máximo que acepta Orion en `POST /users/sync`. */
const BATCH_SIZE = 500;

const FIRMA_URL = `LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, N''))))`;
const FIRMA_NAME = `LOWER(LTRIM(RTRIM(ISNULL(s.subprocess, N''))))`;

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  identification: string | null;
  id_company: number | null;
  department_name: string | null;
  /** 1 si en esta empresa tiene Preparar, Firmar o Registrar huella. */
  has_firma: number | null;
  has_sign: number | null;
};

/**
 * Empresa principal = empresa predefinida del usuario (su primera empresa que
 * exista en Orion). Las demás solo se envían si en ellas tiene permiso de firmas;
 * sin ese permiso no entra a esa empresa en Orion.
 */
export function toSyncUsers(
  rows: UserRow[],
  tenantMap: Record<number, string>
): { users: OrionSyncUser[]; skipped: string[] } {
  const grouped = new Map<
    string,
    { row: UserRow; primary: number | null; additional: number[]; canSign: boolean }
  >();
  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email) continue;
    const entry = grouped.get(row.id) ?? { row, primary: null, additional: [], canSign: false };
    if (Number(row.has_sign) === 1) entry.canSign = true;
    const companyId = Number(row.id_company);
    if (Number.isInteger(companyId) && companyId > 0 && tenantMap[companyId]) {
      if (entry.primary == null) {
        entry.primary = companyId;
      } else if (
        companyId !== entry.primary &&
        Number(row.has_firma) === 1 &&
        !entry.additional.includes(companyId)
      ) {
        entry.additional.push(companyId);
      }
    }
    grouped.set(row.id, entry);
  }

  const users: OrionSyncUser[] = [];
  const skipped: string[] = [];
  for (const { row, primary, additional, canSign } of grouped.values()) {
    const email = row.email.trim().toLowerCase();
    if (!primary) {
      skipped.push(email);
      continue;
    }
    const idNumber = String(row.identification || '').trim() || null;
    users.push({
      email,
      name: String(row.name || '').trim() || email,
      synerlinkUserId: String(row.id),
      synerlinkCompanyId: primary,
      additionalCompanyIds: additional,
      departmentName: String(row.department_name || '').trim() || null,
      idDocumentType: idNumber ? 'CC' : null,
      idNumber,
      canSign,
    });
  }
  return { users, skipped };
}

async function loadUsers(pool: SqlPool, userId?: string): Promise<UserRow[]> {
  const request = pool.request();
  let filter = `WHERE u.isActive = 1 AND ISNULL(u.role, N'user') <> N'supplier'`;
  if (userId) {
    request.input('id', sql.NVarChar(255), userId);
    filter += ' AND u.id = @id';
  }
  const result = await request.query(`
    SELECT u.id, u.name, u.email, u.identification, cu.id_company,
      (
        SELECT TOP 1 d.department
        FROM department_user du
        INNER JOIN department d ON d.id_department = du.id_department
        WHERE du.id_user = u.id
        ORDER BY du.id
      ) AS department_name,
      firma.has_firma, firma.has_sign
    FROM [user] u
    LEFT JOIN company_user cu ON cu.id_user = u.id
    OUTER APPLY (
      SELECT
        MAX(CASE WHEN ${FIRMA_URL} IN (N'/process/firma/prepare', N'/process/firma/manage', N'/process/firma/sign', N'/process/firma/fingerprint')
                   OR ${FIRMA_NAME} LIKE N'%preparar firma%'
                   OR ${FIRMA_NAME} LIKE N'%firma digital%'
                   OR ${FIRMA_NAME} LIKE N'%firmar documento%'
                   OR ${FIRMA_NAME} LIKE N'%registrar huella%'
                 THEN 1 ELSE 0 END) AS has_firma,
        MAX(CASE WHEN ${FIRMA_URL} = N'/process/firma/sign'
                   OR ${FIRMA_NAME} LIKE N'%firmar documento%'
                 THEN 1 ELSE 0 END) AS has_sign
      FROM subprocess_user_company suc
      INNER JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
      WHERE suc.id_company_user = cu.id_company_user
    ) firma
    ${filter}
    ORDER BY u.email, cu.id_company_user
  `);
  return result.recordset as UserRow[];
}

export type OrionUserSyncSummary = {
  total: number;
  batches: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** Usuarios sin ninguna empresa en Orion (no se envían). */
  skippedWithoutCompany: number;
  errors: Array<{ email?: string; error: string }>;
  warnings: Array<{ email: string; warning: string }>;
  /** Alta previa de empresas Kronos que faltaban en Orion. */
  tenants: OrionTenantProvisionSummary;
};

async function sendBatches(users: OrionSyncUser[], summary: OrionUserSyncSummary) {
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    summary.batches += 1;
    const res = await syncOrionUsers(batch);
    // 422 = todos fallaron: igual trae el detalle por usuario.
    const detail = res.data?.users ?? [];
    if (!res.ok && detail.length === 0) {
      summary.failed += batch.length;
      summary.errors.push({ error: `Lote ${summary.batches}: ${res.error || `HTTP ${res.status}`}` });
      if (res.status === 404 && !res.data) break;
      continue;
    }
    const s = res.data?.summary;
    summary.created += Number(s?.created ?? 0);
    summary.updated += Number(s?.updated ?? 0);
    summary.unchanged += Number(s?.unchanged ?? 0);
    for (const u of detail) {
      if (u.action === 'error' || u.error) {
        summary.failed += 1;
        summary.errors.push({ email: u.email, error: u.error || 'Error en Orion' });
      }
      for (const w of u.warnings ?? []) summary.warnings.push({ email: u.email, warning: w });
    }
  }
}

/** Carga masiva de usuarios activos en Orion (módulos Por firmar, Mi firma y Mi huella). */
export async function syncAllUsersToOrion(pool: SqlPool): Promise<OrionUserSyncSummary> {
  const tenants = await provisionCompaniesInOrion(pool);
  const { users, skipped } = toSyncUsers(await loadUsers(pool), getKnownOrionTenantMap());
  const summary: OrionUserSyncSummary = {
    tenants,
    total: users.length,
    batches: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    skippedWithoutCompany: skipped.length,
    errors: [],
    warnings: [],
  };
  await sendBatches(users, summary);
  summary.errors = summary.errors.slice(0, 50);
  summary.warnings = summary.warnings.slice(0, 50);
  return summary;
}

/** Tras crear/editar un usuario en Administración: replicar en Orion sin bloquear la respuesta. */
export function syncUserToOrionInBackground(pool: SqlPool, userId: string): void {
  if (!getOrionConfig().enabled || !userId) return;
  void (async () => {
    const rows = await loadUsers(pool, userId);
    const known = (await refreshOrionTenantMap()) ?? getKnownOrionTenantMap();
    const missing = rows
      .map((r) => Number(r.id_company))
      .filter((id) => Number.isInteger(id) && id > 0 && !known[id]);
    if (missing.length > 0) await provisionCompaniesInOrion(pool, missing);
    const { users } = toSyncUsers(rows, getKnownOrionTenantMap());
    if (users.length === 0) return;
    const res = await syncOrionUsers(users);
    if (!res.ok) console.warn('[orion/userSync] No se pudo sincronizar el usuario', userId, res.error);
  })().catch((err) => console.warn('[orion/userSync] Error sincronizando usuario', userId, err));
}

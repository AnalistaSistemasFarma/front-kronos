import 'server-only';
import sql from 'mssql';
import { listOrionTraceCompanies } from './documentAccess';
import { resolveOrionActorUserId } from './service';
import { getKnownOrionTenantMap, refreshOrionTenantMap } from './tenantRegistry';

type SqlPool = import('mssql').ConnectionPool;

export type OrionTraceCompany = { id: number; name: string; tenantId: string };

export type OrionTraceScope = {
  isAdmin: boolean;
  companies: OrionTraceCompany[];
};

export function isOrionTraceAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'superadmin';
}

/**
 * Empresas que el usuario puede consultar en la trazabilidad: las que tienen el permiso
 * "Ver trazabilidad de documentos" (admin: todas) y además existen en Orion.
 */
export async function resolveOrionTraceScope(
  pool: SqlPool,
  user: { id?: string | null; email: string; role?: string | null }
): Promise<OrionTraceScope> {
  const isAdmin = isOrionTraceAdminRole(user.role);
  await refreshOrionTenantMap();
  const tenantMap = getKnownOrionTenantMap();
  let ids = Object.keys(tenantMap).map(Number);

  if (!isAdmin) {
    const actorId = await resolveOrionActorUserId(pool, {
      userId: user.id ?? null,
      email: user.email,
    });
    const allowed = actorId ? await listOrionTraceCompanies(pool, actorId) : [];
    ids = ids.filter((id) => allowed.includes(id));
    if (ids.length === 0) {
      throw Object.assign(
        new Error('No tiene el permiso “Ver trazabilidad de documentos” en ninguna empresa.'),
        { status: 403 }
      );
    }
  }

  if (ids.length === 0) return { isAdmin, companies: [] };

  const request = pool.request();
  const params = ids.map((id, i) => {
    request.input(`c${i}`, sql.Int, id);
    return `@c${i}`;
  });
  const result = await request.query(
    `SELECT id_company, company FROM company WHERE id_company IN (${params.join(', ')})`
  );
  const names = new Map<number, string>(
    result.recordset.map((row) => [Number(row.id_company), String(row.company || '')])
  );

  const companies = ids
    .map((id) => ({ id, name: names.get(id) || `Empresa ${id}`, tenantId: tenantMap[id] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return { isAdmin, companies };
}

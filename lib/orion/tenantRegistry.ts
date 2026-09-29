import 'server-only';
import sql from 'mssql';
import { listOrionTenants, syncOrionTenants } from './client';
import { getOrionConfig } from './config';
import { parseOrionTenantMap, planOrionTenantProvision } from './tenantCheck';

type SqlPool = import('mssql').ConnectionPool;

const CACHE_TTL_MS = 5 * 60 * 1000;

export const ORION_TENANT_SYNC_UNSUPPORTED_MESSAGE =
  'Orion todavía no permite crear empresas automáticamente (falta POST /api/integrations/synerlink/tenants/sync).';

let cache: { map: Record<number, string>; fetchedAt: number } | null = null;

/** Mapa id_company → slug según Orion (GET /tenants), con caché de 5 min. null si Orion no responde. */
export async function refreshOrionTenantMap(
  options: { force?: boolean } = {}
): Promise<Record<number, string> | null> {
  if (!options.force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.map;
  if (!getOrionConfig().enabled) return null;
  const res = await listOrionTenants();
  if (!res.ok || !res.data) return cache?.map ?? null;
  cache = { map: parseOrionTenantMap(res.data), fetchedAt: Date.now() };
  return cache.map;
}

/**
 * Mapa vigente sin ir a la red: el de Orion si ya se consultó; si Orion nunca respondió,
 * ORION_TENANT_MAP como respaldo.
 */
export function getKnownOrionTenantMap(): Record<number, string> {
  return cache ? cache.map : getOrionConfig().tenantMap;
}

export async function resolveOrionTenantIdLive(companyId: number): Promise<string | null> {
  await refreshOrionTenantMap();
  return getKnownOrionTenantMap()[companyId] ?? null;
}

async function loadCompanies(
  pool: SqlPool,
  companyIds?: number[]
): Promise<Array<{ id: number; name: string }>> {
  const request = pool.request();
  let where = '';
  if (companyIds) {
    const ids = [...new Set(companyIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return [];
    where = `WHERE id_company IN (${ids
      .map((id, i) => {
        request.input(`c${i}`, sql.Int, id);
        return `@c${i}`;
      })
      .join(', ')})`;
  }
  const result = await request.query(
    `SELECT id_company, company FROM company ${where} ORDER BY id_company`
  );
  return result.recordset.map((row) => ({
    id: Number(row.id_company),
    name: String(row.company || '').trim(),
  }));
}

export type OrionTenantProvisionSummary = {
  total: number;
  alreadyInOrion: number;
  provisioned: number;
  failed: number;
  /** Orion respondió 404/405: aún no expone el alta de empresas. */
  unsupported: boolean;
  error: string | null;
  companies: Array<{
    synerlinkCompanyId: number;
    name: string;
    slug: string;
    status: 'provisioned' | 'failed';
  }>;
};

/**
 * Crea en Orion las empresas de Kronos que aún no existan allá (todas, o solo `companyIds`).
 * Idempotente: las que ya están en GET /tenants no se envían.
 */
export async function provisionCompaniesInOrion(
  pool: SqlPool,
  companyIds?: number[]
): Promise<OrionTenantProvisionSummary> {
  const summary: OrionTenantProvisionSummary = {
    total: 0,
    alreadyInOrion: 0,
    provisioned: 0,
    failed: 0,
    unsupported: false,
    error: null,
    companies: [],
  };
  if (!getOrionConfig().enabled) {
    summary.error = 'Integración Orion no configurada';
    return summary;
  }

  const orionMap = await refreshOrionTenantMap({ force: true });
  if (!orionMap) {
    summary.error = 'No se pudo consultar las empresas de Orion (GET /tenants)';
    return summary;
  }

  const companies = await loadCompanies(pool, companyIds);
  summary.total = companies.length;
  const plan = planOrionTenantProvision(companies, orionMap, getOrionConfig().tenantMap);
  summary.alreadyInOrion = companies.length - plan.length;
  if (plan.length === 0) return summary;

  const res = await syncOrionTenants(plan);
  if (!res.ok) {
    summary.unsupported = res.status === 404 || res.status === 405;
    summary.error = summary.unsupported
      ? ORION_TENANT_SYNC_UNSUPPORTED_MESSAGE
      : res.error || `HTTP ${res.status}`;
    summary.failed = plan.length;
    summary.companies = plan.map((p) => ({ ...p, status: 'failed' }));
    return summary;
  }

  const returned = parseOrionTenantMap(res.data);
  const merged =
    Object.keys(returned).length > 0
      ? { ...orionMap, ...returned }
      : ((await refreshOrionTenantMap({ force: true })) ?? orionMap);
  cache = { map: merged, fetchedAt: Date.now() };

  for (const item of plan) {
    const slug = merged[item.synerlinkCompanyId];
    if (slug) {
      summary.provisioned += 1;
      summary.companies.push({ ...item, slug, status: 'provisioned' });
    } else {
      summary.failed += 1;
      summary.companies.push({ ...item, status: 'failed' });
    }
  }
  if (summary.failed > 0 && !summary.error) {
    summary.error = 'Orion no devolvió algunas empresas después del alta';
  }
  return summary;
}

/**
 * Slug Orion de la empresa; si no existe allá, la crea en ese momento.
 * Lanza 422/503 con un mensaje claro si no se puede.
 */
export async function ensureOrionTenantForCompany(
  pool: SqlPool,
  companyId: number,
  companyName?: string | null
): Promise<string> {
  const label = `"${companyName || 'sin nombre'}" (id_company=${companyId})`;
  const map = await refreshOrionTenantMap();
  if (map?.[companyId]) return map[companyId];

  if (!map) {
    const fallback = getOrionConfig().tenantMap[companyId];
    if (fallback) return fallback;
    throw Object.assign(
      new Error(`No se pudo consultar las empresas en Orion para la empresa ${label}. Intente de nuevo.`),
      { status: 503 }
    );
  }

  const summary = await provisionCompaniesInOrion(pool, [companyId]);
  const slug = cache?.map[companyId];
  if (slug) return slug;

  throw Object.assign(
    new Error(
      summary.unsupported
        ? `La empresa ${label} no existe en Orion y no se pudo crear sola: ${ORION_TENANT_SYNC_UNSUPPORTED_MESSAGE}`
        : `No se pudo crear la empresa ${label} en Orion: ${summary.error || 'sin detalle'}`
    ),
    { status: 422 }
  );
}

export type OrionTenantMismatch = {
  synerlinkCompanyId: number;
  kronos: string | null;
  orion: string | null;
};

function pickSlug(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    for (const key of ['slug', 'companySlug', 'tenantId', 'tenant']) {
      const v = row[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

function pickCompanyId(row: Record<string, unknown>): number | null {
  for (const key of ['synerlinkCompanyId', 'companyId', 'id_company', 'id']) {
    const n = Number(row[key]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/**
 * Normaliza la respuesta de GET /tenants de Orion a { id_company: slug }.
 * Acepta un objeto plano, { tenants | tenantMap | map: ... } o un arreglo de filas.
 */
export function parseOrionTenantMap(data: unknown): Record<number, string> {
  const map: Record<number, string> = {};
  let source: unknown = data;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const obj = source as Record<string, unknown>;
    source = obj.tenants ?? obj.tenantMap ?? obj.map ?? obj.data ?? obj;
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const slug = pickSlug(row);
      if (!slug) continue;
      // Formato Orion: { slug, synerlinkCompanyIds: [8, ...] }
      if (Array.isArray(row.synerlinkCompanyIds)) {
        for (const raw of row.synerlinkCompanyIds) {
          const id = Number(raw);
          if (Number.isInteger(id) && id > 0) map[id] = slug;
        }
        continue;
      }
      const id = pickCompanyId(row);
      if (id) map[id] = slug;
    }
    return map;
  }

  if (source && typeof source === 'object') {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const id = Number(key);
      const slug = pickSlug(value);
      if (Number.isInteger(id) && id > 0 && slug) map[id] = slug;
    }
  }
  return map;
}

/** "ONE LATAM Pharma S.A.S." → "one-latam-pharma-s-a-s" */
export function slugifyCompanyName(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export type OrionTenantProvisionItem = {
  synerlinkCompanyId: number;
  name: string;
  slug: string;
};

/**
 * Empresas Kronos que aún no están en Orion, con el slug a proponer:
 * - el de ORION_TENANT_MAP si existe (si ya es de otra empresa en Orion, se vincula a ese tenant);
 * - si no, el nombre en slug; si ese slug ya lo usa otra empresa, se le agrega "-{id}".
 */
export function planOrionTenantProvision(
  companies: Array<{ id: number; name: string }>,
  orionMap: Record<number, string>,
  envMap: Record<number, string> = {}
): OrionTenantProvisionItem[] {
  const taken = new Set(Object.values(orionMap));
  const plan: OrionTenantProvisionItem[] = [];
  for (const company of companies) {
    if (orionMap[company.id]) continue;
    const name = String(company.name || '').trim() || `Empresa ${company.id}`;
    let slug = envMap[company.id]?.trim() || '';
    if (!slug) {
      slug = slugifyCompanyName(name) || `empresa-${company.id}`;
      if (taken.has(slug)) slug = `${slug}-${company.id}`;
    }
    taken.add(slug);
    plan.push({ synerlinkCompanyId: company.id, name, slug });
  }
  return plan;
}

export function compareOrionTenantMaps(
  kronos: Record<number, string>,
  orion: Record<number, string>
): OrionTenantMismatch[] {
  const ids = new Set([...Object.keys(kronos), ...Object.keys(orion)].map(Number));
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => ({ synerlinkCompanyId: id, kronos: kronos[id] ?? null, orion: orion[id] ?? null }))
    .filter((row) => row.kronos !== row.orion);
}

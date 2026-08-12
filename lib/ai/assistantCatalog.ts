// Catálogo de empresas/procesos para el asistente (puro + fetch).

export interface CatalogCompany {
  id: number;
  name: string;
}

export interface CatalogProcess {
  id: number;
  name: string;
  categoryId: number;
  category: string;
  description: string;
  active: boolean;
}

export interface AssistantCatalog {
  companies: CatalogCompany[];
  processes: CatalogProcess[];
  loadedAt: string;
}

type RawConsult = {
  companies?: Array<{ id_company?: number; company?: string }>;
  processCategories?: Array<{
    id_process?: number;
    process?: string;
    id_category_request?: number;
    category?: string;
    description?: string | null;
    active?: number | boolean | null;
  }>;
};

export function normalizeCatalog(raw: RawConsult): AssistantCatalog {
  const companies = (raw.companies ?? [])
    .map((c) => ({
      id: Number(c.id_company),
      name: String(c.company ?? '').trim(),
    }))
    .filter((c) => Number.isFinite(c.id) && c.name);

  const processes = (raw.processCategories ?? [])
    .map((p) => ({
      id: Number(p.id_process),
      name: String(p.process ?? '').trim(),
      categoryId: Number(p.id_category_request),
      category: String(p.category ?? '').trim(),
      description: String(p.description ?? '').trim(),
      active: p.active === 1 || p.active === true,
    }))
    .filter((p) => Number.isFinite(p.id) && p.name);

  return {
    companies,
    processes,
    loadedAt: new Date().toISOString(),
  };
}

export async function fetchAssistantCatalog(): Promise<AssistantCatalog> {
  const res = await fetch('/api/requests-general/consult-request');
  if (!res.ok) {
    throw new Error('No se pudo cargar el catálogo de solicitudes.');
  }
  const raw = (await res.json()) as RawConsult;
  return normalizeCatalog(raw);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(haystack: string, needle: string): number {
  const h = normalizeText(haystack);
  const n = normalizeText(needle);
  if (!h || !n) return 0;
  if (h === n) return 100;
  if (h.includes(n) || n.includes(h)) return 80;
  const tokens = n.split(' ').filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => h.includes(t)).length;
  return Math.round((hits / tokens.length) * 60);
}

export function resolveCompany(
  catalog: AssistantCatalog,
  opts: { id?: number | null; name?: string | null },
): CatalogCompany | null {
  if (opts.id != null && Number.isFinite(Number(opts.id))) {
    const byId = catalog.companies.find((c) => c.id === Number(opts.id));
    if (byId) return byId;
  }
  const name = (opts.name ?? '').trim();
  if (!name) return null;
  let best: CatalogCompany | null = null;
  let bestScore = 0;
  for (const c of catalog.companies) {
    const s = scoreMatch(c.name, name);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return bestScore >= 40 ? best : null;
}

export function resolveProcess(
  catalog: AssistantCatalog,
  opts: { id?: number | null; name?: string | null },
): CatalogProcess | null {
  const active = catalog.processes.filter((p) => p.active);
  if (opts.id != null && Number.isFinite(Number(opts.id))) {
    const byId = active.find((p) => p.id === Number(opts.id));
    if (byId) return byId;
  }
  const name = (opts.name ?? '').trim();
  if (!name) return null;
  let best: CatalogProcess | null = null;
  let bestScore = 0;
  for (const p of active) {
    const s = Math.max(
      scoreMatch(p.name, name),
      scoreMatch(`${p.category} ${p.name}`, name),
      scoreMatch(p.description, name),
    );
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return bestScore >= 35 ? best : null;
}

/** Procesos más relevantes al mensaje del usuario (para no saturar el contexto). */
export function rankProcessesForQuery(
  catalog: AssistantCatalog,
  query: string,
  limit = 25,
): CatalogProcess[] {
  const active = catalog.processes.filter((p) => p.active);
  const q = query.trim();
  if (!q) return active.slice(0, limit);

  return active
    .map((p) => ({
      p,
      score: Math.max(
        scoreMatch(p.name, q),
        scoreMatch(p.category, q),
        scoreMatch(p.description, q),
        scoreMatch(`${p.category} ${p.name} ${p.description}`, q),
      ),
    }))
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .filter((x, i) => x.score > 0 || i < 12)
    .slice(0, limit)
    .map((x) => x.p);
}

/** Texto compacto para inyectar en el prompt del modelo. */
export function formatCatalogForPrompt(
  catalog: AssistantCatalog,
  query?: string,
): string {
  const companies = catalog.companies
    .map((c) => `[${c.id}] ${c.name}`)
    .join('; ');
  const processes = rankProcessesForQuery(catalog, query ?? '', 30)
    .map(
      (p) =>
        `[${p.id}|cat:${p.categoryId}] ${p.category} › ${p.name}` +
        (p.description ? ` — ${p.description.slice(0, 80)}` : ''),
    )
    .join('\n');

  return (
    `Empresas (id|nombre):\n${companies || '(ninguna)'}\n\n` +
    `Procesos activos relevantes (id|categoría › nombre):\n${processes || '(ninguno)'}`
  );
}

// Catálogo Help Desk para el asistente.

import type { CatalogCompany } from './assistantCatalog';
import { normalizeCatalog, resolveCompany } from './assistantCatalog';

export interface HelpDeskCategory {
  id: number;
  name: string;
}

export interface HelpDeskDepartment {
  id: number;
  name: string;
}

export interface HelpDeskTechnician {
  /** Valor que envía el formulario de create-ticket (id_subprocess_user_company). */
  id: number;
  name: string;
  companyUserId: number;
}

export interface HelpDeskOption {
  id: number;
  name: string;
}

export interface HelpDeskCatalog {
  companies: CatalogCompany[];
  categories: HelpDeskCategory[];
  departments: HelpDeskDepartment[];
  technicians: HelpDeskTechnician[];
  loadedAt: string;
}

function scoreName(haystack: string, needle: string): number {
  const h = haystack
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const n = needle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!h || !n) return 0;
  if (h === n) return 100;
  if (h.includes(n) || n.includes(h)) return 85;
  const tokens = n.split(/\s+/).filter((t) => t.length > 1);
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => h.includes(t)).length;
  return Math.round((hits / tokens.length) * 70);
}

export async function fetchHelpDeskCatalog(): Promise<HelpDeskCatalog> {
  const [companiesRes, categoriesRes, departmentsRes, technicalRes] =
    await Promise.all([
      fetch('/api/requests-general/consult-request'),
      fetch('/api/help-desk/categories'),
      fetch('/api/help-desk/departments'),
      fetch('/api/help-desk/technical'),
    ]);

  if (!companiesRes.ok) throw new Error('No se pudieron cargar empresas.');
  if (!categoriesRes.ok) throw new Error('No se pudieron cargar categorías de casos.');
  if (!departmentsRes.ok) throw new Error('No se pudieron cargar departamentos.');
  if (!technicalRes.ok) throw new Error('No se pudieron cargar técnicos.');

  const companiesRaw = await companiesRes.json();
  const companies = normalizeCatalog(companiesRaw).companies;

  const categories = (
    (await categoriesRes.json()) as Array<{ id_category: number; category: string }>
  ).map((c) => ({ id: Number(c.id_category), name: String(c.category) }));

  const departments = (
    (await departmentsRes.json()) as Array<{
      id_department: number;
      department: string;
    }>
  ).map((d) => ({ id: Number(d.id_department), name: String(d.department) }));

  const technicians = (
    (await technicalRes.json()) as Array<{
      id_subprocess_user_company: number;
      id_company_user: number;
      name: string;
    }>
  ).map((t) => ({
    id: Number(t.id_subprocess_user_company),
    companyUserId: Number(t.id_company_user),
    name: String(t.name ?? '').trim(),
  }));

  return {
    companies,
    categories: categories.filter((c) => c.id && c.name),
    departments: departments.filter((d) => d.id && d.name),
    technicians: technicians.filter((t) => t.id && t.name),
    loadedAt: new Date().toISOString(),
  };
}

export async function fetchSubcategories(
  categoryId: number,
): Promise<HelpDeskOption[]> {
  const res = await fetch(
    `/api/help-desk/subcategories?category_id=${categoryId}`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    id_subcategory: number;
    subcategory: string;
  }>;
  return data.map((s) => ({
    id: Number(s.id_subcategory),
    name: String(s.subcategory),
  }));
}

export async function fetchActivities(
  subcategoryId: number,
): Promise<HelpDeskOption[]> {
  const res = await fetch(
    `/api/help-desk/activities?subcategory_id=${subcategoryId}`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    id_activity: number;
    activity: string;
  }>;
  return data.map((a) => ({
    id: Number(a.id_activity),
    name: String(a.activity),
  }));
}

export function resolveTechnician(
  catalog: HelpDeskCatalog,
  name: string | null | undefined,
): HelpDeskTechnician | null {
  if (!name?.trim()) return null;
  let best: HelpDeskTechnician | null = null;
  let bestScore = 0;
  for (const t of catalog.technicians) {
    const s = scoreName(t.name, name);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return bestScore >= 45 ? best : null;
}

export function resolveHelpDeskCategory(
  catalog: HelpDeskCatalog,
  hint: string,
): HelpDeskCategory | null {
  let best: HelpDeskCategory | null = null;
  let bestScore = 0;
  for (const c of catalog.categories) {
    const s = Math.max(scoreName(c.name, hint), scoreName(hint, c.name));
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  // preferencias tipicas de soporte/chatbot
  if (bestScore < 35) {
    const soft = catalog.categories.find((c) =>
      /sistemas|ti|tecnolog|soporte|infra|software|chat/i.test(c.name),
    );
    return soft ?? null;
  }
  return best;
}

export function resolveHelpDeskCompany(
  catalog: HelpDeskCatalog,
  hint: string | null,
): CatalogCompany | null {
  if (hint) {
    const byHint = resolveCompany(
      { companies: catalog.companies, processes: [], loadedAt: catalog.loadedAt },
      { name: hint },
    );
    if (byHint) return byHint;
  }
  return (
    catalog.companies.find((c) => /farmalogica|onelatam|gss/i.test(c.name)) ??
    catalog.companies[0] ??
    null
  );
}

export function formatHelpDeskCatalogForPrompt(catalog: HelpDeskCatalog): string {
  const cats = catalog.categories
    .slice(0, 40)
    .map((c) => `[${c.id}] ${c.name}`)
    .join('; ');
  const deps = catalog.departments
    .slice(0, 40)
    .map((d) => `[${d.id}] ${d.name}`)
    .join('; ');
  const techs = catalog.technicians
    .slice(0, 40)
    .map((t) => `[${t.id}] ${t.name}`)
    .join('; ');
  const companies = catalog.companies
    .map((c) => `[${c.id}] ${c.name}`)
    .join('; ');
  return (
    `Empresas: ${companies}\n` +
    `Categorías caso: ${cats}\n` +
    `Departamentos: ${deps}\n` +
    `Técnicos (asignar): ${techs}`
  );
}

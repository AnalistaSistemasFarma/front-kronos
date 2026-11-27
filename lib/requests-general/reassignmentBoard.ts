import { filterByText } from './textSearch';

export interface WorkflowRaw {
  id_process_category: number;
  process: string;
  id_category_request: number;
  category: string;
  active: boolean | number | null;
  assigned: string | null;
  company: string | null;
  id_department: number;
  department: string | null;
}

export interface RequestRow {
  id: number;
  category: string;
  description: string;
  id_company: number;
  company: string;
  created_at: string;
  requester: string | null;
  status: string;
  subject: string;
  process: string | null;
  id_process_category: number | null;
  id_status_case: number;
  executor_final: string | null;
  user: string | null;
  users_category: string | null;
  departments_proc: string | null;
}

export interface TaskRow {
  id: number;
  id_task: number;
  task: string;
  id_request_general: number;
  description: string;
  subject_request: string;
  id_company: number;
  company: string;
  created_at: string;
  name_requester: string;
  id_status: number;
  status_task: string;
  assigned: string;
  department: string | null;
  process: string | null;
  category: string | null;
}

export interface Workflow {
  id: number;
  process: string;
  category: string;
  active: boolean;
  assigned: string[];
  companies: string[];
  departments: string[];
}

export type Kind = 'workflows' | 'requests' | 'tasks';
export const KINDS: Kind[] = ['workflows', 'requests', 'tasks'];

export interface BoardItem {
  kind: Kind;
  id: number;
  key: string;
  ref: string;
  title: string;
  subtitle?: string | null;
  company: string;
  detail?: string | null;
  date?: string | null;
  status: string;
  requester?: string | null;
  assigned: string;
  companies: string[];
  process: string;
  flowId: number | null;
  searchParts: unknown[];
}

export interface BoardFilters {
  company: string | null;
  process: string | null;
  person: string | null;
  status: string | null;
}

export const EMPTY_FILTERS: BoardFilters = { company: null, process: null, person: null, status: null };

const clean = (value: unknown) => String(value ?? '').trim();

export const uniq = (values: Array<string | null | undefined>) => [...new Set(values.map(clean).filter(Boolean))];

export const toOptions = (values: Array<string | null | undefined>) =>
  uniq(values)
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((v) => ({ value: v, label: v }));

export function groupWorkflows(rows: WorkflowRaw[]): Workflow[] {
  const byId = new Map<number, { base: WorkflowRaw; assigned: string[]; companies: string[]; departments: string[] }>();
  for (const row of rows) {
    const entry = byId.get(row.id_process_category) ?? { base: row, assigned: [], companies: [], departments: [] };
    entry.assigned.push(row.assigned ?? '');
    entry.companies.push(row.company ?? '');
    entry.departments.push(row.department ?? '');
    byId.set(row.id_process_category, entry);
  }
  return [...byId.values()].map(({ base, assigned, companies, departments }) => ({
    id: base.id_process_category,
    process: clean(base.process),
    category: clean(base.category),
    active: base.active === true || base.active === 1,
    assigned: uniq(assigned),
    companies: uniq(companies),
    departments: uniq(departments),
  }));
}

export const workflowItem = (w: Workflow): BoardItem => ({
  kind: 'workflows',
  id: w.id,
  key: `workflows-${w.id}`,
  ref: `#${w.id}`,
  title: w.process,
  subtitle: w.category,
  company: w.companies.join(', ') || '—',
  detail: w.departments.length ? `Depto. ${w.departments.join(', ')}` : null,
  status: w.active ? 'Activo' : 'Inactivo',
  assigned: w.assigned.join(', ') || 'Sin asignar',
  companies: w.companies,
  process: clean(w.process),
  flowId: w.id,
  searchParts: [w.id, w.process, w.category, ...w.companies, ...w.departments, ...w.assigned],
});

export const requestItem = (r: RequestRow): BoardItem => ({
  kind: 'requests',
  id: r.id,
  key: `requests-${r.id}`,
  ref: `#${r.id}`,
  title: r.subject,
  company: clean(r.company),
  detail: [r.category, r.process].map(clean).filter(Boolean).join(' · '),
  date: r.created_at,
  status: clean(r.status),
  requester: r.requester,
  assigned: r.user || 'Sin asignar',
  companies: uniq([r.company]),
  process: clean(r.process),
  flowId: r.id_process_category ?? null,
  searchParts: [r.id, r.subject, r.description, r.company, r.category, r.process, r.status, r.requester, r.user],
});

export const taskItem = (t: TaskRow): BoardItem => ({
  kind: 'tasks',
  id: t.id,
  key: `tasks-${t.id}`,
  ref: `#${t.id_request_general}`,
  title: t.task,
  subtitle: t.subject_request,
  company: clean(t.company),
  detail: [t.category, t.process].map(clean).filter(Boolean).join(' · '),
  date: t.created_at,
  status: clean(t.status_task),
  requester: t.name_requester,
  assigned: t.assigned || 'Sin asignar',
  companies: uniq([t.company]),
  process: clean(t.process),
  flowId: null,
  searchParts: [
    t.id_request_general,
    t.task,
    t.subject_request,
    t.description,
    t.company,
    t.category,
    t.process,
    t.status_task,
    t.name_requester,
    t.assigned,
  ],
});

export function buildBoardItems(data: {
  workflows: WorkflowRaw[];
  requests: RequestRow[];
  tasks: TaskRow[];
}): BoardItem[] {
  return [
    ...groupWorkflows(data.workflows).map(workflowItem),
    ...data.requests.map(requestItem),
    ...data.tasks.map(taskItem),
  ];
}

export const matchesFilters = (item: BoardItem, f: BoardFilters) =>
  (!f.company || item.companies.includes(clean(f.company))) &&
  (!f.process || item.process === clean(f.process)) &&
  (!f.status || item.status === clean(f.status));

export const filterBoardItems = (items: BoardItem[], search: string, filters: BoardFilters) =>
  filterByText(items, search, (item) => item.searchParts).filter((item) => matchesFilters(item, filters));

export function buildFilterOptions(items: BoardItem[]) {
  return {
    companies: toOptions(items.flatMap((i) => i.companies)),
    processes: toOptions(items.map((i) => i.process)),
    statuses: toOptions(items.map((i) => i.status)),
  };
}

export type Selection = Record<Kind, Set<number>>;

export const emptySelection = (): Selection => ({ workflows: new Set(), requests: new Set(), tasks: new Set() });

export const isSelected = (selection: Selection, item: BoardItem) => selection[item.kind].has(item.id);

export function linkedItems(items: BoardItem[], universe: BoardItem[]): BoardItem[] {
  const flowIds = new Set(
    items.filter((i) => i.kind !== 'tasks' && i.flowId != null).map((i) => i.flowId as number)
  );
  if (!flowIds.size) return items;
  const linked = universe.filter((i) => i.kind !== 'tasks' && i.flowId != null && flowIds.has(i.flowId));
  return [...new Map([...items, ...linked].map((i) => [i.key, i])).values()];
}

export function setSelected(
  selection: Selection,
  items: BoardItem[],
  checked: boolean,
  universe: BoardItem[] = items
): Selection {
  const next: Selection = {
    workflows: new Set(selection.workflows),
    requests: new Set(selection.requests),
    tasks: new Set(selection.tasks),
  };
  for (const item of linkedItems(items, universe)) {
    if (checked) next[item.kind].add(item.id);
    else next[item.kind].delete(item.id);
  }
  return next;
}

export const selectionPayload = (selection: Selection) => ({
  workflowIds: [...selection.workflows],
  requestIds: [...selection.requests],
  taskIds: [...selection.tasks],
});

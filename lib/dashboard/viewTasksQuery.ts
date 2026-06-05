import type { ConnectionPool, Request } from 'mssql';
import type { DashboardTask, DashboardRequest } from './types';
import { normalizeVwRequestsGeneralRows } from './viewRequestsQuery';
import {
  normalizeActivityStatus,
  normalizeAssigneeName,
} from './normalizeActivityFields';

export interface ViewTasksFilters {
  task_status?: string | null;
  request_status?: string | null;
  assigned_user?: string | null;
  creator?: string | null;
  executor?: string | null;
  company?: string | null;
  process?: string | null;
  category?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  task_date_from?: string | null;
  task_date_to?: string | null;
  active?: string | null;
}

/** Fila de vw_tareas_solicitudes (+ encargado_proceso si la vista lo expone). */
export type DashboardTaskRow = Record<string, unknown> & {
  id_tarea: number;
  tarea: string;
  estado_tarea: string;
  asignado_tarea: string;
  hora_inicio_tarea: string | null;
  fecha_fin_tarea: string | null;
  resolucion_tarea: string | null;
  fecha_resolucion_tarea: string | null;
  costo_tarea: number | null;
  centro_costo_tarea: string | null;
  activo_tarea: boolean;
  ejecutor_final_tarea: string | null;
  id_solicitud: number;
  asunto_solicitud: string;
  descripcion_solicitud: string;
  fecha_creacion_solicitud: string;
  empresa_solicitud: string;
  creador_solicitud: string;
  estado_solicitud: string;
  resolucion_solicitud: string | null;
  fecha_resolucion_solicitud: string | null;
  ejecutor_final_solicitud: string | null;
  proceso_solicitud: string;
  categoria_solicitud: string;
  encargado_proceso?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}` === value;
}

export function parseViewTasksFilters(searchParams: URLSearchParams): ViewTasksFilters {
  return {
    task_status: searchParams.get('task_status'),
    request_status: searchParams.get('request_status'),
    assigned_user: searchParams.get('assigned_user'),
    creator: searchParams.get('creator'),
    executor: searchParams.get('executor'),
    company: searchParams.get('company'),
    process: searchParams.get('process'),
    category: searchParams.get('category'),
    date_from: searchParams.get('date_from'),
    date_to: searchParams.get('date_to'),
    task_date_from: searchParams.get('task_date_from'),
    task_date_to: searchParams.get('task_date_to'),
    active: searchParams.get('active'),
  };
}

export function validateDateRange(
  date_from: string | null | undefined,
  date_to: string | null | undefined
): string | null {
  if (!date_from && !date_to) return null;
  if (!date_from || !date_to) {
    return 'date_from y date_to deben enviarse juntos (formato YYYY-MM-DD)';
  }
  if (!ISO_DATE.test(date_from) || !ISO_DATE.test(date_to)) {
    return 'Las fechas deben tener formato YYYY-MM-DD';
  }
  if (!isValidCalendarDate(date_from) || !isValidCalendarDate(date_to)) {
    return 'Fecha inválida (verifique día y mes)';
  }
  if (date_from > date_to) {
    return 'date_from no puede ser posterior a date_to';
  }
  return null;
}

/**
 * Misma consulta que main: SELECT * FROM vw_tareas_solicitudes con filtros opcionales.
 */
function buildVwTareasQuery(filters: ViewTasksFilters): string {
  let query = `
    SELECT *
    FROM [vw_tareas_solicitudes]
    WHERE 1=1
  `;

  if (filters.task_status) {
    query += ` AND estado_tarea = @task_status`;
  }
  if (filters.request_status) {
    query += ` AND estado_solicitud = @request_status`;
  }
  if (filters.assigned_user) {
    query += ` AND asignado_tarea LIKE '%' + @assigned_user + '%'`;
  }
  if (filters.creator) {
    query += ` AND creador_solicitud LIKE '%' + @creator + '%'`;
  }
  if (filters.executor) {
    query += ` AND ejecutor_final_tarea LIKE '%' + @executor + '%'`;
  }
  if (filters.company) {
    query += ` AND empresa_solicitud = @company`;
  }
  if (filters.process) {
    query += ` AND proceso_solicitud = @process`;
  }
  if (filters.category) {
    query += ` AND categoria_solicitud = @category`;
  }
  if (filters.date_from && filters.date_to) {
    query += `
      AND CAST(fecha_creacion_solicitud AS DATE) >= CAST(@date_from AS DATE)
      AND CAST(fecha_creacion_solicitud AS DATE) <= CAST(@date_to AS DATE)`;
  }
  if (filters.task_date_from && filters.task_date_to) {
    query += `
      AND CAST(fecha_fin_tarea AS DATE) >= CAST(@task_date_from AS DATE)
      AND CAST(fecha_fin_tarea AS DATE) <= CAST(@task_date_to AS DATE)`;
  }
  if (filters.active) {
    query += ` AND activo_tarea = @active`;
  }

  query += ` ORDER BY id_tarea DESC`;
  return query;
}

/** vw_tareas_solicitudes expone ID_Solicitud (y a veces id), no id_solicitud en minúsculas. */
export function resolveSolicitudId(row: DashboardTask | Record<string, unknown>): number | null {
  const rec = row as Record<string, unknown>;
  const raw = rec.id_solicitud ?? rec.ID_Solicitud ?? rec.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeVwTareasRow(row: Record<string, unknown>): DashboardTaskRow {
  const idSolicitud = resolveSolicitudId(row);
  const base = row as DashboardTaskRow;
  return {
    ...base,
    id_solicitud: idSolicitud ?? base.id_solicitud,
    estado_tarea: normalizeActivityStatus(base.estado_tarea),
    asignado_tarea: normalizeAssigneeName(base.asignado_tarea),
  };
}

export function normalizeVwTareasRows(rows: Record<string, unknown>[]): DashboardTaskRow[] {
  return rows.map(normalizeVwTareasRow);
}

export function applyViewTasksInputs(request: Request, filters: ViewTasksFilters): void {
  if (filters.task_status) {
    request.input('task_status', filters.task_status);
  }
  if (filters.request_status) {
    request.input('request_status', filters.request_status);
  }
  if (filters.assigned_user) {
    request.input('assigned_user', filters.assigned_user);
  }
  if (filters.creator) {
    request.input('creator', filters.creator);
  }
  if (filters.executor) {
    request.input('executor', filters.executor);
  }
  if (filters.company) {
    request.input('company', filters.company);
  }
  if (filters.process) {
    request.input('process', filters.process);
  }
  if (filters.category) {
    request.input('category', filters.category);
  }
  if (filters.date_from && filters.date_to) {
    request.input('date_from', filters.date_from);
    request.input('date_to', filters.date_to);
  }
  if (filters.task_date_from && filters.task_date_to) {
    request.input('task_date_from', filters.task_date_from);
    request.input('task_date_to', filters.task_date_to);
  }
  if (filters.active) {
    const isActive = filters.active === 'true' || filters.active === '1';
    request.input('active', isActive);
  }
}

export async function queryDashboardTasks(
  pool: ConnectionPool,
  filters: ViewTasksFilters
): Promise<DashboardTaskRow[]> {
  const query = buildVwTareasQuery(filters);
  const request = pool.request();
  applyViewTasksInputs(request, filters);
  const result = await request.query(query);
  return normalizeVwTareasRows(result.recordset as Record<string, unknown>[]);
}

/** Todas las tareas de las solicitudes indicadas (sin filtro de fecha). */
export async function queryTasksBySolicitudIds(
  pool: ConnectionPool,
  solicitudIds: number[]
): Promise<DashboardTaskRow[]> {
  const uniqueIds = [...new Set(solicitudIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueIds.length === 0) return [];

  const request = pool.request();
  uniqueIds.forEach((id, index) => {
    request.input(`sid${index}`, id);
  });

  const inClause = uniqueIds.map((_, index) => `@sid${index}`).join(', ');
  const query = `
    SELECT *
    FROM [vw_tareas_solicitudes]
    WHERE ID_Solicitud IN (${inClause})
    ORDER BY ID_Solicitud, id_tarea
  `;

  const result = await request.query(query);
  return normalizeVwTareasRows(result.recordset as Record<string, unknown>[]);
}

/** Miembros del equipo por categoría (user_category_request_general). */
export async function queryCategoryMembersByNames(
  pool: ConnectionPool,
  categoryNames: string[]
): Promise<Record<string, string[]>> {
  const normalizedNames = [
    ...new Set(
      categoryNames
        .map((name) => name.replace(/\r?\n/g, ' ').trim())
        .filter(Boolean)
    ),
  ];

  if (normalizedNames.length === 0) return {};

  const request = pool.request();
  normalizedNames.forEach((name, index) => {
    request.input(`cat${index}`, name);
  });

  const inClause = normalizedNames.map((_, index) => `@cat${index}`).join(', ');
  const query = `
    SELECT
      LTRIM(RTRIM(REPLACE(cr.category, CHAR(13) + CHAR(10), ' '))) AS category,
      LTRIM(RTRIM(u.name)) AS member
    FROM user_category_request_general ucrg
    INNER JOIN category_request cr ON cr.id = ucrg.id_category
    INNER JOIN [user] u ON u.id = ucrg.id_user
    WHERE LTRIM(RTRIM(REPLACE(cr.category, CHAR(13) + CHAR(10), ' '))) IN (${inClause})
    ORDER BY category, member
  `;

  const result = await request.query(query);
  const roster: Record<string, string[]> = {};

  for (const row of result.recordset as { category: string; member: string }[]) {
    const category = row.category?.trim();
    const member = row.member?.trim();
    if (!category || !member) continue;
    if (!roster[category]) roster[category] = [];
    if (!roster[category].includes(member)) roster[category].push(member);
  }

  return roster;
}

/** Resumen simple compatible con la respuesta del dashboard. */
export function buildSummary(data: DashboardTaskRow[]) {
  const completada = data.filter((t) => t.estado_tarea === 'Completada').length;
  const pendiente = data.filter((t) => t.estado_tarea === 'Pendiente').length;
  const enProceso = data.filter((t) => t.estado_tarea === 'En Proceso').length;
  const otros = data.length - completada - pendiente - enProceso;

  return {
    total: data.length,
    completada,
    pendiente,
    en_proceso: enProceso,
    otros,
  };
}

/** Export solicitudes — misma vista que main. */
export async function queryVwRequestsGeneral(
  pool: ConnectionPool
): Promise<DashboardRequest[]> {
  const result = await pool.request().query('SELECT * FROM vw_requests_general');
  return normalizeVwRequestsGeneralRows(result.recordset as Record<string, unknown>[]);
}

/** Export actividades sin filtro — misma vista que main. */
export async function queryVwTareasSolicitudesAll(
  pool: ConnectionPool
): Promise<DashboardTaskRow[]> {
  const result = await pool.request().query('SELECT * FROM vw_tareas_solicitudes');
  return normalizeVwTareasRows(result.recordset as Record<string, unknown>[]);
}

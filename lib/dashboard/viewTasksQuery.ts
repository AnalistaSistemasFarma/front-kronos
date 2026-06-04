import sql from 'mssql';

/** Estados normalizados para tareas (coinciden con status_case real) */
export const ESTADO_TAREA_SQL = `
  CASE
    WHEN LOWER(LTRIM(ISNULL(sc.status, ''))) IN (
      N'resuelto', N'completada', N'completado', N'cerrado', N'closed', N'finalizado'
    ) THEN N'Completada'
    WHEN LOWER(LTRIM(ISNULL(sc.status, ''))) IN (
      N'abierto', N'abierta', N'en proceso', N'en progreso', N'asignado', N'open', N'en curso'
    ) THEN N'En Proceso'
    WHEN LOWER(LTRIM(ISNULL(sc.status, ''))) IN (
      N'sin empezar', N'pendiente', N'nuevo', N'not started', N'por hacer'
    ) THEN N'Pendiente'
    ELSE COALESCE(NULLIF(LTRIM(sc.status), ''), N'Sin estado')
  END
`;

/** Estados de solicitud para el dashboard (Abierto ≠ En proceso) */
export const ESTADO_SOLICITUD_SQL = `
  CASE
    WHEN LOWER(LTRIM(ISNULL(scrg.status, ''))) IN (
      N'resuelto', N'resuelta', N'completada', N'completado', N'cerrado', N'cerrada',
      N'closed', N'finalizado', N'finalizada', N'cancelado', N'cancelada'
    ) THEN N'Cerrada'
    WHEN LOWER(LTRIM(ISNULL(scrg.status, ''))) IN (N'abierto', N'abierta')
      OR LOWER(LTRIM(ISNULL(scrg.status, ''))) LIKE N'%abiert%'
    THEN N'Abierto'
    WHEN LOWER(LTRIM(ISNULL(scrg.status, ''))) IN (
      N'en proceso', N'en progreso', N'asignado', N'asignada', N'open', N'en curso'
    ) THEN N'En proceso'
    WHEN LOWER(LTRIM(ISNULL(scrg.status, ''))) IN (
      N'sin empezar', N'pendiente', N'nuevo', N'not started', N'por hacer'
    ) THEN N'Pendiente'
    ELSE N'Sin estado'
  END
`;

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

export interface DashboardTaskRow {
  id_tarea: number;
  tarea: string;
  estado_tarea: string;
  estado_tarea_original: string;
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
  encargado_proceso: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  return formatDateLocal(parsed) === value;
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

export function buildViewTasksQuery(filters: ViewTasksFilters): string {
  let innerWhere = 'WHERE 1=1';

  if (filters.request_status) {
    innerWhere += ` AND scrg.status = @request_status`;
  }
  if (filters.assigned_user) {
    innerWhere += ` AND u.name LIKE '%' + @assigned_user + '%'`;
  }
  if (filters.creator) {
    innerWhere += ` AND urq.name LIKE '%' + @creator + '%'`;
  }
  if (filters.executor) {
    innerWhere += ` AND (uex_t.name LIKE '%' + @executor + '%' OR uex_rg.name LIKE '%' + @executor + '%')`;
  }
  if (filters.company) {
    innerWhere += ` AND c.company = @company`;
  }
  if (filters.process) {
    innerWhere += ` AND pc.process = @process`;
  }
  if (filters.category) {
    innerWhere += ` AND cr.category = @category`;
  }
  if (filters.date_from && filters.date_to) {
    innerWhere += `
      AND rg.created_at >= CAST(@date_from AS DATE)
      AND rg.created_at < DATEADD(day, 1, CAST(@date_to AS DATE))`;
  }
  if (filters.task_date_from && filters.task_date_to) {
    innerWhere += `
      AND trg.end_date >= CAST(@task_date_from AS DATE)
      AND trg.end_date < DATEADD(day, 1, CAST(@task_date_to AS DATE))`;
  }
  if (filters.active) {
    innerWhere += ` AND tpc.active = @active`;
  }

  let outerWhere = '';
  if (filters.task_status) {
    outerWhere += ` AND estado_tarea = @task_status`;
  }

  return `
      WITH base AS (
        SELECT
          trg.id AS id_tarea,
          tpc.task AS tarea,
          ${ESTADO_TAREA_SQL} AS estado_tarea,
          sc.status AS estado_tarea_original,
          u.name AS asignado_tarea,
          trg.start_date AS hora_inicio_tarea,
          trg.end_date AS fecha_fin_tarea,
          trg.resolution AS resolucion_tarea,
          trg.date_resolution AS fecha_resolucion_tarea,
          tpc.cost AS costo_tarea,
          tpc.cost_center AS centro_costo_tarea,
          CAST(ISNULL(tpc.active, 1) AS BIT) AS activo_tarea,
          uex_t.name AS ejecutor_final_tarea,
          rg.id AS id_solicitud,
          rg.subject_request AS asunto_solicitud,
          rg.description AS descripcion_solicitud,
          rg.created_at AS fecha_creacion_solicitud,
          c.company AS empresa_solicitud,
          urq.name AS creador_solicitud,
          ${ESTADO_SOLICITUD_SQL} AS estado_solicitud,
          rg.resolution AS resolucion_solicitud,
          rg.date_resolution AS fecha_resolucion_solicitud,
          uex_rg.name AS ejecutor_final_solicitud,
          ISNULL(pc.process, N'Sin Proceso') AS proceso_solicitud,
          ISNULL(cr.category, N'Sin Categoría') AS categoria_solicitud,
          enc.encargado_proceso
        FROM task_request_general trg
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
        INNER JOIN [user] u ON u.id = trg.id_assigned
        INNER JOIN requests_general rg ON rg.id = trg.id_request_general
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] urq ON urq.id = rg.id_requester
        LEFT JOIN status_case scrg ON scrg.id_status_case = rg.status_req
        LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
        LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
        LEFT JOIN category_request cr ON cr.id = pc.id_category_request
        LEFT JOIN [user] uex_t ON uex_t.id = trg.id_executor_final
        LEFT JOIN [user] uex_rg ON uex_rg.id = rg.id_executor_final
        OUTER APPLY (
          SELECT TOP 1 u_enc.name AS encargado_proceso
          FROM user_process_category_request_general upcrg
          INNER JOIN [user] u_enc ON u_enc.id = upcrg.id_user
          WHERE upcrg.id_process_category = pc.id
        ) enc
        ${innerWhere}
      )
      SELECT *
      FROM base
      WHERE 1=1${outerWhere}
      ORDER BY id_tarea DESC
    `;
}

export function applyViewTasksInputs(
  request: sql.Request,
  filters: ViewTasksFilters
): void {
  if (filters.task_status) {
    request.input('task_status', sql.NVarChar, filters.task_status);
  }
  if (filters.request_status) {
    request.input('request_status', sql.NVarChar, filters.request_status);
  }
  if (filters.assigned_user) {
    request.input('assigned_user', sql.NVarChar, filters.assigned_user);
  }
  if (filters.creator) {
    request.input('creator', sql.NVarChar, filters.creator);
  }
  if (filters.executor) {
    request.input('executor', sql.NVarChar, filters.executor);
  }
  if (filters.company) {
    request.input('company', sql.NVarChar, filters.company);
  }
  if (filters.process) {
    request.input('process', sql.NVarChar, filters.process);
  }
  if (filters.category) {
    request.input('category', sql.NVarChar, filters.category);
  }
  if (filters.date_from && filters.date_to) {
    // YYYY-MM-DD como string; el SQL hace CAST(... AS DATE). Evita sql.Date en mssql v12.
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
  pool: sql.ConnectionPool,
  filters: ViewTasksFilters
): Promise<DashboardTaskRow[]> {
  const query = buildViewTasksQuery(filters);
  const request = pool.request();
  applyViewTasksInputs(request, filters);
  const result = await request.query(query);
  return result.recordset as DashboardTaskRow[];
}

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

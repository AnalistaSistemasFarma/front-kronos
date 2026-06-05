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

const ESTADO_TAREA_SQL_TASK = ESTADO_TAREA_SQL.replace(/sc\.status/g, 'sc_task.status');

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

/** Estado en gráficas de actividades (1 solicitud = 1 actividad; basado en status de la solicitud). */
const ESTADO_ACTIVIDAD_SQL = `
  CASE
    WHEN LOWER(LTRIM(ISNULL(scrg.status, ''))) IN (
      N'resuelto', N'resuelta', N'completada', N'completado', N'cerrado', N'cerrada',
      N'closed', N'finalizado', N'finalizada', N'cancelado', N'cancelada'
    ) THEN N'Completada'
    WHEN LOWER(LTRIM(ISNULL(scrg.status, ''))) IN (
      N'sin empezar', N'pendiente', N'nuevo', N'not started', N'por hacer'
    ) THEN N'Pendiente'
    WHEN LOWER(LTRIM(ISNULL(scrg.status, ''))) IN (N'abierto', N'abierta')
      OR LOWER(LTRIM(ISNULL(scrg.status, ''))) LIKE N'%abiert%'
      OR LOWER(LTRIM(ISNULL(scrg.status, ''))) IN (
        N'en proceso', N'en progreso', N'asignado', N'asignada', N'open', N'en curso'
      )
    THEN N'En Proceso'
    ELSE COALESCE(NULLIF(LTRIM(scrg.status), ''), N'Sin estado')
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
  let where = 'WHERE 1=1';

  if (filters.request_status) {
    where += ` AND scrg.status = @request_status`;
  }
  if (filters.assigned_user) {
    where += ` AND (
      ISNULL(task.asignado_tarea, N'') LIKE '%' + @assigned_user + '%'
      OR ISNULL(enc.encargado_proceso, N'') LIKE '%' + @assigned_user + '%'
    )`;
  }
  if (filters.creator) {
    where += ` AND urq.name LIKE '%' + @creator + '%'`;
  }
  if (filters.executor) {
    where += ` AND (
      ISNULL(task.ejecutor_final_tarea, N'') LIKE '%' + @executor + '%'
      OR uex_rg.name LIKE '%' + @executor + '%'
    )`;
  }
  if (filters.company) {
    where += ` AND c.company = @company`;
  }
  if (filters.process) {
    where += ` AND ISNULL(pcr.proceso_solicitud, N'') = @process`;
  }
  if (filters.category) {
    where += ` AND ISNULL(pcr.categoria_solicitud, N'') = @category`;
  }
  if (filters.date_from && filters.date_to) {
    where += `
      AND CAST(rg.created_at AS DATE) >= CAST(@date_from AS DATE)
      AND CAST(rg.created_at AS DATE) <= CAST(@date_to AS DATE)`;
  }
  if (filters.task_date_from && filters.task_date_to) {
    where += `
      AND EXISTS (
        SELECT 1
        FROM task_request_general trg_f
        WHERE trg_f.id_request_general = rg.id
          AND trg_f.end_date >= CAST(@task_date_from AS DATE)
          AND trg_f.end_date < DATEADD(day, 1, CAST(@task_date_to AS DATE))
      )`;
  }
  if (filters.active) {
    where += ` AND (trg.id IS NULL OR tpc.active = @active)`;
  }
  if (filters.task_status) {
    where += ` AND (
      (trg.id IS NULL AND ${ESTADO_ACTIVIDAD_SQL} = @task_status)
      OR (trg.id IS NOT NULL AND ${ESTADO_TAREA_SQL_TASK} = @task_status)
    )`;
  }

  return `
      SELECT
        COALESCE(trg.id, -rg.id) AS id_tarea,
        COALESCE(NULLIF(LTRIM(tpc.task), N''), rg.subject_request, N'Sin tarea asignada') AS tarea,
        CASE
          WHEN trg.id IS NOT NULL THEN ${ESTADO_TAREA_SQL_TASK}
          ELSE ${ESTADO_ACTIVIDAD_SQL}
        END AS estado_tarea,
        COALESCE(sc_task.status, scrg.status) AS estado_tarea_original,
        COALESCE(NULLIF(LTRIM(u.name), N''), N'Sin asignar') AS asignado_tarea,
        trg.start_date AS hora_inicio_tarea,
        trg.end_date AS fecha_fin_tarea,
        trg.resolution AS resolucion_tarea,
        trg.date_resolution AS fecha_resolucion_tarea,
        CAST(ISNULL(tpc.cost, 0) AS FLOAT) AS costo_tarea,
        tpc.cost_center AS centro_costo_tarea,
        CAST(COALESCE(tpc.active, 1) AS BIT) AS activo_tarea,
        COALESCE(uex_t.name, uex_rg.name) AS ejecutor_final_tarea,
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
      FROM requests_general rg
      INNER JOIN company c ON c.id_company = rg.id_company
      LEFT JOIN [user] urq ON urq.id = rg.id_requester
      LEFT JOIN status_case scrg ON scrg.id_status_case = rg.status_req
      LEFT JOIN [user] uex_rg ON uex_rg.id = rg.id_executor_final
      LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
      LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
      LEFT JOIN category_request cr ON cr.id = pc.id_category_request
      OUTER APPLY (
        SELECT STUFF((
          SELECT DISTINCT ', ' + u_enc.name
          FROM user_process_category_request_general upcrg
          INNER JOIN [user] u_enc ON u_enc.id = upcrg.id_user
          WHERE pc.id IS NOT NULL AND upcrg.id_process_category = pc.id
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS encargado_proceso
      ) enc
      LEFT JOIN task_request_general trg ON trg.id_request_general = rg.id
      LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
      LEFT JOIN status_case sc_task ON sc_task.id_status_case = trg.id_status
      LEFT JOIN [user] u ON u.id = trg.id_assigned
      LEFT JOIN [user] uex_t ON uex_t.id = trg.id_executor_final
      ${where}
      ORDER BY rg.id DESC, trg.id DESC
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

function countUniqueSolicitudes(rows: DashboardTaskRow[]): number {
  return new Set(rows.map((r) => r.id_solicitud)).size;
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
  const taskRows = data.filter((r) => r.id_tarea > 0);
  const completada = taskRows.filter((t) => t.estado_tarea === 'Completada').length;
  const pendiente = taskRows.filter((t) => t.estado_tarea === 'Pendiente').length;
  const enProceso = taskRows.filter((t) => t.estado_tarea === 'En Proceso').length;
  const otros = taskRows.length - completada - pendiente - enProceso;

  return {
    total_solicitudes: countUniqueSolicitudes(data),
    total_tareas: taskRows.length,
    total: taskRows.length,
    completada,
    pendiente,
    en_proceso: enProceso,
    otros,
  };
}

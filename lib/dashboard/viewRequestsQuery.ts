import type { ConnectionPool, Request } from 'mssql';
import type { DashboardRequest } from './types';
import type { ViewTasksFilters } from './viewTasksQuery';
import { validateDateRange } from './viewTasksQuery';

export { validateDateRange, parseViewTasksFilters } from './viewTasksQuery';

function buildVwRequestsQuery(filters: Pick<ViewTasksFilters, 'date_from' | 'date_to' | 'company' | 'process' | 'category'>): string {
  let query = `
    SELECT *
    FROM [vw_requests_general]
    WHERE 1=1
  `;

  if (filters.company) {
    query += ` AND Empresa = @company`;
  }
  if (filters.process) {
    query += ` AND Proceso = @process`;
  }
  if (filters.category) {
    query += ` AND Categoria = @category`;
  }
  if (filters.date_from && filters.date_to) {
    query += `
      AND CAST([FechaCreación] AS DATE) >= CAST(@date_from AS DATE)
      AND CAST([FechaCreación] AS DATE) <= CAST(@date_to AS DATE)`;
  }

  query += ` ORDER BY NumeroSolicitud DESC`;
  return query;
}

export function applyViewRequestsInputs(
  request: Request,
  filters: Pick<ViewTasksFilters, 'date_from' | 'date_to' | 'company' | 'process' | 'category'>
): void {
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
}

/** Mapea vw_requests_general (columnas reales de KRONOSDB) al modelo del dashboard. */
export function normalizeVwRequestsGeneralRow(row: Record<string, unknown>): DashboardRequest {
  const categoria = String(row.Categoria ?? '').replace(/\r?\n/g, ' ').trim();

  return {
    id_solicitud: Number(row.NumeroSolicitud),
    asunto_solicitud: String(row.Asunto ?? ''),
    descripcion_solicitud: String(row.Descripcion ?? ''),
    fecha_creacion_solicitud: String(row['FechaCreación'] ?? ''),
    empresa_solicitud: String(row.Empresa ?? ''),
    creador_solicitud: String(row.CreadorSolicitud ?? ''),
    estado_solicitud: String(row.EstadoSolicitud ?? ''),
    resolucion_solicitud: (row.Resolucion as string | null) ?? null,
    fecha_resolucion_solicitud: row.FechaResolucion
      ? String(row.FechaResolucion)
      : null,
    ejecutor_final_solicitud: null,
    proceso_solicitud: String(row.Proceso ?? ''),
    categoria_solicitud: categoria || 'Sin categoría',
    encargado_proceso: String(row.UsuarioAsignado ?? '').trim() || null,
  };
}

export function normalizeVwRequestsGeneralRows(rows: Record<string, unknown>[]): DashboardRequest[] {
  return rows
    .map(normalizeVwRequestsGeneralRow)
    .filter((r) => Number.isFinite(r.id_solicitud) && r.id_solicitud > 0);
}

export async function queryDashboardRequests(
  pool: ConnectionPool,
  filters: Pick<ViewTasksFilters, 'date_from' | 'date_to' | 'company' | 'process' | 'category'>
): Promise<DashboardRequest[]> {
  const query = buildVwRequestsQuery(filters);
  const request = pool.request();
  applyViewRequestsInputs(request, filters);
  const result = await request.query(query);
  return normalizeVwRequestsGeneralRows(result.recordset as Record<string, unknown>[]);
}

export function listCompaniesFromRequests(requests: DashboardRequest[]): string[] {
  const set = new Set<string>();
  for (const r of requests) {
    const name = r.empresa_solicitud?.trim();
    if (name) set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

import ExcelJS from 'exceljs';
import type { DashboardDateFilter } from '../dateRange';
import { computeActivityStats, uniqueActivityRowsFromTasks } from '../activityMetrics';
import type { DashboardTask } from '../types';
import {
  addDataSheet,
  buildResumenSheet,
  downloadWorkbook,
  stampFilename,
  writeDistributionTable,
  writeIndicatorTable,
  writeRankingTable,
  type ExportMeta,
} from './excelHelpers';

export type ExportActividadesParams = {
  tasks: DashboardTask[];
  dateFilter: DashboardDateFilter;
  selectedMonthDate: Date;
  appliedRange?: string | null;
};

export async function exportActividadesExcel(params: ExportActividadesParams): Promise<void> {
  const { tasks, dateFilter, selectedMonthDate, appliedRange } = params;

  const rows = uniqueActivityRowsFromTasks(tasks);
  const stats = computeActivityStats(rows);

  const totalCost = rows.reduce((sum, t) => sum + (Number(t.costo_tarea) || 0), 0);
  const withCost = rows.filter((t) => t.costo_tarea != null && Number(t.costo_tarea) > 0).length;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kronos Dashboard';
  workbook.created = new Date();

  const meta: ExportMeta = {
    module: 'Actividades',
    dateFilter,
    selectedMonthDate,
    appliedRange,
    extra: [{ label: 'Alcance', value: 'Actividades = solicitudes únicas en el periodo' }],
  };

  const resumen = buildResumenSheet(workbook, meta);
  let row = 8;

  row = writeIndicatorTable(resumen, row, 'Indicadores de actividades', [
    { label: 'Total actividades', value: stats.total },
    { label: 'Completadas', value: stats.completed },
    { label: 'Pendientes', value: stats.pending },
    { label: 'En proceso', value: stats.inProgress },
    {
      label: '% Completadas',
      value: stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : '0%',
    },
  ]);

  row = writeIndicatorTable(resumen, row, 'Resumen económico', [
    { label: 'Costo total registrado', value: totalCost },
    { label: 'Promedio por actividad', value: stats.total > 0 ? totalCost / stats.total : 0 },
    { label: 'Actividades con costo', value: withCost },
  ]);

  row = writeDistributionTable(
    resumen,
    row,
    'Distribución por estado de solicitud',
    [
      { label: 'Completada', count: stats.completed },
      { label: 'Pendiente', count: stats.pending },
      { label: 'En proceso', count: stats.inProgress },
      ...(stats.abierto > 0 ? [{ label: 'Abiertas', count: stats.abierto }] : []),
      ...(stats.other > 0 ? [{ label: 'Otros', count: stats.other }] : []),
    ].filter((i) => i.count > 0),
    stats.total
  );

  const byProcess = rows.reduce(
    (acc, t) => {
      const p = t.proceso_solicitud || 'Sin proceso';
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const topProcess = Object.entries(byProcess)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  row = writeRankingTable(resumen, row, 'Top 10 procesos', topProcess, 'Actividades');

  const byCategory = rows.reduce(
    (acc, t) => {
      const c = t.categoria_solicitud || 'Sin categoría';
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const topCategory = Object.entries(byCategory)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  row = writeRankingTable(resumen, row, 'Top 10 categorías', topCategory, 'Actividades');

  const byAssignee = rows.reduce(
    (acc, t) => {
      const a = t.asignado_tarea?.trim() || 'Sin asignar';
      acc[a] = (acc[a] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const topAssignee = Object.entries(byAssignee)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);
  writeRankingTable(resumen, row, 'Top asignados', topAssignee, 'Actividades');

  const costByProcess = rows.reduce(
    (acc, t) => {
      const p = t.proceso_solicitud || 'Sin proceso';
      acc[p] = (acc[p] || 0) + (Number(t.costo_tarea) || 0);
      return acc;
    },
    {} as Record<string, number>
  );
  const topCostProcess = Object.entries(costByProcess)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  if (topCostProcess.some((i) => i.value > 0)) {
    const costSheet = workbook.addWorksheet('Costos por proceso');
    costSheet.columns = [
      { header: 'Proceso', key: 'name', width: 28 },
      { header: 'Costo total', key: 'value', width: 16 },
    ];
    topCostProcess.forEach((row) => costSheet.addRow(row));
  }

  addDataSheet(
    workbook,
    'Actividades',
    [
      { header: 'ID tarea', key: 'id_tarea', width: 10 },
      { header: 'Tarea', key: 'tarea', width: 30 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Asignado', key: 'asignado', width: 22 },
      { header: 'Encargado área', key: 'encargado', width: 22 },
      { header: 'ID solicitud', key: 'id_solicitud', width: 12 },
      { header: 'Asunto solicitud', key: 'asunto', width: 28 },
      { header: 'Empresa', key: 'empresa', width: 20 },
      { header: 'Proceso', key: 'proceso', width: 20 },
      { header: 'Categoría', key: 'categoria', width: 18 },
      { header: 'Inicio', key: 'inicio', width: 14 },
      { header: 'Fin', key: 'fin', width: 14 },
      { header: 'Costo', key: 'costo', width: 12 },
      { header: 'Centro costo', key: 'centro', width: 16 },
    ],
    rows.map((t) => ({
      id_tarea: t.id_tarea,
      tarea: t.tarea,
      estado: t.estado_tarea,
      asignado: t.asignado_tarea,
      encargado: t.encargado_proceso ?? '',
      id_solicitud: t.id_solicitud,
      asunto: t.asunto_solicitud,
      empresa: t.empresa_solicitud,
      proceso: t.proceso_solicitud,
      categoria: t.categoria_solicitud,
      inicio: t.hora_inicio_tarea ?? '',
      fin: t.fecha_fin_tarea ?? '',
      costo: t.costo_tarea ?? '',
      centro: t.centro_costo_tarea ?? '',
    }))
  );

  await downloadWorkbook(workbook, stampFilename('Kronos-Actividades', dateFilter));
}

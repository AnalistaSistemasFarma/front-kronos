import ExcelJS from 'exceljs';
import {
  buildCompleteRequestTimeSeries,
  buildRequestTimeSeries,
  formatRequestTimeSeriesLabel,
} from '../requestAnalytics';
import {
  computeResolutionSummary,
  enrichRequestsWithResolution,
  formatHoursLabel,
} from '../requestResolution';
import { countRequestsByDashboardStatus, normalizeRequestStatus } from '../requestStatus';
import type { DashboardDateFilter } from '../dateRange';
import {
  addDataSheet,
  buildResumenSheet,
  downloadWorkbook,
  stampFilename,
  styleHeaderRow,
  writeDistributionTable,
  writeIndicatorTable,
  writeRankingTable,
  type ExportMeta,
} from './excelHelpers';
import { fetchTasksAndRequestsForExport } from './fetchExportData';

export type ExportSolicitudesParams = {
  dateFilter: DashboardDateFilter;
  selectedMonthDate: Date;
  appliedRange?: string | null;
};

const GLOBAL_TREND_FILTER: DashboardDateFilter = 'all';

export async function exportSolicitudesExcel(params: ExportSolicitudesParams): Promise<void> {
  const { dateFilter, selectedMonthDate, appliedRange } = params;

  const { tasks, requests } = await fetchTasksAndRequestsForExport();
  const requestList = requests;
  const stats = countRequestsByDashboardStatus(requestList);
  const enriched = enrichRequestsWithResolution(requestList, tasks);
  const resolutionSummary = computeResolutionSummary(enriched);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kronos Dashboard';
  workbook.created = new Date();

  const meta: ExportMeta = {
    module: 'Solicitudes',
    dateFilter,
    selectedMonthDate,
    appliedRange,
    exportScope: 'global',
    recordCount: requestList.length,
    extra: [{ label: 'Empresa', value: 'General (todas las empresas)' }],
  };

  const { sheet: resumen, contentStartRow } = buildResumenSheet(workbook, meta);
  let row = contentStartRow;

  row = writeIndicatorTable(resumen, row, 'Indicadores principales', [
    { label: 'Total solicitudes', value: stats.total },
    { label: 'Abiertas', value: stats.abierto },
    { label: 'En proceso', value: stats.enProceso },
    { label: 'Cerradas', value: stats.cerrada },
    { label: 'Pendientes', value: stats.pendiente },
  ]);

  row = writeIndicatorTable(resumen, row, 'Tiempos de cierre (histórico)', [
    { label: 'Tiempo promedio', value: formatHoursLabel(resolutionSummary.avgHours) },
    { label: 'Mediana', value: formatHoursLabel(resolutionSummary.medianHours) },
    { label: 'Más rápida', value: formatHoursLabel(resolutionSummary.minHours) },
    { label: 'Más lenta', value: formatHoursLabel(resolutionSummary.maxHours) },
    { label: 'Con fecha de cierre', value: resolutionSummary.closedWithTime },
    { label: 'Sin cierre registrado', value: resolutionSummary.openCount },
  ]);

  row = writeDistributionTable(
    resumen,
    row,
    'Distribución por estado',
    [
      { label: 'Abiertas', count: stats.abierto },
      { label: 'En proceso', count: stats.enProceso },
      { label: 'Cerradas', count: stats.cerrada },
      { label: 'Pendientes', count: stats.pendiente },
    ].filter((i) => i.count > 0),
    stats.total
  );

  const processCounts = requestList.reduce(
    (acc, r) => {
      const p = r.proceso_solicitud || 'Sin proceso';
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const topProcess = Object.entries(processCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  row = writeRankingTable(resumen, row, 'Top 10 procesos', topProcess, 'Solicitudes');

  const companyCounts = requestList.reduce(
    (acc, r) => {
      const c = r.empresa_solicitud || 'Sin empresa';
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const topCompanies = Object.entries(companyCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  writeRankingTable(resumen, row, 'Solicitudes por empresa (Top 8)', topCompanies, 'Solicitudes');

  const rawSeries = buildRequestTimeSeries(requestList, GLOBAL_TREND_FILTER, selectedMonthDate);
  const trend = buildCompleteRequestTimeSeries(
    requestList,
    rawSeries,
    GLOBAL_TREND_FILTER,
    selectedMonthDate
  ).map(([key, count]) => ({
    label: formatRequestTimeSeriesLabel(key, GLOBAL_TREND_FILTER),
    value: count,
  }));

  if (trend.length > 0) {
    const trendSheet = workbook.addWorksheet('Tendencia');
    trendSheet.columns = [
      { header: 'Periodo', key: 'label', width: 22 },
      { header: 'Solicitudes creadas', key: 'value', width: 18 },
    ];
    styleHeaderRow(trendSheet.getRow(1));
    trend.forEach((t) => trendSheet.addRow(t));
  }

  addDataSheet(
    workbook,
    'Solicitudes',
    [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Asunto', key: 'asunto', width: 36 },
      { header: 'Empresa', key: 'empresa', width: 22 },
      { header: 'Proceso', key: 'proceso', width: 22 },
      { header: 'Categoría', key: 'categoria', width: 20 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Creador', key: 'creador', width: 22 },
      { header: 'Fecha creación', key: 'fecha_creacion', width: 14 },
      { header: 'Fecha resolución', key: 'fecha_resolucion', width: 14 },
    ],
    requestList.map((r) => ({
      id: r.id_solicitud,
      asunto: r.asunto_solicitud,
      empresa: r.empresa_solicitud,
      proceso: r.proceso_solicitud,
      categoria: r.categoria_solicitud,
      estado: normalizeRequestStatus(r.estado_solicitud),
      creador: r.creador_solicitud,
      fecha_creacion: r.fecha_creacion_solicitud,
      fecha_resolucion: r.fecha_resolucion_solicitud ?? '',
    }))
  );

  addDataSheet(
    workbook,
    'Tiempos por solicitud',
    [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Asunto', key: 'asunto', width: 32 },
      { header: 'Empresa', key: 'empresa', width: 22 },
      { header: 'Proceso', key: 'proceso', width: 22 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Creación', key: 'creacion', width: 14 },
      { header: 'Cierre', key: 'cierre', width: 14 },
      { header: 'Tiempo total', key: 'tiempo', width: 16 },
      { header: 'Origen cierre', key: 'origen', width: 14 },
    ],
    enriched.map((r) => ({
      id: r.id_solicitud,
      asunto: r.asunto_solicitud,
      empresa: r.empresa_solicitud,
      proceso: r.proceso_solicitud,
      estado: normalizeRequestStatus(r.estado_solicitud),
      creacion: r.fecha_creacion_solicitud,
      cierre: r.resolutionEndDate ?? r.fecha_resolucion_solicitud ?? '',
      tiempo: r.resolutionHours != null ? formatHoursLabel(r.resolutionHours) : 'En curso',
      origen: r.resolutionSource ?? '',
    }))
  );

  await downloadWorkbook(workbook, stampFilename('Kronos-Solicitudes-general', 'global'));
}

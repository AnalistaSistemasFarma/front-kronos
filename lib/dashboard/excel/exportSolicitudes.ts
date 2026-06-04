import ExcelJS from 'exceljs';
import {
  buildCompleteRequestTimeSeries,
  buildRequestTimeSeries,
  formatRequestTimeSeriesLabel,
  uniqueRequestsFromTasks,
} from '../requestAnalytics';
import {
  ALL_COMPANIES_VALUE,
  computeResolutionSummary,
  enrichRequestsWithResolution,
  formatHoursLabel,
} from '../requestResolution';
import { countRequestsByDashboardStatus, normalizeRequestStatus } from '../requestStatus';
import type { DashboardTask } from '../types';
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

export type ExportSolicitudesParams = {
  tasks: DashboardTask[];
  dateFilter: DashboardDateFilter;
  selectedMonthDate: Date;
  appliedRange?: string | null;
  companyFilter: string;
};

export async function exportSolicitudesExcel(params: ExportSolicitudesParams): Promise<void> {
  const { tasks, dateFilter, selectedMonthDate, appliedRange, companyFilter } = params;
  const isCompanyView = companyFilter !== ALL_COMPANIES_VALUE;

  const filteredTasks =
    isCompanyView ? tasks.filter((t) => t.empresa_solicitud === companyFilter) : tasks;

  const requests = uniqueRequestsFromTasks(filteredTasks);
  const allRequests = uniqueRequestsFromTasks(tasks);
  const stats = countRequestsByDashboardStatus(requests);
  const enriched = enrichRequestsWithResolution(requests, filteredTasks);
  const resolutionSummary = computeResolutionSummary(enriched);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kronos Dashboard';
  workbook.created = new Date();

  const meta: ExportMeta = {
    module: 'Solicitudes',
    dateFilter,
    selectedMonthDate,
    appliedRange,
    extra: [
      {
        label: 'Empresa',
        value: isCompanyView ? companyFilter : 'General (todas las empresas)',
      },
    ],
  };

  const resumen = buildResumenSheet(workbook, meta);
  let row = 8;

  row = writeIndicatorTable(resumen, row, 'Indicadores principales', [
    { label: 'Total solicitudes', value: stats.total },
    { label: 'Abiertas', value: stats.abierto },
    { label: 'En proceso', value: stats.enProceso },
    { label: 'Cerradas', value: stats.cerrada },
    { label: 'Pendientes', value: stats.pendiente },
  ]);

  if (isCompanyView) {
    row = writeIndicatorTable(resumen, row, 'Tiempos de cierre (empresa)', [
      { label: 'Tiempo promedio', value: formatHoursLabel(resolutionSummary.avgHours) },
      { label: 'Mediana', value: formatHoursLabel(resolutionSummary.medianHours) },
      { label: 'Más rápida', value: formatHoursLabel(resolutionSummary.minHours) },
      { label: 'Más lenta', value: formatHoursLabel(resolutionSummary.maxHours) },
      { label: 'Con fecha de cierre', value: resolutionSummary.closedWithTime },
      { label: 'Sin cierre registrado', value: resolutionSummary.openCount },
    ]);
  }

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

  const processCounts = requests.reduce(
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

  if (!isCompanyView) {
    const companyCounts = allRequests.reduce(
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
  }

  const rawSeries = buildRequestTimeSeries(requests, dateFilter, selectedMonthDate);
  const trend = buildCompleteRequestTimeSeries(requests, rawSeries, dateFilter, selectedMonthDate).map(
    ([key, count]) => ({
      label: formatRequestTimeSeriesLabel(key, dateFilter),
      value: count,
    })
  );

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
    requests.map((r) => ({
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

  if (isCompanyView) {
    addDataSheet(
      workbook,
      'Tiempos por solicitud',
      [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Asunto', key: 'asunto', width: 32 },
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
        proceso: r.proceso_solicitud,
        estado: normalizeRequestStatus(r.estado_solicitud),
        creacion: r.fecha_creacion_solicitud,
        cierre: r.resolutionEndDate ?? r.fecha_resolucion_solicitud ?? '',
        tiempo:
          r.resolutionHours != null ? formatHoursLabel(r.resolutionHours) : 'En curso',
        origen: r.resolutionSource ?? '',
      }))
    );
  }

  const suffix = isCompanyView
    ? companyFilter.replace(/[^\w\-]+/g, '_').slice(0, 24)
    : 'general';
  await downloadWorkbook(workbook, stampFilename(`Kronos-Solicitudes-${suffix}`, dateFilter));
}

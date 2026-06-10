import ExcelJS from 'exceljs';
import type { DashboardDateFilter } from '../dateRange';
import {
  buildDistinctProcessActivityTimeSeries,
  buildProcessStatsFromTasks,
  computeProcessCoverageMetrics,
  computeProcessSummary,
  formatProcessTimeSeriesLabel,
} from '../processAnalytics';
import { formatHoursLabel } from '../requestResolution';
import { normalizeRequestStatus } from '../requestStatus';
import type { DashboardRequest } from '../types';
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

export type ExportProcesosParams = {
  dateFilter: DashboardDateFilter;
  selectedMonthDate: Date;
  appliedRange?: string | null;
};

const GLOBAL_TREND_FILTER: DashboardDateFilter = 'all';

function normalizeProceso(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed || 'Sin proceso';
}

function buildCategoryRowsByProcess(requests: DashboardRequest[]) {
  const counts = new Map<string, number>();
  for (const req of requests) {
    const key = `${normalizeProceso(req.proceso_solicitud)}|||${req.categoria_solicitud?.trim() || 'Sin categoría'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, cantidad]) => {
      const [proceso, categoria] = key.split('|||');
      return { proceso, categoria, cantidad };
    })
    .sort((a, b) => b.cantidad - a.cantidad || a.proceso.localeCompare(b.proceso, 'es'));
}

function buildCompanyRowsByProcess(requests: DashboardRequest[]) {
  const counts = new Map<string, number>();
  for (const req of requests) {
    const key = `${normalizeProceso(req.proceso_solicitud)}|||${req.empresa_solicitud?.trim() || 'Sin empresa'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, cantidad]) => {
      const [proceso, empresa] = key.split('|||');
      return { proceso, empresa, cantidad };
    })
    .sort((a, b) => b.cantidad - a.cantidad || a.proceso.localeCompare(b.proceso, 'es'));
}

function buildTopCategories(requests: DashboardRequest[], limit = 10) {
  const totals: Record<string, number> = {};
  for (const req of requests) {
    const cat = req.categoria_solicitud?.trim() || 'Sin categoría';
    totals[cat] = (totals[cat] ?? 0) + 1;
  }
  return Object.entries(totals)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function exportProcesosExcel(params: ExportProcesosParams): Promise<void> {
  const { dateFilter, selectedMonthDate, appliedRange } = params;

  const { tasks, requests } = await fetchTasksAndRequestsForExport();
  const processStats = buildProcessStatsFromTasks(tasks, requests);
  const coverage = computeProcessCoverageMetrics(processStats, requests);
  const summary = computeProcessSummary(processStats, requests);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kronos Dashboard';
  workbook.created = new Date();

  const meta: ExportMeta = {
    module: 'Procesos',
    dateFilter,
    selectedMonthDate,
    appliedRange,
    exportScope: 'global',
    recordCount: requests.length,
    extra: [{ label: 'Alcance', value: 'Todos los procesos (histórico completo)' }],
  };

  const { sheet: resumen, contentStartRow } = buildResumenSheet(workbook, meta);
  let row = contentStartRow;

  row = writeIndicatorTable(resumen, row, 'Indicadores de cobertura', [
    { label: 'Total procesos', value: coverage.totalProcesos },
    { label: 'Total solicitudes', value: summary.totalSolicitudes },
    { label: 'Promedio de carga', value: coverage.avgVolumenPorProceso.toFixed(1) },
    { label: 'Categorías distintas', value: coverage.categoriasDistintas },
    { label: 'Empresas distintas', value: coverage.empresasDistintas },
    { label: 'Encargados distintos', value: coverage.encargadosDistintos },
    {
      label: 'Mayor demanda',
      value: coverage.topProceso
        ? `${coverage.topProceso.proceso} (${coverage.topProceso.solicitudes})`
        : '—',
    },
  ]);

  row = writeDistributionTable(
    resumen,
    row,
    'Distribución global por estado',
    [
      { label: 'Abiertas', count: summary.globalStatus.abierto },
      { label: 'En proceso', count: summary.globalStatus.enProceso },
      { label: 'Cerradas', count: summary.globalStatus.cerrada },
      { label: 'Pendientes', count: summary.globalStatus.pendiente },
    ].filter((i) => i.count > 0),
    summary.globalStatus.total
  );

  row = writeRankingTable(
    resumen,
    row,
    'Top 10 procesos por volumen',
    processStats.slice(0, 10).map((p) => ({ name: p.proceso, value: p.solicitudes })),
    'Solicitudes'
  );

  writeRankingTable(resumen, row, 'Top 10 categorías', buildTopCategories(requests), 'Solicitudes');

  addDataSheet(
    workbook,
    'Procesos',
    [
      { header: 'Proceso', key: 'proceso', width: 28 },
      { header: 'Volumen', key: 'volumen', width: 12 },
      { header: 'Categorías', key: 'categorias', width: 12 },
      { header: 'Empresas', key: 'empresas', width: 12 },
      { header: 'Encargados', key: 'encargados', width: 32 },
      { header: 'Abiertas', key: 'abiertas', width: 10 },
      { header: 'En proceso', key: 'en_proceso', width: 12 },
      { header: 'Cerradas', key: 'cerradas', width: 10 },
      { header: 'Pendientes', key: 'pendientes', width: 12 },
      { header: 'Tiempo prom.', key: 'tiempo_prom', width: 14 },
      { header: 'Cierres medidos', key: 'cierres', width: 14 },
    ],
    processStats.map((p) => ({
      proceso: p.proceso,
      volumen: p.solicitudes,
      categorias: p.categorias,
      empresas: p.empresas,
      encargados: p.encargados.join(', '),
      abiertas: p.status.abierto,
      en_proceso: p.status.enProceso,
      cerradas: p.status.cerrada,
      pendientes: p.status.pendiente,
      tiempo_prom:
        p.avgResolutionHours != null ? formatHoursLabel(p.avgResolutionHours) : '—',
      cierres: p.closedWithTime,
    }))
  );

  addDataSheet(
    workbook,
    'Estado por proceso',
    [
      { header: 'Proceso', key: 'proceso', width: 28 },
      { header: 'Abierto', key: 'abierto', width: 10 },
      { header: 'En proceso', key: 'en_proceso', width: 12 },
      { header: 'Cerrada', key: 'cerrada', width: 10 },
      { header: 'Pendiente', key: 'pendiente', width: 12 },
      { header: 'Total', key: 'total', width: 10 },
    ],
    processStats.map((p) => ({
      proceso: p.proceso,
      abierto: p.status.abierto,
      en_proceso: p.status.enProceso,
      cerrada: p.status.cerrada,
      pendiente: p.status.pendiente,
      total: p.solicitudes,
    }))
  );

  addDataSheet(
    workbook,
    'Categorías por proceso',
    [
      { header: 'Proceso', key: 'proceso', width: 28 },
      { header: 'Categoría', key: 'categoria', width: 24 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
    ],
    buildCategoryRowsByProcess(requests)
  );

  addDataSheet(
    workbook,
    'Empresas por proceso',
    [
      { header: 'Proceso', key: 'proceso', width: 28 },
      { header: 'Empresa', key: 'empresa', width: 24 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
    ],
    buildCompanyRowsByProcess(requests)
  );

  const activityTrend = buildDistinctProcessActivityTimeSeries(
    requests,
    GLOBAL_TREND_FILTER,
    selectedMonthDate
  ).map(([key, count]) => ({
    periodo: formatProcessTimeSeriesLabel(key, GLOBAL_TREND_FILTER),
    procesos_activos: count,
  }));

  if (activityTrend.length > 0) {
    const trendSheet = workbook.addWorksheet('Tendencia actividad');
    trendSheet.columns = [
      { header: 'Periodo', key: 'periodo', width: 22 },
      { header: 'Procesos con actividad', key: 'procesos_activos', width: 22 },
    ];
    styleHeaderRow(trendSheet.getRow(1));
    activityTrend.forEach((t) => trendSheet.addRow(t));
  }

  addDataSheet(
    workbook,
    'Solicitudes',
    [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Proceso', key: 'proceso', width: 24 },
      { header: 'Asunto', key: 'asunto', width: 36 },
      { header: 'Empresa', key: 'empresa', width: 22 },
      { header: 'Categoría', key: 'categoria', width: 20 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Encargado', key: 'encargado', width: 22 },
      { header: 'Creador', key: 'creador', width: 22 },
      { header: 'Fecha creación', key: 'fecha_creacion', width: 14 },
      { header: 'Fecha resolución', key: 'fecha_resolucion', width: 14 },
    ],
    requests.map((r) => ({
      id: r.id_solicitud,
      proceso: normalizeProceso(r.proceso_solicitud),
      asunto: r.asunto_solicitud,
      empresa: r.empresa_solicitud,
      categoria: r.categoria_solicitud,
      estado: normalizeRequestStatus(r.estado_solicitud),
      encargado: r.encargado_proceso ?? '',
      creador: r.creador_solicitud,
      fecha_creacion: r.fecha_creacion_solicitud,
      fecha_resolucion: r.fecha_resolucion_solicitud ?? '',
    }))
  );

  await downloadWorkbook(workbook, stampFilename('Kronos-Procesos', 'global'));
}

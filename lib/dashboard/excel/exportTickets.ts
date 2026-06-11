import ExcelJS from 'exceljs';
import {
  aggregateByCompany,
  buildTeamSummary,
  countByStatus,
  formatResolutionDuration,
  getCaseResolutionHours,
  getCompanyLabel,
  getTechnicianLabel,
  normalizeTicketStatus,
} from '../ticketAnalytics';
import type { DashboardDateFilter } from '../dateRange';
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
import { fetchAllTicketsForExport } from './fetchExportData';

export type ExportTicketsParams = {
  dateFilter: DashboardDateFilter;
  selectedMonthDate: Date;
  appliedRange?: string | null;
};

function formatCaseDate(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function exportTicketsExcel(params: ExportTicketsParams): Promise<void> {
  const { dateFilter, selectedMonthDate, appliedRange } = params;

  const cases = await fetchAllTicketsForExport();
  const counts = countByStatus(cases);
  const teamSummary = buildTeamSummary(cases);
  const avgHours = teamSummary.avgResolutionHours;
  const score = teamSummary.teamScore;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kronos Dashboard';
  workbook.created = new Date();

  const meta: ExportMeta = {
    module: 'Tickets (Mesa de ayuda)',
    dateFilter,
    selectedMonthDate,
    appliedRange,
    exportScope: 'global',
    recordCount: cases.length,
    extra: [{ label: 'Vista', value: 'Equipo completo (histórico)' }],
  };

  const { sheet: resumen, contentStartRow } = buildResumenSheet(workbook, meta);
  let row = contentStartRow;

  row = writeIndicatorTable(resumen, row, 'Indicadores de casos', [
    { label: 'Total casos', value: counts.total },
    { label: 'Abiertos', value: counts.abierto },
    { label: 'En progreso', value: counts.enProgreso },
    { label: 'Resueltos', value: counts.resuelto },
    { label: 'Cerrados', value: counts.cerrado },
    {
      label: 'Tiempo prom. resolución',
      value: avgHours != null ? formatResolutionDuration(avgHours) : '—',
    },
    { label: 'Puntaje', value: `${score}/100` },
  ]);

  row = writeDistributionTable(
    resumen,
    row,
    'Distribución por estado',
    [
      { label: 'Abierto', count: counts.abierto },
      { label: 'En progreso', count: counts.enProgreso },
      { label: 'Resuelto', count: counts.resuelto },
      { label: 'Cerrado', count: counts.cerrado },
    ].filter((i) => i.count > 0),
    counts.total
  );

  if (teamSummary.technicians.length > 0) {
    const techRows = teamSummary.technicians
      .slice()
      .sort((a, b) => b.total - a.total)
      .map((t) => ({
        tecnico: t.name,
        casos: t.total,
        abiertos: t.counts.abierto + t.counts.enProgreso,
        resueltos: t.counts.resuelto,
        cerrados: t.counts.cerrado,
        tiempo_prom:
          t.avgResolutionHours != null
            ? formatResolutionDuration(t.avgResolutionHours)
            : '—',
        puntaje: t.score,
      }));

    addDataSheet(
      workbook,
      'Rendimiento técnicos',
      [
        { header: 'Técnico', key: 'tecnico', width: 24 },
        { header: 'Casos', key: 'casos', width: 10 },
        { header: 'Abiertos+progreso', key: 'abiertos', width: 14 },
        { header: 'Resueltos', key: 'resueltos', width: 12 },
        { header: 'Cerrados', key: 'cerrados', width: 12 },
        { header: 'Tiempo prom.', key: 'tiempo_prom', width: 14 },
        { header: 'Puntaje', key: 'puntaje', width: 10 },
      ],
      techRows
    );

    row = writeRankingTable(
      resumen,
      row,
      'Mayor carga de casos',
      teamSummary.technicians
        .slice()
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map((t) => ({ name: t.name, value: t.total })),
      'Casos'
    );
  }

  const byCompany = aggregateByCompany(cases)
    .slice(0, 10)
    .map((c) => ({ name: c.name, value: c.value }));
  writeRankingTable(resumen, row, 'Top empresas', byCompany, 'Casos');

  addDataSheet(
    workbook,
    'Casos',
    [
      { header: 'ID caso', key: 'id', width: 10 },
      { header: 'Asunto', key: 'asunto', width: 32 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Prioridad', key: 'prioridad', width: 12 },
      { header: 'Técnico', key: 'tecnico', width: 22 },
      { header: 'Empresa', key: 'empresa', width: 22 },
      { header: 'Departamento', key: 'departamento', width: 18 },
      { header: 'Tipo', key: 'tipo', width: 16 },
      { header: 'Categoría', key: 'categoria', width: 18 },
      { header: 'Creación', key: 'creacion', width: 14 },
      { header: 'Cierre', key: 'cierre', width: 14 },
      { header: 'Cierre (sistema)', key: 'closed_at', width: 14 },
      { header: 'Horas resolución', key: 'resolution_hours', width: 16 },
      { header: 'Tiempo resolución', key: 'tiempo_resolucion', width: 18 },
      { header: 'Resolución', key: 'resolucion', width: 28 },
    ],
    cases.map((c) => {
      const resolutionHours = getCaseResolutionHours(c);
      return {
        id: c.id_case ?? '',
        asunto: c.subject_case ?? '',
        estado: normalizeTicketStatus(c.status, c.id_status_case),
        prioridad: c.priority ?? '',
        tecnico: getTechnicianLabel(c),
        empresa: getCompanyLabel(c),
        departamento: c.department ?? '',
        tipo: c.case_type ?? '',
        categoria: c.category ?? '',
        creacion: formatCaseDate(c.creation_date),
        cierre: formatCaseDate(c.end_date),
        closed_at: formatCaseDate(c.closed_at),
        resolution_hours: resolutionHours ?? '',
        tiempo_resolucion:
          resolutionHours != null ? formatResolutionDuration(resolutionHours) : '',
        resolucion: c.resolution ?? '',
      };
    })
  );

  await downloadWorkbook(workbook, stampFilename('Kronos-Tickets-equipo', 'global'));
}

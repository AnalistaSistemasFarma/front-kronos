import ExcelJS from 'exceljs';
import {
  ALL_TECHNICIANS_VALUE,
  aggregateByCompany,
  buildTeamSummary,
  countByStatus,
  filterCasesByTechnician,
  formatResolutionDuration,
  getCompanyLabel,
  getTechnicianLabel,
  normalizeTicketStatus,
  type HelpDeskCase,
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

export type ExportTicketsParams = {
  cases: HelpDeskCase[];
  dateFilter: DashboardDateFilter;
  selectedMonthDate: Date;
  appliedRange?: string | null;
  technicianFilter: string;
};

export async function exportTicketsExcel(params: ExportTicketsParams): Promise<void> {
  const { cases, dateFilter, selectedMonthDate, appliedRange, technicianFilter } = params;
  const isIndividual = technicianFilter !== ALL_TECHNICIANS_VALUE;
  const scoped = filterCasesByTechnician(cases, technicianFilter);
  const counts = countByStatus(scoped);
  const teamSummary = buildTeamSummary(cases);
  const selectedTech = isIndividual
    ? teamSummary.technicians.find((t) => t.name === technicianFilter)
    : null;

  const avgHours = isIndividual
    ? selectedTech?.avgResolutionHours ?? null
    : teamSummary.avgResolutionHours;

  const score = isIndividual ? selectedTech?.score ?? 0 : teamSummary.teamScore;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kronos Dashboard';
  workbook.created = new Date();

  const meta: ExportMeta = {
    module: 'Tickets (Mesa de ayuda)',
    dateFilter,
    selectedMonthDate,
    appliedRange,
    extra: [
      {
        label: 'Vista',
        value: isIndividual ? `Analista: ${technicianFilter}` : 'Equipo completo',
      },
    ],
  };

  const resumen = buildResumenSheet(workbook, meta);
  let row = 8;

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

  if (!isIndividual && teamSummary.technicians.length > 0) {
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

  const byCompany = aggregateByCompany(scoped)
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
      { header: 'Resolución', key: 'resolucion', width: 28 },
    ],
    scoped.map((c) => ({
      id: c.id_case ?? '',
      asunto: c.subject_case ?? '',
      estado: normalizeTicketStatus(c.status, c.id_status_case),
      prioridad: c.priority ?? '',
      tecnico: getTechnicianLabel(c),
      empresa: getCompanyLabel(c),
      departamento: c.department ?? '',
      tipo: c.case_type ?? '',
      categoria: c.category ?? '',
      creacion: c.creation_date instanceof Date ? c.creation_date.toISOString() : c.creation_date ?? '',
      cierre: c.end_date instanceof Date ? c.end_date.toISOString() : c.end_date ?? '',
      resolucion: c.resolution ?? '',
    }))
  );

  const suffix = isIndividual
    ? technicianFilter.replace(/[^\w\-]+/g, '_').slice(0, 24)
    : 'equipo';
  await downloadWorkbook(workbook, stampFilename(`Kronos-Tickets-${suffix}`, dateFilter));
}

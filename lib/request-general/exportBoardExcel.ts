import ExcelJS from 'exceljs';
import {
  buildTaskDisplayBadges,
  getSimplifiedTasksProgress,
  type OrionTaskLike,
} from '@/lib/orion/taskProgress';
import { styleHeaderRow, writeDistributionTable, writeIndicatorTable } from '@/lib/dashboard/excel/excelHelpers';

const HEADER_FILL = 'FF113562';

export type BoardTask = OrionTaskLike & {
  status_task?: string | null;
  assigned?: string | null;
};

/** Una solicitud tal como se ve en el listado, con sus tareas para el avance. */
export type BoardRequest = {
  id: number;
  subject: string;
  process?: string | null;
  category?: string | null;
  company?: string | null;
  status?: string | null;
  requester?: string | null;
  assigned?: string | null;
  createdAt?: string | null;
  description?: string | null;
  resolution?: string | null;
  dateResolution?: string | null;
  executor?: string | null;
  tasks?: BoardTask[];
};

/** Tarea asignada a la persona (fila de «Tareas» en Solicitudes y Tareas Asignadas). */
export type BoardAssignedTask = {
  requestId: number;
  taskId: number | string;
  task: string;
  subject?: string | null;
  process?: string | null;
  category?: string | null;
  company?: string | null;
  status?: string | null;
  createdAt?: string | null;
  requester?: string | null;
  assigned?: string | null;
  description?: string | null;
};

export type BoardFilterLine = { label: string; value: string };

/** Misma corrección de zona que el listado (UTC-5 mostrado como hora de Colombia). */
export function formatBoardDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);
  const adjusted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(adjusted);
}

export function boardExportFilename(prefix: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `${prefix}-${stamp}.xlsx`;
}

function statusFill(status: string): string | null {
  const s = status.trim().toLowerCase();
  if (s === 'resuelto' || s === 'completado' || s === 'confirmada') return 'FFDCFCE7';
  if (s === 'abierto') return 'FFFFEDD5';
  if (s === 'sin empezar' || s === 'pendiente') return 'FFF1F5F9';
  if (s === 'cancelado') return 'FFFEE2E2';
  if (s.includes('devuelt')) return 'FFFEF3C7';
  return null;
}

function paintStatus(cell: ExcelJS.Cell, status: string) {
  const fill = statusFill(status);
  cell.alignment = { vertical: 'middle', wrapText: true };
  if (!fill) return;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.font = { bold: true, color: { argb: 'FF1E293B' } };
}

function finishSheet(ws: ExcelJS.Worksheet, columns: number, rows: number) {
  const header = ws.getRow(1);
  styleHeaderRow(header);
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows + 1), column: columns },
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function countBy(values: string[]): { label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const raw of values) {
    const label = raw.trim() || 'Sin dato';
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
}

function progressOf(tasks: BoardTask[] | undefined) {
  const list = tasks ?? [];
  const progress = getSimplifiedTasksProgress(list);
  const badges = buildTaskDisplayBadges(list);
  const pending = badges.filter((b) => !b.done);
  const detail = badges.map((b) => `${b.label} (${b.statusLabel})`).join(' | ');
  const pendingText = pending.map((b) => `${b.label} (${b.statusLabel})`).join(' | ');
  const people = [
    ...new Set(list.map((t) => String(t.assigned || '').trim()).filter(Boolean)),
  ].join(', ');
  return { progress, detail, pendingText, people, pendingCount: pending.length };
}

function addRequestSheet(workbook: ExcelJS.Workbook, requests: BoardRequest[]) {
  const ws = workbook.addWorksheet('Solicitudes');
  const columns: { header: string; key: string; width: number }[] = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Asunto', key: 'subject', width: 36 },
    { header: 'Proceso', key: 'process', width: 24 },
    { header: 'Categoría', key: 'category', width: 22 },
    { header: 'Empresa', key: 'company', width: 24 },
    { header: 'Estado', key: 'status', width: 16 },
    { header: 'Avance %', key: 'percent', width: 12 },
    { header: 'Tareas hechas', key: 'done', width: 14 },
    { header: 'Tareas totales', key: 'total', width: 14 },
    { header: 'Pendientes', key: 'pendingCount', width: 12 },
    { header: 'Qué está pendiente', key: 'pending', width: 42 },
    { header: 'Detalle del proceso', key: 'detail', width: 48 },
    { header: 'Solicitante', key: 'requester', width: 24 },
    { header: 'Encargados', key: 'assigned', width: 28 },
    { header: 'Responsables de tareas', key: 'taskPeople', width: 28 },
    { header: 'Ejecutor final', key: 'executor', width: 22 },
    { header: 'Fecha', key: 'createdAt', width: 28 },
    { header: 'Fecha de resolución', key: 'dateResolution', width: 28 },
    { header: 'Descripción', key: 'description', width: 40 },
    { header: 'Resolución', key: 'resolution', width: 36 },
  ];
  ws.columns = columns;

  requests.forEach((request) => {
    const { progress, detail, pendingText, people, pendingCount } = progressOf(request.tasks);
    const row = ws.addRow({
      id: request.id,
      subject: request.subject || '',
      process: request.process || '',
      category: request.category || '',
      company: request.company || '',
      status: request.status || '',
      percent: progress.percent,
      done: progress.done,
      total: progress.total,
      pendingCount,
      pending: pendingText || (progress.total ? 'Nada pendiente' : ''),
      detail,
      requester: request.requester || '',
      assigned: request.assigned || '',
      taskPeople: people,
      executor: request.executor || '',
      createdAt: formatBoardDate(request.createdAt),
      dateResolution: formatBoardDate(request.dateResolution),
      description: request.description || '',
      resolution: request.resolution || '',
    });
    row.alignment = { vertical: 'top', wrapText: true };
    paintStatus(row.getCell('status'), String(request.status || ''));
    row.getCell('percent').numFmt = '0"%"';
  });

  finishSheet(ws, columns.length, requests.length);
}

function addProcessTasksSheet(workbook: ExcelJS.Workbook, requests: BoardRequest[]) {
  const ws = workbook.addWorksheet('Tareas del proceso');
  const columns: { header: string; key: string; width: number }[] = [
    { header: 'ID solicitud', key: 'requestId', width: 14 },
    { header: 'Asunto', key: 'subject', width: 32 },
    { header: 'Empresa', key: 'company', width: 22 },
    { header: 'Proceso', key: 'process', width: 22 },
    { header: 'Estado solicitud', key: 'requestStatus', width: 16 },
    { header: 'Tarea', key: 'task', width: 32 },
    { header: 'Estado tarea', key: 'status', width: 18 },
    { header: 'Responsable', key: 'assigned', width: 24 },
    { header: 'Solicitante', key: 'requester', width: 24 },
    { header: 'Resolución', key: 'resolution', width: 36 },
  ];
  ws.columns = columns;

  let count = 0;
  for (const request of requests) {
    for (const task of request.tasks ?? []) {
      const status = String(task.status_task || task.status || '').trim();
      const row = ws.addRow({
        requestId: request.id,
        subject: request.subject || '',
        company: request.company || '',
        process: request.process || '',
        requestStatus: request.status || '',
        task: String(task.task || task.name || 'Tarea'),
        status,
        assigned: String(task.assigned || '').trim(),
        requester: request.requester || '',
        resolution: String(task.resolution || '').trim(),
      });
      row.alignment = { vertical: 'top', wrapText: true };
      paintStatus(row.getCell('status'), status);
      paintStatus(row.getCell('requestStatus'), String(request.status || ''));
      count += 1;
    }
  }

  finishSheet(ws, columns.length, count);
}

function addAssignedSheet(workbook: ExcelJS.Workbook, tasks: BoardAssignedTask[]) {
  const ws = workbook.addWorksheet('Tareas asignadas');
  const columns: { header: string; key: string; width: number }[] = [
    { header: 'ID solicitud', key: 'requestId', width: 14 },
    { header: 'ID tarea', key: 'taskId', width: 12 },
    { header: 'Tarea', key: 'task', width: 32 },
    { header: 'Asunto de la solicitud', key: 'subject', width: 32 },
    { header: 'Proceso', key: 'process', width: 22 },
    { header: 'Categoría', key: 'category', width: 20 },
    { header: 'Empresa', key: 'company', width: 22 },
    { header: 'Estado', key: 'status', width: 16 },
    { header: 'Fecha', key: 'createdAt', width: 28 },
    { header: 'Solicitante', key: 'requester', width: 24 },
    { header: 'Asignado', key: 'assigned', width: 24 },
    { header: 'Descripción', key: 'description', width: 40 },
  ];
  ws.columns = columns;

  tasks.forEach((task) => {
    const row = ws.addRow({
      requestId: task.requestId,
      taskId: task.taskId,
      task: task.task || '',
      subject: task.subject || '',
      process: task.process || '',
      category: task.category || '',
      company: task.company || '',
      status: task.status || '',
      createdAt: formatBoardDate(task.createdAt),
      requester: task.requester || '',
      assigned: task.assigned || '',
      description: task.description || '',
    });
    row.alignment = { vertical: 'top', wrapText: true };
    paintStatus(row.getCell('status'), String(task.status || ''));
  });

  finishSheet(ws, columns.length, tasks.length);
}

export async function buildBoardWorkbook(input: {
  module: string;
  filters: BoardFilterLine[];
  requests?: BoardRequest[];
  assignedTasks?: BoardAssignedTask[];
}): Promise<ExcelJS.Workbook> {
  const requests = input.requests ?? [];
  const assignedTasks = input.assignedTasks ?? [];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SynerLink';
  workbook.created = new Date();

  const resumen = workbook.addWorksheet('Resumen');
  resumen.mergeCells('A1:F1');
  const title = resumen.getCell('A1');
  title.value = input.module;
  title.font = { bold: true, size: 16, color: { argb: HEADER_FILL } };
  resumen.getRow(1).height = 28;

  let row = 3;
  const meta = [
    { label: 'Generado', value: new Date().toLocaleString('es-CO') },
    { label: 'Solicitudes', value: String(requests.length) },
    { label: 'Tareas asignadas', value: String(assignedTasks.length) },
    ...input.filters,
  ];
  meta.forEach(({ label, value }) => {
    resumen.getCell(`A${row}`).value = label;
    resumen.getCell(`A${row}`).font = { bold: true };
    resumen.getCell(`B${row}`).value = value || '—';
    resumen.mergeCells(`B${row}:F${row}`);
    row += 1;
  });

  const pendingRequests = requests.filter((request) => {
    const status = String(request.status || '').toLowerCase();
    if (status === 'resuelto' || status === 'cancelado') return false;
    const { pendingCount, progress } = progressOf(request.tasks);
    return pendingCount > 0 || (progress.total === 0 && status !== 'resuelto');
  }).length;

  row = writeIndicatorTable(resumen, row + 1, 'Cómo va el filtro', [
    { label: 'Solicitudes en el archivo', value: requests.length },
    { label: 'Con algo pendiente', value: pendingRequests },
    { label: 'Tareas asignadas en el archivo', value: assignedTasks.length },
    {
      label: 'Tareas del proceso',
      value: requests.reduce((sum, request) => sum + (request.tasks?.length ?? 0), 0),
    },
  ]);

  if (requests.length) {
    row = writeDistributionTable(
      resumen,
      row,
      'Solicitudes por estado',
      countBy(requests.map((r) => String(r.status || ''))),
      requests.length
    );
    row = writeDistributionTable(
      resumen,
      row,
      'Solicitudes por empresa',
      countBy(requests.map((r) => String(r.company || ''))),
      requests.length
    );
    writeDistributionTable(
      resumen,
      row,
      'Solicitudes por proceso',
      countBy(requests.map((r) => String(r.process || ''))),
      requests.length
    );
  }

  resumen.getColumn(1).width = 28;
  resumen.getColumn(2).width = 36;

  if (requests.length) {
    addRequestSheet(workbook, requests);
    addProcessTasksSheet(workbook, requests);
  }
  if (assignedTasks.length) addAssignedSheet(workbook, assignedTasks);

  return workbook;
}

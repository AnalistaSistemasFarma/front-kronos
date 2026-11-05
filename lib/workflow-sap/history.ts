/**
 * Linea de tiempo de una solicitud, PURA: combina los pasos humanos (instancias de
 * task_request_general) con las ejecuciones del historial (workflow_execution_log)
 * y las ordena por hora. Sin servidor, para poder probarla.
 */

export interface HumanTaskRow {
  id: number;
  task: string;
  is_authorization: boolean | number | null;
  id_status: number;
  status_label: string | null;
  assigned_name: string | null;
  executor_name: string | null;
  resolution: string | null;
  start_date: string | Date | null;
  date_resolution: string | Date | null;
}

export interface ExecutionRow {
  id: number;
  step_kind: string;
  step_name: string;
  action_key: string | null;
  trigger_event: string | null;
  triggered_by: string;
  status: string;
  attempt: number;
  sap_entity: string | null;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  request_summary: string | null;
  response_summary: string | null;
  error: string | null;
  started_at: string | Date;
  finished_at: string | Date | null;
}

export interface TimelineEvent {
  at: string;
  kind: 'human' | 'sap' | 'external' | 'system';
  title: string;
  status: 'pending' | 'running' | 'ok' | 'rejected' | 'error' | 'skipped' | 'cancelled';
  detail: string;
  by: string | null;
  durationMs: number | null;
  attempt?: number;
  request?: string | null;
  response?: string | null;
  error?: string | null;
}

const iso = (v: string | Date | null | undefined): string | null =>
  v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString();

/** Estado de una tarea humana segun id_status del workflow (4 pendiente, 2 resuelta/aprobada, 3 rechazada/cancelada). */
function humanStatus(t: HumanTaskRow): TimelineEvent['status'] {
  if (t.id_status === 4) return 'pending';
  if (t.id_status === 2) return 'ok';
  if (t.id_status === 3) return t.is_authorization ? 'rejected' : 'cancelled';
  return 'ok';
}

export function buildTimeline(tasks: HumanTaskRow[], executions: ExecutionRow[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const t of tasks) {
    const status = humanStatus(t);
    const start = iso(t.start_date);
    const end = iso(t.date_resolution);
    const label = t.is_authorization ? 'Autorización' : 'Tarea';
    if (start) {
      events.push({
        at: start,
        kind: 'human',
        title: `${label} · ${t.task}`,
        status: 'pending',
        detail: t.assigned_name ? `Asignada a ${t.assigned_name}` : 'En el pool de autorizadores',
        by: null,
        durationMs: null,
      });
    }
    if (end && status !== 'pending') {
      events.push({
        at: end,
        kind: 'human',
        title: `${label} · ${t.task}`,
        status,
        detail:
          (status === 'ok' ? (t.is_authorization ? 'Aprobada' : 'Resuelta') : status === 'rejected' ? 'Rechazada' : 'Cancelada') +
          (t.resolution ? ` · ${t.resolution}` : ''),
        by: t.executor_name ?? t.assigned_name,
        durationMs: start ? new Date(end).getTime() - new Date(start).getTime() : null,
      });
    }
  }

  for (const e of executions) {
    const start = iso(e.started_at)!;
    const end = iso(e.finished_at);
    const doc = e.sap_doc_num ?? e.sap_doc_entry;
    events.push({
      at: start,
      kind: (['human', 'sap', 'external', 'system'].includes(e.step_kind) ? e.step_kind : 'system') as TimelineEvent['kind'],
      title: e.step_kind === 'sap' ? `SAP · ${e.step_name}` : e.step_name,
      status: e.status === 'started' ? 'running' : (e.status as TimelineEvent['status']),
      detail: [e.sap_entity && doc ? `${e.sap_entity} ${doc}` : null, e.attempt > 1 ? `intento ${e.attempt}` : null]
        .filter(Boolean)
        .join(' · '),
      by: e.triggered_by === 'sync' ? 'Sincronizador' : e.triggered_by === 'retry' ? 'Reintento' : 'Servidor',
      durationMs: end ? new Date(end).getTime() - new Date(start).getTime() : null,
      attempt: e.attempt,
      request: e.request_summary,
      response: e.response_summary,
      error: e.error,
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

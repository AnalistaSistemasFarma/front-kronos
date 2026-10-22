import { describe, expect, it } from 'vitest';
import { buildTimeline, type ExecutionRow, type HumanTaskRow } from './history';

const task = (over: Partial<HumanTaskRow> = {}): HumanTaskRow => ({
  id: 1,
  task: 'Autorización líder de área',
  is_authorization: true,
  id_status: 2,
  status_label: null,
  assigned_name: 'María Pérez',
  executor_name: 'María Pérez',
  resolution: null,
  start_date: '2026-10-22T09:02:13Z',
  date_resolution: '2026-10-22T10:15:40Z',
  ...over,
});

const exec = (over: Partial<ExecutionRow> = {}): ExecutionRow => ({
  id: 10,
  step_kind: 'sap',
  step_name: 'Publicar solicitud en firme',
  action_key: 'purchase.publish_firm',
  trigger_event: 'on_final_approve',
  triggered_by: 'user',
  status: 'ok',
  attempt: 1,
  sap_entity: 'PurchaseRequests',
  sap_doc_entry: 900,
  sap_doc_num: 14270,
  request_summary: null,
  response_summary: 'Creada',
  error: null,
  started_at: '2026-10-22T10:15:42Z',
  finished_at: '2026-10-22T10:15:43.200Z',
  ...over,
});

describe('buildTimeline', () => {
  it('ordena por hora pasos humanos y ejecuciones SAP', () => {
    const t = buildTimeline(
      [task()],
      [exec({ id: 9, step_name: 'Pasar a «Por autorizar»', sap_entity: 'Drafts', sap_doc_num: null, sap_doc_entry: 94811, started_at: '2026-10-22T09:02:11Z', finished_at: '2026-10-22T09:02:12Z' }), exec()]
    );
    expect(t.map((e) => e.title)).toEqual([
      'SAP · Pasar a «Por autorizar»',
      'Autorización · Autorización líder de área',
      'Autorización · Autorización líder de área',
      'SAP · Publicar solicitud en firme',
    ]);
    expect(t[2]).toMatchObject({ status: 'ok', detail: 'Aprobada', by: 'María Pérez' });
    expect(t[3]).toMatchObject({ detail: 'PurchaseRequests 14270', durationMs: 1200 });
  });

  it('marca rechazos con su motivo y deja pendiente lo que no se ha decidido', () => {
    const rejected = buildTimeline([task({ id_status: 3, resolution: 'Falta cotización' })], []);
    expect(rejected[1]).toMatchObject({ status: 'rejected', detail: 'Rechazada · Falta cotización' });
    const pending = buildTimeline([task({ id_status: 4, date_resolution: null })], []);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
  });

  it('muestra errores, reintentos y ejecuciones en curso', () => {
    const t = buildTimeline([], [
      exec({ status: 'error', error: 'Tiempo agotado', finished_at: '2026-10-22T10:15:52Z' }),
      exec({ id: 11, attempt: 2, triggered_by: 'retry', started_at: '2026-10-22T10:16:12Z', finished_at: null, status: 'started' }),
    ]);
    expect(t[0]).toMatchObject({ status: 'error', error: 'Tiempo agotado' });
    expect(t[1]).toMatchObject({ status: 'running', by: 'Reintento', detail: 'PurchaseRequests 14270 · intento 2' });
  });
});

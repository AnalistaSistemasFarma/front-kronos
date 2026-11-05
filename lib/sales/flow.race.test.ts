import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prueba de CARRERA (regresión 2026-11-04, hallazgo 1): al aprobar el extracupo comercial,
 * update-activities lanzaba a la vez la decisión del autorizador (traza U_SEND_TraAproAE en el
 * borrador) y la Tarea SAP «Pasar a AEDA». SAP rechazaba la primera con −2039 y la autorización
 * comercial no quedaba registrada (3 de 12 aprobaciones).
 *
 * Se simula el Service Layer: un PATCH que llega mientras otro PATCH al mismo borrador sigue en
 * curso falla con −2039, como hace SAP.
 */

const h = vi.hoisted(() => ({
  draft: {} as Record<string, unknown>,
  inFlight: 0,
  conflicts: 0,
  patches: [] as Record<string, unknown>[],
  steps: [] as { name: string; status: string }[],
}));

vi.mock('../../dbconfig.js', () => ({ default: {} }));
vi.mock('mssql', () => {
  const request = () => {
    const r = {
      input: () => r,
      query: async (q: string) =>
        /FROM dbo\.sales_authorization/.test(q)
          ? { recordset: [{ id: 1, id_company: 3, doc_entry: 878, status: 'pending', order_doc_entry: null }] }
          : { recordset: [], rowsAffected: [1] },
    };
    return r;
  };
  const sql = { connect: async () => ({ request }), Int: 'Int', NVarChar: () => 'NVarChar', Bit: 'Bit', MAX: -1 };
  return { default: sql };
});
vi.mock('../purchases/authorization', () => ({ companySap: vi.fn(async () => ({ baseUrl: 'x', sessionId: 's' })) }));
vi.mock('../purchases/drafts', () => ({ todayBogota: () => '2026-11-04' }));
vi.mock('../workflow-sap/executionLog', () => ({
  withStep: async (s: { stepName: string }, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      h.steps.push({ name: s.stepName, status: 'ok' });
      return r;
    } catch (e) {
      h.steps.push({ name: s.stepName, status: 'error' });
      throw e;
    }
  },
}));
vi.mock('../sap/serviceLayer', async () => {
  const actual = await vi.importActual<typeof import('../sap/serviceLayer')>('../sap/serviceLayer');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    ...actual,
    sapLogout: async () => undefined,
    sapGetAll: async () => [],
    sapPost: async () => ({}),
    sapGet: async () => {
      await sleep(2);
      return { ...h.draft };
    },
    sapPatch: async (_s: unknown, _path: string, body: Record<string, unknown>) => {
      if (h.inFlight > 0) {
        h.conflicts++;
        throw new actual.SapError(
          'PATCH Drafts(878) fallo (400)',
          400,
          '{"error":{"code":-2039,"message":{"value":"Another user or another operation modified data"}}}'
        );
      }
      h.inFlight++;
      await sleep(25);
      Object.assign(h.draft, body);
      h.patches.push(body);
      h.inFlight--;
    },
  };
});

import { moveToStage, onSalesAuthorizationDecision } from './flow';
import { runAfterSettled } from '../workflow-sap/afterDecision';

beforeEach(() => {
  h.draft = { DocEntry: 878, U_SEND_State: 'AE' };
  h.inFlight = 0;
  h.conflicts = 0;
  h.patches = [];
  h.steps = [];
});

describe('Ventas · carrera al aprobar el extracupo', () => {
  it('lanzadas a la vez (como antes del arreglo), ninguna escritura choca con −2039', async () => {
    const [, move] = await Promise.all([
      onSalesAuthorizationDecision(10117, true, 'Aprobado en la regresión QA'),
      moveToStage(10117, 'AEDA', 'server'),
    ]);
    expect(move.ok).toBe(true);
    expect(h.conflicts).toBe(0);
    expect(h.draft.U_SEND_State).toBe('AEDA');
    expect(h.steps.every((s) => s.status === 'ok')).toBe(true);
    expect(h.patches).toHaveLength(2);
  });

  it('con el orden de update-activities (motor después de la decisión) también queda registrada', async () => {
    const decision = onSalesAuthorizationDecision(10117, true, 'ok comercial');
    const move = await runAfterSettled([decision], () => moveToStage(10117, 'AEDA', 'server'));
    expect(move.ok).toBe(true);
    expect(h.conflicts).toBe(0);
    expect(String(h.draft.U_SEND_TraAproAE)).toMatch(/Autorizado en SynerLink: ok comercial$/);
  });

  it('si otra sesión (SAPSEND, cliente SAP) escribe a la vez, la decisión se reintenta y queda registrada', async () => {
    // Escritura ajena en curso que no pasa por la cola de SynerLink.
    h.inFlight = 1;
    setTimeout(() => {
      h.inFlight = 0;
    }, 200);
    await onSalesAuthorizationDecision(10117, true, 'reintento');
    expect(h.conflicts).toBeGreaterThanOrEqual(1);
    expect(String(h.draft.U_SEND_TraAproAE)).toMatch(/Autorizado en SynerLink: reintento$/);
    expect(h.steps.at(-1)).toEqual({ name: 'Registrar autorización en SAP', status: 'ok' });
  });

  it('sin decisión previa registrada, la Tarea SAP deja la traza de la aprobación (como SAPSEND)', async () => {
    const r = await moveToStage(10117, 'AEDA', 'server');
    expect(r.ok).toBe(true);
    expect(String(h.draft.U_SEND_TraAproAE)).toMatch(/Extracupo autorizado por dirección comercial en SynerLink$/);
  });

  it('el rechazo entra antes que la Tarea SAP y deja el borrador en NADC', async () => {
    const decision = onSalesAuthorizationDecision(10117, false, 'Sin cupo');
    await runAfterSettled([decision], () => moveToStage(10117, 'AEDA', 'server'));
    expect(h.conflicts).toBe(0);
    // La decisión entró primero: el borrador quedó rechazado y la Tarea SAP ya no lo mueve.
    expect(h.draft.U_SEND_State).toBe('NADC');
    expect(String(h.draft.U_SEND_TraDenAE)).toMatch(/Rechazado en SynerLink: Sin cupo$/);
  });

  it('12 aprobaciones seguidas: 12 autorizaciones registradas y 0 conflictos', async () => {
    for (let i = 0; i < 12; i++) {
      h.draft = { DocEntry: 878, U_SEND_State: 'AE' };
      const decision = onSalesAuthorizationDecision(20000 + i, true, `aprobación ${i}`);
      await runAfterSettled([decision], () => moveToStage(20000 + i, 'AEDA', 'server'));
      expect(String(h.draft.U_SEND_TraAproAE)).toContain(`aprobación ${i}`);
      expect(h.draft.U_SEND_State).toBe('AEDA');
    }
    expect(h.conflicts).toBe(0);
  });
});

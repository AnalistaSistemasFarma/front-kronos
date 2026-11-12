import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allPreparedOrionDocumentsSigned } from '../formValue';
import type { OrionDraftState, OrionSignatureBagBag, OrionSignatureState } from '../types';

const h = vi.hoisted(() => ({
  row: { status_req: 1, open_tasks: 0 } as { status_req: number; open_tasks: number } | undefined,
  closed: [] as unknown[],
}));

vi.mock('../../workflow/closeRequestGeneral.js', () => ({
  closeRequestGeneral: vi.fn(async (_pool: unknown, args: unknown) => {
    h.closed.push(args);
    return true;
  }),
}));

import { closeRequestWhenAllSigned } from '../autoCloseOnSigned';

const pool = {
  request: () => ({
    input() {
      return this;
    },
    query: async () => ({ recordset: h.row ? [h.row] : [] }),
  }),
} as unknown as import('mssql').ConnectionPool;

const doc = (status: string, withSigners = true): OrionSignatureState =>
  ({
    fileId: 'x',
    status,
    signers: withSigners ? [{ email: 'a@gss.com', order: 1, status: status === 'FIRMADO' ? 'FIRMADO' : 'PENDIENTE' }] : [],
  }) as OrionSignatureState;

const bag = (documents: Record<string, OrionSignatureState>, drafts: Record<string, Partial<OrionDraftState>> = {}) =>
  ({ documents, drafts }) as unknown as OrionSignatureBagBag;

describe('¿quedó firmado todo lo preparado para firma?', () => {
  it('sí, cuando todos los documentos preparados están firmados', () => {
    expect(allPreparedOrionDocumentsSigned(bag({ a: doc('FIRMADO'), b: doc('FIRMADO') }))).toBe(true);
  });

  it('caso de Juan: el 1 firmado y el 2 en borrador (se envía mañana) → NO se cierra', () => {
    expect(allPreparedOrionDocumentsSigned(bag({ a: doc('FIRMADO'), b: doc('BORRADOR', false) }))).toBe(false);
  });

  it('los adjuntos sin preparar no están en el proceso, así que no impiden el cierre', () => {
    // Solo el documento preparado está en el bag; el adjunto sin preparar nunca entró.
    expect(allPreparedOrionDocumentsSigned(bag({ a: doc('FIRMADO') }))).toBe(true);
  });

  it('no, si alguno sigue en firma, devuelto o rechazado', () => {
    for (const status of ['EN_PROCESO', 'PENDIENTE_FIRMA', 'DEVUELTO', 'RECHAZADO']) {
      expect(allPreparedOrionDocumentsSigned(bag({ a: doc('FIRMADO'), b: doc(status) }))).toBe(false);
    }
  });

  it('no, si no hay nada preparado', () => {
    expect(allPreparedOrionDocumentsSigned(bag({}))).toBe(false);
  });

  it('un Word iniciado que no ha pasado a PDF lo impide (también en elaboración)', () => {
    for (const status of ['EN_ELABORACION', 'EN_VALIDACION_INTERNA', 'EN_REVISION_CLIENTE', 'APROBADO_CLIENTE'] as const) {
      expect(allPreparedOrionDocumentsSigned(bag({ a: doc('FIRMADO') }, { w: { status } }))).toBe(false);
    }
    expect(allPreparedOrionDocumentsSigned(bag({ a: doc('FIRMADO') }, { w: { status: 'CONVERTIDO_PDF' } }))).toBe(true);
  });
});

describe('cierre automático de la solicitud al quedar todo firmado', () => {
  beforeEach(() => {
    h.closed = [];
    h.row = { status_req: 1, open_tasks: 0 };
  });

  it('cierra la solicitud abierta si no quedan otras tareas', async () => {
    await expect(closeRequestWhenAllSigned(pool, { requestId: 10, closedByUserId: '7' })).resolves.toBe(true);
    expect(h.closed).toHaveLength(1);
    expect(h.closed[0]).toMatchObject({ requestId: 10, closedByUserId: '7' });
  });

  it('no cierra si queda otra tarea abierta (por ejemplo, la siguiente del flujo)', async () => {
    h.row = { status_req: 1, open_tasks: 1 };
    await expect(closeRequestWhenAllSigned(pool, { requestId: 10, closedByUserId: '7' })).resolves.toBe(false);
    expect(h.closed).toHaveLength(0);
  });

  it('no toca solicitudes cerradas, canceladas, en borrador ni devueltas', async () => {
    for (const status_req of [2, 3, 6, 7]) {
      h.row = { status_req, open_tasks: 0 };
      await expect(closeRequestWhenAllSigned(pool, { requestId: 10, closedByUserId: '7' })).resolves.toBe(false);
    }
    expect(h.closed).toHaveLength(0);
  });

  it('si la solicitud no existe, no hace nada', async () => {
    h.row = undefined;
    await expect(closeRequestWhenAllSigned(pool, { requestId: 10, closedByUserId: null })).resolves.toBe(false);
    expect(h.closed).toHaveLength(0);
  });
});

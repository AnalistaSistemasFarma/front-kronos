import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allSentOrionDocumentsSigned } from '../formValue';
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

describe('¿quedó firmado todo lo enviado a firmar?', () => {
  it('sí, cuando todos los enviados están firmados', () => {
    expect(allSentOrionDocumentsSigned(bag({ a: doc('FIRMADO'), b: doc('FIRMADO') }))).toBe(true);
  });

  it('los documentos en borrador o sin firmantes no importan', () => {
    expect(allSentOrionDocumentsSigned(bag({ a: doc('FIRMADO'), b: doc('BORRADOR'), c: doc('PENDIENTE_FIRMA', false) }))).toBe(true);
  });

  it('no, si alguno enviado sigue en firma, devuelto o rechazado', () => {
    for (const status of ['EN_PROCESO', 'PENDIENTE_FIRMA', 'DEVUELTO', 'RECHAZADO']) {
      expect(allSentOrionDocumentsSigned(bag({ a: doc('FIRMADO'), b: doc(status) }))).toBe(false);
    }
  });

  it('no, si no se envió nada a firmar', () => {
    expect(allSentOrionDocumentsSigned(bag({}))).toBe(false);
    expect(allSentOrionDocumentsSigned(bag({ a: doc('BORRADOR') }))).toBe(false);
  });

  it('un Word en camino a firma lo impide; uno en elaboración o ya en PDF no', () => {
    expect(allSentOrionDocumentsSigned(bag({ a: doc('FIRMADO') }, { w: { status: 'EN_VALIDACION_INTERNA' } }))).toBe(false);
    expect(allSentOrionDocumentsSigned(bag({ a: doc('FIRMADO') }, { w: { status: 'EN_REVISION_CLIENTE' } }))).toBe(false);
    expect(allSentOrionDocumentsSigned(bag({ a: doc('FIRMADO') }, { w: { status: 'EN_ELABORACION' } }))).toBe(true);
    expect(allSentOrionDocumentsSigned(bag({ a: doc('FIRMADO') }, { w: { status: 'CONVERTIDO_PDF' } }))).toBe(true);
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

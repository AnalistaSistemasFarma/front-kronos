import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RN 2026-11-05: sin la TRM del día en SAP, SynerLink no autoriza ni crea el pedido.
 * Se simula el Service Layer: SAP responde −4006 al pedir la tasa del día.
 */

const h = vi.hoisted(() => ({
  draft: {} as Record<string, unknown>,
  rateMissing: true,
  posts: [] as string[],
  patches: [] as Record<string, unknown>[],
  taskRow: { id_request_general: 10117, is_authorization: true } as Record<string, unknown> | null,
}));

vi.mock('../../dbconfig.js', () => ({ default: {} }));
vi.mock('mssql', () => {
  const request = () => {
    const r = {
      input: () => r,
      query: async (q: string) =>
        /FROM task_request_general/.test(q)
          ? { recordset: h.taskRow ? [h.taskRow] : [] }
          : /FROM dbo\.sales_authorization/.test(q)
            ? { recordset: [{ id: 1, id_company: 3, doc_entry: 878, status: 'pending', order_doc_entry: null }] }
            : { recordset: [], rowsAffected: [1] },
    };
    return r;
  };
  const sql = { connect: async () => ({ request }), Int: 'Int', NVarChar: () => 'NVarChar', Bit: 'Bit', MAX: -1 };
  return { default: sql };
});
vi.mock('../purchases/authorization', () => ({ companySap: vi.fn(async () => ({ baseUrl: 'x', sessionId: 's' })) }));
vi.mock('../purchases/drafts', () => ({ todayBogota: () => '2026-11-05' }));
vi.mock('../workflow-sap/executionLog', () => ({ withStep: async (_s: unknown, fn: () => Promise<unknown>) => fn() }));
vi.mock('../sap/serviceLayer', async () => {
  const actual = await vi.importActual<typeof import('../sap/serviceLayer')>('../sap/serviceLayer');
  return {
    ...actual,
    sapLogout: async () => undefined,
    sapGetAll: async () => [],
    sapGet: async (_s: unknown, path: string) => (path.startsWith('Orders?') ? { value: [] } : { ...h.draft }),
    sapPatch: async (_s: unknown, _p: string, body: Record<string, unknown>) => {
      h.patches.push(body);
    },
    sapPost: async (_s: unknown, path: string) => {
      h.posts.push(path);
      if (path === 'CompanyService_GetAdminInfo') return { LocalCurrency: 'COP', SystemCurrency: 'USD' };
      if (path === 'Orders') return { DocEntry: 2790, DocNum: 2790 };
      return {};
    },
    // El Service Layer responde la tasa en texto plano («3221.190000»).
    sapPostText: async (_s: unknown, path: string) => {
      h.posts.push(path);
      if (path === 'SBOBobService_GetCurrencyRate') {
        if (h.rateMissing) throw new actual.SapError('Update the exchange rate', 400, '{"error":{"code":-4006,"message":{"value":"Update the exchange rate"}}}');
        return '3221.190000';
      }
      return '';
    },
  };
});

import { createOrder, moveToStage, salesApprovalTrmBlock } from './flow';
import { __resetTrmCache } from './trm';

const MSG = 'No hay TRM cargada en SAP para hoy (05/11/2026). Cárguela antes de autorizar.';

beforeEach(() => {
  __resetTrmCache();
  h.rateMissing = true;
  h.posts = [];
  h.patches = [];
  h.taskRow = { id_request_general: 10117, is_authorization: true };
  h.draft = {
    DocEntry: 878,
    CardCode: '900848340',
    U_SEND_State: 'AE',
    ShipToCode: 'ARMENIA',
    AddressExtension: { ShipToZipCode: '630001', U_HBT_MunMedS: '63001' },
    DocumentLines: [{ ItemCode: 'A', Quantity: 1, UnitPrice: 10 }],
  };
});

describe('Ventas · bloqueo por TRM', () => {
  it('moveToStage (autorizar) no mueve el borrador sin TRM del día', async () => {
    const r = await moveToStage(10117, 'AEDA', 'server');
    expect(r).toEqual({ ok: false, error: MSG });
    expect(h.patches).toHaveLength(0);
  });
  it('createOrder no crea el pedido sin TRM del día', async () => {
    const r = await createOrder(10117, 'server');
    expect(r).toEqual({ ok: false, error: MSG });
    expect(h.posts).not.toContain('Orders');
  });
  it('con TRM cargada, crea el pedido', async () => {
    h.rateMissing = false;
    const r = await createOrder(10117, 'server');
    expect(r.ok).toBe(true);
    expect(h.posts).toContain('Orders');
  });
  it('sin dirección de envío no crea el pedido (revisar dirección)', async () => {
    h.rateMissing = false;
    h.draft = { ...h.draft, ShipToCode: null, AddressExtension: {} };
    const r = await createOrder(10117, 'server');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Revisar dirección/);
    expect(h.posts).not.toContain('Orders');
  });
  it('la aprobación de la tarea de autorización se bloquea sin TRM', async () => {
    expect(await salesApprovalTrmBlock(555)).toBe(MSG);
    h.rateMissing = false;
    expect(await salesApprovalTrmBlock(555)).toBeNull();
  });
  it('tareas que no son de autorización no consultan SAP', async () => {
    h.taskRow = { id_request_general: 10117, is_authorization: false };
    expect(await salesApprovalTrmBlock(556)).toBeNull();
    expect(h.posts).toHaveLength(0);
  });
});

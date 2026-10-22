import { describe, expect, it, vi } from 'vitest';
import { buildFirmPayload, firmMarker, publishApprovedDraft, type PublishSap } from './publish';

const draft = (over: Record<string, unknown> = {}) => ({
  DocEntry: 500,
  U_SEND_State: 'LA',
  U_SEND_SolCom: null,
  Comments: 'COMPRA',
  DocDate: '2026-10-15',
  U_SEND_UserId: 32,
  U_SEND_Dep: '12',
  'odata.etag': 'W/"abc"',
  DocumentLines: [{ ItemDescription: 'A', Quantity: 1, RequiredDate: null }],
  ...over,
});

function fakeSap(over: Partial<PublishSap> = {}): PublishSap {
  return {
    getDraft: vi.fn().mockResolvedValue(draft()),
    findFirmByMarker: vi.fn().mockResolvedValue(null),
    createFirm: vi.fn().mockResolvedValue({ DocEntry: 900, DocNum: 901 }),
    markDraftApproved: vi.fn().mockResolvedValue(undefined),
    setFirmSolCom: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('buildFirmPayload', () => {
  it('copia el borrador como SAPSEND y lleva la marca de idempotencia', () => {
    const p = buildFirmPayload(draft(), '2026-10-21');
    expect(p).toMatchObject({
      DocDate: '2026-10-21',
      RequriedDate: '2026-10-21',
      DocDueDate: '2026-10-15',
      U_SEND_UserId: 32,
      U_SEND_Dep: '12',
      U_SEND_SolCom: 'D500',
    });
    expect(p.DocumentLines[0].RequiredDate).toBe('2026-10-21');
  });
});

describe('publishApprovedDraft', () => {
  it('crea la firme, aprueba el borrador con If-Match y enlaza la firme', async () => {
    const sap = fakeSap();
    expect(await publishApprovedDraft(sap, 500)).toEqual({ ok: true, firmDocEntry: 900, firmDocNum: 901, resumed: false });
    expect(sap.createFirm).toHaveBeenCalledTimes(1);
    expect(sap.markDraftApproved).toHaveBeenCalledWith(500, 900, 'W/"abc"');
    expect(sap.setFirmSolCom).toHaveBeenCalledWith(900);
  });

  it('reanuda sin duplicar si la firme ya existe con la marca', async () => {
    const sap = fakeSap({ findFirmByMarker: vi.fn().mockResolvedValue({ DocEntry: 900 }) });
    const r = await publishApprovedDraft(sap, 500);
    expect(r).toMatchObject({ ok: true, firmDocEntry: 900, resumed: true });
    expect(sap.findFirmByMarker).toHaveBeenCalledWith(firmMarker(500));
    expect(sap.createFirm).not.toHaveBeenCalled();
  });

  it('si ya esta aprobado con su firme, no vuelve a crear', async () => {
    const sap = fakeSap({ getDraft: vi.fn().mockResolvedValue(draft({ U_SEND_State: 'A', U_SEND_SolCom: '900' })) });
    expect(await publishApprovedDraft(sap, 500)).toMatchObject({ ok: true, firmDocEntry: 900, resumed: true });
    expect(sap.createFirm).not.toHaveBeenCalled();
  });

  it('devuelve conflicto si el borrador ya no esta en LA', async () => {
    const sap = fakeSap({ getDraft: vi.fn().mockResolvedValue(draft({ U_SEND_State: 'NAD' })) });
    expect(await publishApprovedDraft(sap, 500)).toMatchObject({ ok: false, conflict: true, state: 'NAD' });
    expect(sap.createFirm).not.toHaveBeenCalled();
  });

  it('el paso 3 es best-effort', async () => {
    const sap = fakeSap({ setFirmSolCom: vi.fn().mockRejectedValue(new Error('x')) });
    expect(await publishApprovedDraft(sap, 500)).toMatchObject({ ok: true, firmDocEntry: 900 });
  });
});

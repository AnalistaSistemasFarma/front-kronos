import { describe, expect, it } from 'vitest';
import { previewRedissemination } from '../db/requests';
import { SGC_REDISSEMINATION_FLOW_CODE, SGC_REDISSEMINATION_REQUEST_TYPE, sgcRequestTypeLabel } from '../flows/documentFlow';

/** 2026-10-26: redivulgación de un documento vigente (piezas que no necesitan SQL Server). */

const access = { idCompany: 3, companyName: 'OLP', canRead: true, canManage: true, canQuality: true, canAdminFlows: false };
const dbWith = (doc: unknown, version: unknown) =>
  ({
    sgcDocument: { findFirst: async () => doc },
    sgcDocumentVersion: { findUnique: async () => version },
  }) as never;

describe('SGC · redivulgación (2026-10-26)', () => {
  it('[SGC-REQ-053] tipo, flujo y rótulos', () => {
    expect(SGC_REDISSEMINATION_FLOW_CODE).toBe('REDIV');
    expect(SGC_REDISSEMINATION_REQUEST_TYPE).toBe('redivulgacion');
    expect(sgcRequestTypeLabel('redivulgacion')).toBe('Redivulgación de un documento vigente');
    expect(sgcRequestTypeLabel('nueva_version')).toBe('Nueva versión de un documento vigente');
    expect(sgcRequestTypeLabel('otro')).toBe('otro');
  });

  it('[SGC-REQ-053] solo un documento VIGENTE con su versión vigente y su PDF controlado', async () => {
    const entries = [{ kind: 'empresa' }];
    await expect(previewRedissemination(dbWith({ id_document: 1, status: 'obsoleto', current_version_id: 9 }, null), access, { idDocument: 1, entries })).rejects.toThrow(/VIGENTE/);
    await expect(previewRedissemination(dbWith({ id_document: 1, status: 'vigente', current_version_id: null }, null), access, { idDocument: 1, entries })).rejects.toThrow(/VIGENTE/);
    await expect(previewRedissemination(dbWith({ id_document: 1, status: 'vigente', current_version_id: 9 }, { status: 'vigente', pdf_item_id: null }), access, { idDocument: 1, entries })).rejects.toThrow(/PDF controlado/);
    await expect(previewRedissemination(dbWith({ id_document: 1, status: 'vigente', current_version_id: 9 }, { status: 'obsoleto', pdf_item_id: 'x' }), access, { idDocument: 1, entries })).rejects.toThrow(/PDF controlado/);
    await expect(previewRedissemination(dbWith(null, null), access, { idDocument: 'x', entries })).rejects.toMatchObject({ status: 404 });
    await expect(previewRedissemination(dbWith({ id_document: 1, status: 'vigente', current_version_id: 9 }, { status: 'vigente', pdf_item_id: 'x' }), access, { idDocument: 1, entries: [{ kind: 'galaxia' }] })).rejects.toThrow(/Clase de alcance/);
  });
});

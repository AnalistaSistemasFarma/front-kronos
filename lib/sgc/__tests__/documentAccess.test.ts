import { describe, expect, it } from 'vitest';
import { getGrantInputError, grantApplies, resolveDocumentPermissions, type SgcAccessGrant } from '../documentAccess';
import type { SgcCompanyAccess } from '../permissions';

const NOW = new Date('2026-10-01T15:00:00Z');
const OLP = 3;
const lectura: SgcCompanyAccess = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const calidad: SgcCompanyAccess = { ...lectura, canQuality: true };
const persona = { email: 'ana@onelatampharma.com', departmentIds: [6] }; // Logística
const GARANTIA = 3;
const LOGISTICA = 6;

const doc = (over: Partial<{ status: string; confidentiality: string; idOwnerDepartment: number | null }> = {}) => ({
  idCompany: OLP,
  status: 'vigente',
  confidentiality: 'publica',
  idOwnerDepartment: GARANTIA,
  ...over,
});
const grant = (over: Partial<SgcAccessGrant> = {}): SgcAccessGrant => ({
  idDepartment: null,
  userEmail: null,
  canView: true,
  canDownload: false,
  canPrint: false,
  expiresAt: null,
  revokedAt: null,
  ...over,
});

describe('SGC · permisos por departamento y confidencialidad', () => {
  it('[SGC-REQ-018] sin acceso a la empresa (o de otra empresa) no ve nada', () => {
    expect(resolveDocumentPermissions(null, persona, doc(), []).canView).toBe(false);
    expect(resolveDocumentPermissions({ ...lectura, idCompany: 1 }, persona, doc(), []).canView).toBe(false);
    expect(resolveDocumentPermissions({ ...lectura, canRead: false }, persona, doc(), []).canView).toBe(false);
  });

  it('[SGC-REQ-018] un documento público interno lo ve cualquiera con consulta, sin descarga ni impresión', () => {
    expect(resolveDocumentPermissions(lectura, persona, doc(), [], NOW)).toEqual({ canView: true, canDownload: false, canPrint: false, canAdminister: false });
  });

  it('[SGC-REQ-018] quien no es de Calidad solo ve VIGENTES', () => {
    for (const status of ['borrador', 'obsoleto', 'anulado']) {
      expect(resolveDocumentPermissions(lectura, persona, doc({ status }), [], NOW).canView).toBe(false);
    }
  });

  it('[SGC-REQ-018] "por departamento": lo ve el departamento dueño o un departamento/persona autorizado', () => {
    const d = doc({ confidentiality: 'departamento', idOwnerDepartment: LOGISTICA });
    expect(resolveDocumentPermissions(lectura, persona, d, [], NOW).canView).toBe(true);
    const ajeno = doc({ confidentiality: 'departamento', idOwnerDepartment: GARANTIA });
    expect(resolveDocumentPermissions(lectura, persona, ajeno, [], NOW).canView).toBe(false);
    expect(resolveDocumentPermissions(lectura, persona, ajeno, [grant({ idDepartment: LOGISTICA })], NOW).canView).toBe(true);
    expect(resolveDocumentPermissions(lectura, persona, ajeno, [grant({ userEmail: 'ANA@onelatampharma.com' })], NOW).canView).toBe(true);
  });

  it('[SGC-REQ-018] "confidencial": ser del departamento dueño NO basta; exige acceso expreso', () => {
    const d = doc({ confidentiality: 'confidencial', idOwnerDepartment: LOGISTICA });
    expect(resolveDocumentPermissions(lectura, persona, d, [], NOW).canView).toBe(false);
    expect(resolveDocumentPermissions(lectura, persona, d, [grant({ idDepartment: LOGISTICA })], NOW).canView).toBe(true);
    expect(resolveDocumentPermissions(lectura, persona, d, [grant({ userEmail: 'otro@x.com' })], NOW).canView).toBe(false);
  });

  it('[SGC-REQ-018] los accesos revocados o vencidos no cuentan', () => {
    const d = doc({ confidentiality: 'confidencial' });
    expect(resolveDocumentPermissions(lectura, persona, d, [grant({ userEmail: persona.email, revokedAt: NOW })], NOW).canView).toBe(false);
    expect(resolveDocumentPermissions(lectura, persona, d, [grant({ userEmail: persona.email, expiresAt: NOW })], NOW).canView).toBe(false);
    expect(grantApplies(grant({ userEmail: persona.email, expiresAt: new Date('2026-10-02') }), persona, NOW)).toBe(true);
    expect(grantApplies(grant({ idDepartment: null, userEmail: null }), persona, NOW)).toBe(false);
  });

  it('[SGC-REQ-018] una confidencialidad desconocida se cierra (fail-closed)', () => {
    expect(resolveDocumentPermissions(lectura, persona, doc({ confidentiality: 'secreta' }), [grant({ userEmail: persona.email })], NOW).canView).toBe(false);
  });

  it('[SGC-REQ-018] Calidad ve todo (cualquier estado y confidencialidad) y administra, pero no descarga por defecto', () => {
    const d = doc({ status: 'obsoleto', confidentiality: 'confidencial' });
    expect(resolveDocumentPermissions(calidad, persona, d, [], NOW)).toEqual({ canView: true, canDownload: false, canPrint: false, canAdminister: true });
  });

  it('[SGC-REQ-017] descarga e impresión solo con permiso excepcional vigente', () => {
    const g = grant({ userEmail: persona.email, canDownload: true, canPrint: true, expiresAt: new Date('2026-10-05') });
    expect(resolveDocumentPermissions(lectura, persona, doc(), [g], NOW)).toMatchObject({ canDownload: true, canPrint: true });
    const vencido = { ...g, expiresAt: new Date('2026-09-30') };
    expect(resolveDocumentPermissions(lectura, persona, doc(), [vencido], NOW)).toMatchObject({ canDownload: false, canPrint: false });
    // Sin poder consultar, el permiso de descarga no abre nada.
    const soloDescarga = grant({ userEmail: persona.email, canView: false, canDownload: true, expiresAt: new Date('2026-10-05') });
    expect(resolveDocumentPermissions(lectura, persona, doc({ confidentiality: 'confidencial' }), [soloDescarga], NOW).canDownload).toBe(false);
  });

  it('[SGC-REQ-017] el permiso excepcional exige destino único, motivo y vencimiento futuro', () => {
    const base = { idDepartment: null, userEmail: 'ana@onelatampharma.com', canView: true, canDownload: false, canPrint: false, expiresAt: null, reason: 'Auditoría externa del INVIMA' };
    expect(getGrantInputError(base, NOW)).toBeNull();
    expect(getGrantInputError({ ...base, idDepartment: 3 }, NOW)).toContain('solo uno');
    expect(getGrantInputError({ ...base, userEmail: null }, NOW)).toContain('solo uno');
    expect(getGrantInputError({ ...base, userEmail: 'no-es-correo' }, NOW)).toContain('correo');
    expect(getGrantInputError({ ...base, canView: false }, NOW)).toContain('al menos');
    expect(getGrantInputError({ ...base, canDownload: true }, NOW)).toContain('vencimiento');
    expect(getGrantInputError({ ...base, canPrint: true, expiresAt: new Date('2026-09-01') }, NOW)).toContain('futura');
    expect(getGrantInputError({ ...base, reason: 'corto' }, NOW)).toContain('motivo');
    expect(getGrantInputError({ ...base, userEmail: null, idDepartment: 6 }, NOW)).toBeNull();
  });
});

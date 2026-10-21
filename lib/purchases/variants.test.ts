import { describe, expect, it } from 'vitest';
import { matchesVariant } from './variants';

const me = { sapsendUserId: 32, sapsendDepartmentId: 12 };
const row = (over: Record<string, unknown> = {}) => ({ companyId: 1, U_SEND_State: 'B', U_SEND_UserId: 32, U_SEND_Dep: '12', ...over });

describe('matchesVariant', () => {
  it('«Mis solicitudes» compara U_SEND_UserId con el mapeo de la empresa', () => {
    expect(matchesVariant(row(), 'mias', me)).toBe(true);
    expect(matchesVariant(row({ U_SEND_UserId: 7 }), 'mias', me)).toBe(false);
    expect(matchesVariant(row(), 'mias', { sapsendUserId: null, sapsendDepartmentId: null })).toBe(false);
  });
  it('«Mi area» compara U_SEND_Dep (texto en SAP) con el departamento', () => {
    expect(matchesVariant(row({ U_SEND_UserId: 7 }), 'area', me)).toBe(true);
    expect(matchesVariant(row({ U_SEND_Dep: '6' }), 'area', me)).toBe(false);
  });
  it('oculta anulados salvo en «Todas»', () => {
    expect(matchesVariant(row({ U_SEND_State: null }), 'mias', me)).toBe(false);
    expect(matchesVariant(row({ U_SEND_State: null }), 'todas', me)).toBe(true);
  });
  it('filtra por estado LA y ENC', () => {
    expect(matchesVariant(row({ U_SEND_State: 'LA' }), 'por_autorizar')).toBe(true);
    expect(matchesVariant(row({ U_SEND_State: 'ENC' }), 'cotizacion')).toBe(true);
    expect(matchesVariant(row({ U_SEND_State: 'B' }), 'cotizacion')).toBe(false);
  });
});

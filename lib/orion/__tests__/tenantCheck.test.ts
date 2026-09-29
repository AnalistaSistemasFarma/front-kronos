import { describe, expect, it } from 'vitest';
import {
  compareOrionTenantMaps,
  parseOrionTenantMap,
  planOrionTenantProvision,
  slugifyCompanyName,
} from '../tenantCheck';

describe('tenantCheck', () => {
  it('lee el formato de Orion con synerlinkCompanyIds', () => {
    const map = parseOrionTenantMap({
      tenants: [
        { orionTenantId: 'uuid', slug: 'gss', name: 'GROUP SHARED SERVICES', synerlinkCompanyIds: [8] },
        { slug: 'farmalogica', synerlinkCompanyIds: [1, 3] },
      ],
    });
    expect(map).toEqual({ 1: 'farmalogica', 3: 'farmalogica', 8: 'gss' });
  });

  it('acepta un objeto plano', () => {
    expect(parseOrionTenantMap({ '1': 'farmalogica', x: 'no' })).toEqual({ 1: 'farmalogica' });
  });

  it('reporta empresas faltantes o con slug distinto', () => {
    const mismatches = compareOrionTenantMaps(
      { 1: 'farmalogica', 8: 'gss', 9: 'abamia' },
      { 8: 'gss', 9: 'otra' }
    );
    expect(mismatches).toEqual([
      { synerlinkCompanyId: 1, kronos: 'farmalogica', orion: null },
      { synerlinkCompanyId: 9, kronos: 'abamia', orion: 'otra' },
    ]);
  });

  it('genera slugs sin tildes ni símbolos', () => {
    expect(slugifyCompanyName('ONE LATAM Pharma S.A.S.')).toBe('one-latam-pharma-s-a-s');
    expect(slugifyCompanyName('  Farmalógica & Cía  ')).toBe('farmalogica-cia');
    expect(slugifyCompanyName('***')).toBe('');
  });

  it('planea solo las empresas que faltan en Orion', () => {
    const plan = planOrionTenantProvision(
      [
        { id: 8, name: 'GROUP SHARED SERVICES' },
        { id: 3, name: 'ONELATAMPHARMA' },
        { id: 5, name: 'Nueva Empresa' },
        { id: 6, name: 'GSS' },
        { id: 7, name: '' },
      ],
      { 8: 'gss' },
      { 3: 'farmalogica-1' }
    );
    expect(plan).toEqual([
      { synerlinkCompanyId: 3, name: 'ONELATAMPHARMA', slug: 'farmalogica-1' },
      { synerlinkCompanyId: 5, name: 'Nueva Empresa', slug: 'nueva-empresa' },
      { synerlinkCompanyId: 6, name: 'GSS', slug: 'gss-6' },
      { synerlinkCompanyId: 7, name: 'Empresa 7', slug: 'empresa-7' },
    ]);
  });

  it('un slug de ORION_TENANT_MAP que ya existe vincula la empresa a ese tenant', () => {
    const plan = planOrionTenantProvision([{ id: 3, name: 'X' }], { 8: 'gss' }, { 3: 'gss' });
    expect(plan).toEqual([{ synerlinkCompanyId: 3, name: 'X', slug: 'gss' }]);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isOtResponsableRol, OT_RESPONSABLE_ROLES } from '../constants';
import { assertPuedeSerResponsable, errorSinRol, isOtError, parseCambioResponsable, parseNuevoResponsable, type OtCompanyAccess } from '../rules';

/**
 * Responsables por empresa (2026-10-16, «me deja seleccionar más de los que son»): reglas
 * puras de la asignación de supervisor, inspector y jefe de producción.
 */
const base: OtCompanyAccess = { idCompany: 1, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: false };
const gestion: OtCompanyAccess = { ...base, canManage: true };

function status(fn: () => unknown): number {
  try {
    fn();
    return 0;
  } catch (e) {
    if (isOtError(e)) return e.status;
    throw e;
  }
}

describe('Bitácora de Proceso · responsables', () => {
  it('roles: solo supervisor, inspector y jefe de producción (el operario sale del maestro)', () => {
    expect([...OT_RESPONSABLE_ROLES]).toEqual(['SUPERVISOR', 'INSPECTOR', 'JEFE_PROD']);
    expect(isOtResponsableRol('INSPECTOR')).toBe(true);
    expect(isOtResponsableRol('OPERARIO')).toBe(false);
    expect(isOtResponsableRol('inspector')).toBe(false);
  });

  it('parseNuevoResponsable: empresa, persona y rol obligatorios', () => {
    expect(parseNuevoResponsable({ company: 1, id_user: ' u1 ', rol: 'JEFE_PROD' })).toEqual({ idCompany: 1, idUser: 'u1', rol: 'JEFE_PROD' });
    expect(status(() => parseNuevoResponsable(null))).toBe(400);
    expect(status(() => parseNuevoResponsable({ id_user: 'u1', rol: 'INSPECTOR' }))).toBe(400);
    expect(status(() => parseNuevoResponsable({ company: 1, rol: 'INSPECTOR' }))).toBe(400);
    expect(status(() => parseNuevoResponsable({ company: 1, id_user: 'x'.repeat(51), rol: 'INSPECTOR' }))).toBe(400);
    expect(status(() => parseNuevoResponsable({ company: 1, id_user: 'u1', rol: 'OPERARIO' }))).toBe(400);
  });

  it('parseCambioResponsable: solo activar o desactivar (no se borran)', () => {
    expect(parseCambioResponsable({ company: 1, id_responsable: 4, activo: false })).toEqual({ idCompany: 1, idResponsable: 4, activo: false });
    expect(status(() => parseCambioResponsable({ company: 1, id_responsable: 4 }))).toBe(400);
    expect(status(() => parseCambioResponsable({ company: 1, activo: true }))).toBe(400);
    expect(status(() => parseCambioResponsable({ company: 1, id_responsable: 4, activo: 'no' }))).toBe(400);
  });

  it('el SUPERVISOR exige Gestión; inspector y jefe, el permiso del módulo', () => {
    expect(status(() => assertPuedeSerResponsable('SUPERVISOR', gestion, 'Amanda'))).toBe(0);
    expect(status(() => assertPuedeSerResponsable('SUPERVISOR', base, 'Judy'))).toBe(400);
    expect(status(() => assertPuedeSerResponsable('INSPECTOR', base, 'Judy'))).toBe(0);
    expect(status(() => assertPuedeSerResponsable('JEFE_PROD', base, 'Karen'))).toBe(0);
    expect(status(() => assertPuedeSerResponsable('INSPECTOR', null, 'Sin módulo'))).toBe(400);
    expect(status(() => assertPuedeSerResponsable('JEFE_PROD', { ...base, canOperate: false }, 'Sin módulo'))).toBe(400);
  });

  it('errorSinRol nombra el rol y apunta al catálogo', () => {
    const e = errorSinRol('INSPECTOR');
    expect(e.status).toBe(400);
    expect(e.message).toContain('inspector');
    expect(e.message).toContain('Catálogo → Responsables');
    expect(errorSinRol('SUPERVISOR', 403).status).toBe(403);
  });

  it('la siembra de producción asigna a Judy (inspectora), Karen y Tatiana (jefes) y a Amanda como supervisora provisional; Nicolás solo en pruebas', () => {
    const leer = (f: string) => readFileSync(fileURLToPath(new URL(`../../../prisma/manual/${f}`, import.meta.url)), 'utf8');
    const prod = leer('2026-10-16-bitacora-proceso-responsables-farmalogica.sql');
    expect(prod).toMatch(/judy\.alvarez@farmalogica\.com',\s+N'INSPECTOR'/);
    expect(prod).toMatch(/karen\.blanco@farmalogica\.com',\s+N'JEFE_PROD'/);
    expect(prod).toMatch(/tatiana\.rico@farmalogica\.com',\s+N'JEFE_PROD'/);
    expect(prod).toMatch(/amanda\.casiano@farmalogica\.com', N'SUPERVISOR'/);
    expect(prod).not.toContain('nicolas.rivera@gsslatam.com');
    expect(prod).toContain("IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')");
    const pruebas = leer('2026-10-16-bitacora-proceso-pruebas-responsables.sql');
    expect(pruebas).toContain("IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')");
    expect(pruebas).toContain('nicolas.rivera@gsslatam.com');
    expect(pruebas).not.toMatch(/N'KRONOSDB'[,)]/);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MSG_NOT_MANAGER, MSG_RESTRICTED, decideFlowEdit } from '../flowAccess';

/** Restricted access of flows (2026-11-24): who changes a flow and who manages its access. */
describe('Flujos · acceso restringido', () => {
  const base = { isSystemAdmin: false, isWorkflowManager: false, restricted: false, isEditor: false };

  it('sin el permiso de administrar flujos nadie diseña ni cambia un flujo (antes cualquiera con sesión podía)', () => {
    expect(decideFlowEdit(base)).toEqual({ canEdit: false, canManageAccess: false, reason: MSG_NOT_MANAGER });
    expect(decideFlowEdit({ ...base, isEditor: true, restricted: true })).toMatchObject({ canEdit: false, reason: MSG_NOT_MANAGER });
  });

  it('sin restricción, quien administra flujos los cambia; solo el administrador del sistema gestiona el acceso', () => {
    expect(decideFlowEdit({ ...base, isWorkflowManager: true })).toEqual({ canEdit: true, canManageAccess: false, reason: null });
    expect(decideFlowEdit({ ...base, isSystemAdmin: true })).toEqual({ canEdit: true, canManageAccess: true, reason: null });
  });

  it('un flujo restringido solo lo cambian sus editores y el administrador del sistema', () => {
    expect(decideFlowEdit({ ...base, isWorkflowManager: true, restricted: true })).toEqual({ canEdit: false, canManageAccess: false, reason: MSG_RESTRICTED });
    expect(decideFlowEdit({ ...base, isWorkflowManager: true, restricted: true, isEditor: true })).toEqual({ canEdit: true, canManageAccess: false, reason: null });
    expect(decideFlowEdit({ ...base, isSystemAdmin: true, restricted: true })).toEqual({ canEdit: true, canManageAccess: true, reason: null });
  });
});

describe('Flujos · acceso restringido · SQL', () => {
  const root = path.resolve(__dirname, '../../..');
  const leer = (p: string) => readFileSync(path.join(root, p), 'utf8');
  const pruebas = leer('prisma/manual/2026-11-24-flujos-acceso-restringido-PRUEBAS.sql');
  const prod = leer('prisma/manual/2026-11-24-flujos-acceso-restringido-PROD.sql');
  const reversa = leer('prisma/manual/2026-11-24-flujos-acceso-restringido-reversa.sql');
  const cuerpo = (s: string) => s.slice(s.indexOf('BEGIN TRY'));

  it('PRUEBAS y PROD llevan el mismo cuerpo, con su guarda de base antes', () => {
    expect(cuerpo(pruebas)).toBe(cuerpo(prod));
    expect(pruebas.indexOf("DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')")).toBeLessThan(pruebas.indexOf('BEGIN TRY'));
    expect(prod.indexOf("DB_NAME() <> N'KRONOSDB'")).toBeLessThan(prod.indexOf('BEGIN TRY'));
  });

  it('solo aditivo (banderas NOT NULL DEFAULT 0 = comportamiento actual), historial de solo inserción y reversa con bandera', () => {
    const b = cuerpo(prod);
    expect(b).not.toMatch(/DROP |DELETE FROM|UPDATE dbo\./);
    expect(b).toContain('restricted_access BIT NOT NULL CONSTRAINT DF_process_category_restricted DEFAULT 0');
    expect(b).toContain('sgc_templates_only BIT NOT NULL CONSTRAINT DF_process_category_sgc_only DEFAULT 0');
    expect(b).toContain('CONSTRAINT UQ_process_category_editor UNIQUE (id_process_category, id_user)');
    expect(b).toContain('process_category_change_log_insert_only');
    expect(reversa).toContain("SESSION_CONTEXT(N'flujos_acceso_reversa_acepta_perdida')");
    expect(reversa.indexOf('THROW 51814')).toBeLessThan(reversa.indexOf('DROP TABLE'));
  });

  it('los objetos nuevos quedan en la lista que revisa el despliegue azul/verde', () => {
    const o = JSON.parse(leer('prisma/manual/objetos-requeridos.json')) as { columnas: string[][]; tablas: string[] };
    expect(o.columnas).toEqual(expect.arrayContaining([['process_category', 'restricted_access'], ['process_category', 'sgc_templates_only']]));
    expect(o.tablas).toEqual(expect.arrayContaining(['process_category_editor', 'process_category_change_log']));
  });
});

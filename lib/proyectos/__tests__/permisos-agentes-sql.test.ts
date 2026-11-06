import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Permisos de los agentes (2026-10-20): los scripts manuales de PRUEBAS y PROD repiten TAL CUAL el
 * bloque DDL de la migración, cada uno con su guarda de base, y nada altera tablas existentes. La CI
 * corre además el SQL de verdad (dos veces, PROD que se niega y la reversa ida y vuelta).
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261020190000_proyectos_permisos_agentes/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL de permisos de los agentes', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-10-20-proyectos-permisos-agentes-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-20-proyectos-permisos-agentes-PROD.sql');
    expect(bloque.length).toBeGreaterThan(3000);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
  });

  it('solo aditivo: idempotente, sin ALTER de columnas ni DROP, y sin tocar datos en el DDL', () => {
    const creates = bloque.match(/CREATE (TABLE|NONCLUSTERED INDEX|UNIQUE NONCLUSTERED INDEX|TRIGGER)|ADD CONSTRAINT/g) ?? [];
    const guardas = bloque.match(/IF (OBJECT_ID|NOT EXISTS|COL_LENGTH)/g) ?? [];
    expect(creates.length).toBe(13); // 4 tablas, 5 índices, 3 CHECK y el trigger
    expect(guardas.length).toBeGreaterThanOrEqual(creates.length);
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE|DROP)\b/im);
    expect(bloque).not.toMatch(/ALTER TABLE \[dbo\]\.\[(?!chat_project_(repo_catalog|agent_policy|agent_policy_log)\])/);
    expect(bloque).not.toMatch(/ADD \[|ALTER COLUMN/);
  });

  it('los scripts no crean políticas ni otorgan permisos; solo el subproceso apagado y el catálogo inicial', () => {
    for (const f of ['PRUEBAS', 'PROD']) {
      const s = leer(`prisma/manual/2026-10-20-proyectos-permisos-agentes-${f}.sql`);
      const fuera = s.slice(s.indexOf('/* BLOQUE-DDL-FIN */') > 0 ? s.indexOf('/* BLOQUE-DDL-FIN */') : s.indexOf('Subproceso-permiso'));
      expect(fuera).not.toMatch(/INSERT INTO \[dbo\]\.\[subprocess_user_company\]/);
      expect(fuera).not.toMatch(/INSERT INTO \[dbo\]\.\[chat_project_agent_policy/);
      expect(fuera).toMatch(/subprocess_url = @Url\)\s+INSERT INTO \[dbo\]\.\[subprocess\]/);
      expect(fuera).toMatch(/N'\/process\/proyectos\/permisos-agentes'/);
      expect(fuera).toMatch(/IF NOT EXISTS \(SELECT 1 FROM \[dbo\]\.\[chat_project_repo_catalog\] WHERE slug = N'sapsend'\)/);
    }
  });

  it('los nombres coinciden con los de Prisma (db push no deja índices repetidos)', () => {
    const schema = leer('prisma/schema.prisma');
    expect(schema).toMatch(/@unique\(map: "chat_project_agent_policy_project"\)/);
    expect(schema).toMatch(/@unique\(map: "chat_project_repo_catalog_slug"\)/);
    expect(schema).toMatch(/@@unique\(\[id_project, id_repo\], map: "chat_project_agent_policy_repo_project_repo"\)/);
    expect(schema).toMatch(/@@index\(\[id_repo\], map: "chat_project_agent_policy_repo_id_repo_idx"\)/);
    expect(schema).toMatch(/@@index\(\[id_project, changed_at\], map: "chat_project_agent_policy_log_project_idx"\)/);
    for (const n of ['chat_project_agent_policy_project', 'chat_project_repo_catalog_slug', 'chat_project_agent_policy_repo_project_repo', 'chat_project_agent_policy_repo_id_repo_idx', 'chat_project_agent_policy_log_project_idx']) {
      expect(bloque).toContain(`[${n}]`);
    }
  });

  it('el registro es inmutable y los CHECK cuidan el nivel y los autorizadores', () => {
    expect(bloque).toMatch(/CREATE TRIGGER \[dbo\]\.\[TR_chat_project_agent_policy_log_inmutable\][\s\S]*INSTEAD OF UPDATE, DELETE/);
    expect(bloque).toMatch(/\[code_level\] IN \(N''ninguno'', N''lectura'', N''desarrollo'', N''desarrollo_pases''\)/);
    expect(bloque).toMatch(/\[code_level\] = N''desarrollo_pases'' OR \[deploy_approvers\] IS NULL/);
    expect(bloque).toMatch(/N'ninguno'/);
  });

  it('la reversa lista lo que se perdería, se niega sin su bandera y tiene guarda de base', () => {
    const r = leer('prisma/manual/2026-10-20-proyectos-permisos-agentes-reversa.sql');
    expect(r).toMatch(/proyectos_permisos_agentes_reversa_acepta_perdida/);
    expect(r).toMatch(/THROW 51525/);
    expect(r).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(r.indexOf('WHERE p.code_level <> N')).toBeLessThan(r.indexOf('THROW 51525'));
    for (const t of ['chat_project_agent_policy_log', 'chat_project_agent_policy_repo', 'chat_project_agent_policy', 'chat_project_repo_catalog']) {
      expect(r).toContain(`DROP TABLE [dbo].[${t}]`);
    }
    expect(r).toMatch(/DELETE FROM \[dbo\]\.\[subprocess\] WHERE subprocess_url = N'\/process\/proyectos\/permisos-agentes'/);
  });
});

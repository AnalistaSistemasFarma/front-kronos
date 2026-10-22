import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Configuración de «Proyectos» por empresa (2026-10-20): los scripts manuales de PRUEBAS y PROD
 * repiten TAL CUAL el bloque DDL de la migración, cada uno con su guarda de base. La CI corre
 * además el SQL de verdad (dos veces, PROD que se niega y la reversa ida y vuelta).
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261020180000_proyectos_config_agentes/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL de la configuración de Proyectos', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-10-20-proyectos-config-agentes-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-20-proyectos-config-agentes-PROD.sql');
    expect(bloque.length).toBeGreaterThan(2000);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
  });

  it('el DDL es aditivo e idempotente: no altera tablas existentes ni toca datos', () => {
    const creates = bloque.match(/CREATE (TABLE|NONCLUSTERED INDEX|UNIQUE NONCLUSTERED INDEX|TRIGGER)|ADD CONSTRAINT/g) ?? [];
    const guardas = bloque.match(/IF (OBJECT_ID|NOT EXISTS|COL_LENGTH)/g) ?? [];
    expect(creates.length).toBe(8);
    expect(guardas.length).toBeGreaterThanOrEqual(creates.length);
    expect(bloque).toMatch(/THROW 51510, N'Falta la migración 20261018120000_proyectos_modulo/);
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE|DROP)\b/im);
    // Solo se alteran las tablas NUEVAS (para sus CHECK).
    for (const m of bloque.matchAll(/ALTER TABLE \[dbo\]\.\[(\w+)\]/g)) {
      expect(['chat_project_agent_config', 'chat_project_agent_config_log']).toContain(m[1]);
    }
  });

  it('los scripts manuales solo agregan el subproceso-permiso, apagado', () => {
    for (const f of ['PRUEBAS', 'PROD']) {
      const s = leer(`prisma/manual/2026-10-20-proyectos-config-agentes-${f}.sql`);
      expect(s).toMatch(/DECLARE @Url\s+NVARCHAR\(255\) = N'\/process\/proyectos\/configuracion';/);
      expect(s).toMatch(/IF NOT EXISTS \(SELECT 1 FROM \[dbo\]\.\[subprocess\] WHERE subprocess_url = @Url\)/);
      expect(s).not.toMatch(/INSERT INTO \[dbo\]\.\[subprocess_user_company\]/);
      expect(s).not.toMatch(/INSERT INTO \[dbo\]\.\[chat_project_agent_config\]/);
    }
  });

  it('los nombres coinciden con los de Prisma (db push no deja índices repetidos)', () => {
    const schema = leer('prisma/schema.prisma');
    expect(schema).toMatch(/@@unique\(\[id_company, id_agent\], map: "chat_project_agent_config_company_agent"\)/);
    expect(schema).toMatch(/@@index\(\[id_agent\], map: "chat_project_agent_config_id_agent_idx"\)/);
    expect(schema).toMatch(/@@index\(\[id_company, changed_at\], map: "chat_project_agent_config_log_company_idx"\)/);
    expect(bloque).toMatch(/CREATE UNIQUE NONCLUSTERED INDEX \[chat_project_agent_config_company_agent\]/);
    expect(bloque).toMatch(/TR_chat_project_agent_config_log_inmutable/);
  });

  it('la reversa se niega a perder la configuración sin su bandera, tiene guarda y quita el permiso', () => {
    const r = leer('prisma/manual/2026-10-20-proyectos-config-agentes-reversa.sql');
    expect(r).toMatch(/proyectos_config_agentes_reversa_acepta_perdida/);
    expect(r).toMatch(/THROW 51515/);
    expect(r).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(r).toMatch(/DROP TABLE \[dbo\]\.\[chat_project_agent_config_log\]/);
    expect(r).toMatch(/DROP TABLE \[dbo\]\.\[chat_project_agent_config\]/);
    expect(r).toMatch(/DELETE FROM \[dbo\]\.\[subprocess\] WHERE subprocess_url = N'\/process\/proyectos\/configuracion'/);
  });
});

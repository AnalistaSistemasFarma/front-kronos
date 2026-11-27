import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * «Silenciar notificaciones» of a project (2026-11-23): the manual PRUEBAS and PROD scripts repeat
 * the migration's DDL block VERBATIM, each with its database guard. The CI also runs the real SQL
 * (twice, PROD refusing, and the reversal round trip).
 */
const root = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths.
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const migration = read('prisma/migrations/20261123200000_chat_project_mute/migration.sql');
const block = migration.slice(migration.indexOf('SET XACT_ABORT ON;'), migration.indexOf('/* BLOQUE-DDL-FIN */'));

describe('project mute SQL', () => {
  it('PRUEBAS and PROD carry the identical DDL block and their database guard BEFORE it', () => {
    const pruebas = read('prisma/manual/2026-11-23-proyectos-silenciar-PRUEBAS.sql');
    const prod = read('prisma/manual/2026-11-23-proyectos-silenciar-PROD.sql');
    expect(block.length).toBeGreaterThan(800);
    expect(pruebas).toContain(block);
    expect(prod).toContain(block);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
  });

  it('everything is idempotent and touches no data', () => {
    const creates = block.match(/CREATE (TABLE|NONCLUSTERED INDEX|UNIQUE NONCLUSTERED INDEX)/g) ?? [];
    const guards = block.match(/IF (OBJECT_ID|NOT EXISTS)/g) ?? [];
    expect(creates.length).toBe(3);
    expect(guards.length).toBeGreaterThanOrEqual(creates.length);
    expect(block).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/im);
  });

  it('names match Prisma (db push leaves no duplicated indexes)', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).toMatch(/@@unique\(\[id_project, id_user\], map: "chat_project_mute_project_user"\)/);
    expect(schema).toMatch(/@@index\(\[id_user\], map: "chat_project_mute_id_user_idx"\)/);
    expect(schema).toMatch(/@@map\("chat_project_mute"\)/);
    expect(block).toMatch(/CREATE UNIQUE NONCLUSTERED INDEX \[chat_project_mute_project_user\]/);
    expect(block).toMatch(/\[chat_project_mute_id_project_fkey\] FOREIGN KEY \(\[id_project\]\) REFERENCES \[dbo\]\.\[chat_project\]\(\[id_project\]\) ON DELETE CASCADE/);
  });

  it('the reversal refuses to lose mutes without its flag and has a database guard', () => {
    const r = read('prisma/manual/2026-11-23-proyectos-silenciar-reversa.sql');
    expect(r).toMatch(/proyectos_silenciar_reversa_acepta_perdida/);
    expect(r).toMatch(/THROW 52305/);
    expect(r).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(r).toMatch(/DROP TABLE \[dbo\]\.\[chat_project_mute\]/);
  });
});

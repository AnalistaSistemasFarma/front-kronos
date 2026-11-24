import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Meetings per project (2026-11-24): the manual PRUEBAS and PROD scripts repeat the migration's DDL block
 * VERBATIM, each with its database guard. The CI also runs the real SQL (twice, PROD refusing, reversal).
 */
const root = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths.
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const migration = read('prisma/migrations/20261124150000_chat_project_meetings/migration.sql');
const block = migration.slice(migration.indexOf('SET XACT_ABORT ON;'), migration.indexOf('/* BLOQUE-DDL-FIN */'));

describe('project meetings SQL', () => {
  it('PRUEBAS and PROD carry the identical DDL block and their database guard BEFORE it', () => {
    const pruebas = read('prisma/manual/2026-11-24-proyectos-reuniones-PRUEBAS.sql');
    const prod = read('prisma/manual/2026-11-24-proyectos-reuniones-PROD.sql');
    expect(block.length).toBeGreaterThan(3000);
    expect(pruebas).toContain(block);
    expect(prod).toContain(block);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
    expect(prod).toMatch(/SET LOCK_TIMEOUT 5000;/);
  });

  it('everything is idempotent, additive and touches no data nor existing tables', () => {
    const creates = block.match(/CREATE (TABLE|NONCLUSTERED INDEX|UNIQUE NONCLUSTERED INDEX)/g) ?? [];
    const guards = block.match(/IF (OBJECT_ID|NOT EXISTS)/g) ?? [];
    expect(creates.length).toBe(9);
    expect(guards.length).toBeGreaterThanOrEqual(creates.length);
    expect(block).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE|DROP)\b/im);
    expect(block).not.toMatch(/ALTER TABLE/i);
  });

  it('names match Prisma (db push leaves no duplicated indexes)', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).toMatch(/@unique\(map: "chat_project_meeting_ical_uid"\)/);
    expect(schema).toMatch(/@@unique\(\[mailbox, series_key\], map: "chat_project_meeting_rule_mailbox_series"\)/);
    expect(schema).toMatch(/@@index\(\[id_project, start_at\], map: "chat_project_meeting_project_start_idx"\)/);
    expect(schema).toMatch(/@@index\(\[id_project_meeting, created_at\], map: "chat_project_meeting_analysis_meeting_idx"\)/);
    expect(block).toMatch(/CREATE UNIQUE NONCLUSTERED INDEX \[chat_project_meeting_ical_uid\]/);
    expect(block).toMatch(/\[chat_project_meeting_id_project_fkey\] FOREIGN KEY \(\[id_project\]\) REFERENCES \[dbo\]\.\[chat_project\]\(\[id_project\]\) ON DELETE CASCADE/);
    expect(block).not.toMatch(/transcript\]\s+NVARCHAR/i);
  });

  it('no nested comment openers (T-SQL nests /* … */: one inside a comment breaks the whole script)', () => {
    for (const f of [
      'prisma/migrations/20261124150000_chat_project_meetings/migration.sql',
      'prisma/manual/2026-11-24-proyectos-reuniones-PRUEBAS.sql',
      'prisma/manual/2026-11-24-proyectos-reuniones-PROD.sql',
      'prisma/manual/2026-11-24-proyectos-reuniones-reversa.sql',
    ]) {
      const sql = read(f);
      expect((sql.match(/\/\*/g) ?? []).length).toBe((sql.match(/\*\//g) ?? []).length);
    }
  });

  it('the reversal refuses to lose data without its flag and has a database guard', () => {
    const r = read('prisma/manual/2026-11-24-proyectos-reuniones-reversa.sql');
    expect(r).toMatch(/proyectos_reuniones_reversa_acepta_perdida/);
    expect(r).toMatch(/THROW 52405/);
    expect(r).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(r.indexOf('DROP TABLE [dbo].[chat_project_meeting_analysis]')).toBeLessThan(r.indexOf('DROP TABLE [dbo].[chat_project_meeting];'));
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Los scripts manuales de PRUEBAS y PROD del equipo de subagentes repiten TAL CUAL el bloque DDL
 * de la migración, cada uno con su guarda de base. La CI corre además el SQL de verdad.
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261018220000_proyectos_equipo_subagentes/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL del equipo de subagentes', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-10-18-proyectos-equipo-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-18-proyectos-equipo-PROD.sql');
    expect(bloque.length).toBeGreaterThan(3000);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
  });
  it('todo es idempotente y exige el cronograma antes', () => {
    const creates = bloque.match(/CREATE (TABLE|NONCLUSTERED INDEX|UNIQUE NONCLUSTERED INDEX|TRIGGER)|ADD CONSTRAINT|ALTER TABLE \[dbo\]\.\[chat_project\] ADD/g) ?? [];
    const guardas = bloque.match(/IF (OBJECT_ID|NOT EXISTS|COL_LENGTH)/g) ?? [];
    expect(creates.length).toBeGreaterThan(10);
    expect(guardas.length).toBeGreaterThanOrEqual(creates.length - 4);
    expect(bloque).toMatch(/THROW 51496, N'Falta la migración 20261018180000_proyectos_cronograma/);
  });
  it('la base también defiende: catálogo sin Bash/Agent, slug único entre los vivos, tope 1–5 y auditoría inmutable', () => {
    expect(bloque).toMatch(/NOT LIKE N''%bash%''/);
    expect(bloque).toMatch(/WHERE \[status\] <> N''descartado''/);
    expect(bloque).toMatch(/\[team_max_parallel\] >= 1 AND \[team_max_parallel\] <= 5/);
    expect(bloque).toMatch(/INSTEAD OF UPDATE, DELETE/);
  });
  it('la reversa se niega a perder datos sin su bandera y quita los DEFAULT por columna', () => {
    const r = leer('prisma/manual/2026-10-18-proyectos-equipo-reversa.sql');
    expect(r).toMatch(/proyectos_equipo_reversa_acepta_perdida/);
    expect(r).toMatch(/THROW 51501/);
    expect(r).toMatch(/sys\.default_constraints/);
  });
});

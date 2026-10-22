import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Los scripts manuales de PRUEBAS y PROD del cronograma repiten TAL CUAL el bloque DDL de la
 * migración (para que no se separen con el tiempo), cada uno con su guarda de base.
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261018180000_proyectos_cronograma/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL del cronograma', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base', () => {
    const pruebas = leer('prisma/manual/2026-10-18-proyectos-cronograma-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-18-proyectos-cronograma-PROD.sql');
    expect(bloque.length).toBeGreaterThan(2000);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    // La guarda va ANTES del DDL.
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
  });
  it('todo es idempotente (cada objeto se crea solo si falta)', () => {
    const creates = bloque.match(/CREATE (TABLE|NONCLUSTERED INDEX|TRIGGER)|ADD CONSTRAINT|ADD \[target_date\]/g) ?? [];
    const guardas = bloque.match(/IF (OBJECT_ID|NOT EXISTS|COL_LENGTH)/g) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    expect(guardas.length).toBeGreaterThanOrEqual(5 + 8);
  });
  it('la reversa se niega a perder datos sin su bandera', () => {
    const r = leer('prisma/manual/2026-10-18-proyectos-cronograma-reversa.sql');
    expect(r).toMatch(/proyectos_cronograma_reversa_acepta_perdida/);
    expect(r).toMatch(/THROW 51495/);
  });
});

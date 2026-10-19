import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Mensajes no leídos de Proyectos (icono de la cabecera, 2026-10-19): los scripts manuales de
 * PRUEBAS y PROD repiten TAL CUAL el bloque DDL de la migración, cada uno con su guarda de base.
 * La CI corre además el SQL de verdad (dos veces, PROD que se niega y la reversa ida y vuelta).
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261019140000_proyectos_no_leidos/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL de no leídos de Proyectos', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-10-19-proyectos-no-leidos-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-19-proyectos-no-leidos-PROD.sql');
    expect(bloque.length).toBeGreaterThan(1000);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
  });

  it('todo es idempotente, exige la F1 antes y no toca datos', () => {
    const creates = bloque.match(/CREATE (TABLE|NONCLUSTERED INDEX|UNIQUE NONCLUSTERED INDEX)|ADD CONSTRAINT/g) ?? [];
    const guardas = bloque.match(/IF (OBJECT_ID|NOT EXISTS|COL_LENGTH)/g) ?? [];
    expect(creates.length).toBe(4);
    expect(guardas.length).toBeGreaterThanOrEqual(creates.length);
    expect(bloque).toMatch(/THROW 51502, N'Falta la migración 20261017120000_chat_projects/);
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/im);
  });

  it('los nombres coinciden con los de Prisma (db push no deja índices repetidos)', () => {
    const schema = leer('prisma/schema.prisma');
    expect(schema).toMatch(/@@unique\(\[id_conversation, id_user\], map: "chat_project_read_conversation_user"\)/);
    expect(schema).toMatch(/@@index\(\[id_user\], map: "chat_project_read_id_user_idx"\)/);
    expect(bloque).toMatch(/CREATE UNIQUE NONCLUSTERED INDEX \[chat_project_read_conversation_user\]/);
    expect(bloque).toMatch(/\[chat_project_read_id_conversation_fkey\] FOREIGN KEY \(\[id_conversation\]\) REFERENCES \[dbo\]\.\[chat_conversation\]\(\[id\]\) ON DELETE CASCADE/);
  });

  it('la reversa se niega a perder marcas sin su bandera y tiene guarda de base', () => {
    const r = leer('prisma/manual/2026-10-19-proyectos-no-leidos-reversa.sql');
    expect(r).toMatch(/proyectos_no_leidos_reversa_acepta_perdida/);
    expect(r).toMatch(/THROW 51506/);
    expect(r).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(r).toMatch(/DROP TABLE \[dbo\]\.\[chat_project_read\]/);
  });
});

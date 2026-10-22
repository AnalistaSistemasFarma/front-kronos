import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * «Mis stickers» (2026-10-21): los scripts manuales de PRUEBAS y PROD repiten
 * TAL CUAL el bloque DDL de la migración; todo es aditivo e idempotente. La CI
 * corre además el SQL de verdad (dos veces, PROD que se niega y la reversa ida
 * y vuelta, ANTES que la reversa de reacciones).
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261021120000_chat_stickers_personales/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL de «Mis stickers»', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-10-21-chat-stickers-personales-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-21-chat-stickers-personales-PROD.sql');
    expect(bloque.length).toBeGreaterThan(1500);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
  });

  it('SOLO ADITIVO: una tabla nueva; no altera chat_sticker, chat_message_media ni sus CHECK', () => {
    expect(bloque).not.toMatch(/\bDROP\b/i);
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/im);
    expect(bloque.match(/CREATE TABLE \[dbo\]\.\[(\w+)\]/g)).toEqual(['CREATE TABLE [dbo].[chat_sticker_personal]']);
    for (const a of bloque.match(/ALTER TABLE \[dbo\]\.\[(\w+)\]/g) ?? []) expect(a).toBe('ALTER TABLE [dbo].[chat_sticker_personal]');
  });

  it('todo es idempotente', () => {
    const creates = bloque.match(/CREATE (TABLE|NONCLUSTERED INDEX)|ADD CONSTRAINT/g) ?? [];
    const guardas = bloque.match(/IF (OBJECT_ID|NOT EXISTS)/g) ?? [];
    expect(creates.length).toBe(5);
    expect(guardas.length).toBeGreaterThanOrEqual(creates.length);
  });

  it('los nombres coinciden con los de Prisma', () => {
    const schema = leer('prisma/schema.prisma');
    for (const nombre of ['chat_sticker_personal_user_idx', 'chat_sticker_personal_propuesta_idx']) {
      expect(bloque).toContain(nombre);
      expect(schema).toContain(`map: "${nombre}"`);
    }
    expect(schema).toContain('@@map("chat_sticker_personal")');
  });

  it('la reversa desactiva los personales antes de borrar la tabla y exige su bandera', () => {
    const reversa = leer('prisma/manual/2026-10-21-chat-stickers-personales-reversa.sql');
    expect(reversa).toMatch(/chat_stickers_personales_reversa_acepta_perdida/);
    expect(reversa.indexOf('SET s.active = 0')).toBeGreaterThan(0);
    expect(reversa.indexOf('SET s.active = 0')).toBeLessThan(reversa.indexOf('DROP TABLE [dbo].[chat_sticker_personal]'));
    expect(reversa).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
  });
});

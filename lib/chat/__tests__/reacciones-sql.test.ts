import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Reacciones, GIF y stickers (2026-10-20): los scripts manuales de PRUEBAS y
 * PROD repiten TAL CUAL el bloque DDL de la migración; todo es aditivo e
 * idempotente. La CI corre además el SQL de verdad (dos veces, PROD que se
 * niega y la reversa ida y vuelta).
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261020120000_chat_reacciones_stickers/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL de reacciones, GIF y stickers', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-10-20-chat-reacciones-stickers-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-20-chat-reacciones-stickers-PROD.sql');
    expect(bloque.length).toBeGreaterThan(2000);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
  });

  it('SOLO ADITIVO: crea tablas nuevas y no altera ni borra nada existente', () => {
    expect(bloque).not.toMatch(/ALTER TABLE \[dbo\]\.\[chat_message\]\s/i);
    expect(bloque).not.toMatch(/\bDROP\b/i);
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/im);
    expect(bloque).not.toMatch(/event_type/);
    const tablas = bloque.match(/CREATE TABLE \[dbo\]\.\[(\w+)\]/g) ?? [];
    expect(tablas).toEqual([
      'CREATE TABLE [dbo].[chat_sticker]',
      'CREATE TABLE [dbo].[chat_message_media]',
      'CREATE TABLE [dbo].[chat_message_reaction]',
    ]);
    // Los ALTER solo agregan CHECK a las tablas NUEVAS.
    for (const a of bloque.match(/ALTER TABLE \[dbo\]\.\[(\w+)\]/g) ?? []) {
      expect(a).toMatch(/chat_sticker|chat_message_media|chat_message_reaction/);
    }
  });

  it('todo es idempotente', () => {
    const creates = bloque.match(/CREATE (TABLE|NONCLUSTERED INDEX|UNIQUE NONCLUSTERED INDEX)|ADD CONSTRAINT/g) ?? [];
    const guardas = bloque.match(/IF (OBJECT_ID|NOT EXISTS)/g) ?? [];
    expect(creates.length).toBe(13);
    expect(guardas.length).toBeGreaterThanOrEqual(creates.length);
  });

  it('los nombres coinciden con los de Prisma (db push no deja índices repetidos)', () => {
    const schema = leer('prisma/schema.prisma');
    for (const nombre of [
      'chat_message_reaction_message_user_emoji',
      'chat_message_reaction_conversation_id_idx',
      'chat_message_reaction_id_user_idx',
      'chat_message_media_id_sticker_idx',
      'chat_sticker_company_active_idx',
    ]) {
      expect(schema).toContain(`map: "${nombre}"`);
      expect(bloque).toContain(`[${nombre}]`);
    }
  });

  it('la reversa se protege: base permitida y bandera para aceptar pérdidas', () => {
    const reversa = leer('prisma/manual/2026-10-20-chat-reacciones-stickers-reversa.sql');
    expect(reversa).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(reversa).toContain("SESSION_CONTEXT(N'chat_reacciones_reversa_acepta_perdida')");
    // chat_message_media antes que chat_sticker (llave foránea).
    expect(reversa.indexOf('DROP TABLE [dbo].[chat_message_media]')).toBeLessThan(reversa.indexOf('DROP TABLE [dbo].[chat_sticker]'));
    expect(reversa).not.toMatch(/DROP TABLE \[dbo\]\.\[chat_message\]\s*;/);
  });
});

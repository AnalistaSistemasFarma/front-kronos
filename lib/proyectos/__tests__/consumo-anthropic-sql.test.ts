import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Medidor del consumo de Anthropic (2026-10-22): los scripts manuales de PRUEBAS y PROD repiten TAL
 * CUAL el bloque DDL de la migración, cada uno con su guarda de base; nada altera tablas existentes.
 * La CI corre además el SQL de verdad (dos veces, PROD que se niega y la reversa ida y vuelta).
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261022120000_chat_agent_quota/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL del medidor de consumo', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-10-22-chat-agent-quota-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-22-chat-agent-quota-PROD.sql');
    expect(bloque.length).toBeGreaterThan(1000);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('CREATE TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
  });

  it('solo aditivo: una tabla nueva, idempotente, sin ALTER de columnas ni DROP ni datos', () => {
    const creates = bloque.match(/CREATE TABLE|ADD CONSTRAINT/g) ?? [];
    const guardas = bloque.match(/IF (OBJECT_ID|NOT EXISTS)/g) ?? [];
    expect(creates.length).toBe(3); // la tabla y 2 CHECK
    expect(guardas.length).toBeGreaterThanOrEqual(creates.length);
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE|DROP)\b/im);
    expect(bloque).not.toMatch(/ALTER TABLE \[dbo\]\.\[(?!chat_agent_quota\])/);
    expect(bloque).not.toMatch(/ADD \[|ALTER COLUMN/);
    expect(bloque).toMatch(/\[source\] IN \(N''turno'', N''sonda''\)/);
  });

  it('las columnas coinciden con el modelo de Prisma', () => {
    const schema = leer('prisma/schema.prisma');
    const modelo = schema.slice(schema.indexOf('model ChatAgentQuota {'), schema.indexOf('@@map("chat_agent_quota")'));
    for (const c of ['id_agent', 'utilization_7d', 'reset_7d', 'utilization_5h', 'reset_5h', 'overage', 'measured_at', 'source', 'updated_at']) {
      expect(modelo).toContain(c);
      expect(bloque).toContain(`[${c}]`);
    }
  });

  it('la reversa tiene guarda de base y solo quita su tabla', () => {
    const reversa = leer('prisma/manual/2026-10-22-chat-agent-quota-reversa.sql');
    expect(reversa).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(reversa.indexOf('DB_NAME()')).toBeLessThan(reversa.indexOf('DROP TABLE'));
    expect(reversa.match(/DROP TABLE/g)).toHaveLength(1);
    expect(reversa).toMatch(/DROP TABLE \[dbo\]\.\[chat_agent_quota\]/);
  });
});

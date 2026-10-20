import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Los scripts SQL de la hoja de vida completa (2026-10-20): solo agregan, los de
 * PRUEBAS y PROD llevan la migración y el seed LITERALES y se niegan a correr en
 * otra base, y la reversa solo quita lo que este incremento creó.
 */
const raiz = path.resolve(__dirname, '../../..');
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');

const migracion = leer('prisma/migrations/20261020120000_auditoria_hoja_de_vida_completa/migration.sql');
const seed = leer('prisma/seeds/chat-auditoria-hoja-de-vida-olp.sql');
const pruebas = leer('prisma/manual/2026-10-20-hoja-de-vida-completa-PRUEBAS.sql');
const prod = leer('prisma/manual/2026-10-20-hoja-de-vida-completa-PROD.sql');
const reversa = leer('prisma/manual/2026-10-20-hoja-de-vida-completa-reversa.sql');

/**
 * Sentencias sin comentarios (los comentarios explican qué NO se hace) y sin
 * las cláusulas de las llaves foráneas (ON DELETE / ON UPDATE NO ACTION).
 */
function sinComentarios(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .replace(/\bON (DELETE|UPDATE) (NO ACTION|CASCADE)\b/gi, '');
}

describe('SQL de la hoja de vida completa', () => {
  it('la migración y el seed solo agregan (sin DROP, ALTER, TRUNCATE, UPDATE ni DELETE)', () => {
    for (const sql of [migracion, seed]) {
      expect(sinComentarios(sql)).not.toMatch(/\b(DROP|ALTER|TRUNCATE|UPDATE|DELETE)\b/i);
    }
  });

  it('la migración crea exactamente las 4 tablas nuevas', () => {
    const tablas = [...sinComentarios(migracion).matchAll(/CREATE TABLE \[dbo\]\.\[(\w+)\]/g)].map((m) => m[1]).sort();
    expect(tablas).toEqual(['agent_cv_case', 'agent_external_finding', 'agent_governance', 'agent_inventory_runtime']);
  });

  it('PRUEBAS y PROD llevan la migración y el seed literales, con su guarda de base', () => {
    for (const [sql, base] of [
      [pruebas, 'KRONOSDB_PRUEBAS'],
      [prod, 'KRONOSDB'],
    ] as const) {
      expect(sql).toContain(migracion.trim());
      expect(sql).toContain(seed.trim());
      expect(sql).toContain(`IF DB_NAME() <> N'${base}'`);
      expect(sinComentarios(sql)).not.toMatch(/\b(DROP|ALTER|TRUNCATE|UPDATE|DELETE)\b/i);
    }
  });

  it('el seed va por código de agente, nunca por id', () => {
    expect(seed).toMatch(/INNER JOIN \[dbo\]\.\[agent\] a ON a\.code = g\.code/);
    expect(sinComentarios(seed)).not.toMatch(/id_agent\s*=\s*\d/);
  });

  it('la reversa solo quita las 4 tablas nuevas y las entradas nuevas del historial', () => {
    const drops = [...sinComentarios(reversa).matchAll(/DROP TABLE \[dbo\]\.\[(\w+)\]/g)].map((m) => m[1]).sort();
    expect(drops).toEqual(['agent_cv_case', 'agent_external_finding', 'agent_governance', 'agent_inventory_runtime']);
    expect(sinComentarios(reversa)).toMatch(/DELETE FROM \[dbo\]\.\[agent_cv_entry\]\s+WHERE kind IN/);
    expect(sinComentarios(reversa)).not.toMatch(/\bALTER\b|\bTRUNCATE\b|DROP TABLE \[dbo\]\.\[agent\]/i);
  });
});

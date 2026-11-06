import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoriaAgente, nombreSinChoque, nombresDelLote } from '../archivos-agente';

describe('nombres de los archivos del agente (sin pisar los existentes)', () => {
  it('un nombre libre queda igual', () => {
    expect(nombreSinChoque('informe.pdf', new Set(['otro.pdf']))).toBe('informe.pdf');
  });

  it('un nombre ocupado recibe « (2)» antes de la extensión, sin distinguir mayúsculas', () => {
    expect(nombreSinChoque('informe.pdf', new Set(['informe.pdf']))).toBe('informe (2).pdf');
    expect(nombreSinChoque('Informe.PDF', new Set(['informe.pdf']))).toBe('Informe (2).PDF');
  });

  it('sigue contando y salta los ocupados', () => {
    expect(nombreSinChoque('informe.pdf', new Set(['informe.pdf', 'informe (2).pdf', 'informe (3).pdf']))).toBe('informe (4).pdf');
    expect(nombreSinChoque('informe (2).pdf', new Set(['informe (2).pdf']))).toBe('informe (3).pdf');
  });

  it('sin extensión, el sufijo va al final', () => {
    expect(nombreSinChoque('LEEME', new Set(['leeme']))).toBe('LEEME (2)');
  });

  it('respeta el largo máximo sin cortar la extensión', () => {
    const largo = `${'a'.repeat(200)}.pdf`.slice(-200);
    const r = nombreSinChoque(largo, new Set([largo.toLowerCase()]));
    expect(r.length).toBeLessThanOrEqual(200);
    expect(r.endsWith(' (2).pdf')).toBe(true);
  });

  it('el lote no choca ni con lo existente ni consigo mismo', () => {
    expect(nombresDelLote(['a.csv', 'a.csv', 'b.csv'], ['A.csv'])).toEqual(['a (2).csv', 'a (3).csv', 'b.csv']);
  });

  it('texto de autoría', () => {
    expect(autoriaAgente('Orus', 27)).toBe('subido por Orus en la conversación 27');
    expect(autoriaAgente('', null)).toBe('subido por el asistente');
  });
});

/*
 * SQL (2026-10-23): los scripts manuales de PRUEBAS y PROD repiten TAL CUAL el bloque DDL de la
 * migración, cada uno con su guarda de base; solo agrega dos columnas NULL. La CI corre además el
 * SQL de verdad (dos veces, PROD que se niega y la reversa ida y vuelta).
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261023150000_chat_project_file_agente/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL de archivos del agente', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-10-23-chat-project-file-agente-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-10-23-chat-project-file-agente-PROD.sql');
    expect(bloque.length).toBeGreaterThan(300);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(prod).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
    expect(prod.indexOf("NOT IN (N'KRONOSDB')")).toBeLessThan(prod.indexOf('ALTER TABLE'));
    expect(pruebas.indexOf("NOT IN (N'KRONOSDB_PRUEBAS'")).toBeLessThan(pruebas.indexOf('ALTER TABLE'));
  });

  it('solo aditivo: dos columnas NULL, idempotente, sin datos ni DROP', () => {
    const adds = bloque.match(/ALTER TABLE \[dbo\]\.\[chat_project_file\] ADD \[\w+\] INT NULL;/g) ?? [];
    expect(adds).toHaveLength(2);
    expect(bloque.match(/IF COL_LENGTH\(/g)).toHaveLength(2);
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE|DROP)\b/im);
    expect(bloque).not.toMatch(/ALTER COLUMN|NOT NULL/);
  });

  it('las columnas coinciden con el modelo de Prisma', () => {
    const schema = leer('prisma/schema.prisma');
    const modelo = schema.slice(schema.indexOf('model ChatProjectFile {'), schema.indexOf('@@map("chat_project_file")'));
    for (const c of ['uploaded_by_agent', 'id_conversation']) {
      expect(modelo.split('\n').some((l) => l.trim().split(/\s+/).join(' ') === `${c} Int?`)).toBe(true);
      expect(bloque).toContain(`[${c}]`);
    }
  });

  it('la reversa tiene guarda de base, bandera de pérdida y solo quita sus dos columnas', () => {
    const reversa = leer('prisma/manual/2026-10-23-chat-project-file-agente-reversa.sql');
    expect(reversa).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    expect(reversa.indexOf('DB_NAME()')).toBeLessThan(reversa.indexOf('DROP COLUMN'));
    expect(reversa).toContain("SESSION_CONTEXT(N'proyectos_archivos_agente_reversa_acepta_perdida')");
    expect(reversa.match(/DROP COLUMN/g)).toHaveLength(2);
    expect(reversa).not.toMatch(/DROP TABLE/);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CarpetaInvalida, carpetaDeRutaRelativa, carpetaPadre, conPadres, estaDentro, migas, nombreCarpeta, normalizarCarpeta, subcarpetas, unirCarpetas } from '../carpetas';
import { MAX_PROJECT_FILES } from '../../chat/projects-rules';

/** 2026-11-06 (reunión con Juan Mora): carpetas en los Archivos del proyecto. */
describe('Carpetas de los Archivos del proyecto', () => {
  it('normaliza la ruta: sin barras de más ni espacios dobles; vacío = la raíz', () => {
    expect(normalizarCarpeta(' /Autorizaciones INVIMA//  PISA  /')).toBe('Autorizaciones INVIMA/PISA');
    expect(normalizarCarpeta('Fichas   técnicas')).toBe('Fichas técnicas');
    expect(normalizarCarpeta('')).toBeNull();
    expect(normalizarCarpeta('  /  ')).toBeNull();
    expect(normalizarCarpeta(null)).toBeNull();
    expect(normalizarCarpeta(undefined)).toBeNull();
  });

  it('rechaza rutas que se salen de su lugar o que Windows/OneDrive no admite', () => {
    for (const malo of ['A/../B', './A', 'A/.', 'A:B', 'A\\B', 'A*', 'A?', 'A|B', 'A<B', 'A"B', 'A\u0001']) {
      expect(() => normalizarCarpeta(malo)).toThrow(CarpetaInvalida);
    }
    expect(() => normalizarCarpeta(42)).toThrow(/no es válida/);
    expect(() => normalizarCarpeta('x'.repeat(101))).toThrow(/100 caracteres/);
    expect(() => normalizarCarpeta(Array.from({ length: 9 }, (_, i) => `n${i}`).join('/'))).toThrow(/8 niveles/);
    expect(() => normalizarCarpeta(Array.from({ length: 5 }, () => 'y'.repeat(90)).join('/'))).toThrow(/400 caracteres/);
  });

  it('carpeta de un archivo de «Cargar carpeta» y unión con la carpeta actual', () => {
    expect(carpetaDeRutaRelativa('Regulatorio/INVIMA/autorizacion.pdf')).toBe('Regulatorio/INVIMA');
    expect(carpetaDeRutaRelativa('suelto.pdf')).toBeNull();
    expect(carpetaDeRutaRelativa(undefined)).toBeNull();
    expect(unirCarpetas('Codificación', 'Regulatorio/INVIMA')).toBe('Codificación/Regulatorio/INVIMA');
    expect(unirCarpetas(null, 'A')).toBe('A');
    expect(unirCarpetas('A', null)).toBe('A');
    expect(unirCarpetas(null, null)).toBeNull();
  });

  it('padres, nombre, pertenencia, subcarpetas directas y migas de pan', () => {
    expect(conPadres('A/B/C')).toEqual(['A', 'A/B', 'A/B/C']);
    expect(conPadres(null)).toEqual([]);
    expect(carpetaPadre('A/B/C')).toBe('A/B');
    expect(carpetaPadre('A')).toBeNull();
    expect(carpetaPadre(null)).toBeNull();
    expect(nombreCarpeta('A/B/Fichas')).toBe('Fichas');
    expect(estaDentro('A/B', 'A')).toBe(true);
    expect(estaDentro('A', 'A')).toBe(true);
    expect(estaDentro('AB', 'A')).toBe(false);
    expect(estaDentro('A_B/x', 'AxB')).toBe(false);
    expect(estaDentro(null, 'A')).toBe(false);
    const todas = ['Regulatorio', 'Regulatorio/INVIMA', 'Regulatorio/INVIMA/2026', 'Artes', 'Regulatorio/Fichas'];
    expect(subcarpetas(todas, null)).toEqual(['Artes', 'Regulatorio']);
    expect(subcarpetas(todas, 'Regulatorio')).toEqual(['Regulatorio/Fichas', 'Regulatorio/INVIMA']);
    expect(subcarpetas(todas, 'Artes')).toEqual([]);
    expect(migas('Regulatorio/INVIMA')).toEqual([
      { nombre: 'Regulatorio', ruta: 'Regulatorio' },
      { nombre: 'INVIMA', ruta: 'Regulatorio/INVIMA' },
    ]);
  });

  it('un proyecto admite hasta 1000 archivos (repositorio documental)', () => {
    expect(MAX_PROJECT_FILES).toBe(1000);
  });
});

/* SQL: los scripts de PRUEBAS y PROD repiten TAL CUAL el bloque DDL de la migración, con su guarda antes. */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261106120000_chat_project_folders/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL de las carpetas', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    const pruebas = leer('prisma/manual/2026-11-06-chat-project-carpetas-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-11-06-chat-project-carpetas-PROD.sql');
    expect(bloque.length).toBeGreaterThan(500);
    expect(pruebas).toContain(bloque);
    expect(prod).toContain(bloque);
    expect(pruebas.indexOf("IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')")).toBeLessThan(pruebas.indexOf('ALTER TABLE'));
    expect(prod.indexOf("IF DB_NAME() <> N'KRONOSDB'")).toBeLessThan(prod.indexOf('ALTER TABLE'));
  });

  it('solo aditivo e idempotente: una columna NULL, un índice y una tabla nueva; sin datos ni DROP', () => {
    expect(bloque).toContain("ALTER TABLE [dbo].[chat_project_file] ADD [folder_path] NVARCHAR(400) NULL;");
    expect(bloque).toMatch(/IF COL_LENGTH\(N'dbo\.chat_project_file', N'folder_path'\) IS NULL/);
    expect(bloque).toMatch(/IF OBJECT_ID\(N'dbo\.chat_project_folder', N'U'\) IS NULL/);
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE|DROP)\b/im);
    const schema = leer('prisma/schema.prisma');
    expect(schema).toContain('folder_path       String?  @db.NVarChar(400)');
    expect(schema).toContain('@@map("chat_project_folder")');
  });

  it('la reversa se niega sin su bandera si hay carpetas o archivos en carpetas', () => {
    const reversa = leer('prisma/manual/2026-11-06-chat-project-carpetas-reversa.sql');
    expect(reversa).toContain("SESSION_CONTEXT(N'proyectos_carpetas_reversa_acepta_perdida')");
    expect(reversa.indexOf('THROW 51584')).toBeLessThan(reversa.indexOf('DROP TABLE'));
  });
});

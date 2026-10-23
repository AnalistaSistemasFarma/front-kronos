import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VITRINA_SUBPROCESS_NAMES, VITRINA_SUBPROCESS_URLS } from '../constants';

// Vitrina Comercial (2026-10-22): SQL ADITIVO; los pases manuales repiten el bloque de la migración.
describe('Vitrina Comercial — SQL', () => {
  const raiz = join(__dirname, '..', '..', '..', 'prisma');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
  const leer = (f: string) => readFileSync(f, 'utf8');
  const bloque = (s: string) => s.slice(s.indexOf('/* BLOQUE-DDL-INICIO */'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  const mig = leer(join(raiz, 'migrations', '20261022200000_vitrina_comercial', 'migration.sql'));
  const tablas = ['vitrina_presentacion', 'vitrina_codigo_sap', 'vitrina_area', 'vitrina_presentacion_area', 'vitrina_exclusividad', 'vitrina_imagen', 'vitrina_documento', 'vitrina_historial'];

  it('la migración crea solo las 8 tablas nuevas, idempotente y sin borrar ni alterar lo existente', () => {
    const b = bloque(mig);
    for (const t of tablas) {
      expect(b).toContain(`IF OBJECT_ID(N'dbo.${t}', N'U') IS NULL`);
      expect(b).toContain(`CREATE TABLE [dbo].[${t}]`);
    }
    expect([...b.matchAll(/CREATE TABLE \[dbo\]\.\[(\w+)\]/g)].map((m) => m[1])).toEqual(tablas);
    expect(b.replace(/ON (DELETE|UPDATE) NO ACTION/g, '')).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
    // Solo se alteran tablas vitrina_* (llaves foráneas y CHECK).
    for (const m of b.matchAll(/ALTER TABLE \[dbo\]\.\[(\w+)\]/g)) expect(m[1]).toMatch(/^vitrina_/);
    expect(b).toContain("[es_para_terceros] = 0 OR [visibilidad] = ''INTERNA''");
    expect(b).toMatch(/\[activado_vitrina\] BIT NOT NULL CONSTRAINT \[vitrina_codigo_sap_activado_vitrina_df\] DEFAULT 0/);
    expect(b).toMatch(/\[visibilidad_canal\] NVARCHAR\(20\) NOT NULL CONSTRAINT \[\w+\] DEFAULT 'INTERNA'/);
  });

  it('PRUEBAS y PROD repiten el bloque DDL, con su guarda DB_NAME()', () => {
    for (const amb of ['PRUEBAS', 'PROD']) {
      const f = leer(join(raiz, 'manual', `2026-10-22-vitrina-comercial-${amb}.sql`));
      expect(bloque(f)).toBe(bloque(mig));
      expect(f).toMatch(amb === 'PROD' ? /DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/ : /DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    }
  });

  it('los subprocesos coinciden con las constantes, van en Ventas y no otorgan permisos', () => {
    for (const amb of ['PRUEBAS', 'PROD']) {
      const f = leer(join(raiz, 'manual', `2026-10-22-vitrina-subprocesos-${amb}.sql`));
      expect(f).toContain(`(N'${VITRINA_SUBPROCESS_NAMES.consulta}',            N'${VITRINA_SUBPROCESS_URLS.consulta}')`);
      expect(f).toContain(`(N'${VITRINA_SUBPROCESS_NAMES.gestion}',  N'${VITRINA_SUBPROCESS_URLS.gestion}')`);
      expect(f).toContain("@ProcessName NVARCHAR(255) = N'Ventas'");
      expect(f).toContain("N''vitrina_sincronizar_sap''");
      expect(f).not.toMatch(/INSERT INTO \[dbo\]\.\[subprocess_user_company\]/i);
      expect(f).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
      expect(f).toMatch(amb === 'PROD' ? /DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/ : /DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    }
  });

  it('la reversa tiene guarda, pide bandera si hay datos y solo quita lo de la Vitrina', () => {
    const r = leer(join(raiz, 'manual', '2026-10-22-vitrina-comercial-reversa.sql'));
    expect(r).toContain('DB_NAME() NOT IN');
    expect(r).toContain("SESSION_CONTEXT(N'vitrina_reversa_acepta_perdida')");
    expect([...r.matchAll(/DROP TABLE \[dbo\]\.\[(\w+)\]/g)].map((m) => m[1]).sort()).toEqual([...tablas].sort());
    expect(r).not.toMatch(/\bTRUNCATE\b/i);
  });
});

// Vitrina (2026-10-23): líneas comerciales y grupos terapéuticos. Solo objetos NUEVOS.
describe('Vitrina Comercial — SQL de líneas y grupos (2026-10-23)', () => {
  const raiz = join(__dirname, '..', '..', '..', 'prisma');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
  const leer = (f: string) => readFileSync(f, 'utf8');
  const bloque = (s: string) => s.slice(s.indexOf('/* BLOQUE-DDL-INICIO */'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  const mig = leer(join(raiz, 'migrations', '20261023120000_vitrina_lineas_grupos', 'migration.sql'));
  const manual = (amb: string) => leer(join(raiz, 'manual', `2026-10-23-vitrina-lineas-grupos-${amb}.sql`));
  const tablas = ['vitrina_linea_comercial', 'vitrina_grupo_terapeutico', 'vitrina_presentacion_grupo'];
  /** Texto de los comentarios de bloque de primer nivel (para buscar aperturas anidadas). */
  const comentarios = (s: string) => [...s.matchAll(/\/\*([\s\S]*?)\*\//g)].map((m) => m[1]);

  it('crea solo 3 tablas nuevas y 2 columnas nuevas NULL; idempotente; sin DROP ni cambios a columnas existentes', () => {
    const b = bloque(mig);
    expect(b.length).toBeGreaterThan(500);
    expect([...b.matchAll(/CREATE TABLE \[dbo\]\.\[(\w+)\]/g)].map((m) => m[1])).toEqual(tablas);
    for (const t of tablas) expect(b).toContain(`IF OBJECT_ID(N'dbo.${t}', N'U') IS NULL`);
    expect(b.replace(/ON (DELETE|UPDATE) NO ACTION/g, '')).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
    for (const m of b.matchAll(/ALTER TABLE \[dbo\]\.\[(\w+)\]/g)) expect(m[1]).toMatch(/^vitrina_/);
    // Las únicas columnas agregadas a tablas existentes son NULL y van con su guarda.
    const adds = [...b.matchAll(/ALTER TABLE \[dbo\]\.\[(\w+)\] ADD \[(\w+)\] ([^;]+);/g)].map((m) => `${m[1]}.${m[2]} ${m[3]}`);
    expect(adds).toEqual(['vitrina_presentacion.id_linea INT NULL', 'vitrina_codigo_sap.items_group_name NVARCHAR(100) NULL']);
    expect(b).toContain("IF COL_LENGTH(N'dbo.vitrina_presentacion', N'id_linea') IS NULL");
    expect(b).toContain("IF COL_LENGTH(N'dbo.vitrina_codigo_sap', N'items_group_name') IS NULL");
    expect(b).toContain('UNIQUE NONCLUSTERED ([id_company],[nombre])');
    expect(b).toContain('[vitrina_presentacion_id_linea_fkey]');
  });

  it('PRUEBAS y PROD repiten el bloque, tienen su guarda y su semilla idempotente', () => {
    for (const amb of ['PRUEBAS', 'PROD']) {
      const f = manual(amb);
      expect(bloque(f)).toBe(bloque(mig));
      expect(f).toMatch(amb === 'PROD' ? /DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/ : /DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
      for (const g of ['Antibióticos', 'Analgésicos', 'Sedación y anestesia', 'Cardiovasculares', 'Corticoides', 'Soluciones y electrolitos', 'Vitaminas']) expect(f).toContain(`N''${g}''`);
      expect(f).toContain("(1, N''Antibióticos inyectables'', 10), (2, N''Inyectables hospitalarios'', 10)");
      expect(f).toContain('WHERE NOT EXISTS (SELECT 1 FROM [dbo].[vitrina_grupo_terapeutico] t WHERE t.nombre = g.nombre)');
      expect(f).toContain('AND NOT EXISTS (SELECT 1 FROM [dbo].[vitrina_linea_comercial] t WHERE t.id_company = l.id_company AND t.nombre = l.nombre)');
      expect(f.replace(/ON (DELETE|UPDATE) NO ACTION/g, '')).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
      expect(f).not.toMatch(/INSERT INTO \[dbo\]\.\[vitrina_presentacion_grupo\]/);
    }
  });

  it('el de PRUEBAS solo nombra la base de producción en la guarda DB_NAME()', () => {
    const lineas = manual('PRUEBAS').split('\n').filter((l) => /KRONOSDB/.test(l));
    expect(lineas).toEqual(["IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')"]);
  });

  it('ningún comentario abre otro comentario (T-SQL los anida)', () => {
    for (const f of [mig, manual('PRUEBAS'), manual('PROD'), leer(join(raiz, 'manual', '2026-10-23-vitrina-lineas-grupos-reversa.sql'))]) {
      for (const c of comentarios(f)) expect(c).not.toContain('/*');
    }
  });

  it('la reversa tiene guarda, pide su bandera si hay asignaciones y solo quita lo suyo', () => {
    const r = leer(join(raiz, 'manual', '2026-10-23-vitrina-lineas-grupos-reversa.sql'));
    expect(r).toContain('DB_NAME() NOT IN');
    expect(r).toContain("SESSION_CONTEXT(N'vitrina_lineas_reversa_acepta_perdida')");
    expect([...r.matchAll(/DROP TABLE \[dbo\]\.\[(\w+)\]/g)].map((m) => m[1]).sort()).toEqual([...tablas].sort());
    expect([...r.matchAll(/DROP COLUMN \[(\w+)\]/g)].map((m) => m[1])).toEqual(['id_linea', 'items_group_name']);
    expect(r).not.toMatch(/\bTRUNCATE\b|DROP TABLE \[dbo\]\.\[vitrina_(presentacion|codigo_sap|area|historial)\]/i);
  });
});

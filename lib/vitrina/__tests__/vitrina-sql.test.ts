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

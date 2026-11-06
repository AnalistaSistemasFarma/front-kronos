import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Módulo Formación (2026-10-26): el SQL del pase manual es ADITIVO y repite el bloque de la migración.
describe('Formación · módulo — SQL', () => {
  const raiz = join(__dirname, '..', '..', '..', 'prisma');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
  const leer = (f: string) => readFileSync(f, 'utf8');
  const bloque = (f: string) => {
    const s = leer(f);
    return s.slice(s.indexOf('/* BLOQUE-DDL-INICIO */'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  };
  const mig = bloque(join(raiz, 'migrations', '20261026120000_formacion_modulo', 'migration.sql'));

  it('la migración solo agrega (columna nullable y tablas nuevas)', () => {
    expect(mig).toContain('ALTER TABLE [dbo].[portal_course] ADD [id_company_owner] INT NULL');
    for (const t of ['formacion_empresa_departamento', 'formacion_colaborador', 'formacion_curso_alcance', 'formacion_divulgacion', 'formacion_divulgacion_destinatario']) {
      expect(mig).toContain(`CREATE TABLE [dbo].[${t}]`);
    }
    expect(mig).not.toMatch(/\b(DROP|UPDATE|TRUNCATE)\b|DELETE\s+FROM/i);
  });

  it('PRUEBAS y PROD repiten el bloque DDL y tienen su guarda DB_NAME()', () => {
    for (const amb of ['PRUEBAS', 'PROD']) {
      const f = join(raiz, 'manual', `2026-10-26-formacion-modulo-${amb}.sql`);
      expect(bloque(f)).toBe(mig);
      expect(leer(f)).toMatch(amb === 'PROD' ? /DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/ : /DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
      expect(leer(f)).toContain("N'/process/formacion'");
    }
  });

  it('la reversa tiene guarda y quita solo lo del módulo', () => {
    const r = leer(join(raiz, 'manual', '2026-10-26-formacion-modulo-reversa.sql'));
    expect(r).toContain('DB_NAME() NOT IN');
    expect(r).toContain("subprocess_url = N'/process/formacion'");
    expect(r).not.toMatch(/DROP TABLE \[dbo\]\.\[portal_course\]/);
  });
});

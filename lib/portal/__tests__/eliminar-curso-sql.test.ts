import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Formación · «Eliminar curso» (2026-10-22): el SQL del pase manual es ADITIVO y repite el bloque de la migración.
describe('Formación · «Eliminar curso» — SQL', () => {
  const raiz = join(__dirname, '..', '..', '..', 'prisma');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
  const leer = (f: string) => readFileSync(f, 'utf8');
  const bloque = (f: string) => {
    const s = leer(f);
    return s.slice(s.indexOf('/* BLOQUE-DDL-INICIO */'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  };

  it('PRUEBAS y PROD repiten el bloque DDL de la migración, con su guarda DB_NAME()', () => {
    const mig = bloque(join(raiz, 'migrations', '20261022140000_portal_curso_eliminado', 'migration.sql'));
    expect(mig).toContain('ALTER TABLE [dbo].[portal_course] ADD [eliminado_at] DATETIME2 NULL');
    expect(mig).toContain('ALTER TABLE [dbo].[portal_course] ADD [eliminado_por] NVARCHAR(255) NULL');
    // Aditivo: no borra, no actualiza, no quita columnas.
    expect(mig).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
    for (const amb of ['PRUEBAS', 'PROD']) {
      const f = join(raiz, 'manual', `2026-10-22-portal-curso-eliminado-${amb}.sql`);
      expect(bloque(f)).toBe(mig);
      expect(leer(f)).toMatch(amb === 'PROD' ? /DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/ : /DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    }
  });

  it('la reversa tiene guarda DB_NAME() y solo quita las dos columnas nuevas', () => {
    const reversa = leer(join(raiz, 'manual', '2026-10-22-portal-curso-eliminado-reversa.sql'));
    expect(reversa).toContain('DB_NAME() NOT IN');
    expect([...reversa.matchAll(/DROP COLUMN (\S+?);/g)].map((m) => m[1])).toEqual(['[eliminado_por]', '[eliminado_at]']);
    expect(reversa).not.toMatch(/\b(DROP TABLE|DELETE FROM|UPDATE|TRUNCATE)\b/i);
  });
});

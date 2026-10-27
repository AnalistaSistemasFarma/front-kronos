import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Formación · preguntas y respuestas (2026-10-26): SQL aditivo y PRUEBAS/PROD iguales a la migración.
describe('Formación · preguntas — SQL', () => {
  const raiz = join(__dirname, '..', '..', '..', 'prisma');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
  const leer = (f: string) => readFileSync(f, 'utf8');
  const bloque = (f: string) => {
    const s = leer(f);
    return s.slice(s.indexOf('/* BLOQUE-DDL-INICIO */'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  };
  const mig = bloque(join(raiz, 'migrations', '20261026150000_formacion_preguntas', 'migration.sql'));

  it('solo crea las dos tablas nuevas', () => {
    expect(mig).toContain('CREATE TABLE [dbo].[formacion_pregunta]');
    expect(mig).toContain('CREATE TABLE [dbo].[formacion_pregunta_like]');
    expect(mig).not.toMatch(/\b(DROP|UPDATE|TRUNCATE|ALTER)\b|DELETE\s+FROM/i);
  });

  it('PRUEBAS y PROD repiten el bloque con su guarda', () => {
    for (const amb of ['PRUEBAS', 'PROD']) {
      const f = join(raiz, 'manual', `2026-10-26-formacion-preguntas-${amb}.sql`);
      expect(bloque(f)).toBe(mig);
      expect(leer(f)).toMatch(amb === 'PROD' ? /DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/ : /DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)/);
    }
  });
});

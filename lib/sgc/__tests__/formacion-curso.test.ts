import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { courseProgress, enrollInLinkedCourse } from '../db/trainingCourse';

/** Capacitación del SGC con un curso de Formación (2026-11-26, Calidad OLP). */
function fakeDb(linked: boolean) {
  const enrolled = [{ course_id: 5, student_email: 'ya@olp.com' }];
  return {
    enrolled,
    sgcRequest: { findUnique: vi.fn(async () => ({ tasks: [{ id_task: 1, taskDef: { role: 'material' } }] })) },
    sgcTraining: { findFirst: vi.fn(async () => ({ id_training: 9 })), findUnique: vi.fn(async () => ({ id_training: 9 })) },
    sgcTrainingCourse: { findUnique: vi.fn(async () => (linked ? { id_training: 9, course_id: 5 } : null)) },
    portalCourse: { findUnique: vi.fn(async () => ({ id: 5, title: 'Sanitización de equipos' })) },
    portalCourseEnrollment: {
      findMany: vi.fn(async ({ where }: { where: { student_email: { in: string[] } } }) => enrolled.filter((e) => where.student_email.in.includes(e.student_email))),
      createMany: vi.fn(async ({ data }: { data: { course_id: number; student_email: string }[] }) => (enrolled.push(...data), { count: data.length })),
    },
    portalCourseMaterial: { findMany: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]) },
    portalMaterialProgress: { findMany: vi.fn(async () => [{ student_email: 'A@olp.com' }, { student_email: 'a@olp.com' }, { student_email: 'b@olp.com' }]) },
    portalCertificate: { findMany: vi.fn(async () => [{ student_email: 'a@olp.com' }]) },
  };
}

describe('SGC · capacitación con curso de Formación', () => {
  it('la divulgación queda inscrita en el curso ligado, sin repetir inscripciones; sin curso no inscribe', async () => {
    const db = fakeDb(true);
    expect(await enrollInLinkedCourse(db as never, 1, ['Nuevo@OLP.com', 'ya@olp.com', 'nuevo@olp.com', 'sin-arroba'])).toBe(1);
    expect(db.enrolled.map((e) => e.student_email)).toEqual(['ya@olp.com', 'nuevo@olp.com']);
    expect(await enrollInLinkedCourse(fakeDb(false) as never, 1, ['x@olp.com'])).toBe(0);
  });

  it('avance = materiales completados / total; certificado por persona', async () => {
    const p = await courseProgress(fakeDb(true) as never, 5, ['a@olp.com', 'b@olp.com', 'c@olp.com']);
    expect(Object.fromEntries(p)).toEqual({ 'a@olp.com': { pct: 50, certified: true }, 'b@olp.com': { pct: 25, certified: false }, 'c@olp.com': { pct: 0, certified: false } });
  });

  it('SQL: tabla en dbo (fuera del esquema validado), bloque idéntico, guarda y reversa con bandera', () => {
    const root = path.resolve(__dirname, '../../..');
    const leer = (p: string) => readFileSync(path.join(root, p), 'utf8');
    const bloque = (s: string) => s.slice(s.indexOf('SET XACT_ABORT ON;'), s.indexOf('/* BLOQUE-DDL-FIN */'));
    const mig = leer('prisma/migrations/20261126180000_formacion_curso_capacitacion/migration.sql');
    const pd = leer('prisma/manual/2026-11-26-sgc-formacion-curso-PROD.sql');
    expect(bloque(pd)).toBe(bloque(mig));
    expect(bloque(leer('prisma/manual/2026-11-26-sgc-formacion-curso-PRUEBAS.sql'))).toBe(bloque(mig));
    expect(bloque(mig)).not.toMatch(/\[sgc\]\.|\bsgc\./);
    expect(pd.indexOf("DB_NAME() <> N'KRONOSDB'")).toBeLessThan(pd.indexOf('SET XACT_ABORT ON;'));
    expect(leer('prisma/manual/2026-11-26-sgc-formacion-curso-reversa.sql')).toContain("SESSION_CONTEXT(N'sgc_formacion_reversa_acepta_perdida')");
  });
});

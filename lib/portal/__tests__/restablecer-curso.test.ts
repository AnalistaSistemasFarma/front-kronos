import { beforeEach, describe, expect, it, vi } from 'vitest';

// Restablecer un curso para un estudiante (Cristian Baldión, 2026-10-14). Base SIMULADA.

const { prisma } = vi.hoisted(() => ({
  prisma: {
    portalCourseEnrollment: { findUnique: vi.fn() },
    portalCourseMaterial: { findMany: vi.fn() },
    portalMaterialProgress: { deleteMany: vi.fn() },
    portalFormularioRespuesta: { deleteMany: vi.fn() },
    portalCertificate: { deleteMany: vi.fn() },
    portalFormularioIntento: { deleteMany: vi.fn() },
    portalCourseEnrollmentDelete: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('../../prisma', () => ({ prisma }));

import { restablecerCursoDeEstudiante } from '../restablecer-curso';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.portalCourseEnrollment.findUnique.mockResolvedValue({ id: 1 });
  prisma.portalCourseMaterial.findMany.mockResolvedValue([{ id: 4 }, { id: 5 }, { id: 9 }]);
  prisma.portalMaterialProgress.deleteMany.mockReturnValue({ op: 'progreso' });
  prisma.portalFormularioRespuesta.deleteMany.mockReturnValue({ op: 'respuestas' });
  prisma.portalCertificate.deleteMany.mockReturnValue({ op: 'certificado' });
  prisma.$transaction.mockResolvedValue([{ count: 3 }, { count: 1 }, { count: 1 }]);
});

describe('restablecerCursoDeEstudiante', () => {
  it('borra progreso, respuestas de formularios y certificado de ESE estudiante en ESE curso, en una transacción', async () => {
    const r = await restablecerCursoDeEstudiante(2, 'ana@gsslatam.com');
    expect(r).toEqual({ progresos: 3, respuestas: 1, certificados: 1 });
    expect(prisma.portalMaterialProgress.deleteMany).toHaveBeenCalledWith({ where: { student_email: 'ana@gsslatam.com', material_id: { in: [4, 5, 9] } } });
    expect(prisma.portalFormularioRespuesta.deleteMany).toHaveBeenCalledWith({ where: { student_email: 'ana@gsslatam.com', material_id: { in: [4, 5, 9] } } });
    expect(prisma.portalCertificate.deleteMany).toHaveBeenCalledWith({ where: { course_id: 2, student_email: 'ana@gsslatam.com' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect((prisma.$transaction.mock.calls[0][0] as unknown[]).length).toBe(3);
  });

  it('incluye los materiales ya eliminados del curso (no filtra por eliminado_at)', async () => {
    await restablecerCursoDeEstudiante(2, 'ana@gsslatam.com');
    expect(prisma.portalCourseMaterial.findMany).toHaveBeenCalledWith({ where: { course_id: 2 }, select: { id: true } });
  });

  it('CONSERVA la inscripción y el historial de intentos (no los toca)', async () => {
    await restablecerCursoDeEstudiante(2, 'ana@gsslatam.com');
    expect(prisma.portalFormularioIntento.deleteMany).not.toHaveBeenCalled();
  });

  it('si no está inscrito: null y no borra nada', async () => {
    prisma.portalCourseEnrollment.findUnique.mockResolvedValue(null);
    expect(await restablecerCursoDeEstudiante(2, 'otro@gsslatam.com')).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.portalMaterialProgress.deleteMany).not.toHaveBeenCalled();
  });
});

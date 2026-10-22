import { beforeEach, describe, expect, it, vi } from 'vitest';

// Eliminar un curso (Cristian Baldión, 2026-10-22): permisos del endpoint y que el curso eliminado no aparezca.
// Sesión y base SIMULADAS.

const FORMADOR = 'formador@gsslatam.com';
const { identificar, puedeMarcarManual, prisma } = vi.hoisted(() => ({
  identificar: vi.fn(),
  puedeMarcarManual: vi.fn(),
  prisma: {
    portalCourse: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    portalCourseEnrollment: { count: vi.fn(), upsert: vi.fn() },
    portalCertificate: { count: vi.fn(), findUnique: vi.fn() },
    portalMaterialProgress: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/portal/permisos-formacion', () => ({ puedeMarcarManual }));

import { NextRequest } from 'next/server';
import { DELETE as eliminar, GET as detalle, PATCH as editar } from '../[id]/route';
import { GET as listar } from '../route';

const req = (method: string, ruta = '/api/portal/courses/2', body?: unknown) =>
  new NextRequest(new URL(ruta, 'http://localhost'), {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  process.env.PORTAL_TH_FORMADORES = FORMADOR;
  identificar.mockResolvedValue({ correo: FORMADOR, via: 'codigo' });
  puedeMarcarManual.mockResolvedValue(false);
  prisma.portalCourse.findFirst.mockResolvedValue({ id: 2, title: 'Inducción SST' });
  prisma.portalCourse.updateMany.mockResolvedValue({ count: 1 });
  prisma.portalCourseEnrollment.count.mockResolvedValue(5);
  prisma.portalCertificate.count.mockResolvedValue(2);
});

describe('DELETE /api/portal/courses/:id', () => {
  it('un formador elimina: borrado lógico (eliminado_at, eliminado_por, borrador) y responde con los conteos', async () => {
    const r = await eliminar(req('DELETE'), p('2'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, curso: { id: 2, titulo: 'Inducción SST' }, inscritos: 5, certificados: 2 });
    expect(prisma.portalCourse.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.portalCourse.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: 2, eliminado_at: null });
    expect(data).toMatchObject({ eliminado_por: FORMADOR, active: false });
    expect(data.eliminado_at).toBeInstanceOf(Date);
  });

  it('nunca borra filas: ni el curso, ni inscripciones, ni certificados', async () => {
    // La base simulada NO tiene delete/deleteMany: si la ruta los llamara, fallaría con 500.
    const r = await eliminar(req('DELETE'), p('2'));
    expect(r.status).toBe(200);
    expect(prisma.portalCourse.update).not.toHaveBeenCalled();
  });

  it('quien no es formador: 403 y no toca nada (aunque esté en el Excel de permisos)', async () => {
    identificar.mockResolvedValue({ correo: 'estudiante@gsslatam.com', via: 'codigo' });
    puedeMarcarManual.mockResolvedValue(true);
    const r = await eliminar(req('DELETE'), p('2'));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/formador/);
    expect(prisma.portalCourse.findFirst).not.toHaveBeenCalled();
    expect(prisma.portalCourse.updateMany).not.toHaveBeenCalled();
  });

  it('sin sesión: 401', async () => {
    identificar.mockResolvedValue(null);
    expect((await eliminar(req('DELETE'), p('2'))).status).toBe(401);
    expect(prisma.portalCourse.updateMany).not.toHaveBeenCalled();
  });

  it('id inválido: 400; curso inexistente o ya eliminado: 404', async () => {
    for (const id of ['x', '0', '-1', '1.5']) expect((await eliminar(req('DELETE'), p(id))).status, id).toBe(400);
    prisma.portalCourse.findFirst.mockResolvedValue(null);
    expect((await eliminar(req('DELETE'), p('2'))).status).toBe(404);
    prisma.portalCourse.findFirst.mockResolvedValue({ id: 2, title: 'X' });
    prisma.portalCourse.updateMany.mockResolvedValue({ count: 0 }); // otro formador lo eliminó primero
    expect((await eliminar(req('DELETE'), p('2'))).status).toBe(404);
  });

  it('error de base: 500 sin detalles y sin correos en los registros', async () => {
    prisma.portalCourse.updateMany.mockRejectedValue(new Error('Invalid prisma invocation formador@gsslatam.com'));
    const r = await eliminar(req('DELETE'), p('2'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/prisma|formador@/);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('formador@');
  });
});

describe('Un curso eliminado no aparece', () => {
  it('la lista excluye eliminado_at para formadores y estudiantes', async () => {
    prisma.portalCourse.findMany.mockResolvedValue([]);
    await listar(req('GET', '/api/portal/courses'));
    expect(prisma.portalCourse.findMany.mock.calls[0][0].where).toEqual({ eliminado_at: null });

    identificar.mockResolvedValue({ correo: 'estudiante@gsslatam.com', via: 'codigo' });
    await listar(req('GET', '/api/portal/courses'));
    expect(prisma.portalCourse.findMany.mock.calls[1][0].where).toEqual({ active: true, eliminado_at: null });
  });

  it('el detalle de un curso eliminado da 404, y no se puede editar ni volver a publicar', async () => {
    prisma.portalCourse.findUnique.mockResolvedValue(null);
    expect((await detalle(req('GET'), p('2'))).status).toBe(404);
    expect(prisma.portalCourse.findUnique.mock.calls[0][0].where).toEqual({ id: 2, eliminado_at: null });
    expect(prisma.portalCourseEnrollment.upsert).not.toHaveBeenCalled();

    const r = await editar(req('PATCH', '/api/portal/courses/2', { activo: true }), p('2'));
    expect(r.status).toBe(404);
    expect(prisma.portalCourse.findUnique.mock.calls[1][0].where).toEqual({ id: 2, eliminado_at: null });
    expect(prisma.portalCourse.update).not.toHaveBeenCalled();
  });

  it('el detalle para el formador trae los conteos de la confirmación', async () => {
    prisma.portalCourse.findUnique.mockResolvedValue({ id: 2, title: 'Inducción SST', description: null, active: true, created_by: FORMADOR, materials: [] });
    prisma.portalMaterialProgress.findMany.mockResolvedValue([]);
    prisma.portalCertificate.findUnique.mockResolvedValue(null);
    const r = await detalle(req('GET'), p('2'));
    expect(r.status).toBe(200);
    expect((await r.json()).conteos).toEqual({ inscritos: 5, certificados: 2 });
  });
});

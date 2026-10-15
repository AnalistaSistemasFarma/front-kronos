import { beforeEach, describe, expect, it, vi } from 'vitest';

// Invitar a un curso (Cristian Baldión, 2026-10-14): permisos, validación, envío e inscripción. Sesión, base y correo SIMULADOS.

const FORMADOR = 'formador@gsslatam.com';
const EXCEL = 'admin.excel@gsslatam.com';
const { identificar, puedeMarcarManual, correoAutorizado, prisma, enviarInvitacionCurso } = vi.hoisted(() => ({
  identificar: vi.fn(),
  puedeMarcarManual: vi.fn(),
  correoAutorizado: vi.fn(),
  enviarInvitacionCurso: vi.fn(),
  prisma: {
    portalCourse: { findUnique: vi.fn() },
    portalCourseEnrollment: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/portal/permisos-formacion', () => ({ puedeMarcarManual }));
vi.mock('@/lib/portal/auth', async (original) => ({ ...(await original<typeof import('@/lib/portal/auth')>()), correoAutorizado }));
vi.mock('@/lib/portal/formacion', () => ({ nombreDesdeCorreo: (c: string) => c.split('@')[0] }));
vi.mock('@/lib/portal/invitar-curso', async (original) => ({ ...(await original<typeof import('@/lib/portal/invitar-curso')>()), enviarInvitacionCurso }));

import { NextRequest } from 'next/server';
import { _reiniciarLimitesInvitacion } from '@/lib/portal/invitar-curso';
import { POST as invitar } from '../[id]/invitar/route';

const post = (body: unknown) =>
  new NextRequest(new URL('/api/portal/courses/2/invitar', 'http://localhost'), {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  _reiniciarLimitesInvitacion();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  process.env.PORTAL_TH_FORMADORES = FORMADOR;
  process.env.PORTAL_TH_URL_PUBLICA = 'https://portal.gsslatam.com';
  identificar.mockResolvedValue({ correo: FORMADOR, via: 'codigo' });
  puedeMarcarManual.mockResolvedValue(false);
  correoAutorizado.mockResolvedValue(true);
  enviarInvitacionCurso.mockResolvedValue(undefined);
  prisma.portalCourse.findUnique.mockResolvedValue({ id: 2, title: 'INDUCCIÓN SST', active: true });
  prisma.portalCourseEnrollment.findUnique.mockResolvedValue(null);
  prisma.portalCourseEnrollment.upsert.mockResolvedValue({ id: 1 });
});

describe('POST /api/portal/courses/:id/invitar', () => {
  it('sin sesión: 401; sin permiso: 403 y no envía nada', async () => {
    identificar.mockResolvedValue(null);
    expect((await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'))).status).toBe(401);
    identificar.mockResolvedValue({ correo: 'estudiante@gsslatam.com', via: 'codigo' });
    const r = await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'));
    expect(r.status).toBe(403);
    expect(enviarInvitacionCurso).not.toHaveBeenCalled();
    expect(prisma.portalCourseEnrollment.upsert).not.toHaveBeenCalled();
  });

  it('un formador del portal puede invitar; también quien está en el Excel de administradores', async () => {
    expect((await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'))).status).toBe(200);
    identificar.mockResolvedValue({ correo: EXCEL, via: 'codigo' });
    puedeMarcarManual.mockResolvedValue(true);
    expect((await invitar(post({ correo: 'luis@gsslatam.com' }), p('2'))).status).toBe(200);
  });

  it('envía el correo con el enlace al curso e inscribe a la persona', async () => {
    const r = await invitar(post({ correo: '  Ana.Gomez@GSSLATAM.com ' }), p('2'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, correo: 'ana.gomez@gsslatam.com', yaInscrito: false });
    expect(enviarInvitacionCurso).toHaveBeenCalledWith({
      correo: 'ana.gomez@gsslatam.com',
      cursoTitulo: 'INDUCCIÓN SST',
      urlCurso: 'https://portal.gsslatam.com/portal/formacion?curso=2',
      invitadoPor: 'formador',
    });
    expect(prisma.portalCourseEnrollment.upsert).toHaveBeenCalledWith({
      where: { course_id_student_email: { course_id: 2, student_email: 'ana.gomez@gsslatam.com' } },
      update: {},
      create: { course_id: 2, student_email: 'ana.gomez@gsslatam.com' },
    });
  });

  it('si ya estaba inscrita, lo dice (la invitación se reenvía igual)', async () => {
    prisma.portalCourseEnrollment.findUnique.mockResolvedValue({ id: 9 });
    expect((await (await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'))).json()).yaInscrito).toBe(true);
  });

  it('valida: curso inválido, correo vacío o malo, JSON malo → 400 sin enviar', async () => {
    for (const id of ['x', '0', '-1']) expect((await invitar(post({ correo: 'ana@gsslatam.com' }), p(id))).status, id).toBe(400);
    for (const b of [{}, { correo: '' }, { correo: 'sin-arroba' }, { correo: 5 }, 'no es json']) expect((await invitar(post(b), p('2'))).status).toBe(400);
    expect(enviarInvitacionCurso).not.toHaveBeenCalled();
  });

  it('un correo que no puede entrar al portal: 422, sin enviar ni inscribir', async () => {
    correoAutorizado.mockResolvedValue(false);
    const r = await invitar(post({ correo: 'alguien@gmail.com' }), p('2'));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/no está autorizado para entrar al portal/);
    expect(enviarInvitacionCurso).not.toHaveBeenCalled();
    expect(prisma.portalCourseEnrollment.upsert).not.toHaveBeenCalled();
  });

  it('curso inexistente: 404; curso en borrador: 409 (la persona no lo vería)', async () => {
    prisma.portalCourse.findUnique.mockResolvedValue(null);
    expect((await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'))).status).toBe(404);
    prisma.portalCourse.findUnique.mockResolvedValue({ id: 2, title: 'X', active: false });
    const r = await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/borrador/);
    expect(enviarInvitacionCurso).not.toHaveBeenCalled();
  });

  it('dos invitaciones seguidas a la misma persona: la segunda es 429', async () => {
    expect((await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'))).status).toBe(200);
    const r = await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/Ya le envió una invitación/);
    expect(enviarInvitacionCurso).toHaveBeenCalledTimes(1);
  });

  it('sin dirección pública configurada: 503 y no envía', async () => {
    for (const k of ['PORTAL_TH_URL_PUBLICA', 'NEXT_PUBLIC_APP_URL', 'APP_URL', 'NEXTAUTH_URL']) vi.stubEnv(k, '');
    const r = await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'));
    vi.unstubAllEnvs();
    expect(r.status).toBe(503);
    expect(enviarInvitacionCurso).not.toHaveBeenCalled();
  });

  it('si el correo no sale: 502, NO se inscribe y NO gasta el tope (se puede reintentar)', async () => {
    enviarInvitacionCurso.mockRejectedValueOnce(new Error('El servicio de correo respondió 500.'));
    const r = await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'));
    expect(r.status).toBe(502);
    expect(prisma.portalCourseEnrollment.upsert).not.toHaveBeenCalled();
    expect((await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'))).status).toBe(200);
  });

  it('no escribe el correo del destinatario en los registros (éxito ni error)', async () => {
    await invitar(post({ correo: 'ana@gsslatam.com' }), p('2'));
    prisma.portalCourse.findUnique.mockRejectedValueOnce(Object.assign(new Error('Invalid prisma invocation: ana@gsslatam.com'), { name: 'PrismaClientKnownRequestError' }));
    const r = await invitar(post({ correo: 'luis@gsslatam.com' }), p('2'));
    expect(r.status).toBe(502);
    const todo = JSON.stringify([...(console.info as unknown as { mock: { calls: unknown[] } }).mock.calls, ...(console.error as unknown as { mock: { calls: unknown[] } }).mock.calls]);
    expect(todo).not.toMatch(/ana@|luis@/);
  });
});

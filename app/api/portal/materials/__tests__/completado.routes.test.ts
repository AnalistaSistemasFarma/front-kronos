import { beforeEach, describe, expect, it, vi } from 'vitest';

// Formación — completado automático y marcado manual (Cristian, 2026-10-08),
// con sesión, base, permisos (Excel) y cálculo de progreso SIMULADOS.

const { identificar, puedeMarcarManual, marcarMaterialCompletado, recalcularProgresoDeMaterial, contarPaginasPdf, prisma } =
  vi.hoisted(() => ({
    identificar: vi.fn(),
    puedeMarcarManual: vi.fn(),
    marcarMaterialCompletado: vi.fn(),
    recalcularProgresoDeMaterial: vi.fn(),
    contarPaginasPdf: vi.fn(),
    prisma: {
      portalCourseMaterial: { findFirst: vi.fn(), findUnique: vi.fn() },
      portalMaterialProgress: { deleteMany: vi.fn(), findUnique: vi.fn() },
      portalMaterialVista: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    },
  }));

vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/portal/permisos-formacion', async (original) => {
  const real = await original<typeof import('@/lib/portal/permisos-formacion')>();
  return { ...real, puedeMarcarManual };
});
vi.mock('@/lib/portal/formacion', () => ({ marcarMaterialCompletado, recalcularProgresoDeMaterial, contarPaginasPdf }));

import { NextRequest } from 'next/server';
import { DELETE as desmarcar, POST as marcar } from '../[materialId]/progress/route';
import { POST as abrir } from '../[materialId]/vista/route';
import { POST as reportar } from '../[materialId]/vista/[token]/route';

const TOKEN = '11111111-2222-4333-8444-555555555555';
const ESTUDIANTE = 'estudiante@gsslatam.com';

const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(new URL(url, 'http://localhost'), {
    method: init?.method ?? 'POST',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
const p = (materialId: string) => ({ params: Promise.resolve({ materialId }) });
const pt = (materialId: string, token = TOKEN) => ({ params: Promise.resolve({ materialId, token }) });

function vistaAbierta(haceSegundos: number, extra: Record<string, unknown> = {}) {
  return {
    material_id: 7,
    student_email: ESTUDIANTE,
    abierta_at: new Date(Date.now() - haceSegundos * 1000),
    paginas: null,
    aceptada: null,
    material: { type: 'DOCUMENT', mime: 'video/mp4', eliminado_at: null },
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: ESTUDIANTE, via: 'codigo' });
  recalcularProgresoDeMaterial.mockResolvedValue({ porcentaje: 100, certificado: null });
  prisma.portalCourseMaterial.findFirst.mockResolvedValue({
    id: 7,
    type: 'DOCUMENT',
    mime: 'video/mp4',
    sp_drive_item_id: 'X',
    file_size: BigInt(10),
    course: { active: true },
  });
  prisma.portalMaterialProgress.findUnique.mockResolvedValue(null);
});

describe('marcado MANUAL — POST/DELETE /api/portal/materials/:id/progress', () => {
  it('sin sesión: 401', async () => {
    identificar.mockResolvedValue(null);
    expect((await marcar(req('/api/portal/materials/7/progress'), p('7'))).status).toBe(401);
  });

  it('usuario que NO está en ADMINISTRADORES/FORMADORES: 403 y no marca', async () => {
    puedeMarcarManual.mockResolvedValue(false);
    const res = await marcar(req('/api/portal/materials/7/progress'), p('7'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/se marca automáticamente/);
    expect(marcarMaterialCompletado).not.toHaveBeenCalled();
  });

  it('usuario sin permiso tampoco puede DESMARCAR: 403', async () => {
    puedeMarcarManual.mockResolvedValue(false);
    const res = await desmarcar(req('/api/portal/materials/7/progress', { method: 'DELETE' }), p('7'));
    expect(res.status).toBe(403);
    expect(prisma.portalMaterialProgress.deleteMany).not.toHaveBeenCalled();
  });

  it('administrador/formador: marca con origen MANUAL y queda registrado quién', async () => {
    puedeMarcarManual.mockResolvedValue(true);
    const res = await marcar(req('/api/portal/materials/7/progress'), p('7'));
    expect(res.status).toBe(200);
    expect(marcarMaterialCompletado).toHaveBeenCalledWith({
      materialId: 7,
      correo: ESTUDIANTE,
      origen: 'MANUAL',
      marcadoPor: ESTUDIANTE,
    });
  });

  it('administrador/formador: puede desmarcar', async () => {
    puedeMarcarManual.mockResolvedValue(true);
    recalcularProgresoDeMaterial.mockResolvedValue({ porcentaje: 50, certificado: null });
    const res = await desmarcar(req('/api/portal/materials/7/progress', { method: 'DELETE' }), p('7'));
    expect(res.status).toBe(200);
    expect(prisma.portalMaterialProgress.deleteMany).toHaveBeenCalled();
    expect((await res.json()).porcentaje).toBe(50);
  });
});

describe('apertura — POST /api/portal/materials/:id/vista', () => {
  it('registra la apertura con hora del servidor y devuelve la regla', async () => {
    const res = await abrir(req('/api/portal/materials/7/vista'), p('7'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.regla.tipo).toBe('video');
    expect(data.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(prisma.portalMaterialVista.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ material_id: 7, student_email: ESTUDIANTE, abierta_at: expect.any(Date) }),
    });
    expect(marcarMaterialCompletado).not.toHaveBeenCalled();
  });

  it('un ENLACE queda completado al abrirlo', async () => {
    prisma.portalCourseMaterial.findFirst.mockResolvedValue({
      id: 8,
      type: 'LINK',
      mime: null,
      sp_drive_item_id: null,
      file_size: null,
      course: { active: true },
    });
    const res = await abrir(req('/api/portal/materials/8/vista'), p('8'));
    expect(res.status).toBe(200);
    expect((await res.json()).completado).toBe(true);
    expect(marcarMaterialCompletado).toHaveBeenCalledWith({ materialId: 8, correo: ESTUDIANTE, origen: 'AUTO' });
  });

  it('curso no publicado: 404 para un estudiante', async () => {
    prisma.portalCourseMaterial.findFirst.mockResolvedValue({
      id: 7,
      type: 'DOCUMENT',
      mime: 'video/mp4',
      sp_drive_item_id: 'X',
      file_size: null,
      course: { active: false },
    });
    expect((await abrir(req('/api/portal/materials/7/vista'), p('7'))).status).toBe(404);
  });
});

describe('reporte — POST /api/portal/materials/:id/vista/:token', () => {
  it('video visto completo en tiempo real: el SERVIDOR lo marca (AUTO)', async () => {
    prisma.portalMaterialVista.findUnique.mockResolvedValue(vistaAbierta(125));
    const res = await reportar(
      req(`/api/portal/materials/7/vista/${TOKEN}`, { body: { segundosVistos: 118, duracion: 120 } }),
      pt('7')
    );
    expect(res.status).toBe(200);
    expect((await res.json()).completado).toBe(true);
    expect(marcarMaterialCompletado).toHaveBeenCalledWith({ materialId: 7, correo: ESTUDIANTE, origen: 'AUTO' });
    expect(prisma.portalMaterialVista.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ aceptada: true }) })
    );
  });

  it('reporte implausible (120 s de video "vistos" a los 10 s de abrirlo): 422 y no marca', async () => {
    prisma.portalMaterialVista.findUnique.mockResolvedValue(vistaAbierta(10));
    const res = await reportar(
      req(`/api/portal/materials/7/vista/${TOKEN}`, { body: { segundosVistos: 120, duracion: 120 } }),
      pt('7')
    );
    expect(res.status).toBe(422);
    expect(marcarMaterialCompletado).not.toHaveBeenCalled();
    expect(prisma.portalMaterialVista.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ aceptada: false }) })
    );
  });

  it('video incompleto (50 %): 422', async () => {
    prisma.portalMaterialVista.findUnique.mockResolvedValue(vistaAbierta(300));
    const res = await reportar(
      req(`/api/portal/materials/7/vista/${TOKEN}`, { body: { segundosVistos: 60, duracion: 120 } }),
      pt('7')
    );
    expect(res.status).toBe(422);
    expect(marcarMaterialCompletado).not.toHaveBeenCalled();
  });

  it('PDF: exige el tiempo proporcional a sus páginas', async () => {
    prisma.portalMaterialVista.findUnique.mockResolvedValue(
      vistaAbierta(20, { paginas: 10, material: { type: 'DOCUMENT', mime: 'application/pdf', eliminado_at: null } })
    );
    const corto = await reportar(req(`/api/portal/materials/7/vista/${TOKEN}`, { body: { segundosVistos: 60 } }), pt('7'));
    expect(corto.status).toBe(422);

    prisma.portalMaterialVista.findUnique.mockResolvedValue(
      vistaAbierta(65, { paginas: 10, material: { type: 'DOCUMENT', mime: 'application/pdf', eliminado_at: null } })
    );
    const bien = await reportar(req(`/api/portal/materials/7/vista/${TOKEN}`, { body: { segundosVistos: 60 } }), pt('7'));
    expect(bien.status).toBe(200);
  });

  it('el token de OTRA persona no sirve: 404', async () => {
    prisma.portalMaterialVista.findUnique.mockResolvedValue(vistaAbierta(500, { student_email: 'otra@gsslatam.com' }));
    const res = await reportar(
      req(`/api/portal/materials/7/vista/${TOKEN}`, { body: { segundosVistos: 118, duracion: 120 } }),
      pt('7')
    );
    expect(res.status).toBe(404);
    expect(marcarMaterialCompletado).not.toHaveBeenCalled();
  });

  it('cuerpo o token mal formados: 400', async () => {
    expect((await reportar(req(`/api/portal/materials/7/vista/${TOKEN}`, { body: { segundosVistos: 'x' } }), pt('7'))).status).toBe(400);
    expect((await reportar(req('/api/portal/materials/7/vista/abc', { body: { segundosVistos: 1 } }), pt('7', 'abc'))).status).toBe(400);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta del Top 10 (Cristian Baldión, 2026-10-16): sesión, base y permisos SIMULADOS. Personas inventadas.

const { identificar, prisma, correosConMarcadoManual, formadoresDePortal } = vi.hoisted(() => ({
  identificar: vi.fn(),
  correosConMarcadoManual: vi.fn(),
  formadoresDePortal: vi.fn(),
  prisma: { portalCertificate: { findMany: vi.fn() }, portalFormularioIntento: { groupBy: vi.fn() } },
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/portal/permisos-formacion', () => ({ correosConMarcadoManual }));
vi.mock('@/lib/portal/config', () => ({ formadoresDePortal }));
vi.mock('../../../../../lib/prisma', () => ({ prisma }));
vi.mock('../../../../../lib/portal/permisos-formacion', () => ({ correosConMarcadoManual }));
vi.mock('../../../../../lib/portal/config', () => ({ formadoresDePortal }));

import { NextRequest } from 'next/server';
import { _reiniciarCacheRanking } from '@/lib/portal/ranking-formacion-servidor';
import { GET as obtener } from '../route';

const req = () => new NextRequest(new URL('/api/portal/ranking-formacion', 'http://localhost'));
const cert = (correo: string, nombre: string, curso: number, dia: number) => ({ student_email: correo, student_name: nombre, course_id: curso, issued_at: new Date(`2026-10-${dia}T12:00:00Z`) });

beforeEach(() => {
  vi.clearAllMocks();
  _reiniciarCacheRanking();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: 'ana@gsslatam.com', via: 'codigo' });
  formadoresDePortal.mockReturnValue(['formador@gsslatam.com']);
  correosConMarcadoManual.mockResolvedValue(new Set(['admin@gsslatam.com']));
  prisma.portalCertificate.findMany.mockResolvedValue([
    cert('ana@gsslatam.com', 'Ana Gómez', 1, 10),
    cert('ana@gsslatam.com', 'Ana Gómez', 2, 11),
    cert('luis@gsslatam.com', 'Luis Ruiz', 1, 10),
    cert('formador@gsslatam.com', 'Formador Prueba', 1, 1),
    cert('admin@gsslatam.com', 'Admin Prueba', 1, 1),
    cert('admin@gsslatam.com', 'Admin Prueba', 2, 1),
    cert('admin@gsslatam.com', 'Admin Prueba', 3, 1),
  ]);
  prisma.portalFormularioIntento.groupBy.mockResolvedValue([
    { material_id: 5, student_email: 'ana@gsslatam.com', _max: { porcentaje: 90 } },
    { material_id: 6, student_email: 'luis@gsslatam.com', _max: { porcentaje: 100 } },
  ]);
});

describe('GET /api/portal/ranking-formacion', () => {
  it('sin sesión: 401 y no consulta la base', async () => {
    identificar.mockResolvedValue(null);
    expect((await obtener(req())).status).toBe(401);
    expect(prisma.portalCertificate.findMany).not.toHaveBeenCalled();
  });

  it('devuelve el top ordenado, sin formadores ni administradores, y marca a quien pregunta', async () => {
    const res = await obtener(req());
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.top.map((x: { nombre: string }) => x.nombre)).toEqual(['Ana Gómez', 'Luis Ruiz']);
    expect(d.top[0]).toEqual({ puesto: 1, nombre: 'Ana Gómez', cursos: 2, nota: 90, esUsted: true });
    expect(d.top[1]).toMatchObject({ puesto: 2, cursos: 1, nota: 100, esUsted: false });
    expect(d.total).toBe(2);
    expect(JSON.stringify(d)).not.toMatch(/Prueba|formador@|admin@/);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('solo se piden certificados y notas de cursos PUBLICADOS y evaluaciones no eliminadas, y solo intentos aprobados', async () => {
    await obtener(req());
    expect(prisma.portalCertificate.findMany.mock.calls[0][0].where).toEqual({ course: { active: true } });
    expect(prisma.portalFormularioIntento.groupBy.mock.calls[0][0].where).toEqual({ aprobado: true, material: { eliminado_at: null, course: { active: true } } });
    expect(prisma.portalFormularioIntento.groupBy.mock.calls[0][0].by).toEqual(['material_id', 'student_email']);
  });

  it('NO entrega correos ni la cédula: solo nombre, cursos, nota y puesto', async () => {
    const texto = JSON.stringify(await (await obtener(req())).json());
    expect(texto).not.toMatch(/@|correo|cedula/i);
  });

  it('la lista completa se recuerda un minuto: una segunda petición no vuelve a consultar la base', async () => {
    await obtener(req());
    await obtener(req());
    expect(prisma.portalCertificate.findMany).toHaveBeenCalledTimes(1);
  });

  it('nadie con curso completado: lista vacía (no es un error)', async () => {
    prisma.portalCertificate.findMany.mockResolvedValue([]);
    const d = await (await obtener(req())).json();
    expect(d).toEqual({ top: [], total: 0, usted: null });
  });

  it('si la base falla: 500 con mensaje genérico, sin detalles ni correos', async () => {
    prisma.portalCertificate.findMany.mockRejectedValueOnce(Object.assign(new Error('Invalid prisma invocation: ana@gsslatam.com'), { name: 'PrismaClientKnownRequestError' }));
    const r = await obtener(req());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/prisma|ana@/i);
  });
});

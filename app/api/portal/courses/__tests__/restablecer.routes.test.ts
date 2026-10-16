import { beforeEach, describe, expect, it, vi } from 'vitest';

// Restablecer un curso (Cristian Baldión, 2026-10-14): permisos y validación. Sesión, permisos y base SIMULADOS.

const ADMIN = 'admin@gsslatam.com';
const { identificar, puedeMarcarManual, restablecerCursoDeEstudiante } = vi.hoisted(() => ({
  identificar: vi.fn(),
  puedeMarcarManual: vi.fn(),
  restablecerCursoDeEstudiante: vi.fn(),
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/permisos-formacion', () => ({ puedeMarcarManual }));
vi.mock('@/lib/portal/restablecer-curso', () => ({ restablecerCursoDeEstudiante }));

import { NextRequest } from 'next/server';
import { POST as restablecer } from '../[id]/restablecer/route';

const post = (body: unknown) =>
  new NextRequest(new URL('/api/portal/courses/2/restablecer', 'http://localhost'), {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: ADMIN, via: 'codigo' });
  puedeMarcarManual.mockResolvedValue(true);
  restablecerCursoDeEstudiante.mockResolvedValue({ progresos: 3, respuestas: 1, certificados: 1 });
});

describe('POST /api/portal/courses/:id/restablecer', () => {
  it('sin sesión: 401; sin permiso (no está en el Excel): 403 y no toca nada', async () => {
    identificar.mockResolvedValue(null);
    expect((await restablecer(post({ correo: 'ana@gsslatam.com' }), p('2'))).status).toBe(401);
    identificar.mockResolvedValue({ correo: 'estudiante@gsslatam.com', via: 'codigo' });
    puedeMarcarManual.mockResolvedValue(false);
    const r = await restablecer(post({ correo: 'ana@gsslatam.com' }), p('2'));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/restablecer un curso/);
    expect(restablecerCursoDeEstudiante).not.toHaveBeenCalled();
  });

  it('un administrador restablece: llama a la lógica con el curso y el correo en minúsculas y responde con los conteos', async () => {
    const r = await restablecer(post({ correo: '  Ana.Gomez@GSSLATAM.com ' }), p('2'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, progresos: 3, respuestas: 1, certificados: 1 });
    expect(restablecerCursoDeEstudiante).toHaveBeenCalledWith(2, 'ana.gomez@gsslatam.com');
  });

  it('valida: curso inválido, correo vacío o malo, JSON malo → 400 sin tocar nada', async () => {
    for (const id of ['x', '0', '-1', '1.5']) expect((await restablecer(post({ correo: 'ana@gsslatam.com' }), p(id))).status, id).toBe(400);
    for (const b of [{}, { correo: '' }, { correo: 'sin-arroba' }, { correo: 5 }, 'no es json']) expect((await restablecer(post(b), p('2'))).status).toBe(400);
    expect(restablecerCursoDeEstudiante).not.toHaveBeenCalled();
  });

  it('un estudiante que no está inscrito: 404', async () => {
    restablecerCursoDeEstudiante.mockResolvedValue(null);
    const r = await restablecer(post({ correo: 'otro@gsslatam.com' }), p('2'));
    expect(r.status).toBe(404);
  });

  it('error de base: 500 sin detalles y sin correo en los registros', async () => {
    restablecerCursoDeEstudiante.mockRejectedValue(new Error('Invalid prisma invocation: ana@gsslatam.com'));
    const r = await restablecer(post({ correo: 'ana@gsslatam.com' }), p('2'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/prisma|ana@/);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('ana@');
  });

  it('no escribe correos en el registro de éxito', async () => {
    await restablecer(post({ correo: 'ana@gsslatam.com' }), p('2'));
    expect(JSON.stringify((console.info as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('ana@');
  });
});

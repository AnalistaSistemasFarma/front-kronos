import { beforeEach, describe, expect, it, vi } from 'vitest';

// Eventos de la empresa del calendario (Cristian Baldión, 2026-10-09): permisos, validación y borrado lógico.
// Sesión y base SIMULADAS.

const EDITOR = 'editor.th@gsslatam.com';
const LECTOR = 'colaborador@gsslatam.com';

const { identificar, prisma } = vi.hoisted(() => ({
  identificar: vi.fn(),
  prisma: { portalEvento: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { NextRequest } from 'next/server';
import { GET as listar, POST as crear } from '../route';
import { DELETE as quitar } from '../[eventoId]/route';

const get = (qs: string) => new NextRequest(new URL('/api/portal/eventos' + qs, 'http://localhost'));
const post = (body: unknown) =>
  new NextRequest(new URL('/api/portal/eventos', 'http://localhost'), {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const del = (id: string) => quitar(new NextRequest(new URL('/api/portal/eventos/' + id, 'http://localhost'), { method: 'DELETE' }), { params: Promise.resolve({ eventoId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.PORTAL_TH_EDITORES = EDITOR;
  identificar.mockResolvedValue({ correo: LECTOR, via: 'codigo' });
  prisma.portalEvento.findMany.mockResolvedValue([]);
  prisma.portalEvento.count.mockResolvedValue(0);
  prisma.portalEvento.create.mockResolvedValue({ id: 7, fecha: new Date('2026-10-20T00:00:00Z'), titulo: 'Capacitación SST', descripcion: null });
  prisma.portalEvento.updateMany.mockResolvedValue({ count: 1 });
});

describe('GET /api/portal/eventos', () => {
  it('sin sesión: 401', async () => {
    identificar.mockResolvedValue(null);
    expect((await listar(get('?desde=2026-10-01&hasta=2026-10-31'))).status).toBe(401);
  });

  it('cualquiera que entre al portal VE los eventos; puedeEditar solo para los editores', async () => {
    prisma.portalEvento.findMany.mockResolvedValue([{ id: 1, fecha: new Date('2026-10-12T00:00:00Z'), titulo: 'Jornada', descripcion: 'Sala 2' }]);
    const r = await listar(get('?desde=2026-10-01&hasta=2026-10-31'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ eventos: [{ id: 1, fecha: '2026-10-12', titulo: 'Jornada', descripcion: 'Sala 2', tipo: 'empresa' }], puedeEditar: false });
    identificar.mockResolvedValue({ correo: EDITOR.toUpperCase(), via: 'codigo' });
    expect((await (await listar(get('?desde=2026-10-01&hasta=2026-10-31'))).json()).puedeEditar).toBe(true);
  });

  it('solo pide eventos vigentes (no borrados) del rango', async () => {
    await listar(get('?desde=2026-10-01&hasta=2026-10-31'));
    const where = prisma.portalEvento.findMany.mock.calls[0][0].where;
    expect(where.eliminado_at).toBeNull();
    expect(where.fecha.gte.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(where.fecha.lte.toISOString().slice(0, 10)).toBe('2026-10-31');
  });

  it('rango inválido o demasiado grande: 400', async () => {
    for (const qs of ['', '?desde=2026-10-01', '?desde=2026-10-31&hasta=2026-10-01', '?desde=2026-02-30&hasta=2026-03-01', '?desde=2026-01-01&hasta=2026-12-31']) {
      expect((await listar(get(qs))).status, qs).toBe(400);
    }
    expect(prisma.portalEvento.findMany).not.toHaveBeenCalled();
  });

  it('error de base: 500 sin detalles', async () => {
    prisma.portalEvento.findMany.mockRejectedValue(new Error('Invalid prisma invocation: secreto'));
    const r = await listar(get('?desde=2026-10-01&hasta=2026-10-31'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/secreto|prisma/i);
  });
});

describe('POST /api/portal/eventos', () => {
  it('sin sesión: 401; quien no es editor: 403 y no escribe', async () => {
    identificar.mockResolvedValue(null);
    expect((await crear(post({ fecha: '2026-10-20', titulo: 'X' }))).status).toBe(401);
    identificar.mockResolvedValue({ correo: LECTOR, via: 'codigo' });
    expect((await crear(post({ fecha: '2026-10-20', titulo: 'X' }))).status).toBe(403);
    expect(prisma.portalEvento.create).not.toHaveBeenCalled();
  });

  it('un editor crea el evento: guarda quién lo creó y responde 201', async () => {
    identificar.mockResolvedValue({ correo: EDITOR, via: 'codigo' });
    const r = await crear(post({ fecha: '2026-10-20', titulo: '  Capacitación SST  ', descripcion: '' }));
    expect(r.status).toBe(201);
    expect((await r.json()).evento).toEqual({ id: 7, fecha: '2026-10-20', titulo: 'Capacitación SST', descripcion: null, tipo: 'empresa' });
    const data = prisma.portalEvento.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ titulo: 'Capacitación SST', descripcion: null, created_by: EDITOR });
    expect(data.fecha.toISOString().slice(0, 10)).toBe('2026-10-20');
  });

  it('valida: fecha imposible, título vacío o JSON malo → 400 sin escribir', async () => {
    identificar.mockResolvedValue({ correo: EDITOR, via: 'codigo' });
    for (const b of [{ fecha: '2026-02-30', titulo: 'X' }, { fecha: '2026-10-20', titulo: '  ' }, { fecha: '2026-10-20', titulo: 'x'.repeat(200) }, 'no es json', {}]) {
      expect((await crear(post(b))).status).toBe(400);
    }
    expect(prisma.portalEvento.create).not.toHaveBeenCalled();
  });

  it('un día no admite más de 30 eventos: 409', async () => {
    identificar.mockResolvedValue({ correo: EDITOR, via: 'codigo' });
    prisma.portalEvento.count.mockResolvedValue(30);
    expect((await crear(post({ fecha: '2026-10-20', titulo: 'X' }))).status).toBe(409);
    expect(prisma.portalEvento.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/portal/eventos/:id', () => {
  it('sin sesión: 401; quien no es editor: 403', async () => {
    identificar.mockResolvedValue(null);
    expect((await del('7')).status).toBe(401);
    identificar.mockResolvedValue({ correo: LECTOR, via: 'codigo' });
    expect((await del('7')).status).toBe(403);
    expect(prisma.portalEvento.updateMany).not.toHaveBeenCalled();
  });

  it('un editor lo quita con borrado LÓGICO (quién y cuándo)', async () => {
    identificar.mockResolvedValue({ correo: EDITOR, via: 'codigo' });
    expect((await del('7')).status).toBe(200);
    const arg = prisma.portalEvento.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 7, eliminado_at: null });
    expect(arg.data.eliminado_by).toBe(EDITOR);
    expect(arg.data.eliminado_at).toBeInstanceOf(Date);
  });

  it('id inválido: 400; ya borrado o inexistente: 404', async () => {
    identificar.mockResolvedValue({ correo: EDITOR, via: 'codigo' });
    for (const id of ['x', '0', '-3', '1.5']) expect((await del(id)).status, id).toBe(400);
    prisma.portalEvento.updateMany.mockResolvedValue({ count: 0 });
    expect((await del('99')).status).toBe(404);
  });
});

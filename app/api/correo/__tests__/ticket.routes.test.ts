import { beforeEach, describe, expect, it, vi } from 'vitest';

// /api/correo/ticket — «Crear ticket» desde un hilo: SOLO TI, validado en el servidor en cada llamada.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getCorreoAccess', 'correoDeps', 'usuariosPorCorreo', 'usuarioDeEmpresa',
    'ticketDeHilo', 'reservarTicket', 'activarTicket', 'liberarTicket', 'auditar',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/correo/runtime', () => ({ correoDeps: m.correoDeps }));
vi.mock('../../../../lib/correo/db', () => {
  const { correoDeps: _c, getServerSession: _g, ...rest } = m;
  return rest;
});

import { readCorreoConfig } from '../../../../lib/correo/config';
import { reiniciarBuzonSimulado } from '../../../../lib/correo/mock';
import * as estado from '../route';
import * as ticket from '../ticket/route';

const yo = {
  idUser: 'op1',
  nombre: 'Técnico TI',
  email: 'ti@gsslatam.com',
  empresas: [{ idCompany: 1, companyName: 'GSS' }],
  empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }],
};
let n = 0;
let esTecnico = true;
const crearCaso = vi.fn(async () => 500);

function comoUsuario() {
  const a = { ...yo, idUser: `${yo.idUser}-${++n}` };
  m.getServerSession.mockResolvedValue({ user: { email: a.email } });
  m.getCorreoAccess.mockResolvedValue(a);
}
const H = { 'x-forwarded-for': '10.0.0.9' };
const get = (q: string) => new Request(`http://x/api/correo${q}`, { headers: H });
const post = (body: unknown) => new Request('http://x/api/correo/ticket', { method: 'POST', body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });

const cuerpo = {
  conversationId: 'mock-conv-01AAAA',
  idCompany: 1,
  tipo: 'Solicitud',
  prioridad: 'Media',
  sitio: 'Planta',
  categoria: 1,
  subcategoria: 2,
  actividad: 3,
  departamento: 4,
  asunto: 'Usuario de Prueba Uno - No funciona la impresora',
  descripcion: 'La impresora del piso 2 no imprime desde ayer.',
  adjuntosIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarBuzonSimulado();
  esTecnico = true;
  m.correoDeps.mockImplementation(() => ({
    db: { emailAudit: { findMany: async () => [] } },
    cfg: readCorreoConfig({ CORREO_MODO: 'mock' }),
    kronos: {},
    crearSolicitud: vi.fn(),
    notificarNueva: vi.fn(),
    subirAdjuntos: vi.fn(),
    dominiosGrupo: ['gsslatam.com'],
    ticket: {
      esTecnico: vi.fn(async () => esTecnico),
      catalogo: vi.fn(async () => ({ categorias: [], departamentos: [], tecnicos: [] })),
      validarClasificacion: vi.fn(async () => null),
      companyUser: vi.fn(async () => 12),
      casoExiste: vi.fn(async () => true),
      crearCaso,
      subirAdjuntos: vi.fn(async () => ({ subidos: 0, fallidos: [] })),
    },
  }));
  m.usuariosPorCorreo.mockResolvedValue(new Map());
  m.ticketDeHilo.mockResolvedValue(null);
  m.reservarTicket.mockResolvedValue({ idReserva: 1 });
});

describe('Correo · /api/correo/ticket (solo TI)', () => {
  it('401 sin sesión', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await ticket.GET(get('/ticket?hilo=mock-conv-01AAAA'))).status).toBe(401);
    expect((await ticket.POST(post(cuerpo))).status).toBe(401);
  });

  it('TI: el estado lo habilita, prepara el formulario y crea el ticket (201)', async () => {
    comoUsuario();
    expect((await (await estado.GET(get(''))).json()).ticketHabilitado).toBe(true);
    const p = await ticket.GET(get('/ticket?hilo=mock-conv-01AAAA&preparar=1'));
    expect(p.status).toBe(200);
    expect((await p.json()).asunto).toContain('Usuario de Prueba Uno - ');
    const r = await ticket.POST(post(cuerpo));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ idCase: 500 });
    expect(crearCaso).toHaveBeenCalledTimes(1);
  });

  it('no-TI: el estado no lo habilita y el servidor responde 403 SOLO_TI aunque se llame directo', async () => {
    esTecnico = false;
    comoUsuario();
    expect((await (await estado.GET(get(''))).json()).ticketHabilitado).toBe(false);
    for (const r of [await ticket.GET(get('/ticket?hilo=mock-conv-01AAAA')), await ticket.GET(get('/ticket?hilo=mock-conv-01AAAA&preparar=1')), await ticket.POST(post(cuerpo))]) {
      expect(r.status).toBe(403);
      expect((await r.json()).code).toBe('SOLO_TI');
    }
    expect(crearCaso).not.toHaveBeenCalled();
    expect(m.reservarTicket).not.toHaveBeenCalled();
  });

  it('400 con hilo inválido o cuerpo incompleto', async () => {
    comoUsuario();
    expect((await ticket.GET(get('/ticket?hilo=..%2Fx'))).status).toBe(400);
    expect((await ticket.POST(post({ ...cuerpo, actividad: null }))).status).toBe(400);
  });
});

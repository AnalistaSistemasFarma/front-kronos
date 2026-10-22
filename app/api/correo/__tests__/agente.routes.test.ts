import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas de «Consultar a un agente»: sesión obligatoria, permiso del módulo, identidad SIEMPRE de la
// sesión (nunca del cuerpo) y que confirmar/descartar son las únicas que ejecutan.
const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getCorreoAccess: vi.fn(),
  agentesDisponibles: vi.fn(),
  compartirConAgente: vi.fn(),
  concesionesDeHilo: vi.fn(),
  revocarConcesion: vi.fn(),
  accionesDeChat: vi.fn(),
  confirmarAccion: vi.fn(),
  descartarAccion: vi.fn(),
  prepararSolicitud: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../../../lib/correo/runtime', () => ({ correoDeps: () => ({ tag: 'deps' }) }));
vi.mock('../../../../lib/correo/db', () => ({ getCorreoAccess: m.getCorreoAccess }));
vi.mock('../../../../lib/correo/agenteRuntime', () => ({ agentePort: () => ({ tag: 'px' }) }));
vi.mock('../../../../lib/correo/agente', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, agentesDisponibles: m.agentesDisponibles, compartirConAgente: m.compartirConAgente, concesionesDeHilo: m.concesionesDeHilo, revocarConcesion: m.revocarConcesion, accionesDeChat: m.accionesDeChat, confirmarAccion: m.confirmarAccion, descartarAccion: m.descartarAccion, prepararSolicitud: m.prepararSolicitud };
});

import * as agentes from '../agente/agentes/route';
import * as compartir from '../agente/compartir/route';
import * as compartidos from '../agente/compartidos/route';
import * as revocar from '../agente/revocar/route';
import * as acciones from '../agente/acciones/route';
import * as accion from '../agente/acciones/[id]/route';
import * as preparar from '../agente/acciones/[id]/preparar/route';
import { CorreoError } from '../../../../lib/correo/errors';

let n = 0;
function comoUsuario(con = true) {
  const a = { idUser: `op-${++n}`, nombre: 'Laura', email: 'laura@gsslatam.com', empresas: [{ idCompany: 1, companyName: 'GSS' }], empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }] };
  m.getServerSession.mockResolvedValue({ user: { email: a.email } });
  m.getCorreoAccess.mockResolvedValue(con ? a : null);
  return a;
}
const post = (url: string, body: unknown) => new Request(`http://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (url: string) => new Request(`http://x${url}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  // La suite prueba la función ENCENDIDA; el bloque «bandera apagada» prueba el valor por defecto.
  vi.stubEnv('CORREO_AGENTE_HABILITADO', 'true');
});

describe('Correo · agente · bandera CORREO_AGENTE_HABILITADO apagada', () => {
  beforeEach(() => vi.stubEnv('CORREO_AGENTE_HABILITADO', ''));

  it('sin sesión sigue siendo 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await agentes.GET(get('/api/correo/agente/agentes'))).status).toBe(401);
  });

  it('con sesión y permiso: 403 en todas, lista vacía en acciones y no llama a nada', async () => {
    comoUsuario();
    expect((await agentes.GET(get('/api/correo/agente/agentes'))).status).toBe(403);
    expect((await compartir.POST(post('/api/correo/agente/compartir', { conversationId: 'c', idAgent: 1 }))).status).toBe(403);
    expect((await compartidos.GET(get('/api/correo/agente/compartidos?conversationId=x'))).status).toBe(403);
    expect((await revocar.POST(post('/api/correo/agente/revocar', { id: 1 }))).status).toBe(403);
    expect((await accion.POST(post('/api/correo/agente/acciones/1', { op: 'confirmar' }), params('1'))).status).toBe(403);
    expect((await preparar.GET(get('/api/correo/agente/acciones/1/preparar'), params('1'))).status).toBe(403);
    const r = await acciones.GET(get('/api/correo/agente/acciones?chat=1'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ acciones: [] });
    for (const f of [m.agentesDisponibles, m.compartirConAgente, m.concesionesDeHilo, m.revocarConcesion, m.accionesDeChat, m.confirmarAccion, m.prepararSolicitud]) {
      expect(f).not.toHaveBeenCalled();
    }
  });
});

describe('Correo · agente · rutas', () => {
  it('sin sesión: 401 en todas', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await agentes.GET(get('/api/correo/agente/agentes'))).status).toBe(401);
    expect((await compartir.POST(post('/api/correo/agente/compartir', {}))).status).toBe(401);
    expect((await compartidos.GET(get('/api/correo/agente/compartidos?conversationId=x'))).status).toBe(401);
    expect((await revocar.POST(post('/api/correo/agente/revocar', { id: 1 }))).status).toBe(401);
    expect((await acciones.GET(get('/api/correo/agente/acciones?chat=1'))).status).toBe(401);
    expect((await accion.POST(post('/api/correo/agente/acciones/1', { op: 'confirmar' }), params('1'))).status).toBe(401);
    expect((await preparar.GET(get('/api/correo/agente/acciones/1/preparar'), params('1'))).status).toBe(401);
    expect(m.confirmarAccion).not.toHaveBeenCalled();
  });

  it('sin el módulo Correo: 403 (y las tarjetas del chat responden vacío, sin ruido)', async () => {
    comoUsuario(false);
    expect((await compartir.POST(post('/api/correo/agente/compartir', { conversationId: 'C', idAgent: 7 }))).status).toBe(403);
    const r = await acciones.GET(get('/api/correo/agente/acciones?chat=1'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ acciones: [] });
    expect(m.accionesDeChat).not.toHaveBeenCalled();
  });

  it('compartir usa la identidad de la SESIÓN aunque el cuerpo traiga otra', async () => {
    const a = comoUsuario();
    m.compartirConAgente.mockResolvedValue({ idShare: 1, idChatConversation: 2, agente: { code: 'horus' }, venceEn: 'x' });
    const r = await compartir.POST(post('/api/correo/agente/compartir', { conversationId: 'CONV-1', idAgent: 7, pregunta: 'hola', mailbox: 'otra@gsslatam.com', idUser: 'intruso' }));
    expect(r.status).toBe(201);
    const [, , acceso, p] = m.compartirConAgente.mock.calls[0];
    expect(acceso).toBe(a);
    expect(p).toMatchObject({ conversationId: 'CONV-1', idAgent: 7, pregunta: 'hola' });
    expect(p).not.toHaveProperty('mailbox');
  });

  it('confirmar y descartar pasan por la sesión; op desconocida → 400; errores de negocio con su estado', async () => {
    const a = comoUsuario();
    m.confirmarAccion.mockResolvedValue({ estado: 'CONFIRMADA', resultado: 'ok', idRequest: null });
    m.descartarAccion.mockResolvedValue({ estado: 'DESCARTADA', resultado: 'x', idRequest: null });
    expect((await accion.POST(post('/api/correo/agente/acciones/5', { op: 'confirmar', cuerpo: 'Hola', idUser: 'otro' }), params('5'))).status).toBe(200);
    expect(m.confirmarAccion.mock.calls[0][2]).toBe(a);
    expect(m.confirmarAccion.mock.calls[0][3]).toBe(5);
    expect(m.confirmarAccion.mock.calls[0][4]).toEqual({ cuerpo: 'Hola' });
    expect((await accion.POST(post('/api/correo/agente/acciones/5', { op: 'descartar' }), params('5'))).status).toBe(200);
    expect((await accion.POST(post('/api/correo/agente/acciones/5', { op: 'enviar-ya' }), params('5'))).status).toBe(400);
    m.confirmarAccion.mockRejectedValue(new CorreoError('Esta propuesta ya fue atendida.', 409, 'YA_ATENDIDA'));
    const r = await accion.POST(post('/api/correo/agente/acciones/5', { op: 'confirmar' }), params('5'));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'YA_ATENDIDA' });
  });

  it('respuestas sin caché', async () => {
    comoUsuario();
    m.accionesDeChat.mockResolvedValue([]);
    const r = await acciones.GET(get('/api/correo/agente/acciones?chat=3'));
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    expect(m.accionesDeChat.mock.calls[0][3]).toBe(3);
  });
});

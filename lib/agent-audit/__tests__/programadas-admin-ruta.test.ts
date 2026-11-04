import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Administrar automatizaciones programadas (2026-11-04):
 *   GET  /programadas/<id>          — auditoría; notas de error solo a quien administra.
 *   POST /programadas/<id>          — solo «Auditoría de agentes · Configurar» (403), confirmar (400),
 *                                     lista blanca y estado (409), orden activa (409).
 *   GET  /programadas/ordenes       — solo la llave del ejecutor; ve las de SU equipo.
 *   POST /programadas/ordenes/<id>  — solo la llave del ejecutor; reporta sobre SU equipo.
 */
const r = vi.hoisted(() => ({
  sesion: vi.fn(),
  auditar: vi.fn(),
  configurar: vi.fn(),
  alcance: vi.fn(),
  leer: vi.fn(),
  ordenes: vi.fn(),
  crear: vi.fn(),
  pendientes: vi.fn(),
  reportar: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: r.sesion };
});
vi.mock('../../chat/audit-access', () => ({
  canAuditAgents: r.auditar,
  canConfigureAgents: r.configurar,
  getAuditScope: r.alcance,
}));
vi.mock('../scheduled-admin-db', () => {
  class AdminNoDisponible extends Error {}
  class OrdenProgramadaActiva extends Error {
    constructor(public orden: unknown) {
      super('Ya hay una orden en curso para esta automatización.');
    }
  }
  class TransicionProgramadaInvalida extends Error {}
  return {
    AdminNoDisponible,
    OrdenProgramadaActiva,
    TransicionProgramadaInvalida,
    leerProgramada: r.leer,
    ordenesDeProgramada: r.ordenes,
    crearOrdenProgramada: r.crear,
    ordenesPendientesHost: r.pendientes,
    reportarOrdenProgramada: r.reportar,
  };
});

import { NextRequest } from 'next/server';
import { GET, POST } from '../../../app/api/chat/auditoria/automatizaciones/programadas/[id]/route';
import { GET as GET_ORDENES } from '../../../app/api/chat/auditoria/automatizaciones/programadas/ordenes/route';
import { POST as REPORTAR } from '../../../app/api/chat/auditoria/automatizaciones/programadas/ordenes/[id]/route';
import { OrdenProgramadaActiva } from '../scheduled-admin-db';

const job = {
  id: 5,
  idAgent: 9,
  code: 'carter',
  displayName: 'Carter',
  clave: 'jorge:launchd:com.jorge.carter.certificaciones',
  host: 'jorge',
  tipo: 'launchd',
  ref: 'com.jorge.carter.certificaciones',
  nombre: 'Certificaciones',
  cargada: true,
  habilitada: true,
  estado: 'activa',
  ultimaCorrida: '2026-11-03T21:00:00Z',
  ultimaOk: true,
  ultimas: [{ ts: '2026-11-03T21:00:00Z', ok: false, produccion: null, nota: 'Error al publicar' }],
};
const params = (id = '5') => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, id = '5') =>
  POST(
    new NextRequest(`http://x/api/chat/auditoria/automatizaciones/programadas/${id}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.8', 'user-agent': 'Prueba/1.0' },
    }),
    params(id),
  );
const LLAVE_JORGE = 'j'.repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_SCHEDULED_EXECUTOR_KEYS = `jorge:${LLAVE_JORGE},local:${'l'.repeat(40)}`;
  r.sesion.mockResolvedValue({ id: 'u1', email: 'admin@x' });
  r.auditar.mockResolvedValue(true);
  r.configurar.mockResolvedValue(true);
  r.alcance.mockResolvedValue({ all: true });
  r.leer.mockResolvedValue(job);
  r.ordenes.mockResolvedValue([]);
  r.crear.mockImplementation(async (n: { accion: string }) => ({ id: 77, accion: n.accion, status: 'pendiente' }));
});

describe('GET /programadas/<id>', () => {
  it('sin permiso de auditoría: 403; fuera de alcance: 404', async () => {
    r.auditar.mockResolvedValue(false);
    expect((await GET(new NextRequest('http://x'), params())).status).toBe(403);
    r.auditar.mockResolvedValue(true);
    r.leer.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://x'), params())).status).toBe(404);
  });

  it('auditor sin «Configurar»: ve corridas sin notas y no puede administrar', async () => {
    r.configurar.mockResolvedValue(false);
    const j = await (await GET(new NextRequest('http://x'), params())).json();
    expect(j.puedeAdministrar).toBe(false);
    expect(j.programada.ultimas[0].nota).toBeNull();
  });

  it('administrador: notas y motivos por acción', async () => {
    const j = await (await GET(new NextRequest('http://x'), params())).json();
    expect(j.puedeAdministrar).toBe(true);
    expect(j.programada.ultimas[0].nota).toBe('Error al publicar');
    expect(j.acciones.pausar).toBeNull();
    expect(j.acciones.reanudar).toMatch(/No está pausada/);
  });

  it('con una orden activa, todas las acciones quedan bloqueadas', async () => {
    r.ordenes.mockResolvedValue([{ id: 1, status: 'en_curso' }]);
    const j = await (await GET(new NextRequest('http://x'), params())).json();
    expect(j.acciones.pausar).toMatch(/orden en curso/);
    expect(j.acciones.ejecutar).toMatch(/orden en curso/);
  });
});

describe('POST /programadas/<id>', () => {
  it('sin «Auditoría de agentes · Configurar»: 403 y no crea nada', async () => {
    r.configurar.mockResolvedValue(false);
    const res = await post({ accion: 'pausar', confirmar: true });
    expect(res.status).toBe(403);
    expect(r.crear).not.toHaveBeenCalled();
  });

  it('exige la confirmación y una acción válida', async () => {
    expect((await post({ accion: 'pausar' })).status).toBe(400);
    expect((await post({ accion: 'borrar', confirmar: true })).status).toBe(400);
    expect(r.crear).not.toHaveBeenCalled();
  });

  it('fuera de la lista blanca: 409', async () => {
    r.leer.mockResolvedValue({ ...job, ref: 'com.horus.curador', host: 'local' });
    const res = await post({ accion: 'pausar', confirmar: true });
    expect(res.status).toBe(409);
    expect(r.crear).not.toHaveBeenCalled();
  });

  it('acción que no corresponde al estado: 409 (reanudar una activa)', async () => {
    expect((await post({ accion: 'reanudar', confirmar: true })).status).toBe(409);
  });

  it('registra la orden con correo, IP y navegador: 202', async () => {
    const res = await post({ accion: 'pausar', confirmar: true });
    expect(res.status).toBe(202);
    expect(r.crear).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'pausar', requestedBy: 'admin@x', ip: '10.0.0.8', userAgent: 'Prueba/1.0' }),
    );
  });

  it('ya hay una orden activa: 409', async () => {
    r.crear.mockRejectedValue(new OrdenProgramadaActiva({ id: 3 } as never));
    expect((await post({ accion: 'ejecutar', confirmar: true })).status).toBe(409);
  });
});

describe('ejecutor', () => {
  const conLlave = (url: string, llave: string | null, body?: unknown) =>
    new NextRequest(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(llave ? { authorization: `Bearer ${llave}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('sin llave o con una sesión: 401', async () => {
    expect((await GET_ORDENES(conLlave('http://x/o', null))).status).toBe(401);
    expect((await GET_ORDENES(conLlave('http://x/o', 'x'.repeat(40)))).status).toBe(401);
  });

  it('la llave de jorge solo lee las órdenes de jorge', async () => {
    r.pendientes.mockResolvedValue([]);
    const res = await GET_ORDENES(conLlave('http://x/o', LLAVE_JORGE));
    expect(res.status).toBe(200);
    expect(r.pendientes).toHaveBeenCalledWith('jorge');
  });

  it('reporta sobre su equipo; estados inválidos 400; ajena 404', async () => {
    r.reportar.mockResolvedValue({ id: 7, status: 'ok' });
    const ok = await REPORTAR(conLlave('http://x/o/7', LLAVE_JORGE, { estado: 'ok', detalle: 'listo' }), params('7'));
    expect(ok.status).toBe(200);
    expect(r.reportar).toHaveBeenCalledWith('jorge', 7, 'ok', 'listo', 'jorge');
    expect((await REPORTAR(conLlave('http://x/o/7', LLAVE_JORGE, { estado: 'vencida' }), params('7'))).status).toBe(400);
    r.reportar.mockResolvedValue(null);
    expect((await REPORTAR(conLlave('http://x/o/8', LLAVE_JORGE, { estado: 'ok' }), params('8'))).status).toBe(404);
  });
});

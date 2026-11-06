import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Icono «Proyectos» de la cabecera (2026-10-19): permisos y contador, con la base simulada.
 *   - sin el módulo: nada (la ruta responde 403 y el icono no se pinta);
 *   - la consulta lleva SIEMPRE la puerta: miembro (cualquier rol, también lector) + módulo en la
 *     empresa del proyecto + proyecto y conversación no archivados;
 *   - cuenta mensajes de personas y de agentes posteriores a la marca, nunca los propios;
 *   - el fragmento va en texto plano y solo de conversaciones visibles;
 *   - la marca de lectura solo avanza y nunca pasa del último mensaje real;
 *   - el pulso del chat avisa de proyectos solo con esa misma puerta.
 */
const m = vi.hoisted(() => ({
  empresas: vi.fn(),
  convFindMany: vi.fn(),
  readFindMany: vi.fn(),
  readFindUnique: vi.fn(),
  readCreate: vi.fn(),
  readUpdateMany: vi.fn(),
  msgGroupBy: vi.fn(),
  msgFindMany: vi.fn(),
  msgFindFirst: vi.fn(),
  msgCount: vi.fn(),
  supFindFirst: vi.fn(),
  visiblesPersonas: vi.fn(),
  participantes: vi.fn(),
  sessionUser: vi.fn(),
  guard: vi.fn(),
  estadoFindMany: vi.fn(),
}));

vi.mock('../../prisma', () => ({
  prisma: {
    chatConversation: { findMany: m.convFindMany },
    chatProjectRead: { findMany: m.readFindMany, findUnique: m.readFindUnique, create: m.readCreate, updateMany: m.readUpdateMany },
    chatMessage: { groupBy: m.msgGroupBy, findMany: m.msgFindMany, findFirst: m.msgFindFirst, count: m.msgCount },
    subprocessUserCompany: { findFirst: m.supFindFirst },
    chatParticipant: { findMany: m.participantes },
    chatAgentStatus: { findMany: m.estadoFindMany },
  },
}));
vi.mock('../../chat/projects', () => ({ projectModuleCompanies: m.empresas }));
vi.mock('../../chat/people', () => ({ visiblePeopleConversationIds: m.visiblesPersonas }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: m.sessionUser, guardConversation: m.guard };
});

import { NextRequest } from 'next/server';
import {
  fragmentoMensaje,
  marcarLeidaProyecto,
  resumenNoLeidos,
  whereConversacionesVisibles,
  whereMensajesQueCuentan,
} from '../no-leidos';
import { GET as noLeidosGet, POST as noLeidosPost } from '../../../app/api/proyectos/no-leidos/route';
import { POST as leerPost } from '../../../app/api/chat/conversations/[id]/read/route';
import { GET as pulso } from '../../../app/api/chat/pulse/route';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };
const conv = (id: number, idProject = 4, title = 'Importaciones') => ({
  id,
  title,
  id_project: idProject,
  project: { name: `Proyecto ${idProject}` },
  agent: { code: 'play', display_name: 'Play' },
});
const req = (url: string, init?: { method: string; body?: unknown }) =>
  new NextRequest(`http://x${url}`, init ? { method: init.method, body: init.body === undefined ? undefined : JSON.stringify(init.body), headers: { 'Content-Type': 'application/json' } } : undefined);

beforeEach(() => {
  vi.clearAllMocks();
  m.empresas.mockResolvedValue([{ idCompany: 3, companyName: 'OLP' }]);
  m.convFindMany.mockResolvedValue([]);
  m.readFindMany.mockResolvedValue([]);
  m.msgGroupBy.mockResolvedValue([]);
  m.msgFindMany.mockResolvedValue([]);
  m.msgCount.mockResolvedValue(0);
  m.visiblesPersonas.mockResolvedValue([]);
  m.participantes.mockResolvedValue([]);
  m.estadoFindMany.mockResolvedValue([]);
});

describe('la puerta del contador', () => {
  it('el filtro de conversaciones exige miembro + módulo en la empresa + nada archivado, sin mirar el rol', () => {
    const w = whereConversacionesVisibles('u-ana', [3, 8]);
    expect(w).toEqual({
      kind: 'project',
      archived: false,
      project: { archived: false, id_company: { in: [3, 8] }, members: { some: { id_user: 'u-ana' } } },
    });
    // Un LECTOR es miembro: el filtro no pide dueño ni editor.
    expect(JSON.stringify(w)).not.toMatch(/role/);
  });

  it('cuentan personas y agentes, nunca lo propio ni lo de sistema', () => {
    expect(whereMensajesQueCuentan('u-ana')).toEqual({
      role: { in: ['user', 'agent'] },
      OR: [{ id_user_author: null }, { id_user_author: { not: 'u-ana' } }],
    });
  });

  it('sin el módulo en ninguna empresa: null y no se consulta nada más', async () => {
    m.empresas.mockResolvedValue([]);
    expect(await resumenNoLeidos(ANA, { detalle: true })).toBeNull();
    expect(m.convFindMany).not.toHaveBeenCalled();
  });

  it('la consulta real lleva la puerta con las empresas del módulo de esa persona', async () => {
    await resumenNoLeidos(ANA, { detalle: false });
    const where = m.convFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject(whereConversacionesVisibles('u-ana', [3]));
    expect(m.empresas).toHaveBeenCalledWith('u-ana');
  });
});

describe('el contador', () => {
  it('cuenta conversaciones con mensajes nuevos desde la marca de cada una', async () => {
    m.convFindMany.mockResolvedValue([conv(10), conv(11), conv(12)]);
    m.readFindMany.mockResolvedValue([{ id_conversation: 10, last_read_message_id: 5 }]);
    m.msgGroupBy.mockResolvedValue([
      { id_conversation: 10, _count: { _all: 2 }, _max: { id: 8 } },
      { id_conversation: 11, _count: { _all: 1 }, _max: { id: 3 } },
      // Una conversación que NO pasó la puerta nunca se cuenta (defensa en profundidad).
      { id_conversation: 99, _count: { _all: 5 }, _max: { id: 50 } },
    ]);
    const r = await resumenNoLeidos(ANA, { detalle: false });
    expect(r).toEqual({ noLeidos: 2, mensajes: 3 });
    const where = m.msgGroupBy.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([
      { id_conversation: 10, id: { gt: 5 } },
      { id_conversation: 11, id: { gt: 0 } },
      { id_conversation: 12, id: { gt: 0 } },
    ]);
    expect(where.AND[1]).toEqual(whereMensajesQueCuentan('u-ana'));
    expect(m.readFindMany.mock.calls[0][0].where).toEqual({ id_user: 'u-ana', id_conversation: { in: [10, 11, 12] } });
  });

  it('sin conversaciones visibles: cero y sin más consultas', async () => {
    expect(await resumenNoLeidos(ANA, { detalle: true })).toEqual({ noLeidos: 0, mensajes: 0, items: [] });
    expect(m.msgGroupBy).not.toHaveBeenCalled();
  });

  it('el panel: proyecto, conversación, agente, quién escribió, fragmento plano y hora', async () => {
    m.convFindMany.mockResolvedValue([conv(11, 7, 'Fletes'), conv(10, 4)]);
    m.msgGroupBy.mockResolvedValue([
      { id_conversation: 10, _count: { _all: 2 }, _max: { id: 8 } },
      { id_conversation: 11, _count: { _all: 1 }, _max: { id: 9 } },
    ]);
    const creado = new Date('2026-10-19T15:00:00Z');
    m.msgFindMany.mockResolvedValue([
      { id: 8, id_conversation: 10, body: '**Listo** el <b>informe</b> [aquí](http://x)', role: 'agent', created_at: creado, userAuthor: null, agentAuthor: { display_name: 'Play' } },
      { id: 9, id_conversation: 11, body: 'x'.repeat(400), role: 'user', created_at: creado, userAuthor: { name: 'Angye Mancipe', email: 'angye@olp.com' }, agentAuthor: null },
    ]);
    const r = await resumenNoLeidos(ANA, { detalle: true });
    expect(r?.items?.map((i) => i.idConversation)).toEqual([11, 10]);
    expect(r?.items?.[0]).toMatchObject({ idProject: 7, projectName: 'Proyecto 7', conversationTitle: 'Fletes', noLeidos: 1, ultimo: { autor: 'Angye Mancipe', autorTipo: 'persona' } });
    expect(r?.items?.[0].ultimo?.fragmento.length).toBeLessThanOrEqual(120);
    expect(r?.items?.[1].ultimo).toMatchObject({ autor: 'Play', autorTipo: 'agente', fragmento: 'Listo el <b>informe</b> aquí', createdAt: creado.toISOString() });
    // El último mensaje solo se busca dentro de las conversaciones visibles.
    expect(m.msgFindMany.mock.calls[0][0].where).toEqual({ id: { in: [9, 8] }, id_conversation: { in: [11, 10] } });
  });

  it('fragmento: texto plano y recortado; un adjunto sin texto se nombra', () => {
    expect(fragmentoMensaje('# Título\n- uno')).toBe('Título uno');
    expect(fragmentoMensaje('')).toBe('Envió un archivo');
    expect(fragmentoMensaje('a'.repeat(300)).endsWith('…')).toBe(true);
  });
});

describe('marcar como leída', () => {
  it('primera vez: crea la marca hasta el último mensaje', async () => {
    m.msgFindFirst.mockResolvedValue({ id: 40 });
    m.readFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ last_read_message_id: 40 });
    m.readCreate.mockResolvedValue({});
    const r = await marcarLeidaProyecto('u-ana', 28);
    expect(m.readCreate).toHaveBeenCalledWith({ data: { id_conversation: 28, id_user: 'u-ana', last_read_message_id: 40 } });
    expect(r).toMatchObject({ marca: 40, updated: 1 });
  });

  it('un número inventado por el cliente no pasa del último mensaje real', async () => {
    m.msgFindFirst.mockResolvedValue({ id: 40 });
    m.readFindUnique.mockResolvedValueOnce({ last_read_message_id: 10 }).mockResolvedValueOnce({ last_read_message_id: 40 });
    m.readUpdateMany.mockResolvedValue({ count: 1 });
    await marcarLeidaProyecto('u-ana', 28, 999_999);
    expect(m.readUpdateMany).toHaveBeenCalledWith({
      where: { id_conversation: 28, id_user: 'u-ana', last_read_message_id: { lt: 40 } },
      data: expect.objectContaining({ last_read_message_id: 40 }),
    });
  });

  it('solo avanza: una marca vieja no «deslee»', async () => {
    m.msgFindFirst.mockResolvedValue({ id: 40 });
    m.readFindUnique.mockResolvedValue({ last_read_message_id: 30 });
    m.msgCount.mockResolvedValue(4);
    const r = await marcarLeidaProyecto('u-ana', 28, 20);
    expect(m.readUpdateMany).not.toHaveBeenCalled();
    expect(r).toEqual({ marca: 30, unreadCount: 4, updated: 0 });
    expect(m.msgCount.mock.calls[0][0].where).toMatchObject({ id_conversation: 28, id: { gt: 30 } });
  });

  it('dos pestañas a la vez: el duplicado se resuelve con el UPDATE que solo avanza', async () => {
    m.msgFindFirst.mockResolvedValue({ id: 40 });
    m.readFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ last_read_message_id: 40 });
    m.readCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    m.readUpdateMany.mockResolvedValue({ count: 0 });
    const r = await marcarLeidaProyecto('u-ana', 28);
    expect(m.readUpdateMany).toHaveBeenCalled();
    expect(r.marca).toBe(40);
  });
});

describe('rutas', () => {
  it('GET /api/proyectos/no-leidos: 401 sin sesión, 200 { habilitado: false } sin módulo, 200 sin caché', async () => {
    m.sessionUser.mockResolvedValue(null);
    expect((await noLeidosGet(req('/api/proyectos/no-leidos'))).status).toBe(401);

    m.sessionUser.mockResolvedValue(ANA);
    m.empresas.mockResolvedValue([]);
    const sinModulo = await noLeidosGet(req('/api/proyectos/no-leidos'));
    expect(sinModulo.status).toBe(200);
    expect(await sinModulo.json()).toEqual({ habilitado: false });

    m.empresas.mockResolvedValue([{ idCompany: 3, companyName: 'OLP' }]);
    const res = await noLeidosGet(req('/api/proyectos/no-leidos'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ noLeidos: 0, mensajes: 0 });
    const conDetalle = await noLeidosGet(req('/api/proyectos/no-leidos?detalle=1'));
    // Con el panel viajan también los agentes trabajando (2026-10-20), con la misma puerta.
    expect(await conDetalle.json()).toEqual({ noLeidos: 0, mensajes: 0, items: [], trabajando: [] });
    expect(m.estadoFindMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.estadoFindMany.mock.calls[0][0].where.conversation)).toContain('"members":{"some":{"id_user":"u-ana"}}');
  });

  it('POST leer-todo: solo esa acción y solo con el módulo', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    expect((await noLeidosPost(req('/api/proyectos/no-leidos', { method: 'POST', body: { accion: 'borrar' } }))).status).toBe(400);
    m.empresas.mockResolvedValue([]);
    expect((await noLeidosPost(req('/api/proyectos/no-leidos', { method: 'POST', body: { accion: 'leer-todo' } }))).status).toBe(403);
    m.empresas.mockResolvedValue([{ idCompany: 3, companyName: 'OLP' }]);
    const ok = await noLeidosPost(req('/api/proyectos/no-leidos', { method: 'POST', body: { accion: 'leer-todo' } }));
    expect(await ok.json()).toEqual({ ok: true, conversaciones: 0 });
  });

  it('POST /read de una conversación de proyecto mueve la marca de ESA persona (también un lector)', async () => {
    m.guard.mockResolvedValue({ user: ANA, conversationId: 28, kind: 'project' });
    m.msgFindFirst.mockResolvedValue({ id: 40 });
    m.readFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ last_read_message_id: 35 });
    m.readCreate.mockResolvedValue({});
    m.msgCount.mockResolvedValue(5);
    const res = await leerPost(req('/api/chat/conversations/28/read', { method: 'POST', body: { upToMessageId: 35 } }), { params: Promise.resolve({ id: '28' }) });
    expect(await res.json()).toEqual({ updated: 1, unreadCount: 5 });
    expect(m.readCreate).toHaveBeenCalledWith({ data: { id_conversation: 28, id_user: 'u-ana', last_read_message_id: 35 } });
  });

  it('POST /read sin pasar la puerta: la respuesta de la puerta y nada se escribe', async () => {
    const { NextResponse } = await import('next/server');
    m.guard.mockResolvedValue({ response: NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 }) });
    const res = await leerPost(req('/api/chat/conversations/28/read', { method: 'POST', body: {} }), { params: Promise.resolve({ id: '28' }) });
    expect(res.status).toBe(404);
    expect(m.readCreate).not.toHaveBeenCalled();
    expect(m.readUpdateMany).not.toHaveBeenCalled();
  });
});

describe('pulso del chat con proyectos', () => {
  const pulseReq = (since: number) => new NextRequest(`http://x/api/chat/pulse?since=${since}`);

  it('sin Chat ni Proyectos: 403 (el pulso se apaga)', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    m.supFindFirst.mockResolvedValue(null);
    m.empresas.mockResolvedValue([]);
    expect((await pulso(pulseReq(0))).status).toBe(403);
  });

  it('solo Proyectos: busca solo la rama de proyectos, con la puerta, y avisa sin el texto', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    m.supFindFirst.mockResolvedValue(null);
    m.msgFindFirst.mockResolvedValue({ id: 120 });
    m.msgFindMany.mockResolvedValue([
      { id: 115, id_conversation: 28, event_type: null, created_at: new Date('2026-10-19T15:00:00Z'), role: 'agent', conversation: { kind: 'project' }, userAuthor: null, agentAuthor: { display_name: 'Play' } },
    ]);
    const res = await pulso(pulseReq(100));
    const body = await res.json();
    expect(body.cursor).toBe(120);
    expect(body.events).toEqual([
      { type: 'project', idConversation: 28, idMessage: 115, authorName: 'Play', createdAt: '2026-10-19T15:00:00.000Z', muted: false },
    ]);
    const ramas = m.msgFindMany.mock.calls[0][0].where.OR;
    expect(ramas).toHaveLength(1);
    expect(ramas[0].conversation).toEqual(whereConversacionesVisibles('u-ana', [3]));
    expect(ramas[0].role).toEqual({ in: ['user', 'agent'] });
    expect(JSON.stringify(body)).not.toMatch(/body|fragmento/);
    // Sin hilos entre personas no se consulta su regla.
    expect(m.visiblesPersonas).not.toHaveBeenCalled();
  });

  it('con Chat y sin Proyectos: la rama de proyectos no existe', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    m.supFindFirst.mockResolvedValue({ id_subprocess_user_company: 1 });
    m.empresas.mockResolvedValue([]);
    m.msgFindFirst.mockResolvedValue({ id: 120 });
    m.msgFindMany.mockResolvedValue([
      { id: 116, id_conversation: 30, event_type: null, created_at: new Date(), role: 'user', conversation: { kind: 'people' }, userAuthor: { name: 'Diana', email: 'd@x' }, agentAuthor: null },
    ]);
    m.visiblesPersonas.mockResolvedValue([30]);
    const body = await (await pulso(pulseReq(100))).json();
    const ramas = m.msgFindMany.mock.calls[0][0].where.OR;
    expect(ramas).toHaveLength(1);
    expect(ramas[0].conversation.kind).toBe('people');
    expect(body.events).toMatchObject([{ type: 'message', idConversation: 30, authorName: 'Diana' }]);
  });
});

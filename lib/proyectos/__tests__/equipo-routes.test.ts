import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Equipo de subagentes del módulo «Proyectos» (F2, 2026-10-18), del lado de las rutas:
 *   - un NO miembro recibe 404 en todas las rutas nuevas;
 *   - el LECTOR ve el equipo, pero no pide sugerencias, no aprueba ni configura (403);
 *   - el EDITOR pide sugerencias; NO aprueba salvo PROYECTOS_EQUIPO_EDITOR_APRUEBA=1; no configura;
 *   - el DUEÑO aprueba, edita (catálogo cerrado y lo que admite el perfil), descarta y configura;
 *     máximo 6 aprobados; el tope de simultáneos va de 1 a 5; todo deja auditoría;
 *   - un pedido a la vez por proyecto;
 *   - el puente solo con SU llave (scope projects): reclama pedidos de su agente, entrega
 *     sugerencias que quedan PROPUESTAS (lo inválido se recorta) y registra corridas solo en
 *     conversaciones suyas; el contexto solo trae lo APROBADO.
 * Base simulada en memoria.
 */

type Fila = Record<string, unknown>;
const db = vi.hoisted(() => ({
  subagentes: [] as Fila[],
  pedidos: [] as Fila[],
  corridas: [] as Fila[],
  eventos: [] as Fila[],
  proyecto: { team_enabled: true, team_max_parallel: 3 } as Fila,
  seq: 100,
}));
const sessionUser = vi.hoisted(() => vi.fn());
const resolveProject = vi.hoisted(() => vi.fn());
const writeAccess = vi.hoisted(() => vi.fn());
const authenticateAgent = vi.hoisted(() => vi.fn());
const assertAgentConv = vi.hoisted(() => vi.fn());

function coincide(f: Fila, where: Fila | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if ('lt' in o) return (f[k] as Date) < (o.lt as Date);
      if ('gte' in o) return (f[k] as Date) >= (o.gte as Date);
      if ('in' in o) return (o.in as unknown[]).includes(f[k]);
      if ('not' in o) return f[k] !== o.not;
      return true; // filtros de relación: los cubre el resto de la prueba
    }
    return f[k] === v;
  });
}

vi.mock('../../prisma', () => {
  const tabla = (nombre: 'subagentes' | 'pedidos' | 'corridas' | 'eventos', idCampo: string) => ({
    findMany: vi.fn(async (a?: { where?: Fila; take?: number }) => (db[nombre] as Fila[]).filter((f) => coincide(f, a?.where)).slice(0, a?.take ?? 1000)),
    findFirst: vi.fn(async (a?: { where?: Fila }) => (db[nombre] as Fila[]).find((f) => coincide(f, a?.where)) ?? null),
    count: vi.fn(async (a?: { where?: Fila }) => (db[nombre] as Fila[]).filter((f) => coincide(f, a?.where)).length),
    create: vi.fn(async (a: { data: Fila }) => {
      const f = { [idCampo]: ++db.seq, created_at: new Date(), requested_at: new Date(), status: nombre === 'pedidos' ? 'pendiente' : 'propuesto', suggested: 0, ...a.data };
      (db[nombre] as Fila[]).push(f);
      return f;
    }),
    createMany: vi.fn(async (a: { data: Fila[] }) => {
      for (const d of a.data) (db[nombre] as Fila[]).push({ [idCampo]: ++db.seq, created_at: new Date(), ...d });
      return { count: a.data.length };
    }),
    update: vi.fn(async (a: { where: Fila; data: Fila }) => {
      const f = (db[nombre] as Fila[]).find((x) => coincide(x, a.where));
      if (f) Object.assign(f, a.data);
      return f;
    }),
    updateMany: vi.fn(async (a: { where: Fila; data: Fila }) => {
      const fs = (db[nombre] as Fila[]).filter((x) => coincide(x, a.where));
      for (const f of fs) Object.assign(f, a.data);
      return { count: fs.length };
    }),
    groupBy: vi.fn(async () => []),
  });
  const agente = { id_agent: 5, code: 'horus', display_name: 'Orus', handle: '@orus', avatar_url: null, avatar_updated_at: null, is_active: true };
  const prisma: Record<string, unknown> = {
    chatProjectSubagent: tabla('subagentes', 'id_subagent'),
    chatProjectTeamRequest: tabla('pedidos', 'id_request'),
    chatProjectSubagentRun: tabla('corridas', 'id_run'),
    chatProjectTeamEvent: tabla('eventos', 'id_event'),
    chatProjectAgent: { findMany: vi.fn(async () => [{ agent: agente }]) },
    chatProject: {
      findUnique: vi.fn(async () => ({
        ...db.proyecto,
        name: 'Comex',
        description: 'Importaciones',
        instructions: 'Solo comex',
        profile: 'olp',
        company: { company: 'OLP ' },
        files: [{ file_name: 'plan.xlsx' }],
        agents: [{ agent: agente }],
        subagents: db.subagentes.filter((s) => s.status === 'aprobado'),
      })),
      update: vi.fn(async (a: { data: Fila }) => Object.assign(db.proyecto, a.data)),
    },
    chatConversation: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  prisma.$queryRaw = vi.fn(async () => []);
  return { prisma };
});
vi.mock('../../mssqlPool', () => ({ sql: {}, withMssqlPool: vi.fn(async () => { throw new Error('sin SQL'); }) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: sessionUser };
});
vi.mock('../../chat/projects', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/projects')>();
  return { ...real, resolveProjectForUser: resolveProject, writeAccessForAgent: writeAccess, assertAgentProjectConversation: assertAgentConv };
});
vi.mock('../../chat/projects-links', () => ({ vinculosDelProyecto: vi.fn(async () => ({ emails: [{ subject: 'DIM 123' }], requests: [] })) }));
vi.mock('../cronograma', () => ({ cronogramaParaAgente: vi.fn(async () => ({ tasks: [{ title: 'Radicar', startDate: '2026-10-20', endDate: '2026-10-22', status: 'pendiente' }] })) }));
vi.mock('../../chat/agent-auth', () => ({ authenticateAgent }));

import { NextRequest } from 'next/server';
import { GET as verEquipo, PATCH as configurar } from '../../../app/api/proyectos/[id]/equipo/route';
import { POST as sugerir } from '../../../app/api/proyectos/[id]/equipo/sugerencias/route';
import { PATCH as cambiarSub } from '../../../app/api/proyectos/[id]/equipo/[subId]/route';
import { POST as reclamar } from '../../../app/api/chat/agent/projects/team/requests/route';
import { POST as entregar } from '../../../app/api/chat/agent/projects/team/suggestions/route';
import { POST as corridasRuta } from '../../../app/api/chat/agent/projects/team/runs/route';
import { equipoParaAgente } from '../equipo';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };
const proyecto = (role: 'owner' | 'editor' | 'reader', archived = false) => ({ idProject: 7, name: 'Comex', idCompany: 3, profile: 'olp', role, archived });
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://x${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const p = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: '7', subId: '', ...extra }) });

function sub(over: Fila = {}): Fila {
  const f = { id_subagent: ++db.seq, id_project: 7, slug: `sub-${db.seq}`, name: 'Analista SAP', purpose: 'Consulta inventario', instructions: null, tools: 'archivos,conectores', model: null, status: 'propuesto', origin: 'agente', id_agent: 5, created_at: new Date(), reviewed_by: null, reviewed_at: null, ...over };
  db.subagentes.push(f);
  return f;
}

beforeEach(() => {
  db.subagentes = [];
  db.pedidos = [];
  db.corridas = [];
  db.eventos = [];
  db.proyecto = { team_enabled: true, team_max_parallel: 3 };
  sessionUser.mockResolvedValue(ANA);
  writeAccess.mockResolvedValue({ ok: true });
  authenticateAgent.mockResolvedValue({ idAgent: 5, code: 'horus', scope: 'projects' });
});
afterEach(() => {
  delete process.env.PROYECTOS_EQUIPO_EDITOR_APRUEBA;
});

describe('equipo de subagentes · persona', () => {
  it('un NO miembro recibe 404 en todo', async () => {
    resolveProject.mockResolvedValue(null);
    const s = sub();
    expect((await verEquipo(req('/api/proyectos/7/equipo'), p())).status).toBe(404);
    expect((await configurar(req('/api/proyectos/7/equipo', 'PATCH', { enabled: false }), p())).status).toBe(404);
    expect((await sugerir(req('/api/proyectos/7/equipo/sugerencias', 'POST', {}), p())).status).toBe(404);
    expect((await cambiarSub(req('/x', 'PATCH', { action: 'aprobar' }), p({ subId: String(s.id_subagent) }))).status).toBe(404);
    expect(s.status).toBe('propuesto');
  });

  it('el LECTOR ve el equipo pero no pide, no aprueba ni configura', async () => {
    resolveProject.mockResolvedValue(proyecto('reader'));
    const s = sub();
    const r = await verEquipo(req('/api/proyectos/7/equipo'), p());
    expect(r.status).toBe(200);
    const { team } = await r.json();
    expect(team.capacidades).toEqual({ ver: true, sugerir: false, aprobar: false, configurar: false });
    expect(team.members).toHaveLength(1);
    expect((await sugerir(req('/x', 'POST', {}), p())).status).toBe(403);
    expect((await cambiarSub(req('/x', 'PATCH', { action: 'aprobar' }), p({ subId: String(s.id_subagent) }))).status).toBe(403);
    expect((await configurar(req('/x', 'PATCH', { enabled: false }), p())).status).toBe(403);
    expect(s.status).toBe('propuesto');
    expect(db.pedidos).toHaveLength(0);
  });

  it('el EDITOR pide una sugerencia, pero NO aprueba (salvo la bandera) ni configura', async () => {
    resolveProject.mockResolvedValue(proyecto('editor'));
    const r = await sugerir(req('/x', 'POST', {}), p());
    expect(r.status).toBe(201);
    expect(db.pedidos).toHaveLength(1);
    expect(db.eventos.map((e) => e.action)).toEqual(['pedir']);

    const s = sub();
    const neg = await cambiarSub(req('/x', 'PATCH', { action: 'aprobar' }), p({ subId: String(s.id_subagent) }));
    expect(neg.status).toBe(403);
    expect((await neg.json()).error).toMatch(/Solo el dueño/);
    expect((await configurar(req('/x', 'PATCH', { maxParallel: 2 }), p())).status).toBe(403);

    process.env.PROYECTOS_EQUIPO_EDITOR_APRUEBA = '1';
    expect((await cambiarSub(req('/x', 'PATCH', { action: 'aprobar' }), p({ subId: String(s.id_subagent) }))).status).toBe(200);
    expect(s.status).toBe('aprobado');
    expect((await configurar(req('/x', 'PATCH', { maxParallel: 2 }), p())).status).toBe(403);
  });

  it('pedir sugerencia exige un asistente que la persona pueda usar, y una a la vez', async () => {
    resolveProject.mockResolvedValue(proyecto('owner'));
    writeAccess.mockResolvedValueOnce({ ok: false, motivo: 'Usted no tiene este asistente asignado en la empresa del proyecto.' });
    const neg = await sugerir(req('/x', 'POST', {}), p());
    expect(neg.status).toBe(403);
    expect((await neg.json()).error).toMatch(/no tiene este asistente/);
    expect((await sugerir(req('/x', 'POST', { agentCode: 'otro' }), p())).status).toBe(400);
    expect((await sugerir(req('/x', 'POST', { agentCode: 'horus' }), p())).status).toBe(201);
    const otra = await sugerir(req('/x', 'POST', {}), p());
    expect(otra.status).toBe(409);
  });

  it('archivado: nadie cambia el equipo', async () => {
    resolveProject.mockResolvedValue(proyecto('owner', true));
    const s = sub();
    expect((await sugerir(req('/x', 'POST', {}), p())).status).toBe(403);
    expect((await cambiarSub(req('/x', 'PATCH', { action: 'aprobar' }), p({ subId: String(s.id_subagent) }))).status).toBe(403);
    expect((await configurar(req('/x', 'PATCH', { enabled: false }), p())).status).toBe(403);
  });

  it('el DUEÑO aprueba, edita dentro del catálogo y del perfil, descarta y restaura; todo con auditoría', async () => {
    resolveProject.mockResolvedValue(proyecto('owner'));
    const s = sub();
    const id = String(s.id_subagent);
    // Catálogo cerrado: nada de Bash.
    const bash = await cambiarSub(req('/x', 'PATCH', { tools: ['archivos', 'bash'] }), p({ subId: id }));
    expect(bash.status).toBe(400);
    expect((await bash.json()).error).toMatch(/fuera del catálogo/);
    // Modelo desconocido.
    expect((await cambiarSub(req('/x', 'PATCH', { model: 'gpt-5' }), p({ subId: id }))).status).toBe(400);
    // Editar y aprobar de una vez.
    const ok = await cambiarSub(req('/x', 'PATCH', { action: 'aprobar', name: 'Analista de inventario', tools: ['archivos', 'conectores', 'web'], model: 'haiku' }), p({ subId: id }));
    expect(ok.status).toBe(200);
    expect(s).toMatchObject({ status: 'aprobado', name: 'Analista de inventario', tools: 'archivos,web,conectores', model: 'haiku', reviewed_by: ANA.id });
    expect(db.eventos.map((e) => e.action)).toEqual(['editar', 'aprobar']);
    expect(JSON.parse(db.eventos[0].changes as string)).toMatchObject({ name: ['Analista SAP', 'Analista de inventario'] });
    // Descartar y restaurar.
    expect((await cambiarSub(req('/x', 'PATCH', { action: 'descartar' }), p({ subId: id }))).status).toBe(200);
    expect(s.status).toBe('descartado');
    expect((await cambiarSub(req('/x', 'PATCH', { name: 'Otro' }), p({ subId: id }))).status).toBe(409);
    expect((await cambiarSub(req('/x', 'PATCH', { action: 'restaurar' }), p({ subId: id }))).status).toBe(200);
    expect(s.status).toBe('propuesto');
  });

  it('un perfil sin web no admite «Navegar en internet»', async () => {
    resolveProject.mockResolvedValue({ ...proyecto('owner'), profile: 'ryan' });
    const s = sub();
    const r = await cambiarSub(req('/x', 'PATCH', { tools: ['archivos', 'web'] }), p({ subId: String(s.id_subagent) }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/no admite/);
  });

  it('máximo 6 aprobados; tope de simultáneos de 1 a 5', async () => {
    resolveProject.mockResolvedValue(proyecto('owner'));
    for (let i = 0; i < 6; i += 1) sub({ status: 'aprobado' });
    const s = sub();
    expect((await cambiarSub(req('/x', 'PATCH', { action: 'aprobar' }), p({ subId: String(s.id_subagent) }))).status).toBe(409);
    expect((await configurar(req('/x', 'PATCH', { maxParallel: 9 }), p())).status).toBe(400);
    expect((await configurar(req('/x', 'PATCH', { maxParallel: 0 }), p())).status).toBe(400);
    expect((await configurar(req('/x', 'PATCH', { maxParallel: 2, enabled: false }), p())).status).toBe(200);
    expect(db.proyecto).toMatchObject({ team_max_parallel: 2, team_enabled: false });
    expect(db.eventos.at(-1)).toMatchObject({ action: 'configurar', via: 'web', id_user: ANA.id });
  });
});

describe('equipo de subagentes · puente', () => {
  it('solo con la llave del puente (scope projects)', async () => {
    authenticateAgent.mockResolvedValue({ idAgent: 5, code: 'horus', scope: 'channel' });
    expect((await reclamar(req('/x', 'POST', {}))).status).toBe(404);
    expect((await entregar(req('/x', 'POST', { idRequest: 1, items: [] }))).status).toBe(404);
    expect((await corridasRuta(req('/x', 'POST', { idConversation: 40, runs: [] }))).status).toBe(404);
    authenticateAgent.mockResolvedValue(null);
    expect((await reclamar(req('/x', 'POST', {}))).status).toBe(401);
  });

  it('reclama SUS pedidos (una sola vez) con la ficha del proyecto, sin cuerpos de correo', async () => {
    db.pedidos.push({ id_request: 1, id_project: 7, id_agent: 5, status: 'pendiente', requested_at: new Date() });
    db.pedidos.push({ id_request: 2, id_project: 7, id_agent: 9, status: 'pendiente', requested_at: new Date() });
    const r = await reclamar(req('/x', 'POST', {}));
    const { requests } = await r.json();
    expect(requests.map((x: Fila) => x.idRequest)).toEqual([1]);
    expect(requests[0].project).toMatchObject({ name: 'Comex', profileKey: 'olp', companyName: 'OLP' });
    expect(requests[0].emails).toEqual(['DIM 123']);
    expect(requests[0].tasks[0]).toMatch(/Radicar/);
    expect(db.pedidos[0].status).toBe('en_curso');
    expect(db.pedidos[1].status).toBe('pendiente');
    const otra = await (await reclamar(req('/x', 'POST', {}))).json();
    expect(otra.requests).toEqual([]);
  });

  it('entrega: los subagentes quedan PROPUESTOS y recortados al catálogo; los propuestos viejos se descartan', async () => {
    const viejo = sub();
    const aprobado = sub({ status: 'aprobado', slug: 'analista-sap' });
    db.pedidos.push({ id_request: 1, id_project: 7, id_agent: 5, status: 'en_curso', requested_at: new Date(), project: { profile: 'olp' } });
    const r = await entregar(
      req('/x', 'POST', {
        idRequest: 1,
        items: [
          { name: 'Analista SAP', purpose: 'Inventario', instructions: 'Lotes', tools: ['conectores', 'bash'], model: 'gpt' },
          { name: 'x', purpose: 'muy corto' },
          { name: 'Investigador INVIMA', purpose: 'Normativa', tools: ['web'], model: 'haiku' },
        ],
        tokens: { input: 10, output: 20 },
      })
    );
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ creados: 2, rechazados: 1 });
    const nuevos = db.subagentes.filter((s) => s.id_request === 1);
    expect(nuevos.map((s) => [s.slug, s.status, s.tools, s.model])).toEqual([
      ['analista-sap-2', 'propuesto', 'archivos,conectores', null],
      ['investigador-invima', 'propuesto', 'archivos,web', 'haiku'],
    ]);
    expect(viejo.status).toBe('descartado');
    expect(aprobado.status).toBe('aprobado');
    expect(db.pedidos[0]).toMatchObject({ status: 'lista', suggested: 2, total_tokens: 30 });
    expect(db.eventos.filter((e) => e.action === 'sugerir')).toHaveLength(2);
  });

  it('entrega de un pedido ajeno o no reclamado: 404; un error deja el pedido fallido', async () => {
    db.pedidos.push({ id_request: 1, id_project: 7, id_agent: 9, status: 'en_curso', requested_at: new Date() });
    db.pedidos.push({ id_request: 2, id_project: 7, id_agent: 5, status: 'pendiente', requested_at: new Date() });
    expect((await entregar(req('/x', 'POST', { idRequest: 1, items: [] }))).status).toBe(404);
    expect((await entregar(req('/x', 'POST', { idRequest: 2, items: [] }))).status).toBe(404);
    db.pedidos.push({ id_request: 3, id_project: 7, id_agent: 5, status: 'en_curso', requested_at: new Date(), project: { profile: 'olp' } });
    expect((await entregar(req('/x', 'POST', { idRequest: 3, error: 'sin cupo' }))).status).toBe(201);
    expect(db.pedidos[2]).toMatchObject({ status: 'fallida', error: 'sin cupo' });
  });

  it('corridas: solo en conversaciones suyas; se normalizan y un bloqueo queda en la auditoría', async () => {
    assertAgentConv.mockResolvedValueOnce(null);
    expect((await corridasRuta(req('/x', 'POST', { idConversation: 99, runs: [] }))).status).toBe(404);
    const s = sub({ status: 'aprobado', slug: 'redactor' });
    assertAgentConv.mockResolvedValueOnce({ id: 40, idProject: 7, projectName: 'Comex' });
    const r = await corridasRuta(
      req('/x', 'POST', {
        idConversation: 40,
        sessionId: 's1',
        turnStartedAt: '2026-10-18T20:00:00Z',
        blocked: ['el subagente redactor usó una herramienta fuera de su lista: Bash'],
        runs: [
          { slug: 'redactor', description: 'Borrador', status: 'ok', totalTokens: 500, toolUses: 2, durationMs: 1200 },
          { slug: '../../etc', description: 'x', status: 'ok' },
          { slug: 'redactor', description: 'Segundo', status: 'raro', totalTokens: -5 },
        ],
      })
    );
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ registradas: 2 });
    expect(db.corridas.map((c) => [c.slug, c.status, c.total_tokens, c.id_subagent, c.id_conversation])).toEqual([
      ['redactor', 'ok', 500, s.id_subagent, 40],
      ['redactor', 'cancelado', 0, s.id_subagent, 40],
    ]);
    expect(db.eventos.at(-1)).toMatchObject({ action: 'bloqueo', via: 'puente', id_agent: 5 });
  });

  it('el contexto del puente solo trae lo APROBADO, con el interruptor y el tope', async () => {
    sub({ status: 'propuesto', slug: 'propuesto-uno' });
    sub({ status: 'descartado', slug: 'descartado-uno' });
    sub({ status: 'aprobado', slug: 'aprobado-uno', tools: 'archivos,trabajo', model: 'sonnet' });
    db.proyecto.team_max_parallel = 4;
    const t = await equipoParaAgente(7);
    expect(t.enabled).toBe(true);
    expect(t.maxParallel).toBe(4);
    expect(t.members.map((m) => [m.slug, m.tools, m.model])).toEqual([['aprobado-uno', ['archivos', 'trabajo'], 'sonnet']]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Cronograma y propuestas del módulo «Proyectos» (2026-10-18), del lado de las rutas:
 *   - un NO miembro recibe 404 en todas las rutas nuevas;
 *   - el LECTOR ve, pero no crea, no edita, no borra, no fija fechas ni confirma (403);
 *   - el EDITOR crea y edita, pero solo borra lo suyo; el responsable debe ser miembro;
 *   - una propuesta sin confirmación no cambia nada; confirmar ejecuta con la identidad,
 *     el rol y la VISIBILIDAD DE SOLICITUDES de quien confirma; una del MCP solo la confirma
 *     la persona a cuyo nombre actuó el agente; el candado impide confirmar dos veces;
 *   - el puente entrega propuestas solo con su llave y solo en conversaciones de su agente;
 *   - las concesiones son de la persona (las ajenas, 404).
 * Base simulada en memoria (Prisma y SQL Server).
 */

type Fila = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tareas: [] as Fila[],
  eventos: [] as Fila[],
  propuestas: [] as Fila[],
  grants: [] as Fila[],
  solicitudes: [] as Fila[],
  miembros: [] as Fila[],
  mensajes: [] as Fila[],
  seq: 100,
}));
const sessionUser = vi.hoisted(() => vi.fn());
const resolveProject = vi.hoisted(() => vi.fn());
const solicitudVisible = vi.hoisted(() => vi.fn());
const authenticateAgent = vi.hoisted(() => vi.fn());
const assertAgentConv = vi.hoisted(() => vi.fn());

function coincide(f: Fila, where: Fila | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      if ('gt' in o) return (f[k] as Date) > (o.gt as Date);
      if ('lte' in o) return (f[k] as Date) <= (o.lte as Date);
      if ('in' in o) return (o.in as unknown[]).includes(f[k]);
      return true;
    }
    return f[k] === v;
  });
}

vi.mock('../../prisma', () => {
  const tabla = (nombre: keyof typeof db, idCampo: string) => ({
    findMany: vi.fn(async (a?: { where?: Fila }) => (db[nombre] as Fila[]).filter((f) => coincide(f, a?.where))),
    findFirst: vi.fn(async (a?: { where?: Fila }) => (db[nombre] as Fila[]).find((f) => coincide(f, a?.where)) ?? null),
    count: vi.fn(async (a?: { where?: Fila }) => (db[nombre] as Fila[]).filter((f) => coincide(f, a?.where)).length),
    create: vi.fn(async (a: { data: Fila }) => {
      const f = { [idCampo]: ++db.seq, created_at: new Date(), ...a.data };
      (db[nombre] as Fila[]).push(f);
      return f;
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
    delete: vi.fn(async (a: { where: Fila }) => {
      const i = (db[nombre] as Fila[]).findIndex((x) => coincide(x, a.where));
      return i >= 0 ? (db[nombre] as Fila[]).splice(i, 1)[0] : null;
    }),
  });
  const prisma: Record<string, unknown> = {
    chatProjectTask: tabla('tareas', 'id_project_task'),
    chatProjectEvent: tabla('eventos', 'id_event'),
    chatProjectProposal: tabla('propuestas', 'id_proposal'),
    chatProjectGrant: tabla('grants', 'id_grant'),
    chatProjectRequest: tabla('solicitudes', 'id_project_request'),
    chatMessage: tabla('mensajes', 'id'),
    chatProjectEmail: { count: vi.fn(async () => 0) },
    chatProjectMember: {
      ...tabla('miembros', 'id_project_member'),
      findMany: vi.fn(async (a?: { where?: Fila }) =>
        db.miembros.filter((f) => coincide(f, a?.where)).map((m) => ({ ...m, user: { name: m.name, email: m.email } }))
      ),
    },
    chatProject: { update: vi.fn(async () => ({})) },
    chatConversation: { update: vi.fn(async () => ({})), count: vi.fn(async () => 0) },
    user: { findMany: vi.fn(async () => []) },
    agent: { findFirst: vi.fn(async () => ({ display_name: 'Orus', code: 'horus' })), findMany: vi.fn(async () => []) },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});
vi.mock('../../mssqlPool', () => ({
  sql: { Int: 'Int', NVarChar: () => 'NVarChar' },
  withMssqlPool: vi.fn(async () => {
    throw new Error('sin SQL en la prueba');
  }),
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: sessionUser };
});
vi.mock('../../chat/projects', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/projects')>();
  return {
    ...real,
    resolveProjectForUser: resolveProject,
    projectModuleCompanies: vi.fn(async () => [{ idCompany: 3, companyName: 'OLP' }]),
    assertAgentProjectConversation: assertAgentConv,
  };
});
vi.mock('../../correo/kronos', () => ({ solicitudVisible }));
vi.mock('../../chat/agent-auth', () => ({ authenticateAgent }));

import { NextRequest } from 'next/server';
import { GET as verCronograma } from '../../../app/api/proyectos/[id]/cronograma/route';
import { POST as crearTareaRuta } from '../../../app/api/proyectos/[id]/cronograma/tareas/route';
import { DELETE as borrarTareaRuta, GET as historialRuta, PATCH as editarTareaRuta } from '../../../app/api/proyectos/[id]/cronograma/tareas/[taskId]/route';
import { PATCH as fechaObjetivoRuta } from '../../../app/api/proyectos/[id]/cronograma/solicitudes/[linkId]/route';
import { POST as decidirRuta } from '../../../app/api/proyectos/[id]/propuestas/[proposalId]/route';
import { DELETE as revocarRuta } from '../../../app/api/proyectos/concesiones/route';
import { POST as puenteRuta } from '../../../app/api/chat/agent/projects/proposals/route';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };
const LUIS = { id: 'u-luis', email: 'luis@gsslatam.com' };
const proyecto = (role: 'owner' | 'editor' | 'reader', archived = false) => ({ idProject: 7, name: 'Comex', idCompany: 3, profile: 'olp', role, archived });
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://x${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
// Contexto de ruta con los parámetros que cada una espera (id + taskId / linkId / proposalId).
const p = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: '7', taskId: '', linkId: '', proposalId: '', ...extra }) });

function tarea(over: Fila = {}): Fila {
  const f = {
    id_project_task: ++db.seq,
    id_project: 7,
    title: 'Radicar DIM',
    description: null,
    id_responsible: null,
    start_date: new Date('2026-10-10T00:00:00Z'),
    end_date: new Date('2026-10-15T00:00:00Z'),
    status: 'pendiente',
    progress: null,
    is_milestone: false,
    origin: 'persona',
    created_by: LUIS.id,
    created_at: new Date(),
    updated_by: null,
    updated_at: null,
    ...over,
  };
  db.tareas.push(f);
  return f;
}

function propuesta(over: Fila = {}): Fila {
  const f = {
    id_proposal: ++db.seq,
    id_project: 7,
    kind: 'tarea_crear',
    payload: JSON.stringify({ kind: 'tarea_crear', tarea: { title: 'Revisar DIM', startDate: '2026-10-20' } }),
    summary: 'Tarea «Revisar DIM»',
    status: 'pendiente',
    source: 'puente',
    id_agent: 21,
    id_conversation: 40,
    id_grant: null,
    requested_for: null,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 3600_000),
    ...over,
  };
  db.propuestas.push(f);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ['tareas', 'eventos', 'propuestas', 'grants', 'solicitudes', 'miembros', 'mensajes'] as const) db[k] = [];
  db.miembros.push(
    { id_project: 7, id_user: ANA.id, name: 'Ana', email: ANA.email, role: 'editor' },
    { id_project: 7, id_user: LUIS.id, name: 'Luis', email: LUIS.email, role: 'owner' }
  );
  sessionUser.mockResolvedValue(ANA);
  solicitudVisible.mockResolvedValue(null);
});

describe('un NO miembro: 404 en todo el cronograma', () => {
  it('ver, crear, editar, borrar, historial, fecha objetivo y decidir propuestas', async () => {
    resolveProject.mockResolvedValue(null);
    const t = tarea();
    const pr = propuesta();
    const r = await Promise.all([
      verCronograma(req('/x'), p()),
      crearTareaRuta(req('/x', 'POST', { title: 'x', startDate: '2026-10-20' }), p()),
      editarTareaRuta(req('/x', 'PATCH', { status: 'hecha' }), p({ taskId: String(t.id_project_task) })),
      borrarTareaRuta(req('/x', 'DELETE'), p({ taskId: String(t.id_project_task) })),
      historialRuta(req('/x'), p({ taskId: String(t.id_project_task) })),
      fechaObjetivoRuta(req('/x', 'PATCH', { targetDate: '2026-10-30' }), p({ linkId: '1' })),
      decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) })),
    ]);
    expect(r.map((x) => x.status)).toEqual(Array(7).fill(404));
    expect(db.tareas).toHaveLength(1);
    expect(db.tareas[0]!.status).toBe('pendiente');
    expect(db.propuestas[0]!.status).toBe('pendiente');
    expect(db.eventos).toHaveLength(0);
  });
});

describe('un LECTOR', () => {
  beforeEach(() => resolveProject.mockResolvedValue(proyecto('reader')));

  it('ve el cronograma (con avisos si SQL falla), pero sin poder crear', async () => {
    const r = await verCronograma(req('/x'), p());
    expect(r.status).toBe(200);
    const d = (await r.json()).cronograma;
    expect(d.capabilities).toEqual({ crear: false, vincular: false, fijarFecha: false });
  });

  it('no crea, no edita, no borra, no fija fechas y no confirma ni rechaza (403)', async () => {
    const t = tarea();
    const pr = propuesta();
    db.solicitudes.push({ id_project_request: 1, id_project: 7, id_request: 55, target_date: null, linked_by: LUIS.id });
    const r = await Promise.all([
      crearTareaRuta(req('/x', 'POST', { title: 'x', startDate: '2026-10-20' }), p()),
      editarTareaRuta(req('/x', 'PATCH', { status: 'hecha' }), p({ taskId: String(t.id_project_task) })),
      borrarTareaRuta(req('/x', 'DELETE'), p({ taskId: String(t.id_project_task) })),
      fechaObjetivoRuta(req('/x', 'PATCH', { targetDate: '2026-10-30' }), p({ linkId: '1' })),
      decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) })),
      decidirRuta(req('/x', 'POST', { accion: 'rechazar' }), p({ proposalId: String(pr.id_proposal) })),
    ]);
    expect(r.map((x) => x.status)).toEqual(Array(6).fill(403));
    expect(db.tareas).toHaveLength(1);
    expect(db.tareas[0]!.status).toBe('pendiente');
    expect(db.solicitudes[0]!.target_date).toBeNull();
    expect(db.propuestas[0]!.status).toBe('pendiente');
  });
});

describe('un EDITOR', () => {
  beforeEach(() => resolveProject.mockResolvedValue(proyecto('editor')));

  it('crea una tarea y queda auditada (quién y cuándo)', async () => {
    const r = await crearTareaRuta(req('/x', 'POST', { title: 'Revisar DIM', startDate: '2026-10-20', endDate: '2026-10-22', idResponsible: LUIS.id }), p());
    expect(r.status).toBe(201);
    expect(db.tareas[0]).toMatchObject({ title: 'Revisar DIM', created_by: ANA.id, id_responsible: LUIS.id, origin: 'persona' });
    expect(db.eventos[0]).toMatchObject({ entity: 'tarea', action: 'crear', id_user: ANA.id, via: 'web' });
  });

  it('el responsable debe ser miembro; datos inválidos → 400', async () => {
    expect((await crearTareaRuta(req('/x', 'POST', { title: 'x', startDate: '2026-10-20', idResponsible: 'u-extrano' }), p())).status).toBe(400);
    expect((await crearTareaRuta(req('/x', 'POST', { title: 'x', startDate: '2026-10-20', endDate: '2026-10-01' }), p())).status).toBe(400);
    expect(db.tareas).toHaveLength(0);
  });

  it('edita el estado y el avance de cualquier tarea: queda quién la cambió y qué', async () => {
    const t = tarea();
    const r = await editarTareaRuta(req('/x', 'PATCH', { status: 'en_curso', progress: 40 }), p({ taskId: String(t.id_project_task) }));
    expect(r.status).toBe(200);
    expect(db.tareas[0]).toMatchObject({ status: 'en_curso', progress: 40, updated_by: ANA.id });
    expect(db.eventos[0]).toMatchObject({ action: 'estado', id_user: ANA.id });
    expect(String(db.eventos[0]!.detail)).toMatch(/estado: Pendiente → En curso; avance: — → 40 %/);
  });

  it('solo borra las tareas que creó; la tarea de otro proyecto es 404', async () => {
    const ajena = tarea({ created_by: LUIS.id });
    const mia = tarea({ created_by: ANA.id });
    const otra = tarea({ id_project: 99 });
    expect((await borrarTareaRuta(req('/x', 'DELETE'), p({ taskId: String(ajena.id_project_task) }))).status).toBe(403);
    expect((await borrarTareaRuta(req('/x', 'DELETE'), p({ taskId: String(otra.id_project_task) }))).status).toBe(404);
    expect((await borrarTareaRuta(req('/x', 'DELETE'), p({ taskId: String(mia.id_project_task) }))).status).toBe(200);
    expect(db.tareas.map((x) => x.id_project_task)).toEqual([ajena.id_project_task, otra.id_project_task]);
    expect(db.eventos.map((e) => e.action)).toEqual(['borrar']);
  });

  it('fija la fecha objetivo de una solicitud vinculada (y se audita)', async () => {
    db.solicitudes.push({ id_project_request: 1, id_project: 7, id_request: 55, target_date: null, linked_by: LUIS.id });
    expect((await fechaObjetivoRuta(req('/x', 'PATCH', { targetDate: '2026-10-30' }), p({ linkId: '1' }))).status).toBe(200);
    expect((db.solicitudes[0]!.target_date as Date).toISOString().slice(0, 10)).toBe('2026-10-30');
    expect(db.eventos[0]).toMatchObject({ entity: 'solicitud', id_entity: 55, action: 'fecha_objetivo' });
    expect((await fechaObjetivoRuta(req('/x', 'PATCH', { targetDate: '30/10/2026' }), p({ linkId: '1' }))).status).toBe(400);
  });

  it('un proyecto archivado no se cambia', async () => {
    resolveProject.mockResolvedValue(proyecto('owner', true));
    expect((await crearTareaRuta(req('/x', 'POST', { title: 'x', startDate: '2026-10-20' }), p())).status).toBe(403);
  });
});

describe('propuestas: nada cambia sin confirmar; al confirmar, con los permisos de quien confirma', () => {
  it('una propuesta pendiente no ha creado ninguna tarea; el editor la confirma y la tarea queda como «agente»', async () => {
    resolveProject.mockResolvedValue(proyecto('editor'));
    const pr = propuesta();
    expect(db.tareas).toHaveLength(0);
    const r = await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }));
    expect(r.status).toBe(200);
    expect(db.tareas[0]).toMatchObject({ title: 'Revisar DIM', created_by: ANA.id, origin: 'agente' });
    expect(db.propuestas[0]).toMatchObject({ status: 'confirmada', decided_by: ANA.id });
    expect(db.eventos.map((e) => `${e.entity}:${e.action}:${e.via}`)).toEqual(['tarea:crear:puente', 'propuesta:confirmar:web']);
    // Segundo clic: el candado ya la decidió.
    expect((await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }))).status).toBe(409);
    expect(db.tareas).toHaveLength(1);
  });

  it('una propuesta del MCP solo la confirma la persona a cuyo nombre actuó el agente', async () => {
    db.grants.push({ id_grant: 31, id_user: LUIS.id, revoked_at: null, expires_at: new Date(Date.now() + 3600_000) });
    const pr = propuesta({ source: 'mcp', requested_for: LUIS.id, id_grant: 31 });
    resolveProject.mockResolvedValue(proyecto('editor'));
    const r = await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }));
    expect(r.status).toBe(403);
    expect(db.tareas).toHaveLength(0);
    sessionUser.mockResolvedValue(LUIS);
    resolveProject.mockResolvedValue(proyecto('owner'));
    expect((await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }))).status).toBe(200);
    expect(db.tareas).toHaveLength(1);
  });

  it('con la concesión vencida o revocada, la propuesta del MCP ya no se confirma (410)', async () => {
    db.grants.push({ id_grant: 31, id_user: LUIS.id, revoked_at: new Date(), expires_at: new Date(Date.now() + 3600_000) });
    const pr = propuesta({ source: 'mcp', requested_for: LUIS.id, id_grant: 31 });
    sessionUser.mockResolvedValue(LUIS);
    resolveProject.mockResolvedValue(proyecto('owner'));
    expect((await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }))).status).toBe(410);
    expect(db.tareas).toHaveLength(0);
  });

  it('vincular una solicitud: se valida la VISIBILIDAD de quien confirma; si no la ve, 404 y la propuesta sigue pendiente', async () => {
    resolveProject.mockResolvedValue(proyecto('editor'));
    const pr = propuesta({ kind: 'solicitud_vincular', payload: JSON.stringify({ kind: 'solicitud_vincular', idRequest: 18342 }) });
    const r = await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }));
    expect(r.status).toBe(404);
    expect(solicitudVisible).toHaveBeenCalledWith(ANA.id, 18342);
    expect(db.solicitudes).toHaveLength(0);
    expect(db.propuestas[0]).toMatchObject({ status: 'pendiente', decided_by: null });
    expect(db.eventos.map((e) => e.action)).toEqual(['fallar']);
    // Con una solicitud que sí ve (de la empresa del proyecto), se vincula.
    solicitudVisible.mockResolvedValue({ id: 18342, asunto: 'Proveedor', idCompany: 3, proceso: 'Datos maestros' });
    expect((await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }))).status).toBe(200);
    expect(db.solicitudes[0]).toMatchObject({ id_request: 18342, linked_by: ANA.id });
  });

  it('una solicitud de OTRA empresa no se vincula aunque la persona la vea', async () => {
    resolveProject.mockResolvedValue(proyecto('owner'));
    solicitudVisible.mockResolvedValue({ id: 18342, asunto: 'x', idCompany: 10, proceso: null });
    const pr = propuesta({ kind: 'solicitud_vincular', payload: JSON.stringify({ kind: 'solicitud_vincular', idRequest: 18342 }) });
    expect((await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }))).status).toBe(404);
    expect(db.solicitudes).toHaveLength(0);
  });

  it('un payload alterado en la base no se ejecuta (se revalida al confirmar)', async () => {
    resolveProject.mockResolvedValue(proyecto('owner'));
    const pr = propuesta({ payload: JSON.stringify({ kind: 'tarea_crear', tarea: { title: '', startDate: 'mañana' } }) });
    expect((await decidirRuta(req('/x', 'POST', { accion: 'confirmar' }), p({ proposalId: String(pr.id_proposal) }))).status).toBe(400);
    expect(db.tareas).toHaveLength(0);
  });

  it('rechazar: no cambia nada y queda auditado', async () => {
    resolveProject.mockResolvedValue(proyecto('editor'));
    const pr = propuesta();
    expect((await decidirRuta(req('/x', 'POST', { accion: 'rechazar' }), p({ proposalId: String(pr.id_proposal) }))).status).toBe(200);
    expect(db.tareas).toHaveLength(0);
    expect(db.propuestas[0]!.status).toBe('rechazada');
    expect(db.eventos.map((e) => e.action)).toEqual(['rechazar']);
  });
});

describe('el puente entrega propuestas', () => {
  it('solo con su llave (scope projects) y solo en conversaciones de su agente', async () => {
    authenticateAgent.mockResolvedValue(null);
    expect((await puenteRuta(req('/x', 'POST', { idConversation: 40, items: [] }))).status).toBe(401);
    authenticateAgent.mockResolvedValue({ idAgent: 21, scope: 'agent' });
    expect((await puenteRuta(req('/x', 'POST', { idConversation: 40, items: [] }))).status).toBe(404);
    authenticateAgent.mockResolvedValue({ idAgent: 21, scope: 'projects' });
    assertAgentConv.mockResolvedValue(null);
    expect((await puenteRuta(req('/x', 'POST', { idConversation: 40, items: [] }))).status).toBe(404);
    expect(db.propuestas).toHaveLength(0);
  });

  it('valida cada propuesta (solo tareas) y no cambia el cronograma', async () => {
    authenticateAgent.mockResolvedValue({ idAgent: 21, scope: 'projects' });
    assertAgentConv.mockResolvedValue({ id: 40, idProject: 7, projectName: 'Comex' });
    const t = tarea();
    const r = await puenteRuta(
      req('/x', 'POST', {
        idConversation: 40,
        items: [
          { kind: 'tarea_crear', tarea: { title: 'Revisar', startDate: '2026-10-20' } },
          { kind: 'tarea_editar', idTask: t.id_project_task, tarea: { status: 'hecha' } },
          { kind: 'tarea_editar', idTask: 999, tarea: { status: 'hecha' } },
          { kind: 'miembro_invitar', email: 'x@y.com', role: 'editor' },
        ],
      })
    );
    expect(r.status).toBe(201);
    const d = await r.json();
    expect(d.creadas).toHaveLength(2);
    expect(d.rechazadas.map((x: { indice: number }) => x.indice)).toEqual([2, 3]);
    expect(db.propuestas.map((x) => `${x.kind}:${x.source}:${x.status}`)).toEqual(['tarea_crear:puente:pendiente', 'tarea_editar:puente:pendiente']);
    expect(db.tareas).toHaveLength(1);
    expect(db.tareas[0]!.status).toBe('pendiente');
    expect(db.eventos.every((e) => e.action === 'proponer' && e.via === 'puente' && e.id_user === null)).toBe(true);
  });
});

describe('concesiones', () => {
  it('revocar la de OTRA persona → 404 y no cambia nada', async () => {
    db.grants.push({ id_grant: 31, id_user: LUIS.id, revoked_at: null, expires_at: new Date(Date.now() + 3600_000) });
    const r = await revocarRuta(req('/api/proyectos/concesiones?id=31', 'DELETE'));
    expect(r.status).toBe(404);
    expect(db.grants[0]!.revoked_at).toBeNull();
  });
});

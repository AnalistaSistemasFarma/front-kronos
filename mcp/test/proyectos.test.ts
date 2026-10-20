/**
 * Proyectos desde un agente (2026-10-18): herramientas proyecto_* del MCP.
 *   - Identidad SOLO por la concesión (pg_…) + el agente de la llave; ninguna herramienta
 *     recibe a nombre de quién actúa.
 *   - Un NO miembro (o sin el permiso del módulo, o proyecto archivado) recibe el rechazo de
 *     «proyecto no encontrado» (el 404 del MCP).
 *   - Un LECTOR no puede proponer; solo el dueño propone invitaciones.
 *   - Una propuesta NO cambia nada: solo inserta chat_project_proposal 'pendiente', el aviso en
 *     el chat de la concesión y la auditoría. Nunca toca chat_project_task ni los vínculos.
 *   - Las fechas del calendario son las MISMAS del front (paridad con lib/proyectos/cronograma-rules.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrismaClient } from '../../app/generated/prisma/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import {
  eventosCalendario,
  fechasDeSolicitud,
  PROYECTOS_TOOLS,
  RECHAZO_CONCESION_PROYECTOS,
  RECHAZO_PROYECTO,
  registerProyectosTools,
} from '../src/tools/proyectos.js';
import * as front from '../../lib/proyectos/cronograma-rules';
import { callJson, connectClient, createMockPrisma, type CapturedRawQuery, type MockPrisma } from './helpers.js';

const TOKEN = 'pg_AbCdEfGhIjKlMnOpQrStUvWx';
const ORUS: AuthScope = { agent: 'horus', role: 'admin', allCompanies: true, companyIds: [] };

interface Estado {
  agentes: Array<{ id_agent: number; code: string; display_name: string; id_subprocess: number | null }>;
  grants: Array<Record<string, unknown>>;
  permiso: number;
  chat: boolean;
  /** Proyectos que la PUERTA devuelve para la persona (vacío = no miembro / sin módulo / archivado). */
  visibles: Array<{ id_project: number; name: string; description: string | null; id_company: number; company: string; role: string }>;
  pendientes: number;
  solicitudVisible: boolean;
}

let mock: MockPrisma;
let estado: Estado;
const norm = (q: CapturedRawQuery) => q.text.replace(/\s+/g, ' ');

function preparar(parcial: Partial<Estado> = {}) {
  estado = {
    agentes: [{ id_agent: 7, code: 'horus', display_name: 'Orus', id_subprocess: 70 }],
    grants: [
      {
        id_grant: 31,
        token: TOKEN,
        id_user: 'u-silvia',
        id_agent: 7,
        id_project: null,
        id_chat_conversation: 501,
        expires_at: new Date(Date.now() + 3600_000),
        vigente: 1,
        name: 'Silvia Gómez',
        email: 'silvia@gsslatam.com',
        isActive: true,
        role: 'user',
      },
    ],
    permiso: 1,
    chat: true,
    visibles: [{ id_project: 12, name: 'Comex Latam', description: null, id_company: 3, company: 'ONE LATAM PHARMA', role: 'editor' }],
    pendientes: 0,
    solicitudVisible: true,
    ...parcial,
  };
  mock = createMockPrisma();
  mock.rawResolvers = [
    (q) => {
      const t = norm(q);
      if (/FROM agent a WHERE LOWER\(a\.code\)/.test(t)) return estado.agentes.filter((a) => a.code === q.values[0]);
      if (/FROM chat_project_grant g INNER JOIN \[user\]/.test(t)) return estado.grants.filter((g) => g.token === q.values[0]);
      if (/FROM subprocess_user_company suc INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user INNER JOIN agent_company/.test(t)) return [{ n: estado.permiso }];
      if (/FROM chat_conversation c WHERE/.test(t)) return estado.chat ? [{ id: 501 }] : [];
      if (/FROM chat_project p INNER JOIN chat_project_member m/.test(t)) {
        // La puerta SIEMPRE con el id de la persona de la concesión.
        expect(q.values[0]).toBe(estado.grants[0]!.id_user);
        // Los únicos números son los filtros de proyecto (de la concesión y del pedido).
        const nums = q.values.filter((v): v is number => typeof v === 'number');
        return estado.visibles.filter((p) => nums.every((n) => n === p.id_project));
      }
      if (/FROM chat_project_proposal WHERE id_project/.test(t)) return [{ n: estado.pendientes }];
      if (/FROM chat_project_task WHERE id_project_task/.test(t)) return [{ title: 'Radicar DIM' }];
      if (/FROM requests_general rg WHERE rg\.id =/.test(t)) return estado.solicitudVisible ? [{ subject_request: 'Proveedor Sun Pharma' }] : [];
      if (/FROM chat_project_request WHERE id_project/.test(t)) return [{ n: 0 }];
      if (/INSERT INTO chat_project_proposal/.test(t)) return [{ id_proposal: 77 }];
      if (/FROM chat_project_task t LEFT JOIN/.test(t))
        return [{ id_project_task: 5, title: 'Radicar DIM', description: null, responsable: 'Silvia Gómez', start_date: new Date('2026-10-10T00:00:00Z'), end_date: new Date('2026-10-15T00:00:00Z'), status: 'en_curso', progress: 40, is_milestone: false, updated_at: null, created_at: new Date('2026-10-09T00:00:00Z') }];
      if (/FROM chat_project_request pr LEFT JOIN requests_general/.test(t))
        return [{ id_request: 18342, subject: 'Proveedor Sun Pharma', process_name: 'Datos maestros', target_date: new Date('2026-10-20T00:00:00Z'), created_at: new Date('2026-10-01T09:00:00Z'), status_req: 1, date_resolution: null, status: 'Abierto' }];
      return undefined;
    },
  ];
  setPrisma(mock as unknown as PrismaClient);
}

async function cliente(scope: AuthScope = ORUS) {
  const server = new McpServer({ name: 't', version: '1' });
  registerProyectosTools(server, { scope, audit: { log: async () => {} } });
  return connectClient(server);
}

const todo = () => [...mock.capturedWrite, ...mock.capturedRaw].map(norm);
const eventos = () => mock.capturedWrite.filter((w) => /INSERT INTO chat_project_event/.test(w.text)).map((w) => String(w.values[3]));

beforeEach(() => preparar());

describe('identidad: solo la concesión', () => {
  it('ninguna herramienta recibe a nombre de quién actúa (ni correo ni id de persona)', async () => {
    const { tools } = await (await cliente()).listTools();
    const nuestras = tools.filter((t) => (PROYECTOS_TOOLS as readonly string[]).includes(t.name));
    expect(nuestras.map((t) => t.name).sort()).toEqual([...PROYECTOS_TOOLS].sort());
    for (const t of nuestras) {
      const props = Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      expect(props).toContain('concesion_id');
      // «correo» solo existe en invitar, y es la persona INVITADA, no la que actúa.
      expect(props.filter((p) => /user|usuario|email|persona|actor/i.test(p))).toEqual([]);
      // Descripciones en español.
      expect(t.description).toMatch(/[áéíóúñ]|PROPONE|SOLO LECTURA/);
    }
  });

  it('token mal formado, desconocido o inyectado → rechazo sin leer proyectos', async () => {
    const c = await cliente();
    for (const concesion_id of ['pg_NoExisteNoExisteNoExiste', 'cs_AbCdEfGhIjKlMnOpQrStUvWx', "pg_x' OR 1=1 --aaaaaaaaaa"]) {
      const r = await callJson(c, 'proyectos_listar', { concesion_id });
      expect(r.isError).toBe(true);
      expect(String(r.data)).toContain('Rechazado');
    }
    expect(todo().some((t) => /FROM chat_project p INNER JOIN/.test(t))).toBe(false);
    expect(mock.capturedRaw.every((q) => !q.text.includes('OR 1=1'))).toBe(true);
  });

  it('la concesión de OTRO agente, vencida, de una persona sin el agente o sin chat → mismo rechazo', async () => {
    estado.agentes.push({ id_agent: 8, code: 'nancy', display_name: 'Nancy', id_subprocess: 80 });
    const r1 = await callJson(await cliente({ agent: 'nancy', role: 'admin', allCompanies: true, companyIds: [] }), 'proyectos_listar', { concesion_id: TOKEN });
    expect(String(r1.data)).toContain(RECHAZO_CONCESION_PROYECTOS);
    for (const cambio of [() => (estado.grants[0]!.vigente = 0), () => (estado.permiso = 0), () => (estado.chat = false), () => (estado.grants[0]!.isActive = false)]) {
      preparar();
      cambio();
      const r = await callJson(await cliente(), 'proyectos_listar', { concesion_id: TOKEN });
      expect(r.isError).toBe(true);
      expect(String(r.data)).toContain(RECHAZO_CONCESION_PROYECTOS);
    }
  });

  it('una concesión de UN proyecto acota la puerta a ese proyecto', async () => {
    estado.grants[0]!.id_project = 12;
    const r = await callJson(await cliente(), 'proyectos_listar', { concesion_id: TOKEN });
    expect(r.isError).toBeFalsy();
    const puerta = mock.capturedRaw.find((q) => /FROM chat_project p INNER JOIN chat_project_member/.test(norm(q)))!;
    expect(puerta.values).toContain(12);
  });
});

describe('lecturas: lo que ve la persona', () => {
  it('NO miembro (la puerta no devuelve el proyecto) → «proyecto no encontrado» en detalle, cronograma, calendario y propuestas', async () => {
    estado.visibles = [];
    const c = await cliente();
    const llamadas: Array<[string, Record<string, unknown>]> = [
      ['proyecto_detalle', { id_proyecto: 12 }],
      ['proyecto_cronograma', { id_proyecto: 12 }],
      ['proyecto_calendario', { id_proyecto: 12, desde: '2026-10-01', hasta: '2026-10-31' }],
      ['proyecto_proponer_tarea', { id_proyecto: 12, titulo: 'x', inicio: '2026-10-20' }],
      ['proyecto_proponer_vincular_solicitud', { id_proyecto: 12, id_solicitud: 18342 }],
    ];
    for (const [tool, args] of llamadas) {
      const r = await callJson(c, tool, { concesion_id: TOKEN, ...args });
      expect(r.isError, tool).toBe(true);
      expect(String(r.data)).toContain(RECHAZO_PROYECTO);
    }
    expect(todo().some((t) => /INSERT INTO chat_project_proposal/.test(t))).toBe(false);
  });

  it('cronograma: tareas y solicitudes con fechas, y la lectura queda auditada', async () => {
    const r = await callJson(await cliente(), 'proyecto_cronograma', { concesion_id: TOKEN, id_proyecto: 12 });
    expect(r.isError).toBeFalsy();
    const d = r.data as { tareas: Array<{ id: number; startDate: string; endDate: string }>; solicitudes: Array<{ idRequest: number; createdAt: string; targetDate: string }> };
    expect(d.tareas[0]).toMatchObject({ id: 5, startDate: '2026-10-10', endDate: '2026-10-15' });
    expect(d.solicitudes[0]).toMatchObject({ idRequest: 18342, createdAt: '2026-10-01', targetDate: '2026-10-20' });
    expect(eventos()).toEqual(['leer']);
  });

  it('calendario: rango de más de 92 días o invertido → rechazo', async () => {
    const c = await cliente();
    expect(String((await callJson(c, 'proyecto_calendario', { concesion_id: TOKEN, desde: '2026-01-01', hasta: '2026-12-31' })).data)).toContain('92');
    expect(String((await callJson(c, 'proyecto_calendario', { concesion_id: TOKEN, desde: '2026-10-31', hasta: '2026-10-01' })).data)).toContain('anterior');
  });
});

describe('propuestas: nada cambia sin la confirmación de la persona', () => {
  it('un EDITOR propone una tarea: solo propuesta pendiente + aviso en SU chat + auditoría; ninguna tarea creada', async () => {
    const r = await callJson(await cliente(), 'proyecto_proponer_tarea', { concesion_id: TOKEN, id_proyecto: 12, titulo: 'Revisar DIM', inicio: '2026-10-20', fin: '2026-10-22', responsable: 'Silvia Gómez' });
    expect(r.isError).toBeFalsy();
    expect((r.data as { propuesta_id: number; siguiente: string }).propuesta_id).toBe(77);
    expect((r.data as { siguiente: string }).siguiente).toMatch(/NADA cambió/);
    const ins = mock.capturedRaw.find((q) => /INSERT INTO chat_project_proposal/.test(q.text))!;
    // kind, payload, …, source 'mcp', a nombre de la persona de la concesión y con SU concesión.
    expect(ins.values).toContain('tarea_crear');
    expect(ins.values).toContain('mcp');
    expect(ins.values).toContain('u-silvia');
    expect(ins.values).toContain(31);
    expect(JSON.parse(String(ins.values[2]))).toMatchObject({ kind: 'tarea_crear', tarea: { title: 'Revisar DIM', startDate: '2026-10-20', endDate: '2026-10-22', responsable: 'Silvia Gómez' } });
    const w = todo();
    expect(w.some((t) => /INSERT INTO chat_message/.test(t))).toBe(true);
    expect(eventos()).toEqual(['proponer']);
    // Nunca escribe el cronograma ni los vínculos.
    expect(w.some((t) => /(INSERT INTO|UPDATE|DELETE FROM) chat_project_(task|request|member)\b/.test(t))).toBe(false);
  });

  it('un LECTOR no puede proponer nada (y queda el intento auditado)', async () => {
    estado.visibles[0]!.role = 'reader';
    const c = await cliente();
    for (const [tool, args] of [
      ['proyecto_proponer_tarea', { titulo: 'x', inicio: '2026-10-20' }],
      ['proyecto_proponer_cambio_tarea', { id_tarea: 5, estado: 'hecha' }],
      ['proyecto_proponer_vincular_solicitud', { id_solicitud: 18342 }],
      ['proyecto_proponer_conversacion', { asistente: 'horus' }],
    ] as const) {
      const r = await callJson(c, tool, { concesion_id: TOKEN, id_proyecto: 12, ...args });
      expect(r.isError, tool).toBe(true);
      expect(String(r.data)).toMatch(/LECTORA/);
    }
    expect(todo().some((t) => /INSERT INTO chat_project_proposal/.test(t))).toBe(false);
    expect(eventos().every((e) => e === 'denegar')).toBe(true);
  });

  it('invitar: un editor no puede; la dueña sí (como propuesta)', async () => {
    let r = await callJson(await cliente(), 'proyecto_proponer_invitar', { concesion_id: TOKEN, id_proyecto: 12, correo: 'ana@gsslatam.com', rol: 'reader' });
    expect(String(r.data)).toMatch(/Solo el dueño/);
    preparar();
    estado.visibles[0]!.role = 'owner';
    r = await callJson(await cliente(), 'proyecto_proponer_invitar', { concesion_id: TOKEN, id_proyecto: 12, correo: 'ana@gsslatam.com', rol: 'reader' });
    expect(r.isError).toBeFalsy();
    expect(todo().some((t) => /INSERT INTO chat_project_member/.test(t))).toBe(false);
  });

  it('vincular una solicitud que la persona NO ve → rechazo', async () => {
    estado.solicitudVisible = false;
    const r = await callJson(await cliente(), 'proyecto_proponer_vincular_solicitud', { concesion_id: TOKEN, id_proyecto: 12, id_solicitud: 999 });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no se encontró/i);
    // La visibilidad se evaluó con el id de la persona de la concesión.
    const q = mock.capturedRaw.find((x) => /FROM requests_general rg WHERE rg\.id =/.test(norm(x)))!;
    expect(q.values).toContain('u-silvia');
  });

  it('cupo de pendientes lleno → rechazo', async () => {
    estado.pendientes = 30;
    const r = await callJson(await cliente(), 'proyecto_proponer_tarea', { concesion_id: TOKEN, id_proyecto: 12, titulo: 'x', inicio: '2026-10-20' });
    expect(String(r.data)).toMatch(/30 propuestas pendientes/);
  });
});

describe('paridad de fechas con el front', () => {
  it('fechasDeSolicitud y eventosCalendario dan lo mismo que lib/proyectos/cronograma-rules.ts', () => {
    const hoy = '2026-10-18';
    const casos = [
      { createdAt: '2026-10-01', resolvedAt: null, idStatus: 1, targetDate: '2026-10-20' },
      { createdAt: '2026-10-01', resolvedAt: null, idStatus: 1, targetDate: '2026-10-05' },
      { createdAt: '2026-10-01', resolvedAt: '2026-10-09', idStatus: 2, targetDate: null },
      { createdAt: '2026-10-01', resolvedAt: null, idStatus: 3, targetDate: null },
      { createdAt: null, resolvedAt: null, idStatus: null, targetDate: null },
    ];
    for (const c of casos) expect(fechasDeSolicitud(c, hoy)).toEqual(front.fechasDeSolicitud(c, hoy));
    const tareas = [
      { id: 1, title: 'A', startDate: '2026-10-01', endDate: '2026-10-10', status: 'en_curso' as const, isMilestone: false },
      { id: 2, title: 'B', startDate: '2026-10-25', endDate: '2026-10-25', status: 'pendiente' as const, isMilestone: true },
      { id: 3, title: 'C', startDate: '2026-10-12', endDate: '2026-10-12', status: 'hecha' as const, isMilestone: false },
    ];
    const sols = casos.filter((c) => c.createdAt).map((c, i) => ({ ...c, idRequest: 100 + i, subject: `S${i}` }));
    expect(eventosCalendario(tareas, sols, hoy)).toEqual(front.eventosCalendario(tareas, sols, hoy));
  });
});

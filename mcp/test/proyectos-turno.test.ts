/**
 * El agente lee SUS proyectos desde su CHAT NORMAL (2026-11-06, caso Kepler).
 *   - Sin concesión: la persona sale del MENSAJE que el agente atiende (conversation_id +
 *     message_id), verificado en el servidor. El modelo no puede pasar un correo ni un id de persona.
 *   - Solo proyectos donde el agente de la LLAVE está designado y la persona del turno tiene acceso.
 *   - Si la persona no tiene acceso → «No autorizado».
 *   - SOLO LECTURA: lo único que se escribe es la auditoría (chat_project_event).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrismaClient } from '../../app/generated/prisma/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import {
  motivoRechazoTurno,
  prsEnGithub,
  prsEnTexto,
  RECHAZO_PROYECTO_TURNO,
  RECHAZO_TURNO,
  ramaDelProyecto,
  registerProyectosTools,
  repoDeCatalogo,
  hiloPorDefecto,
  type FilaTurno,
} from '../src/tools/proyectos.js';
import { callJson, connectClient, createMockPrisma, type CapturedRawQuery, type MockPrisma } from './helpers.js';

const KEPLER: AuthScope = { agent: 'kepler', role: 'agent', allCompanies: false, companyIds: [3], agentCode: 'kepler' };

const filaOk = (p: Partial<FilaTurno> = {}): FilaTurno => ({
  id_conversation: 900,
  kind: 'direct',
  conv_agent: 27,
  conv_user: 'u-neider',
  conv_archived: 0,
  role: 'user',
  id_user_author: 'u-neider',
  reciente: 1,
  entregado_al_agente: 0,
  name: 'Neider Navarrete',
  email: 'neider@olp.com',
  isActive: true,
  user_role: 'user',
  ...p,
});

interface Estado {
  turno: FilaTurno[];
  visibles: Array<{ id_project: number; name: string; description: string | null; id_company: number; company: string; role: string; ultima: Date | null; updated_at: Date | null }>;
}

let mock: MockPrisma;
let estado: Estado;
const norm = (q: CapturedRawQuery) => q.text.replace(/\s+/g, ' ');

function preparar(parcial: Partial<Estado> = {}) {
  estado = {
    turno: [filaOk()],
    visibles: [{ id_project: 22, name: 'Seguimiento Comercial', description: 'Dashboards', id_company: 3, company: 'ONE LATAM PHARMA', role: 'owner', ultima: new Date('2026-11-06T15:00:00Z'), updated_at: new Date('2026-11-01T00:00:00Z') }],
    ...parcial,
  };
  mock = createMockPrisma();
  mock.rawResolvers = [
    (q) => {
      const t = norm(q);
      if (/FROM agent a WHERE LOWER\(a\.code\)/.test(t)) return q.values[0] === 'kepler' ? [{ id_agent: 27, code: 'kepler', display_name: 'Kepler', id_subprocess: 90 }] : [];
      if (/FROM chat_message m INNER JOIN chat_conversation c ON c\.id = m\.id_conversation LEFT JOIN \[user\]/.test(t)) {
        // Mensaje y conversación SIEMPRE los dos (el mensaje debe ser de esa conversación).
        expect(t).toContain('m.id_conversation =');
        return estado.turno;
      }
      if (/FROM chat_project p INNER JOIN chat_project_member m/.test(t)) {
        // Puerta con la persona del TURNO (autor del mensaje) y el filtro del agente designado.
        expect(q.values[0]).toBe('u-neider');
        expect(t).toMatch(/chat_project_agent pa WHERE pa\.id_project = p\.id_project AND pa\.id_agent =/);
        expect(q.values.filter((v) => v === 27).length).toBe(2);
        const pedido = q.values.filter((v): v is number => typeof v === 'number' && v !== 27);
        return estado.visibles.filter((p) => pedido.every((n) => n === p.id_project));
      }
      if (/FROM chat_conversation c LEFT JOIN agent a ON a\.id_agent = c\.id_agent WHERE c\.id_project/.test(t))
        return [
          { id: 166, title: 'Dashboards ventas', display_name: 'Kepler', code: 'kepler', created_at: new Date('2026-11-01T00:00:00Z'), last_message_at: new Date('2026-11-06T15:00:00Z'), n: 3 },
          { id: 170, title: 'Otro', display_name: 'Atlas', code: 'atlas', created_at: new Date('2026-11-02T00:00:00Z'), last_message_at: new Date('2026-11-05T15:00:00Z'), n: 1 },
        ];
      if (/FROM chat_message m LEFT JOIN \[user\] u ON u\.id = m\.id_user_author LEFT JOIN agent a/.test(t)) {
        expect(q.values).toContain(166);
        return [
          { id: 3003, role: 'agent', body: 'Listo: abrí el PR https://github.com/AnalistaSistemasFarma/front-kronos/pull/898', created_at: new Date('2026-11-06T15:00:00Z'), user_name: null, user_email: null, agent_name: 'Kepler' },
          { id: 3002, role: 'user', body: 'Súbalo a testing', created_at: new Date('2026-11-06T14:00:00Z'), user_name: 'Neider Navarrete', user_email: 'n@olp.com', agent_name: null },
        ];
      }
      if (/FROM chat_attachment WHERE id_message IN/.test(t)) return [{ id_message: 3002, file_name: 'ventas.xlsx', content_type: 'application/vnd.ms-excel', size_bytes: 1200 }];
      if (/FROM chat_project_agent_policy_repo pr INNER JOIN chat_project_repo_catalog/.test(t)) return [{ github: 'AnalistaSistemasFarma/front-kronos' }];
      if (/m\.body LIKE/.test(t)) return [{ id_conversation: 166, body: 'PR https://github.com/AnalistaSistemasFarma/front-kronos/pull/898', created_at: new Date('2026-11-06T15:00:00Z') }];
      return undefined;
    },
  ];
  setPrisma(mock as unknown as PrismaClient);
}

async function cliente(scope: AuthScope = KEPLER) {
  const server = new McpServer({ name: 't', version: '1' });
  registerProyectosTools(server, { scope, audit: { log: async () => {} } });
  return connectClient(server);
}

const TURNO = { conversation_id: 900, message_id: 4501 };
const escrituras = () => mock.capturedWrite.map(norm);

beforeEach(() => {
  delete process.env.PROYECTOS_GITHUB_TOKEN;
  preparar();
});

describe('regla del turno (pura)', () => {
  it('acepta el directo del agente con su persona, y el grupo solo si el mensaje se le entregó', () => {
    expect(motivoRechazoTurno(filaOk(), 27)).toBeNull();
    expect(motivoRechazoTurno(filaOk({ kind: 'group', conv_agent: 5, conv_user: 'otro', entregado_al_agente: 1 }), 27)).toBeNull();
    expect(motivoRechazoTurno(filaOk({ kind: 'group', entregado_al_agente: 0 }), 27)).toMatch(/grupo/);
  });

  it('rechaza: no existe, hilo de proyecto o entre personas, archivado, de otro agente, autor ajeno, mensaje del agente, antiguo, persona inactiva o proveedor', () => {
    expect(motivoRechazoTurno(undefined, 27)).toBeTruthy();
    for (const p of [
      { kind: 'project' },
      { kind: 'people' },
      { conv_archived: 1 },
      { conv_agent: 28 },
      { id_user_author: 'u-otra' },
      { role: 'agent' },
      { id_user_author: null },
      { reciente: 0 },
      { isActive: false },
      { user_role: 'supplier' },
    ] as Partial<FilaTurno>[]) {
      expect(motivoRechazoTurno(filaOk(p), 27), JSON.stringify(p)).toBeTruthy();
    }
  });
});

describe('desde el chat normal', () => {
  it('proyectos_listar: SUS proyectos con nombre, empresa, descripción y última actividad; sin escritura salvo nada', async () => {
    const r = await callJson(await cliente(), 'proyectos_listar', TURNO);
    expect(r.isError).toBeFalsy();
    const d = r.data as { persona: string; proyectos: Array<Record<string, unknown>> };
    expect(d.persona).toBe('Neider Navarrete');
    expect(d.proyectos[0]).toMatchObject({ id_proyecto: 22, nombre: 'Seguimiento Comercial', empresa: 'ONE LATAM PHARMA', descripcion: 'Dashboards', ultima_actividad: '2026-11-06T15:00:00.000Z' });
    expect(escrituras()).toEqual([]);
  });

  it('turno inválido (otro agente, hilo de proyecto, mensaje viejo) → «No autorizado» y no se lee ningún proyecto', async () => {
    for (const p of [{ conv_agent: 28 }, { kind: 'project' }, { reciente: 0 }] as Partial<FilaTurno>[]) {
      preparar({ turno: [filaOk(p)] });
      const r = await callJson(await cliente(), 'proyectos_listar', TURNO);
      expect(r.isError).toBe(true);
      expect(String(r.data)).toContain(RECHAZO_TURNO);
      expect(mock.capturedRaw.some((q) => /FROM chat_project p INNER JOIN/.test(norm(q)))).toBe(false);
    }
  });

  it('sin concesión ni turno → rechazo', async () => {
    const r = await callJson(await cliente(), 'proyectos_listar', {});
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/conversation_id y message_id/);
  });

  it('persona SIN acceso al proyecto (la puerta no lo devuelve) → «No autorizado» en detalle, historial, PR y cronograma', async () => {
    estado.visibles = [];
    const c = await cliente();
    for (const tool of ['proyecto_detalle', 'proyecto_historial', 'proyecto_prs', 'proyecto_cronograma']) {
      const r = await callJson(c, tool, { ...TURNO, id_proyecto: 22 });
      expect(r.isError, tool).toBe(true);
      expect(String(r.data)).toContain(RECHAZO_PROYECTO_TURNO);
    }
    expect(escrituras()).toEqual([]);
  });

  it('proyecto_historial: hilos + mensajes del hilo propio, adjuntos listados y la lectura auditada (única escritura)', async () => {
    const r = await callJson(await cliente(), 'proyecto_historial', { ...TURNO, id_proyecto: 22 });
    expect(r.isError).toBeFalsy();
    const d = r.data as { hilos: Array<{ id_hilo: number }>; hilo: { id_hilo: number }; mensajes: Array<{ id: number; rol: string; autor: string; adjuntos: unknown[] }> };
    expect(d.hilos.map((h) => h.id_hilo)).toEqual([166, 170]);
    expect(d.hilo.id_hilo).toBe(166);
    expect(d.mensajes.map((m) => m.id)).toEqual([3002, 3003]);
    expect(d.mensajes[0]).toMatchObject({ rol: 'persona', autor: 'Neider Navarrete', adjuntos: [{ nombre: 'ventas.xlsx', tipo: 'application/vnd.ms-excel', bytes: 1200 }] });
    const w = escrituras();
    expect(w.length).toBe(1);
    expect(w[0]!.trim()).toMatch(/^INSERT INTO chat_project_event/);
    expect(String(mock.capturedWrite[0]!.values[3])).toBe('leer');
  });

  it('proyecto_historial con un hilo de otro proyecto → rechazo', async () => {
    const r = await callJson(await cliente(), 'proyecto_historial', { ...TURNO, id_proyecto: 22, id_hilo: 999 });
    expect(r.isError).toBe(true);
  });

  it('proyecto_prs sin token de GitHub: los PR mencionados en los hilos y cómo consultarlos', async () => {
    const r = await callJson(await cliente(), 'proyecto_prs', { ...TURNO, id_proyecto: 22 });
    expect(r.isError).toBeFalsy();
    const d = r.data as { mencionados_en_hilos: Array<{ numero: number }>; github: { nota?: string }; rama_del_proyecto: string; repos_del_proyecto: string[] };
    expect(d.mencionados_en_hilos.map((m) => m.numero)).toEqual([898]);
    expect(d.rama_del_proyecto).toBe('proyecto/22-*');
    expect(d.repos_del_proyecto).toEqual(['AnalistaSistemasFarma/front-kronos']);
    expect(d.github.nota).toMatch(/head:proyecto\/22-/);
  });

  it('las propuestas siguen exigiendo concesión (el turno NO sirve para escribir)', async () => {
    const r = await callJson(await cliente(), 'proyecto_proponer_tarea', { ...TURNO, concesion_id: undefined, id_proyecto: 22, titulo: 'x', inicio: '2026-11-07' });
    expect(r.isError).toBe(true);
    expect(escrituras().some((t) => /chat_project_proposal/.test(t))).toBe(false);
  });
});

describe('PR: funciones puras y GitHub', () => {
  it('rama del proyecto, repo del catálogo, enlaces en texto y hilo por defecto', () => {
    expect(ramaDelProyecto('proyecto/22-c166', 22)).toBe(true);
    expect(ramaDelProyecto('proyecto/22', 22)).toBe(true);
    expect(ramaDelProyecto('proyecto/220-c1', 22)).toBe(false);
    expect(ramaDelProyecto('feat/x', 22)).toBe(false);
    expect(repoDeCatalogo('https://github.com/AnalistaSistemasFarma/front-kronos.git')).toBe('AnalistaSistemasFarma/front-kronos');
    expect(repoDeCatalogo('nada')).toBeNull();
    const prs = prsEnTexto([
      { id_conversation: 1, body: 'ver https://github.com/a/b/pull/3 y https://github.com/a/b/pull/3', created_at: '2026-11-01T00:00:00Z' },
      { id_conversation: 2, body: 'https://github.com/a/b/pull/3', created_at: '2026-11-02T00:00:00Z' },
    ]);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ repo: 'a/b', numero: 3, id_hilo: 2 });
    expect(hiloPorDefecto([{ id_hilo: 1, asistente_code: 'atlas' }, { id_hilo: 2, asistente_code: 'Kepler' }] as never, 'kepler')?.id_hilo).toBe(2);
    expect(hiloPorDefecto([{ id_hilo: 1, asistente_code: 'atlas' }] as never, 'kepler')?.id_hilo).toBe(1);
  });

  it('con token: lista los PR de la rama del proyecto y el estado de los mencionados (solo GET)', async () => {
    const llamadas: string[] = [];
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      llamadas.push(url);
      expect(init?.headers?.Authorization).toBe('Bearer tkn');
      if (url.endsWith('/pulls/5'))
        return { ok: true, status: 200, json: async () => ({ number: 5, title: 'Viejo', state: 'closed', merged_at: null, head: { ref: 'feat/x' }, base: { ref: 'testing' }, html_url: 'u5' }) };
      return {
        ok: true,
        status: 200,
        json: async () => [
          { number: 898, title: 'Dashboard', state: 'closed', merged_at: '2026-11-06T16:00:00Z', head: { ref: 'proyecto/22-c166' }, base: { ref: 'testing' }, updated_at: '2026-11-06T16:00:00Z', html_url: 'u898' },
          { number: 900, title: 'Otro', state: 'open', merged_at: null, head: { ref: 'proyecto/23-c1' }, base: { ref: 'testing' }, html_url: 'u900' },
        ],
      };
    };
    const r = await prsEnGithub(22, ['o/r'], [{ repo: 'o/r', numero: 5, url: '', id_hilo: 1, fecha: '' }], { token: 'tkn', fetchImpl });
    expect(r!.prs.map((p) => [p.numero, p.estado])).toEqual([
      [898, 'fusionado'],
      [5, 'cerrado'],
    ]);
    expect(llamadas.every((u) => u.startsWith('https://api.github.com/repos/'))).toBe(true);
    expect(await prsEnGithub(22, ['o/r'], [], { token: '' })).toBeNull();
  });
});

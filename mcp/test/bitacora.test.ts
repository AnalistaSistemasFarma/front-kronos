/**
 * Bitácora de Proceso — tools de SOLO LECTURA (src/tools/bitacoraProceso.ts).
 *
 * Verifica: alcance por empresa, candado de solo lectura, que nunca salgan la
 * imagen de la firma / huellas / IP, validación de entradas, topes de página y
 * el formato de salida (código BP-xxxx, estado visible, horas ISO UTC).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/tools/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import {
  codigoBitacora,
  likeContains,
  parseCodigoBitacora,
  BITACORA_TOOLS,
} from '../src/tools/bitacoraProceso.js';
import { createMockPrisma, connectClient, callJson, type MockPrisma, type CapturedRawQuery } from './helpers.js';

const noopAudit = { log: async () => {} };
const scopeFarma: AuthScope = { agent: 'horus', role: 'reader', allCompanies: false, companyIds: [2] };
const scopeOtra: AuthScope = { agent: 'otra', role: 'reader', allCompanies: false, companyIds: [1] };
const scopeAdmin: AuthScope = { agent: 'admin', role: 'admin', allCompanies: true, companyIds: [] };

let mock: MockPrisma;

function buildServer(scope: AuthScope = scopeFarma, maxPageSize = 200): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  registerTools(server, { scope, audit: noopAudit, maxPageSize, defaultPageSize: 50 });
  return server;
}

const ABIERTA = new Date('2026-10-14T11:00:00.000Z');

const ORDEN = {
  id_orden_trabajo: 7,
  consecutivo: 3,
  id_company: 2,
  company: 'FARMALOGICA',
  producto: 'CEFAZOLINA 1 G',
  item_code: 'PTCZ0121',
  lote: '1565426',
  turno: 'MANANA',
  area: 'Estériles',
  sap_op_docnum: 14045,
  sap_op_snapshot: JSON.stringify({ ItemNo: 'PTCZ0121', DocumentNumber: 14045 }),
  estado: 'CERRADA',
  abierta_en: ABIERTA,
  cerrada_en: new Date('2026-10-14T18:00:00.000Z'),
  observacion_cierre: 'Sin novedad',
  supervisor_id: 'u-sup',
  supervisor_nombre: 'Supervisora',
  supervisor_email: 'sup@example.com',
  inspector_id: 'u-ins',
  inspector_nombre: 'Inspector',
  inspector_email: 'ins@example.com',
  cerrada_por_id: 'u-sup',
  cerrada_por_nombre: 'Supervisora',
  operarios: 2,
  registros: 5,
  ultimo_registro_en: new Date('2026-10-14T17:30:00.000Z'),
  ultima_firma_en: new Date('2026-10-14T18:05:00.000Z'),
  firma_cerro: 1,
  firma_verifico: 1,
  total: 1,
};

/** Resolutor por tabla para las consultas de la bitácora. */
function seedBitacora(m: MockPrisma, opts: { ordenes?: unknown[] } = {}) {
  m.rawResolvers = [
    (q: CapturedRawQuery) => {
      const t = q.text.toLowerCase();
      if (t.includes('from ot_firma f\n') || /from ot_firma f\s+where f\.id_orden_trabajo = @p1\s+order by/i.test(q.text)) {
        return [
          { rol: 'SUPERVISOR', significado: 'Cerró', id_user: 'u-sup', signer_name: 'Supervisora', signer_email: 'sup@example.com', firmado_en: new Date('2026-10-14T18:00:00Z'), auth_method: 'PASSWORD' },
          { rol: 'INSPECTOR', significado: 'Verificó', id_user: 'u-ins', signer_name: 'Inspector', signer_email: 'ins@example.com', firmado_en: new Date('2026-10-14T18:05:00Z'), auth_method: 'PASSWORD' },
        ];
      }
      if (t.includes('from ot_orden_operario oo\n') || /from ot_orden_operario oo\s+left join/i.test(q.text)) {
        return [{ id_user: 'u-a1', name: 'Aux 1', email: 'a1@example.com' }];
      }
      if (/from ot_orden_operador op\s+inner join ot_operador/i.test(q.text)) {
        return [{ id_operador: 7, nombre: 'Pepito Pérez', activo: true }];
      }
      if (/from ot_registro r\s+left join \[user\]/i.test(q.text)) {
        return [
          { id_registro: '11', id_actividad: 1, actividad_nombre: 'Alimentación de tolva', registrado_en: new Date('2026-10-14T12:00:00Z'), observacion: null, id_user: 'u-a1', usuario_nombre: 'Aux 1', id_operador: null, operador_nombre: null },
          { id_registro: '12', id_actividad: 14, actividad_nombre: 'Otra', registrado_en: new Date('2026-10-14T13:00:00Z'), observacion: 'Limpieza', id_user: 'u-planta', usuario_nombre: 'Producción Planta', id_operador: 7, operador_nombre: 'Pepito Pérez' },
        ];
      }
      if (/from ot_registro r\s+inner join ot_orden_trabajo/i.test(q.text)) {
        return [
          { id_registro: '21', registrado_en: new Date('2026-10-14T13:10:00Z'), actividad_nombre: 'Mantenimiento', observacion: null, id_user: 'u-a1', usuario_nombre: 'Aux 1', id_orden_trabajo: 8, consecutivo: 4, id_company: 2, company: 'FARMALOGICA', producto: 'X', lote: 'L1', turno: 'TARDE', estado: 'ABIERTA' },
        ];
      }
      if (t.includes('from ot_actividad a')) {
        return [{ id_actividad: 1, id_company: 2, company: 'FARMALOGICA', nombre: 'Alimentación de tolva', icono: 'tolva', orden: 10, exige_observacion: false, activo: true }];
      }
      if (t.includes('from ot_orden_trabajo o')) {
        return opts.ordenes ?? [ORDEN];
      }
      return undefined;
    },
  ];
}

beforeEach(() => {
  mock = createMockPrisma();
  // @ts-expect-error mock parcial compatible para pruebas
  setPrisma(mock);
  seedBitacora(mock);
});

function bitacoraQueries(): CapturedRawQuery[] {
  return mock.capturedRaw.filter((q) => /\bot_(orden_trabajo|registro|actividad|firma|orden_operario)\b/.test(q.text));
}

describe('helpers de la bitácora', () => {
  it('codigoBitacora y parseCodigoBitacora son inversos', () => {
    expect(codigoBitacora(3)).toBe('BP-0003');
    expect(codigoBitacora(12345)).toBe('BP-12345');
    expect(parseCodigoBitacora('BP-0003')).toBe(3);
    expect(parseCodigoBitacora('bp3')).toBe(3);
    expect(parseCodigoBitacora('7')).toBe(7);
    expect(parseCodigoBitacora('BP-0000')).toBeNull();
    expect(parseCodigoBitacora("BP-1'; DROP")).toBeNull();
  });

  it('likeContains escapa los comodines de LIKE', () => {
    expect(likeContains('50%_[x')).toBe('%50[%][_][[]x%');
  });
});

describe('superficie', () => {
  it('las 4 tools de bitácora están registradas, con descripción en español', async () => {
    const client = await connectClient(buildServer());
    const { tools } = await client.listTools();
    for (const name of BITACORA_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t!.description).toMatch(/bitácora/i);
      expect(t!.description).toMatch(/Solo lectura/);
    }
  });
});

describe('kronos_list_bitacoras', () => {
  it('filtra por la empresa del alcance y respeta la regla de oro', async () => {
    const client = await connectClient(buildServer());
    await callJson(client, 'kronos_list_bitacoras', {});
    const q = bitacoraQueries()[0]!;
    expect(q.text).toContain('o.id_company IN');
    expect(q.values).toContain(2);

    mock.capturedRaw.length = 0;
    const client2 = await connectClient(buildServer(scopeOtra));
    await callJson(client2, 'kronos_list_bitacoras', { companyId: 2 });
    const q2 = bitacoraQueries()[0]!;
    expect(q2.text).toContain('1 = 0');
    expect(q2.values).not.toContain(2);
  });

  it('una key admin no filtra empresa', async () => {
    const client = await connectClient(buildServer(scopeAdmin));
    await callJson(client, 'kronos_list_bitacoras', {});
    expect(bitacoraQueries()[0]!.text).toContain('1 = 1');
  });

  it('devuelve código BP, estado visible, firmas y última actividad en ISO UTC', async () => {
    const client = await connectClient(buildServer());
    const { data } = await callJson(client, 'kronos_list_bitacoras', {});
    const out = data as { total: number; data: Record<string, unknown>[] };
    expect(out.total).toBe(1);
    const b = out.data[0]!;
    expect(b.codigo).toBe('BP-0003');
    expect(b.estado).toBe('verificada');
    expect(b.firmas).toBe('cerrada_y_verificada');
    expect(b.turno).toBe('Mañana (06–14)');
    expect(b.operarios).toBe(2);
    expect(b.jefe_produccion).toEqual({ id: 'u-ins', nombre: 'Inspector' });
    expect(b).not.toHaveProperty('inspector');
    expect(b.registros).toBe(5);
    expect(b.abierta_en).toBe('2026-10-14T11:00:00.000Z');
    expect(b.ultima_actividad_en).toBe('2026-10-14T18:05:00.000Z');
  });

  it('aplica los filtros como valores parametrizados y escapa LIKE', async () => {
    const client = await connectClient(buildServer());
    await callJson(client, 'kronos_list_bitacoras', {
      estado: 'cerrada',
      desde: '2026-10-01',
      hasta: '2026-10-14',
      producto: "CEFA'; DROP TABLE x --",
      lote: '15%',
      supervisor: 'amanda',
      jefeProduccion: 'u-ins',
      ordenProduccion: 14045,
    });
    const q = bitacoraQueries()[0]!;
    expect(q.text).toContain("o.estado = N'CERRADA' AND NOT EXISTS");
    expect(q.text).not.toContain('DROP TABLE');
    expect(q.values).toContain("%CEFA'; DROP TABLE x --%");
    expect(q.values).toContain('%15[%]%');
    expect(q.values).toContain('%amanda%');
    expect(q.values).toContain('u-ins');
    expect(q.values).toContain(14045);
    // «hasta» con solo fecha incluye todo el día: < 2026-10-15.
    const fechas = q.values.filter((v) => v instanceof Date) as Date[];
    expect(fechas.map((d) => d.toISOString())).toEqual(['2026-10-01T00:00:00.000Z', '2026-10-15T00:00:00.000Z']);
  });

  it('limita el tamaño de página al máximo del servidor', async () => {
    const client = await connectClient(buildServer(scopeFarma, 100));
    const { data } = await callJson(client, 'kronos_list_bitacoras', { limit: 100000, offset: -5 });
    const out = data as { limit: number; offset: number };
    expect(out.limit).toBe(100);
    expect(out.offset).toBe(0);
  });

  it('rechaza un estado o una fecha inválidos', async () => {
    const client = await connectClient(buildServer());
    const r1 = await callJson(client, 'kronos_list_bitacoras', { estado: 'borrada' });
    expect(r1.isError).toBe(true);
    const r2 = await callJson(client, 'kronos_list_bitacoras', { desde: 'ayer' });
    expect(r2.isError).toBe(true);
  });
});

describe('kronos_get_bitacora', () => {
  it('trae encabezado, participantes, registros cronológicos y firmas sin imagen ni huellas', async () => {
    const client = await connectClient(buildServer());
    const { data, raw } = await callJson(client, 'kronos_get_bitacora', { codigo: 'BP-0003' });
    const out = data as {
      found: boolean;
      bitacora: Record<string, unknown>;
      participantes: { auxiliares_con_usuario: unknown[]; operarios: { nombre: string }[]; jefe_produccion: { nombre: string } };
      registros: { id: string; registrado_en: string; actividad: string; operario: { nombre: string } | null; usuario_sesion: { nombre: string } }[];
      firmas: { significado: string; nombre: string; rol: string }[];
    };
    expect(out.found).toBe(true);
    expect(out.bitacora.codigo).toBe('BP-0003');
    expect(out.bitacora.estado).toBe('verificada');
    expect(out.bitacora.orden_produccion_sap_copia).toEqual({ ItemNo: 'PTCZ0121', DocumentNumber: 14045 });
    expect(out.participantes.auxiliares_con_usuario).toHaveLength(1);
    expect(out.participantes.operarios.map((o) => o.nombre)).toEqual(['Pepito Pérez']);
    expect(out.participantes.jefe_produccion.nombre).toBe('Inspector');
    expect(out.registros.map((r) => r.id)).toEqual(['11', '12']);
    expect(out.registros[0]!.operario).toBeNull();
    expect(out.registros[1]!.operario?.nombre).toBe('Pepito Pérez');
    expect(out.registros[1]!.usuario_sesion.nombre).toBe('Producción Planta');
    expect(out.firmas.map((f) => f.significado)).toEqual(['Cerró', 'Verificó']);
    expect(out.firmas.map((f) => f.rol)).toEqual(['supervisor', 'jefe_produccion']);
    // Ninguna llave de salida llama «inspector» a quien verifica.
    expect(JSON.stringify(out.participantes)).not.toMatch(/"inspector":/i);

    // Nunca se piden ni se devuelven la imagen, las huellas, la IP ni el navegador.
    const sqlFirmas = bitacoraQueries().find((q) => /from ot_firma f\s+where/i.test(q.text))!;
    expect(sqlFirmas.text).not.toMatch(/firma_png|sha256|user_agent|\bip\b/i);
    const sqlRegistros = bitacoraQueries().find((q) => /from ot_registro r\s+left join/i.test(q.text))!;
    expect(sqlRegistros.text).not.toMatch(/r\.ip\b/i);
    const texto = JSON.stringify(raw);
    expect(texto).not.toMatch(/firma_png|sha256|user_agent/i);
  });

  it('el código se traduce a consecutivo parametrizado y respeta el alcance', async () => {
    const client = await connectClient(buildServer(scopeOtra));
    await callJson(client, 'kronos_get_bitacora', { codigo: 'BP-0003', companyId: 2 });
    const q = bitacoraQueries()[0]!;
    expect(q.text).toContain('1 = 0');
    expect(q.values).toContain(3);
  });

  it('si no encuentra la bitácora responde found=false sin consultar detalle', async () => {
    seedBitacora(mock, { ordenes: [] });
    const client = await connectClient(buildServer());
    const { data } = await callJson(client, 'kronos_get_bitacora', { id: 999 });
    expect((data as { found: boolean }).found).toBe(false);
    expect(bitacoraQueries()).toHaveLength(1);
  });

  it('un código repetido en varias empresas pide precisar', async () => {
    seedBitacora(mock, { ordenes: [ORDEN, { ...ORDEN, id_orden_trabajo: 9, id_company: 5, company: 'OTRA' }] });
    const client = await connectClient(buildServer(scopeAdmin));
    const { data } = await callJson(client, 'kronos_get_bitacora', { codigo: 'BP-0003' });
    const out = data as { ambiguo: boolean; candidatos: unknown[] };
    expect(out.ambiguo).toBe(true);
    expect(out.candidatos).toHaveLength(2);
  });

  it('exige id o código válido', async () => {
    const client = await connectClient(buildServer());
    expect((await callJson(client, 'kronos_get_bitacora', {})).isError).toBe(true);
    expect((await callJson(client, 'kronos_get_bitacora', { codigo: 'XX-1' })).isError).toBe(true);
  });
});

describe('kronos_bitacora_actividad_reciente', () => {
  it('por defecto: abiertas, última hora, alcance y cursor', async () => {
    const client = await connectClient(buildServer());
    const antes = Date.now();
    const { data } = await callJson(client, 'kronos_bitacora_actividad_reciente', {});
    const out = data as { desde: string; solo_abiertas: boolean; siguiente_cursor: string; data: { bitacora: { codigo: string } }[] };
    expect(out.solo_abiertas).toBe(true);
    expect(out.siguiente_cursor).toBe('21');
    expect(out.data[0]!.bitacora.codigo).toBe('BP-0004');
    const desdeMs = new Date(out.desde).getTime();
    expect(antes - desdeMs).toBeGreaterThanOrEqual(59 * 60 * 1000);
    expect(antes - desdeMs).toBeLessThanOrEqual(61 * 60 * 1000);
    const q = bitacoraQueries()[0]!;
    expect(q.text).toContain('o.id_company IN');
    expect(q.text).toContain("o.estado = N'ABIERTA'");
  });

  it('el cursor viaja parametrizado y una fecha muy antigua se acota a 31 días', async () => {
    const client = await connectClient(buildServer());
    const { data } = await callJson(client, 'kronos_bitacora_actividad_reciente', {
      desde: '2020-01-01T00:00:00Z',
      despuesDeRegistro: '20',
      soloAbiertas: false,
    });
    const out = data as { desde: string };
    expect(Date.now() - new Date(out.desde).getTime()).toBeLessThanOrEqual(31 * 24 * 60 * 60 * 1000 + 5000);
    const q = bitacoraQueries()[0]!;
    expect(q.values).toContain('20');
    expect(q.text).not.toContain("o.estado = N'ABIERTA'");
  });

  it('rechaza un cursor no numérico', async () => {
    const client = await connectClient(buildServer());
    const r = await callJson(client, 'kronos_bitacora_actividad_reciente', { despuesDeRegistro: '1 OR 1=1' });
    expect(r.isError).toBe(true);
  });
});

describe('kronos_list_bitacora_actividades', () => {
  it('lista el catálogo activo de la empresa del alcance', async () => {
    const client = await connectClient(buildServer());
    const { data } = await callJson(client, 'kronos_list_bitacora_actividades', {});
    const out = data as { count: number; data: { nombre: string }[] };
    expect(out.count).toBe(1);
    const q = bitacoraQueries()[0]!;
    expect(q.text).toContain('a.id_company IN');
    expect(q.text).toContain('a.activo = 1');
  });
});

describe('candado de solo lectura y base sin el módulo', () => {
  it('todo el SQL de la bitácora empieza por SELECT', async () => {
    const client = await connectClient(buildServer());
    await callJson(client, 'kronos_list_bitacoras', {});
    await callJson(client, 'kronos_get_bitacora', { id: 7 });
    await callJson(client, 'kronos_bitacora_actividad_reciente', {});
    await callJson(client, 'kronos_list_bitacora_actividades', {});
    const qs = bitacoraQueries();
    expect(qs.length).toBeGreaterThanOrEqual(6);
    for (const q of qs) expect(/^\s*select\b/i.test(q.text)).toBe(true);
  });

  it('si las tablas no existen (prod antes del pase) responde un error claro', async () => {
    mock.rawResolvers = [
      () => {
        throw Object.assign(new Error("Invalid object name 'ot_orden_trabajo'."), { meta: { code: '208' } });
      },
    ];
    const client = await connectClient(buildServer());
    const r = await callJson(client, 'kronos_list_bitacoras', {});
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no está instalado/);
  });
});

/**
 * Pruebas de las 5 tools recuperadas: adjuntos en OneDrive
 * (kronos_upload_attachment, kronos_delete_attachment) y formulario dinámico
 * (kronos_get_process_fields, kronos_get_request_fields, kronos_set_request_fields).
 *
 * MS Graph se simula con un `fetch` global falso; la BD con el mock de Prisma.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/tools/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import type { AuditEvent } from '../src/audit.js';
import { createMockPrisma, connectClient, callJson, type CapturedRawQuery, type MockPrisma } from './helpers.js';

const scopeReader: AuthScope = { agent: 'bot', role: 'reader', allCompanies: false, companyIds: [1] };
const scopeAdminCo1: AuthScope = { agent: 'horus', role: 'admin', allCompanies: false, companyIds: [1] };

const DRIVE = 'https://graph.example.test/v1.0/users/u/drive/';
const FILE_ID = '01ABCDEF!123';

let mock: MockPrisma;
let auditLog: AuditEvent[];
let fetchCalls: { url: string; method: string; body?: unknown }[];
/** Respuestas de Graph por (método, fragmento de URL). */
let graphRoutes: { method: string; match: string; status: number; json?: unknown }[];

function buildServer(scope: AuthScope): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  const audit = { log: async (e: AuditEvent) => { auditLog.push(e); } };
  registerTools(server, { scope, audit, maxPageSize: 200, defaultPageSize: 50 });
  return server;
}

async function call(scope: AuthScope, tool: string, args: Record<string, unknown>) {
  const client = await connectClient(buildServer(scope));
  return callJson(client, tool, args);
}

const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  fetchCalls.push({ url, method, body: init?.body });
  if (url.includes('login.microsoftonline.com')) {
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
  }
  const route = graphRoutes.find((r) => r.method === method && url.includes(r.match));
  if (!route) return new Response('not found', { status: 404 });
  return new Response(route.json === undefined ? null : JSON.stringify(route.json), { status: route.status });
});

function sqlText(q: CapturedRawQuery): string {
  return q.text.toLowerCase();
}

beforeAll(() => {
  process.env.MICROSOFTCLIENTID = 'client';
  process.env.MICROSOFTCLIENTSECRET = 'secret';
  process.env.MICROSOFTTENANTID = 'tenant';
  process.env.MICROSOFTGRAPHUSERROUTE = DRIVE;
  vi.stubGlobal('fetch', fakeFetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mock = createMockPrisma();
  // @ts-expect-error mock parcial compatible para pruebas
  setPrisma(mock);
  auditLog = [];
  fetchCalls = [];
  graphRoutes = [];
});

const graphWrites = () => fetchCalls.filter((c) => c.method !== 'GET' && !c.url.includes('login.'));

// ---------------------------------------------------------------------------
describe('kronos_upload_attachment', () => {
  const pdf = Buffer.from('%PDF-1.4 prueba').toString('base64');

  it('sube a la carpeta de la solicitud, sanea el nombre y NO sobrescribe (conflictBehavior=fail)', async () => {
    mock.rawRows.requests_general = [{ id: 50 }];
    graphRoutes = [
      { method: 'GET', match: 'root:/SAPSEND/TEC/SG/Request-50', status: 200, json: { id: 'FOLDER1', folder: {} } },
      { method: 'PUT', match: 'items/FOLDER1:/', status: 201, json: { id: 'NEW1', name: 'RUT - factura.pdf', size: 15, file: { mimeType: 'application/pdf' } } },
    ];
    const { data, isError } = await call(scopeReader, 'kronos_upload_attachment', {
      requestId: 50,
      fileName: 'fac:tura.pdf',
      label: 'RUT',
      contentBase64: pdf,
      contentType: 'application/pdf',
    });
    expect(isError ?? false).toBe(false);
    expect((data as { file_id: string }).file_id).toBe('NEW1');

    const q = mock.capturedRaw.find((x) => sqlText(x).includes('from requests_general'));
    expect(q!.text).toContain('rg.id_company IN');
    expect(q!.values).toContain(1);

    const put = fetchCalls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain(encodeURIComponent('RUT - factura.pdf'));
    expect(put.url).toContain('@microsoft.graph.conflictBehavior=fail');
    // El binario no queda en la auditoría.
    expect(JSON.stringify(auditLog)).not.toContain(pdf);
  });

  it('crea la carpeta con conflictBehavior "fail" (nunca "replace") si no existe', async () => {
    mock.rawRows.requests_general = [{ id: 51 }];
    graphRoutes = [
      { method: 'POST', match: 'root:/SAPSEND/TEC/SG:/children', status: 201, json: { id: 'FOLDER2' } },
      { method: 'PUT', match: 'items/FOLDER2:/', status: 201, json: { id: 'NEW2', name: 'a.pdf', file: {} } },
    ];
    const { isError } = await call(scopeReader, 'kronos_upload_attachment', {
      requestId: 51, fileName: 'a.pdf', contentBase64: pdf,
    });
    expect(isError ?? false).toBe(false);
    const post = fetchCalls.find((c) => c.method === 'POST' && c.url.includes('children'))!;
    const body = JSON.parse(String(post.body));
    expect(body['@microsoft.graph.conflictBehavior']).toBe('fail');
    expect(body.name).toBe('Request-51');
  });

  it('si ya existe un archivo con ese nombre (409) falla sin sobrescribir', async () => {
    mock.rawRows.requests_general = [{ id: 50 }];
    graphRoutes = [
      { method: 'GET', match: 'root:/SAPSEND/TEC/SG/Request-50', status: 200, json: { id: 'FOLDER1', folder: {} } },
      { method: 'PUT', match: 'items/FOLDER1:/', status: 409, json: { error: { code: 'nameAlreadyExists' } } },
    ];
    const { data, isError } = await call(scopeReader, 'kronos_upload_attachment', {
      requestId: 50, fileName: 'a.pdf', contentBase64: pdf,
    });
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/Ya existe un archivo/);
  });

  it('una solicitud fuera de alcance aborta antes de tocar OneDrive', async () => {
    mock.rawRows.requests_general = [];
    const { isError, data } = await call(scopeReader, 'kronos_upload_attachment', {
      requestId: 999, fileName: 'a.pdf', contentBase64: pdf,
    });
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/fuera de alcance/);
    expect(graphWrites()).toHaveLength(0);
  });

  it('los tickets se validan contra case.company y van a la carpeta MA', async () => {
    mock.rawRows.case = [{ id_case: 7 }];
    graphRoutes = [
      { method: 'GET', match: 'root:/SAPSEND/TEC/MA/Ticket-7', status: 200, json: { id: 'F7', folder: {} } },
      { method: 'PUT', match: 'items/F7:/', status: 201, json: { id: 'T1', name: 'a.pdf', file: {} } },
    ];
    const { isError } = await call(scopeReader, 'kronos_upload_attachment', {
      requestId: 7, kind: 'ticket', fileName: 'a.pdf', contentBase64: pdf,
    });
    expect(isError ?? false).toBe(false);
    const q = mock.capturedRaw.find((x) => sqlText(x).includes('from [case]'));
    expect(q!.text).toContain('c.company IN');
  });

  it('rechaza base64 inválido, MIME inválido y nombres que quedan vacíos', async () => {
    mock.rawRows.requests_general = [{ id: 50 }];
    const bad = await call(scopeReader, 'kronos_upload_attachment', {
      requestId: 50, fileName: 'a.pdf', contentBase64: 'no es base64!!',
    });
    expect(bad.isError).toBe(true);
    expect(String(bad.data)).toMatch(/base64/);

    const mime = await call(scopeReader, 'kronos_upload_attachment', {
      requestId: 50, fileName: 'a.pdf', contentBase64: pdf, contentType: 'text/html; <script>',
    });
    expect(mime.isError).toBe(true);

    const empty = await call(scopeReader, 'kronos_upload_attachment', {
      requestId: 50, fileName: '...', contentBase64: pdf,
    });
    expect(empty.isError).toBe(true);
    expect(graphWrites()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('kronos_delete_attachment', () => {
  const args = {
    requestId: 60,
    fileId: FILE_ID,
    justification: 'Documento cargado por error en la solicitud',
    actorUserId: 'user-admin',
  };

  /** Resolutores de un escenario "todo en regla"; se sobreescriben por prueba. */
  function happyResolvers(over: { actor?: unknown[]; orion?: unknown[]; index?: unknown[] } = {}) {
    mock.rawRows.requests_general = [{ id: 60, id_company: 1 }];
    mock.rawResolvers = [
      (q) => (sqlText(q).includes('from [user] u') ? over.actor ?? [{ id: 'user-admin', name: 'Ana', email: 'ana@x.com', is_admin: 1, can_delete: 1 }] : undefined),
      (q) => (sqlText(q).includes('as open_tasks') ? over.orion ?? [{ in_bag: 0, open_tasks: 0 }] : undefined),
      (q) => (sqlText(q).includes('from orion_document_index') ? over.index ?? [{ n: 0 }] : undefined),
      (q) => (sqlText(q).includes('insert into notes') ? [{ id_note: 900 }] : undefined),
    ];
    graphRoutes = [
      { method: 'GET', match: 'Request-60:/children', status: 200, json: { value: [{ id: FILE_ID, name: 'soporte.pdf', file: {} }] } },
      { method: 'DELETE', match: `items/${encodeURIComponent(FILE_ID)}`, status: 204 },
    ];
  }

  it('una key que no es admin no puede eliminar (ni consulta la BD)', async () => {
    happyResolvers();
    const { isError, data } = await call(scopeReader, 'kronos_delete_attachment', args);
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/role "admin"/);
    expect(mock.capturedRaw).toHaveLength(0);
    expect(graphWrites()).toHaveLength(0);
  });

  it('exige justificación de al menos 10 caracteres y un fileId válido', async () => {
    happyResolvers();
    const short = await call(scopeAdminCo1, 'kronos_delete_attachment', { ...args, justification: 'corta' });
    expect(short.isError).toBe(true);
    const evil = await call(scopeAdminCo1, 'kronos_delete_attachment', { ...args, fileId: "x'; DROP TABLE notes;--" });
    expect(evil.isError).toBe(true);
    expect(graphWrites()).toHaveLength(0);
  });

  it('elimina, filtra por empresa y deja la nota con la justificación', async () => {
    happyResolvers();
    const { isError, data } = await call(scopeAdminCo1, 'kronos_delete_attachment', args);
    expect(isError ?? false).toBe(false);
    expect(data).toMatchObject({ onedrive_deleted: true, id_note: 900, name: 'soporte.pdf' });

    const reqQ = mock.capturedRaw.find((x) => sqlText(x).includes('from requests_general'));
    expect(reqQ!.text).toContain('rg.id_company IN');
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(1);

    const note = mock.capturedRaw.find((x) => sqlText(x).includes('insert into notes'))!;
    // La justificación viaja como VALOR parametrizado.
    expect(note.text).not.toContain('Documento cargado por error');
    expect(JSON.stringify(note.values)).toContain('Justificación: Documento cargado por error');
    const event = mock.capturedWrite.find((x) => sqlText(x).includes('orion_document_event'))!;
    expect(event.values).toContain('ELIMINADO');
  });

  it('sin la doble llave (admin + "Eliminar adjuntos") no borra nada', async () => {
    happyResolvers({ actor: [{ id: 'u2', name: 'Pepe', email: 'p@x.com', is_admin: 1, can_delete: 0 }] });
    const { isError, data } = await call(scopeAdminCo1, 'kronos_delete_attachment', args);
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/Eliminar adjuntos/);
    expect(graphWrites()).toHaveLength(0);
  });

  it('rechaza documentos con flujo de firma Orion (bag, tareas o índice)', async () => {
    for (const over of [
      { orion: [{ in_bag: 1, open_tasks: 0 }] },
      { orion: [{ in_bag: 0, open_tasks: 2 }] },
      { index: [{ n: 1 }] },
    ]) {
      fetchCalls = [];
      happyResolvers(over);
      const { isError, data } = await call(scopeAdminCo1, 'kronos_delete_attachment', args);
      expect(isError).toBe(true);
      expect(String(data)).toMatch(/Orion/);
      expect(graphWrites()).toHaveLength(0);
    }
  });

  it('un fileId que no está en la carpeta de ESA solicitud no se borra', async () => {
    happyResolvers();
    graphRoutes[0] = { method: 'GET', match: 'Request-60:/children', status: 200, json: { value: [{ id: 'OTRO!1', name: 'x.pdf', file: {} }] } };
    const { isError, data } = await call(scopeAdminCo1, 'kronos_delete_attachment', args);
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/no pertenece a esta solicitud/);
    expect(graphWrites()).toHaveLength(0);
  });

  it('una solicitud fuera de alcance aborta antes de tocar OneDrive', async () => {
    happyResolvers();
    mock.rawRows.requests_general = [];
    const { isError } = await call(scopeAdminCo1, 'kronos_delete_attachment', args);
    expect(isError).toBe(true);
    expect(graphWrites()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('kronos_get_process_fields / kronos_get_request_fields', () => {
  it('get_process_fields con processId valida el proceso contra las empresas del alcance', async () => {
    const { data } = await call(scopeReader, 'kronos_get_process_fields', { processId: 33 });
    expect(data).toBeNull();
    const q = mock.capturedRaw.find((x) => sqlText(x).includes('company_category_request'))!;
    expect(q.text).toContain('ccr.id_company IN');
    expect(q.values).toContain(1);
  });

  it('get_process_fields arma campos con opciones y condiciones', async () => {
    mock.rawResolvers = [
      (q) => (sqlText(q).includes('pcrg.id_process_category') ? [{ id_process_category: 8 }] : undefined),
      (q) => (sqlText(q).includes('from process_form_field\n') || sqlText(q).includes('from process_form_field ') ? [{ id: 1, field_label: ' Tipo ', field_type: 'select', required: 1, display_order: 1 }] : undefined),
      (q) => (sqlText(q).includes('from process_form_field_option') ? [{ id: 11, id_form_field: 1, option_label: ' A ' }] : undefined),
      (q) => (sqlText(q).includes('from field_condition_option') ? [{ id: 5, id_form_field: 1, id_option: 11 }] : undefined),
    ];
    const { data } = await call(scopeReader, 'kronos_get_process_fields', { requestId: 70 });
    const out = data as { id_process_category: number; fields: { field_label: string; options: { option_label: string }[]; conditions: unknown[] }[] };
    expect(out.id_process_category).toBe(8);
    expect(out.fields[0]!.field_label).toBe('Tipo');
    expect(out.fields[0]!.options[0]!.option_label).toBe('A');
    expect(out.fields[0]!.conditions).toHaveLength(1);
    const q = mock.capturedRaw.find((x) => sqlText(x).includes('from requests_general'))!;
    expect(q.text).toContain('rg.id_company IN');
  });

  it('get_request_fields no devuelve valores de una solicitud fuera de alcance', async () => {
    mock.rawRows.requests_general = [];
    const { data } = await call(scopeReader, 'kronos_get_request_fields', { requestId: 70 });
    expect(data).toBeNull();
    expect(mock.capturedRaw.some((x) => sqlText(x).includes('from request_form_value'))).toBe(false);
  });

  it('todo el SQL de las dos tools de lectura es SELECT', async () => {
    mock.rawRows.requests_general = [{ id: 70 }];
    await call(scopeReader, 'kronos_get_request_fields', { requestId: 70 });
    await call(scopeReader, 'kronos_get_process_fields', { processId: 3 });
    for (const q of mock.capturedRaw) expect(/^\s*select\b/i.test(q.text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('kronos_set_request_fields', () => {
  function scenario(opts: { status?: number; existing?: number[] } = {}) {
    mock.rawResolvers = [
      (q) => (sqlText(q).includes('rg.status_req') ? [{ id_process_category: 8, status_req: opts.status ?? 1 }] : undefined),
      (q) =>
        sqlText(q).includes('select id, field_type, editable')
          ? [
              { id: 1, field_type: 'select', editable: 1 },
              { id: 2, field_type: 'text', editable: 0 },
              { id: 3, field_type: 'orion_signature', editable: 1 },
            ]
          : undefined,
      (q) => (sqlText(q).includes('select id_form_field from request_form_value') ? (opts.existing ?? []).map((id) => ({ id_form_field: id })) : undefined),
      (q) => (sqlText(q).includes('from process_form_field_option') ? (q.values.includes(11) ? [{ ok: 1 }] : []) : undefined),
    ];
  }

  it('inserta y actualiza con valores parametrizados y filtro de empresa', async () => {
    scenario({ existing: [1] });
    const evil = "x'); DROP TABLE request_form_value;--";
    const { data, isError } = await call(scopeReader, 'kronos_set_request_fields', {
      requestId: 80,
      values: [
        { id_field: 1, id_option: 11 },
        { id_field: 2, value_text: evil },
      ],
    });
    expect(isError ?? false).toBe(false);
    expect(data).toMatchObject({ updated: 1, inserted: 1 });
    const reqQ = mock.capturedRaw.find((x) => sqlText(x).includes('rg.status_req'))!;
    expect(reqQ.text).toContain('rg.id_company IN');
    for (const w of mock.capturedWrite) expect(w.text).not.toContain('DROP TABLE');
    expect(mock.capturedWrite.some((w) => w.values.includes(evil))).toBe(true);
  });

  it('no edita una solicitud cerrada', async () => {
    scenario({ status: 2 });
    const { isError, data } = await call(scopeReader, 'kronos_set_request_fields', {
      requestId: 80, values: [{ id_field: 1, id_option: 11 }],
    });
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/cerrada/);
    expect(mock.capturedWrite).toHaveLength(0);
  });

  it('nunca toca el campo de firma Orion', async () => {
    scenario();
    const { isError, data } = await call(scopeReader, 'kronos_set_request_fields', {
      requestId: 80, values: [{ id_field: 3, value_text: '{}' }],
    });
    expect(isError).toBe(true);
    expect(String(data)).toMatch(/firma Orion/);
    expect(mock.capturedWrite).toHaveLength(0);
  });

  it('un campo ya diligenciado y no editable no se sobrescribe', async () => {
    scenario({ existing: [2] });
    const { isError } = await call(scopeReader, 'kronos_set_request_fields', {
      requestId: 80, values: [{ id_field: 2, value_text: 'nuevo' }],
    });
    expect(isError).toBe(true);
    expect(mock.capturedWrite).toHaveLength(0);
  });

  it('valida coherencia: campo ajeno, opción ajena, select sin opción y campos repetidos', async () => {
    scenario();
    const cases = [
      [{ id_field: 99, value_text: 'x' }],
      [{ id_field: 1, id_option: 12 }],
      [{ id_field: 1 }],
      [{ id_field: 2, value_text: 'a' }, { id_field: 2, value_text: 'b' }],
    ];
    for (const values of cases) {
      const { isError } = await call(scopeReader, 'kronos_set_request_fields', { requestId: 80, values });
      expect(isError).toBe(true);
    }
    expect(mock.capturedWrite).toHaveLength(0);
  });

  it('un error a mitad de la lista no deja escrituras parciales (valida todo antes)', async () => {
    scenario();
    const { isError } = await call(scopeReader, 'kronos_set_request_fields', {
      requestId: 80,
      values: [{ id_field: 1, id_option: 11 }, { id_field: 99, value_text: 'x' }],
    });
    expect(isError).toBe(true);
    expect(mock.capturedWrite).toHaveLength(0);
  });
});

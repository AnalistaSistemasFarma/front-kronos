/**
 * SGC documental — tools de SOLO LECTURA (src/tools/sgcDocumentos.ts).
 *
 * Verifica: alcance por empresa, política conservadora (solo vigentes públicos
 * de empresas con el SGC activo), candado de solo lectura, que no salgan ids ni
 * rutas de OneDrive, la verificación SHA-256, la extracción de texto y la marca
 * de copia controlada. MS Graph se simula con un `fetch` falso.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { registerTools } from '../src/tools/index.js';
import { setPrisma } from '../src/db.js';
import { assertReadOnlySql } from '../src/readonly.js';
import type { AuthScope } from '../src/auth.js';
import { SGC_TOOLS } from '../src/tools/sgcDocumentos.js';
import { agentCopyLines, extractPdfText, sha256Hex } from '../src/sgcPdf.js';
import { createMockPrisma, connectClient, callJson, type CapturedRawQuery, type MockPrisma } from './helpers.js';

const scopeOlp: AuthScope = { agent: 'doki', role: 'reader', allCompanies: false, companyIds: [3] };
const scopeOtra: AuthScope = { agent: 'otra', role: 'reader', allCompanies: false, companyIds: [1] };
const scopeAdmin: AuthScope = { agent: 'admin', role: 'admin', allCompanies: true, companyIds: [] };
const scopeRestringida: AuthScope = { ...scopeOlp, allowedTools: ['sgc_list_documents'] };

const DRIVE = 'https://graph.example.test/v1.0/users/u/drive/';
const ITEM_ID = '01SGCITEM!42';

let mock: MockPrisma;
let pdfBytes: Uint8Array;
let pdfServed: Uint8Array;
let fetchCalls: { url: string; method: string }[];

async function buildPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([595, 842]);
  p1.drawText('PROCEDIMIENTO DE CONTROL DE DOCUMENTOS', { x: 50, y: 780, size: 14, font });
  p1.drawText('Objetivo: establecer el control documental.', { x: 50, y: 750, size: 11, font });
  const p2 = pdf.addPage([595, 842]);
  p2.drawText('Responsables: Aseguramiento de Calidad.', { x: 50, y: 780, size: 11, font });
  return pdf.save();
}

const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  fetchCalls.push({ url, method });
  if (url.includes('login.microsoftonline.com')) {
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
  }
  if (method === 'GET' && url.includes(`items/${encodeURIComponent(ITEM_ID)}/content`)) {
    return new Response(Buffer.from(pdfServed), { status: 200 });
  }
  return new Response('not found', { status: 404 });
});

function docRow(over: Record<string, unknown> = {}) {
  return {
    id_document: 11,
    id_company: 3,
    company: 'ONE LATAM PHARMA',
    code: 'PR-GC-001',
    title: 'Control de documentos',
    status: 'vigente',
    confidentiality: 'publica',
    id_document_type: 2,
    type_code: 'PR',
    type_name: 'Procedimiento',
    id_process_map: 5,
    process_code: 'GC',
    process_name: 'Gestión de Calidad',
    process_type_code: 'AP',
    process_type_name: 'Apoyo',
    id_area: 9,
    area: 'Aseguramiento de Calidad',
    id_document_version: 21,
    version_number: 2,
    version_status: 'vigente',
    effective_date: new Date('2026-10-01T00:00:00.000Z'),
    review_due_date: new Date('2029-10-01T00:00:00.000Z'),
    vigencia: 'al_dia',
    total: 1,
    created_by: 'calidad@onelatampharma.com',
    created_at: new Date('2026-09-30T15:00:00.000Z'),
    updated_at: new Date('2026-10-01T15:00:00.000Z'),
    next_review_date: null,
    review_months: 36,
    requires_training: true,
    pdf_item_id: ITEM_ID,
    pdf_file_name: 'PR-GC-001 V2.pdf',
    pdf_sha256: sha256Hex(pdfBytes),
    pdf_size: pdfBytes.byteLength,
    change_description: 'Actualización del alcance',
    id_request: 77,
    version_created_by: 'calidad@onelatampharma.com',
    version_created_at: new Date('2026-10-01T15:00:00.000Z'),
    ...over,
  };
}

/** Resolutor por tabla. `docs` = filas que devuelve la consulta principal de documentos. */
function seed(m: MockPrisma, docs: unknown[]) {
  m.rawResolvers = [
    (q: CapturedRawQuery) => {
      const t = q.text.toLowerCase();
      if (t.includes('from sgc.signature')) {
        return [
          { signer_name: 'Ana Calidad', signer_email: 'ana@x.com', meaning: 'elaboro', signed_at: new Date('2026-09-28T14:00:00Z'), on_behalf_of: null, ip: '10.0.0.1' },
          { signer_name: 'Luis Jefe', signer_email: 'luis@x.com', meaning: 'aprobo', signed_at: new Date('2026-09-29T14:00:00Z'), on_behalf_of: null },
        ];
      }
      if (t.includes('from sgc.document_version v\n') || /from sgc\.document_version v\s+where v\.id_document/.test(t)) {
        return [
          { id_document_version: 21, version_number: 2, status: 'vigente', effective_date: new Date('2026-10-01'), review_due_date: new Date('2029-10-01'), obsolete_date: null, change_description: 'Actualización', created_at: new Date('2026-10-01') },
          { id_document_version: 20, version_number: 1, status: 'obsoleto', effective_date: new Date('2025-01-01'), review_due_date: null, obsolete_date: new Date('2026-10-01'), change_description: null, created_at: new Date('2025-01-01') },
        ];
      }
      if (t.includes('from sgc.document_type dt')) {
        return [{ id_document_type: 2, id_company: 3, company: 'ONE LATAM PHARMA', code: 'PR', name: 'Procedimiento', plural_name: 'Procedimientos', review_months: 36, alert_months: 2, sort_order: 1, documents: 1 }];
      }
      if (t.includes('from sgc.document d')) return docs;
      return undefined;
    },
  ];
}

async function call(scope: AuthScope, tool: string, args: Record<string, unknown> = {}) {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  registerTools(server, { scope, audit: { log: async () => {} }, maxPageSize: 200, defaultPageSize: 50 });
  const client = await connectClient(server);
  return callJson(client, tool, args);
}

const docQueries = () => mock.capturedRaw.filter((q) => q.text.toLowerCase().includes('from sgc.document d'));

beforeAll(async () => {
  process.env.MICROSOFTCLIENTID = 'client';
  process.env.MICROSOFTCLIENTSECRET = 'secret';
  process.env.MICROSOFTTENANTID = 'tenant';
  process.env.MICROSOFTGRAPHUSERROUTE = DRIVE;
  vi.stubGlobal('fetch', fakeFetch);
  pdfBytes = await buildPdf();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mock = createMockPrisma();
  // @ts-expect-error mock parcial compatible para pruebas
  setPrisma(mock);
  fetchCalls = [];
  pdfServed = pdfBytes;
  seed(mock, [docRow()]);
});

describe('registro', () => {
  it('registra las 5 herramientas del SGC y respeta la lista blanca de la llave', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    registerTools(server, { scope: scopeRestringida, audit: { log: async () => {} }, maxPageSize: 200, defaultPageSize: 50 });
    const client = await connectClient(server);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(['sgc_list_documents']);

    const s2 = new McpServer({ name: 'test', version: '1.0.0' });
    registerTools(s2, { scope: scopeOlp, audit: { log: async () => {} }, maxPageSize: 200, defaultPageSize: 50 });
    const all = (await (await connectClient(s2)).listTools()).tools.map((t) => t.name);
    for (const t of SGC_TOOLS) expect(all).toContain(t);
  });
});

describe('sgc_list_documents', () => {
  it('filtra por empresa del alcance, solo vigentes públicos de empresas activas, y pagina', async () => {
    const res = await call(scopeOlp, 'sgc_list_documents', { texto: "PR'; DROP TABLE x --", limit: 10, offset: 0 });
    expect(res.isError).toBeFalsy();
    const out = res.data as { total: number; documents: Record<string, unknown>[] };
    expect(out.total).toBe(1);
    expect(out.documents[0]).toMatchObject({ code: 'PR-GC-001', vigencia: 'al_dia', synerlink_path: '/process/sgc-documental/documentos/11' });
    expect(JSON.stringify(out)).not.toContain(ITEM_ID);

    const q = docQueries()[0]!;
    expect(q.text).toContain("cc.is_active = 1 AND d.status = N'vigente' AND d.confidentiality = N'publica'");
    expect(q.text).toContain("d.id_company IN");
    expect(q.values).toContain(3);
    // La inyección viaja como VALOR, nunca como SQL.
    expect(q.text).not.toContain('DROP');
    expect(q.values.some((v) => String(v).includes('DROP TABLE'))).toBe(true);
    expect(() => assertReadOnlySql(q.text)).not.toThrow();
  });

  it('una empresa fuera del alcance no amplía el filtro (1 = 0)', async () => {
    await call(scopeOtra, 'sgc_list_documents', { companyId: 3 });
    expect(docQueries()[0]!.text).toContain('1 = 0');
  });

  it('la llave admin ve todas las empresas pero igual solo vigentes públicos', async () => {
    await call(scopeAdmin, 'sgc_list_documents', {});
    const t = docQueries()[0]!.text;
    expect(t).toContain('1 = 1');
    expect(t).toContain("d.confidentiality = N'publica'");
  });

  it('filtros de tipo, área y vigencia', async () => {
    await call(scopeOlp, 'sgc_list_documents', { tipo: 'PR', areaId: 9, vigencia: 'vencido' });
    const q = docQueries()[0]!;
    expect(q.text).toContain('UPPER(dt.code) = UPPER(');
    expect(q.text).toContain('COALESCE(d.id_owner_department, pm.id_department) =');
    expect(q.values).toEqual(expect.arrayContaining(['PR', 9, 'vencido']));
  });

  it('rechaza un estado distinto de vigente', async () => {
    const res = await call(scopeOlp, 'sgc_list_documents', { estado: 'obsoleto' });
    expect(res.isError).toBe(true);
  });
});

describe('sgc_get_document', () => {
  it('devuelve metadatos, versiones y firmas sin rutas, ids de OneDrive ni IP', async () => {
    const res = await call(scopeOlp, 'sgc_get_document', { idDocument: 11 });
    expect(res.isError).toBeFalsy();
    const out = res.data as Record<string, unknown> & { versions: unknown[]; signatures: Record<string, unknown>[] };
    expect(out.code).toBe('PR-GC-001');
    expect(out.versions).toHaveLength(2);
    expect(out.signatures.map((s) => s.meaning)).toEqual(['Elaboró', 'Aprobó']);
    const json = JSON.stringify(out);
    expect(json).not.toContain(ITEM_ID);
    expect(json).not.toContain('10.0.0.1');
    expect(json).not.toContain('pdf_item_id');
    const sig = mock.capturedRaw.find((q) => q.text.includes('FROM sgc.signature'))!;
    expect(sig.text).not.toMatch(/s\.ip|user_agent/);
  });

  it('documento no visible o inexistente → null', async () => {
    seed(mock, []);
    const res = await call(scopeOlp, 'sgc_get_document', { code: 'PR-XX-999' });
    expect(res.data).toBeNull();
  });

  it('código repetido en varias empresas pide companyId', async () => {
    seed(mock, [docRow(), docRow({ id_company: 4, id_document: 12 })]);
    const res = await call(scopeAdmin, 'sgc_get_document', { code: 'PR-GC-001' });
    expect(res.isError).toBe(true);
    expect(String(res.data)).toContain('companyId');
  });

  it('exige idDocument o code', async () => {
    const res = await call(scopeOlp, 'sgc_get_document', {});
    expect(res.isError).toBe(true);
  });
});

describe('sgc_download_document', () => {
  it('descarga la vigente, verifica SHA-256 y devuelve el texto', async () => {
    const res = await call(scopeOlp, 'sgc_download_document', { code: 'PR-GC-001' });
    expect(res.isError).toBeFalsy();
    const out = res.data as Record<string, unknown>;
    expect(out.sha256_verified).toBe(true);
    expect(out.pages).toBe(2);
    expect(String(out.text)).toContain('PROCEDIMIENTO DE CONTROL DE DOCUMENTOS');
    expect(String(out.text)).toContain('Responsables: Aseguramiento de Calidad.');
    expect(out.content_base64).toBeNull();
    // Solo lecturas a Graph.
    expect(fetchCalls.filter((c) => c.method !== 'GET' && !c.url.includes('login.'))).toHaveLength(0);
  });

  it('con incluirPdf entrega la copia marcada (distinta del original) en base64', async () => {
    const res = await call(scopeOlp, 'sgc_download_document', { idDocument: 11, incluirPdf: true, incluirTexto: false });
    const out = res.data as Record<string, unknown>;
    expect(out.pdf_included).toBe(true);
    const copy = Buffer.from(String(out.content_base64), 'base64');
    expect(copy.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256Hex(copy)).not.toBe(sha256Hex(pdfBytes));
    const text = await extractPdfText(new Uint8Array(copy), 20_000);
    expect(text.text).toContain('COPIA CONTROLADA');
    expect(text.text).toContain('doki');
  });

  it('si el archivo no coincide con su huella no lo entrega', async () => {
    pdfServed = new Uint8Array([...pdfBytes, 0x20]);
    const res = await call(scopeOlp, 'sgc_download_document', { idDocument: 11 });
    expect(res.isError).toBe(true);
    expect(String(res.data)).toContain('SHA-256');
  });

  it('solo entrega la versión vigente', async () => {
    const res = await call(scopeOlp, 'sgc_download_document', { idDocument: 11, version: 1 });
    expect(res.isError).toBe(true);
    expect(fetchCalls.filter((c) => c.url.includes('/content'))).toHaveLength(0);
  });

  it('respeta el tope de tamaño', async () => {
    seed(mock, [docRow({ pdf_size: 50 * 1024 * 1024 })]);
    const res = await call(scopeOlp, 'sgc_download_document', { idDocument: 11 });
    expect(res.isError).toBe(true);
    expect(String(res.data)).toContain('tope');
  });

  it('documento fuera del alcance → null sin tocar OneDrive', async () => {
    seed(mock, []);
    const res = await call(scopeOtra, 'sgc_download_document', { idDocument: 11 });
    expect(res.data).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('sgc_list_document_types y sgc_master_list', () => {
  it('tipos con conteo, filtrados por alcance', async () => {
    const res = await call(scopeOlp, 'sgc_list_document_types', {});
    const out = res.data as { types: Record<string, unknown>[] };
    expect(out.types[0]).toMatchObject({ code: 'PR', documents: 1 });
    const q = mock.capturedRaw.find((x) => x.text.includes('FROM sgc.document_type dt'))!;
    expect(q.text).toMatch(/dt\.id_company IN/);
    expect(() => assertReadOnlySql(q.text)).not.toThrow();
  });

  it('listado maestro compacto', async () => {
    const res = await call(scopeOlp, 'sgc_master_list', { companyId: 3 });
    const out = res.data as { total: number; truncated: boolean; documents: Record<string, unknown>[] };
    expect(out.total).toBe(1);
    expect(out.truncated).toBe(false);
    expect(out.documents[0]).toMatchObject({ code: 'PR-GC-001', type: 'PR', version: 2 });
    expect(() => assertReadOnlySql(docQueries()[0]!.text)).not.toThrow();
  });
});

describe('marca de la copia', () => {
  it('líneas sin caracteres fuera de WinAnsi', () => {
    const l = agentCopyLines({ code: 'PR-GC-001', versionNumber: 2, agent: 'Doki «OLP»', at: new Date('2026-11-13T16:00:00Z'), versionStatus: 'vigente' });
    expect(l.diagonal).toBe('COPIA CONTROLADA - VIGENTE');
    expect(l.footer).toContain('2026-11-13 11:00');
    expect(l.footer).toContain('"Doki "OLP""');
  });
});

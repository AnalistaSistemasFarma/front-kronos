import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 1 (/api/sgc/**) con la sesión, la base y OneDrive
// simulados. Las reglas de negocio se prueban en lib/sgc/__tests__ y, contra
// un SQL Server real, en tests/integration/sgc.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getSgcAccessForUser: vi.fn(),
  getAccessSubject: vi.fn(),
  listMasterDocuments: vi.fn(),
  createInitialDocument: vi.fn(),
  getDocumentDetail: vi.fn(),
  updateDocumentMetadata: vi.fn(),
  annulDocument: vi.fn(),
  grantDocumentAccess: vi.fn(),
  revokeDocumentAccess: vi.fn(),
  getVersionForViewer: vi.fn(),
  getCatalogs: vi.fn(),
  saveCatalogEntry: vi.fn(),
  downloadVerifiedPdf: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { sgcAuditLog: { create: m.auditCreate } } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({
  getAccessSubject: m.getAccessSubject,
  listMasterDocuments: m.listMasterDocuments,
  createInitialDocument: m.createInitialDocument,
  getDocumentDetail: m.getDocumentDetail,
  updateDocumentMetadata: m.updateDocumentMetadata,
  annulDocument: m.annulDocument,
  grantDocumentAccess: m.grantDocumentAccess,
  revokeDocumentAccess: m.revokeDocumentAccess,
  getVersionForViewer: m.getVersionForViewer,
}));
vi.mock('../../../../lib/sgc/db/catalogs', () => ({
  getCatalogs: m.getCatalogs,
  saveCatalogEntry: m.saveCatalogEntry,
  SGC_CATALOG_ENTITIES: ['coding-guide', 'process-types', 'processes', 'document-types'],
}));
vi.mock('../../../../lib/sgc/onedrive', () => ({ uploadToSgcStorage: vi.fn(), downloadVerifiedPdf: m.downloadVerifiedPdf }));

import { SgcError } from '../../../../lib/sgc/errors';
import { GET as getCatalogs } from '../catalogs/route';
import { POST as postConfig } from '../config/[entity]/route';
import { GET as listDocs, POST as postDoc } from '../documents/route';
import { GET as getDoc, PATCH as patchDoc } from '../documents/[id]/route';
import { POST as annul } from '../documents/[id]/annul/route';
import { POST as grant } from '../documents/[id]/access/route';
import { POST as revoke } from '../documents/[id]/access/[accessId]/revoke/route';
import { GET as getFile } from '../documents/[id]/versions/[versionId]/file/route';
import { companyAccess, parseCompanyParam } from '../_lib/context';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'ana@onelatampharma.com';

function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [6] });
}
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const json = (url: string, body: unknown, method = 'POST') =>
  new Request(url, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.5:5555' } });

async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  return pdf.save();
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas del SGC · sesión y dos llaves', () => {
  it('[SGC-REQ-007] sin sesión todas las rutas del S1 responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const responses = await Promise.all([
      getCatalogs(new Request('http://x/api/sgc/catalogs?company=3')),
      listDocs(new Request('http://x/api/sgc/documents?company=3')),
      postDoc(new Request('http://x/api/sgc/documents', { method: 'POST' })),
      getDoc(new Request('http://x'), params({ id: '1' })),
      patchDoc(json('http://x', {}, 'PATCH'), params({ id: '1' })),
      annul(json('http://x', {}), params({ id: '1' })),
      grant(json('http://x', {}), params({ id: '1' })),
      revoke(json('http://x', {}), params({ id: '1', accessId: '1' })),
      getFile(new Request('http://x'), params({ id: '1', versionId: '1' })),
      postConfig(json('http://x', {}), params({ entity: 'processes' })),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(401));
    expect(m.getSgcAccessForUser).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-004] sin acceso a la empresa pedida responde 403; sin empresa, 400', async () => {
    asUser([]);
    expect((await listDocs(new Request('http://x/api/sgc/documents?company=3'))).status).toBe(403);
    expect((await getCatalogs(new Request('http://x/api/sgc/catalogs?company=3'))).status).toBe(403);
    expect((await listDocs(new Request('http://x/api/sgc/documents'))).status).toBe(400);
    expect((await getCatalogs(new Request('http://x/api/sgc/catalogs?company=abc'))).status).toBe(400);
  });

  it('[SGC-REQ-004] utilidades del contexto: empresa de la URL y permiso por empresa', () => {
    expect(parseCompanyParam('http://x/?company=3')).toBe(3);
    expect(parseCompanyParam('http://x/?company=0')).toBeNull();
    const ctx = { email: EMAIL, access: [lectura], subject: { email: EMAIL, departmentIds: [] }, actor: { email: EMAIL } };
    expect(companyAccess(ctx, OLP)).toBe(lectura);
    expect(companyAccess(ctx, OLP, 'canQuality')).toBeNull();
    expect(companyAccess(ctx, 1)).toBeNull();
  });
});

describe('Rutas del SGC · listado maestro y maestros', () => {
  it('[SGC-REQ-015] el listado maestro sale del acceso de la sesión y sin caché', async () => {
    asUser([lectura]);
    m.listMasterDocuments.mockResolvedValue([{ code: 'OLP-GC-PR-001' }]);
    const res = await listDocs(new Request('http://x/api/sgc/documents?company=3&status=todos'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ documents: [{ code: 'OLP-GC-PR-001' }] });
    expect(m.listMasterDocuments).toHaveBeenCalledWith(expect.anything(), lectura, { email: EMAIL, departmentIds: [6] }, { status: 'todos' });
  });

  it('[SGC-REQ-012] los maestros: solo Calidad puede pedir los inactivos', async () => {
    asUser([lectura]);
    m.getCatalogs.mockResolvedValue({ idCompany: OLP });
    await getCatalogs(new Request('http://x/api/sgc/catalogs?company=3&all=1'));
    expect(m.getCatalogs).toHaveBeenLastCalledWith(expect.anything(), OLP, false);
    asUser([calidad]);
    await getCatalogs(new Request('http://x/api/sgc/catalogs?company=3&all=1'));
    expect(m.getCatalogs).toHaveBeenLastCalledWith(expect.anything(), OLP, true);
  });

  it('[SGC-REQ-012] configurar maestros es solo de Calidad, con el actor y su IP sin puerto', async () => {
    asUser([lectura]);
    expect((await postConfig(json('http://x', { company: 3, reason: 'x' }), params({ entity: 'processes' }))).status).toBe(403);
    asUser([calidad]);
    expect((await postConfig(json('http://x', { company: 3 }), params({ entity: 'otra-cosa' }))).status).toBe(404);
    expect((await postConfig(json('http://x', { reason: 'x' }), params({ entity: 'processes' }))).status).toBe(400);
    expect((await postConfig(new Request('http://x', { method: 'POST', body: 'no-json' }), params({ entity: 'processes' }))).status).toBe(400);
    m.saveCatalogEntry.mockResolvedValue({ id_process_map: 9 });
    const res = await postConfig(json('http://x', { company: 3, code: 'GC', reason: 'Alta inicial del proceso' }), params({ entity: 'processes' }));
    expect(res.status).toBe(201);
    expect(m.saveCatalogEntry).toHaveBeenCalledWith(expect.anything(), OLP, 'processes', expect.objectContaining({ code: 'GC' }), expect.objectContaining({ email: EMAIL, ip: '10.0.0.5' }));
    m.saveCatalogEntry.mockRejectedValue(new SgcError('Ya existe', 409));
    expect((await postConfig(json('http://x', { company: 3, id: 9, reason: 'x' }), params({ entity: 'processes' }))).status).toBe(409);
  });
});

describe('Rutas del SGC · carga inicial por Calidad', () => {
  const form = (fields: Record<string, string | Blob>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return new Request('http://x/api/sgc/documents', { method: 'POST', body: f });
  };

  it('[SGC-REQ-014] solo Aseguramiento de Calidad carga documentos vigentes', async () => {
    asUser([lectura]);
    const res = await postDoc(form({ company: '3' }));
    expect(res.status).toBe(403);
    expect(m.createInitialDocument).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-014] exige formulario y empresa', async () => {
    asUser([calidad]);
    expect((await postDoc(new Request('http://x', { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } }))).status).toBe(400);
    expect((await postDoc(form({ title: 'x' }))).status).toBe(400);
  });

  it('[SGC-REQ-014] entrega a la carga el PDF, el Word y los metadatos del formulario', async () => {
    asUser([calidad]);
    m.createInitialDocument.mockResolvedValue({ idDocument: 1, code: 'OLP-GC-PR-001' });
    const pdf = new File([new TextEncoder().encode('%PDF-1.7 x')], 'proc.pdf', { type: 'application/pdf' });
    const word = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'proc.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const res = await postDoc(
      form({ company: '3', idProcess: '20', idDocumentType: '200', title: 'Control de documentos', confidentiality: 'publica', versionNumber: '2', effectiveDate: '2026-01-15', idOwnerDepartment: '3', pdf, source: word })
    );
    expect(res.status).toBe(201);
    const [, , input] = m.createInitialDocument.mock.calls[0];
    expect(input).toMatchObject({ idCompany: 3, idProcess: 20, idDocumentType: 200, versionNumber: 2, effectiveDate: '2026-01-15', idOwnerDepartment: 3 });
    expect(input.pdf.fileName).toBe('proc.pdf');
    expect(input.pdf.bytes.length).toBeGreaterThan(0);
    expect(input.source.fileName).toBe('proc.docx');
  });

  it('[SGC-REQ-014] sin PDF igual llega a la validación (que lo rechaza) y los errores internos no filtran detalle', async () => {
    asUser([calidad]);
    m.createInitialDocument.mockRejectedValue(new SgcError('Falta el PDF controlado del documento.'));
    const res = await postDoc(form({ company: '3', title: 'x' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('PDF');
    expect(m.createInitialDocument.mock.calls[0][2]).toMatchObject({ versionNumber: 1, idOwnerDepartment: null, source: null });
    m.createInitialDocument.mockRejectedValue(new Error('Login failed for user secreto'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res2 = await postDoc(form({ company: '3' }));
    expect(res2.status).toBe(500);
    expect(JSON.stringify(await res2.json())).not.toContain('secreto');
    spy.mockRestore();
  });
});

describe('Rutas del SGC · ficha, edición, anulación y accesos', () => {
  it('[SGC-REQ-018] la ficha responde 404 si no existe o no se puede consultar (no revela su existencia)', async () => {
    asUser([lectura]);
    m.getDocumentDetail.mockResolvedValue(null);
    expect((await getDoc(new Request('http://x'), params({ id: '7' }))).status).toBe(404);
    m.getDocumentDetail.mockResolvedValue({ document: { code: 'X' } });
    const res = await getDoc(new Request('http://x'), params({ id: '7' }));
    expect(res.status).toBe(200);
    expect(m.getDocumentDetail).toHaveBeenLastCalledWith(expect.anything(), [lectura], expect.anything(), 7);
  });

  it('[SGC-REQ-022] edición, anulación y accesos pasan el actor; los errores de negocio conservan su código', async () => {
    asUser([calidad]);
    m.updateDocumentMetadata.mockResolvedValue({ id_document: 7 });
    expect((await patchDoc(json('http://x', { title: 'Nuevo', reason: 'Corrección del título' }, 'PATCH'), params({ id: '7' }))).status).toBe(200);
    expect((await patchDoc(new Request('http://x', { method: 'PATCH', body: 'x' }), params({ id: '7' }))).status).toBe(400);
    m.annulDocument.mockRejectedValue(new SgcError('Solo Aseguramiento de Calidad puede administrar documentos.', 403));
    expect((await annul(json('http://x', { reason: 'x' }), params({ id: '7' }))).status).toBe(403);
    m.annulDocument.mockResolvedValue({ status: 'anulado' });
    expect((await annul(json('http://x', { reason: 'Documento reemplazado' }), params({ id: '7' }))).status).toBe(200);
    expect(m.annulDocument).toHaveBeenLastCalledWith(expect.anything(), [calidad], 7, 'Documento reemplazado', expect.objectContaining({ email: EMAIL }));
    m.grantDocumentAccess.mockResolvedValue({ id_document_access: 1 });
    expect((await grant(json('http://x', { userEmail: 'b@c.co', reason: 'Auditoría externa' }), params({ id: '7' }))).status).toBe(201);
    expect((await grant(new Request('http://x', { method: 'POST', body: 'x' }), params({ id: '7' }))).status).toBe(400);
    m.revokeDocumentAccess.mockResolvedValue({ revoked_at: new Date() });
    expect((await revoke(json('http://x', { reason: 'Terminó la auditoría' }), params({ id: '7', accessId: '1' }))).status).toBe(200);
    expect(m.revokeDocumentAccess).toHaveBeenLastCalledWith(expect.anything(), [calidad], 7, 1, 'Terminó la auditoría', expect.anything());
    m.getDocumentDetail.mockRejectedValue(new Error('x'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await getDoc(new Request('http://x'), params({ id: '7' }))).status).toBe(500);
    for (const fn of [m.updateDocumentMetadata, m.grantDocumentAccess, m.revokeDocumentAccess, m.getCatalogs, m.listMasterDocuments]) fn.mockRejectedValue(new Error('x'));
    expect((await patchDoc(json('http://x', {}, 'PATCH'), params({ id: '7' }))).status).toBe(500);
    expect((await grant(json('http://x', {}), params({ id: '7' }))).status).toBe(500);
    expect((await revoke(json('http://x', {}), params({ id: '7', accessId: '1' }))).status).toBe(500);
    expect((await getCatalogs(new Request('http://x/?company=3'))).status).toBe(500);
    expect((await listDocs(new Request('http://x/?company=3'))).status).toBe(500);
    spy.mockRestore();
  });
});

describe('Rutas del SGC · visor sin descarga ni impresión', () => {
  const found = (perms: Partial<{ canDownload: boolean; canPrint: boolean }> = {}) => ({
    document: { id: 7, idCompany: OLP, code: 'OLP-GC-PR-001', title: 'Control' },
    version: { id_document_version: 11, version_number: 2, pdf_item_id: 'item', pdf_sha256: 'abc' },
    permissions: { canView: true, canDownload: false, canPrint: false, canAdminister: false, ...perms },
  });

  it('[SGC-REQ-017][SGC-REQ-019] la consulta entrega el PDF inline, sin caché, con marca de agua y queda auditada', async () => {
    asUser([lectura]);
    m.getVersionForViewer.mockResolvedValue(found());
    m.downloadVerifiedPdf.mockResolvedValue(await samplePdf());
    const res = await getFile(new Request('http://x/file', { headers: { 'x-forwarded-for': '10.9.9.9:4444' } }), params({ id: '7', versionId: '11' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const out = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()), { updateMetadata: false });
    expect(out.getProducer()).toContain('copia controlada');
    expect(m.downloadVerifiedPdf).toHaveBeenCalledWith('item', 'abc');
    expect(m.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'documento.consulta', actor_email: EMAIL, ip: '10.9.9.9', entity_id: '11' }) });
  });

  it('[SGC-REQ-017] descarga e impresión sin permiso: 403 y el intento queda en la auditoría', async () => {
    asUser([lectura]);
    m.getVersionForViewer.mockResolvedValue(found());
    for (const modo of ['descarga', 'impresion']) {
      const res = await getFile(new Request(`http://x/file?modo=${modo}`), params({ id: '7', versionId: '11' }));
      expect(res.status).toBe(403);
    }
    expect(m.downloadVerifiedPdf).not.toHaveBeenCalled();
    expect(m.auditCreate).toHaveBeenCalledTimes(2);
    expect(m.auditCreate.mock.calls[0][0].data.action).toBe('acceso.denegado');
  });

  it('[SGC-REQ-017] con permiso excepcional la descarga sale como adjunto y queda auditada como descarga', async () => {
    asUser([lectura]);
    m.getVersionForViewer.mockResolvedValue(found({ canDownload: true, canPrint: true }));
    m.downloadVerifiedPdf.mockResolvedValue(await samplePdf());
    const res = await getFile(new Request('http://x/file?modo=descarga'), params({ id: '7', versionId: '11' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(m.auditCreate.mock.calls[0][0].data.action).toBe('documento.descarga');
    const res2 = await getFile(new Request('http://x/file?modo=impresion'), params({ id: '7', versionId: '11' }));
    expect(res2.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(m.auditCreate.mock.calls[1][0].data.action).toBe('documento.impresion');
  });

  it('[SGC-REQ-018] sin permiso de consulta responde 404 y registra el intento; modo inválido 400; hash alterado 409', async () => {
    asUser([lectura]);
    m.getVersionForViewer.mockResolvedValue(null);
    expect((await getFile(new Request('http://x/file'), params({ id: '7', versionId: '11' }))).status).toBe(404);
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({ action: 'acceso.denegado', id_company: null });
    expect((await getFile(new Request('http://x/file?modo=pantallazo'), params({ id: '7', versionId: '11' }))).status).toBe(400);
    m.getVersionForViewer.mockResolvedValue(found());
    m.downloadVerifiedPdf.mockRejectedValue(new SgcError('El archivo guardado no coincide con su huella registrada (SHA-256).', 409));
    expect((await getFile(new Request('http://x/file'), params({ id: '7', versionId: '11' }))).status).toBe(409);
  });
});

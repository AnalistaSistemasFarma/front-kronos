import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * RUTAS DE FORMACIÓN contra SharePoint (Graph simulado).
 *
 * - Subir un material: el archivo va a FORMACION/<curso>/materiales y la base
 *   guarda SOLO la referencia (nunca `contenido`).
 * - Sin credenciales: 503 con mensaje claro y NADA se guarda en la base.
 * - Descargar: el portal hace de proxy (el navegador no ve SharePoint).
 * - Certificado: al emitirse se sube a FORMACION/<curso>/certificados/<codigo>.pdf.
 */

const db = vi.hoisted(() => ({
  portalCourse: { findUnique: vi.fn(), updateMany: vi.fn() },
  portalCourseMaterial: { aggregate: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  portalCertificate: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
const identificar = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({ prisma: db }));
vi.mock('../acceso', () => ({ identificar }));
vi.mock('../certificado-pdf', () => ({ generarCertificadoPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }));

import { POST as subirMaterial } from '../../../app/api/portal/courses/[id]/materials/route';
import { GET as descargarMaterial } from '../../../app/api/portal/courses/[id]/materials/[materialId]/file/route';
import { emitirCertificadoSiCorresponde } from '../formacion';
import { _reiniciarCacheToken } from '../formacion-storage';

const ENV = {
  PORTAL_TH_SP_TENANT_ID: 'tenant',
  PORTAL_TH_SP_CLIENT_ID: 'cliente',
  PORTAL_TH_SP_CLIENT_SECRET: 'secreto',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,024c062f,12fcaddd',
};

let graph: ReturnType<typeof vi.fn>;

function instalarGraph() {
  graph = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('login.microsoftonline.com')) {
      return Response.json({ access_token: 'tok', expires_in: 3600 });
    }
    if (u.includes('/drive/items/')) {
      return new Response('BYTES', { headers: { 'content-type': 'application/pdf', 'content-length': '5' } });
    }
    if (init?.method === 'PUT') {
      const nombre = decodeURIComponent(u.split(':/content')[0].split('/').pop() ?? '');
      return Response.json({ id: `ID-${nombre}`, name: nombre, size: 4, webUrl: `https://sp/${nombre}` }, { status: 201 });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', graph);
}

function formulario(archivo: File) {
  const form = new FormData();
  form.append('type', 'DOCUMENT');
  form.append('title', 'Guía SST');
  form.append('required', 'true');
  form.append('file', archivo);
  return new Request('https://portal.test/api/portal/courses/7/materials', { method: 'POST', body: form }) as unknown as NextRequest;
}

const params7 = { params: Promise.resolve({ id: '7' }) };

beforeEach(() => {
  vi.clearAllMocks();
  _reiniciarCacheToken();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubEnv('PORTAL_TH_SP_FOLDER', '');
  identificar.mockResolvedValue({ correo: 'cristian.baldion@gsslatam.com' });
  db.portalCourse.findUnique.mockResolvedValue({ id: 7, title: 'Inducción SST', sp_folder_name: null });
  db.portalCourse.updateMany.mockResolvedValue({ count: 1 });
  db.portalCourseMaterial.aggregate.mockResolvedValue({ _max: { orden: 0 } });
  db.portalCourseMaterial.create.mockResolvedValue({ id: 99 });
  instalarGraph();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/portal/courses/:id/materials (DOCUMENT)', () => {
  it('sube a FORMACION/<slug>-<id>/materiales y guarda solo la referencia', async () => {
    // El segundo findUnique (relectura de la carpeta) ya la trae fijada.
    db.portalCourse.findUnique
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce({ title: 'Inducción SST', sp_folder_name: null })
      .mockResolvedValueOnce({ sp_folder_name: 'induccion-sst-7' });

    const res = await subirMaterial(formulario(new File(['%PDF'], 'guía final.pdf', { type: 'application/pdf' })), params7);
    expect(res.status).toBe(200);

    const put = graph.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PUT');
    expect(String(put?.[0])).toContain('/drive/root:/FORMACION/induccion-sst-7/materiales/');
    expect(String(put?.[0])).toContain('conflictBehavior=rename');

    const data = db.portalCourseMaterial.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: 'DOCUMENT', sp_drive_item_id: expect.stringMatching(/^ID-/), file_size: BigInt(4) });
    expect(data).not.toHaveProperty('contenido');
  });

  it('sin variables de SharePoint responde 503 claro y NO guarda en la base', async () => {
    vi.stubEnv('PORTAL_TH_SP_CLIENT_SECRET', '');
    const res = await subirMaterial(formulario(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })), params7);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/SharePoint/);
    expect(db.portalCourseMaterial.create).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });

  it('si Graph falla, no crea la fila', async () => {
    graph.mockImplementation(async (url: string | URL | Request) =>
      String(url).includes('login.microsoftonline.com')
        ? Response.json({ access_token: 'tok', expires_in: 3600 })
        : new Response(null, { status: 403 })
    );
    const res = await subirMaterial(formulario(new File(['x'], 'a.pdf', { type: 'application/pdf' })), params7);
    expect(res.status).toBe(500);
    expect(db.portalCourseMaterial.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/portal/courses/:id/materials/:materialId/file', () => {
  const p = { params: Promise.resolve({ id: '7', materialId: '99' }) };
  const req = new Request('https://portal.test/x') as unknown as NextRequest;

  it('hace proxy desde SharePoint cuando hay sp_drive_item_id', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({
      id: 99, file_name: 'guia.pdf', mime: 'application/pdf', sp_drive_item_id: 'ITEM99', contenido: null, course: { active: true },
    });
    const res = await descargarMaterial(req, p);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('BYTES');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(String(graph.mock.calls.at(-1)?.[0])).toContain('/drive/items/ITEM99/content');
  });

  it('material antiguo (sin referencia) se sigue sirviendo desde la base', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({
      id: 99, file_name: 'viejo.pdf', mime: 'application/pdf', sp_drive_item_id: null, contenido: Buffer.from('OLD'), course: { active: true },
    });
    const res = await descargarMaterial(req, p);
    expect(await res.text()).toBe('OLD');
    expect(graph).not.toHaveBeenCalled();
  });

  it('sin sesión del portal: 401', async () => {
    identificar.mockResolvedValue(null);
    expect((await descargarMaterial(req, p)).status).toBe(401);
  });
});

describe('certificado', () => {
  it('al emitirse se sube a FORMACION/<curso>/certificados/<codigo>.pdf', async () => {
    db.portalCertificate.findUnique
      .mockResolvedValueOnce(null) // no existía
      .mockImplementation(async ({ where }: { where: { code: string } }) => ({
        code: where.code, course_id: 7, student_name: 'Ana', course_title: 'Inducción SST', issued_at: new Date(), sp_drive_item_id: null,
      }));
    db.portalCertificate.create.mockImplementation(async ({ data }: { data: { code: string } }) => ({ code: data.code, issued_at: new Date() }));
    db.portalCourse.findUnique.mockResolvedValue({ title: 'Inducción SST', sp_folder_name: 'induccion-sst-7' });

    const r = await emitirCertificadoSiCorresponde({
      courseId: 7, studentEmail: 'ana@gsslatam.com', studentName: 'Ana', courseTitle: 'Inducción SST', porcentaje: 100,
    });
    expect(r?.code).toMatch(/^GSS-/);

    const put = graph.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PUT');
    expect(String(put?.[0])).toContain(`/drive/root:/FORMACION/induccion-sst-7/certificados/${r!.code}.pdf:/content`);
    expect(db.portalCertificate.update).toHaveBeenCalledWith({
      where: { code: r!.code },
      data: expect.objectContaining({ sp_drive_item_id: `ID-${r!.code}.pdf` }),
    });
  });

  it('si SharePoint no está configurado, el certificado igual se emite', async () => {
    vi.stubEnv('PORTAL_TH_SP_SITE_ID', '');
    db.portalCertificate.findUnique.mockResolvedValueOnce(null).mockResolvedValue({
      code: 'GSS-X', course_id: 7, student_name: 'Ana', course_title: 'C', issued_at: new Date(), sp_drive_item_id: null,
    });
    db.portalCertificate.create.mockResolvedValue({ code: 'GSS-X', issued_at: new Date() });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await emitirCertificadoSiCorresponde({
      courseId: 7, studentEmail: 'ana@gsslatam.com', studentName: 'Ana', courseTitle: 'C', porcentaje: 100,
    });
    expect(r?.code).toBe('GSS-X');
    expect(db.portalCertificate.update).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

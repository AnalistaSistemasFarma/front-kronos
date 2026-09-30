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
  portalCourse: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  portalCourseMaterial: {
    aggregate: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(),
  },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  portalCertificate: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
const identificar = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({ prisma: db }));
vi.mock('../acceso', () => ({ identificar }));
vi.mock('../certificado-pdf', () => ({ generarCertificadoPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }));

import { POST as subirMaterial } from '../../../app/api/portal/courses/[id]/materials/route';
import {
  GET as descargarMaterial,
  PUT as reemplazarArchivo,
} from '../../../app/api/portal/courses/[id]/materials/[materialId]/file/route';
import {
  DELETE as quitarMaterial,
  PATCH as editarMaterial,
} from '../../../app/api/portal/courses/[id]/materials/[materialId]/route';
import { PATCH as editarCurso } from '../../../app/api/portal/courses/[id]/route';
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
    if (u.includes('/drive/items/') && !init?.method) {
      return new Response('BYTES', { headers: { 'content-type': 'application/pdf', 'content-length': '5' } });
    }
    if (init?.method === 'PATCH' && u.includes('/drive/items/')) {
      const id = u.split('/drive/items/')[1].split('?')[0];
      return Response.json({ id, name: JSON.parse(String(init.body)).name, webUrl: `https://sp/ELIMINADOS/${id}` });
    }
    if (init?.method === 'POST' && u.endsWith('/children')) return Response.json({ id: 'DIR' }, { status: 201 });
    if (!init?.method && u.includes('/drive/root:/')) return Response.json({ id: 'DIR' });
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

const pMat = { params: Promise.resolve({ id: '7', materialId: '99' }) };
function jsonReq(metodo: string, cuerpo: unknown) {
  return new Request('https://portal.test/x', {
    method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  }) as unknown as NextRequest;
}
const pasos = () => graph.mock.calls.map(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${String(u)}`);

describe('DELETE material → FORMACION/ELIMINADOS', () => {
  beforeEach(() => {
    db.portalCourse.findUnique.mockResolvedValue({ title: 'Inducción SST', sp_folder_name: 'induccion-sst-7' });
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, sp_drive_item_id: 'ITEM99', file_name: 'guia.pdf' });
  });

  it('mueve el archivo a ELIMINADOS/<curso>/materiales y marca eliminado_at/eliminado_por', async () => {
    const res = await quitarMaterial(new Request('https://portal.test/x', { method: 'DELETE' }) as unknown as NextRequest, pMat);
    expect(res.status).toBe(200);
    expect(pasos().some((p) => p.includes('/drive/root:/FORMACION/ELIMINADOS/induccion-sst-7/materiales'))).toBe(true);
    expect(pasos().some((p) => p.startsWith('PATCH') && p.includes('/drive/items/ITEM99?@microsoft.graph.conflictBehavior=rename'))).toBe(true);
    expect(db.portalCourseMaterial.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: expect.objectContaining({
        eliminado_at: expect.any(Date),
        eliminado_por: 'cristian.baldion@gsslatam.com',
        sp_drive_item_id: 'ITEM99',
        sp_web_url: 'https://sp/ELIMINADOS/ITEM99',
      }),
    });
  });

  it('si Graph no lo mueve, la eliminación falla con mensaje claro y la fila no cambia', async () => {
    graph.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('login.microsoftonline.com')) return Response.json({ access_token: 'tok', expires_in: 3600 });
      if (init?.method === 'PATCH') return new Response(null, { status: 423 });
      return Response.json({ id: 'DIR' });
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await quitarMaterial(new Request('https://portal.test/x', { method: 'DELETE' }) as unknown as NextRequest, pMat);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/ELIMINADOS/);
    expect(db.portalCourseMaterial.update).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('un enlace (sin archivo) se quita sin llamar a Graph', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, sp_drive_item_id: null, file_name: null });
    const res = await quitarMaterial(new Request('https://portal.test/x', { method: 'DELETE' }) as unknown as NextRequest, pMat);
    expect(res.status).toBe(200);
    expect(graph).not.toHaveBeenCalled();
  });
});

describe('edición de materiales', () => {
  beforeEach(() => {
    db.portalCourse.findUnique.mockResolvedValue({ title: 'Inducción SST', sp_folder_name: 'induccion-sst-7' });
  });

  it('PATCH título/obligatorio: solo formadores', async () => {
    identificar.mockResolvedValue({ correo: 'estudiante@gsslatam.com' });
    expect((await editarMaterial(jsonReq('PATCH', { titulo: 'X' }), pMat)).status).toBe(403);
  });

  it('PATCH documento → enlace mueve el archivo a ELIMINADOS y limpia la referencia', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, type: 'DOCUMENT', orden: 0, sp_drive_item_id: 'ITEM99', file_name: 'a.pdf' });
    db.portalCourseMaterial.update.mockResolvedValue({ id: 99 });
    const res = await editarMaterial(jsonReq('PATCH', { tipo: 'LINK', url: 'https://forms.office.com/x', obligatorio: false }), pMat);
    expect(res.status).toBe(200);
    expect(pasos().some((p) => p.startsWith('PATCH') && p.includes('/drive/items/ITEM99'))).toBe(true);
    expect(db.portalCourseMaterial.update.mock.calls[0][0].data).toMatchObject({
      type: 'LINK', url: 'https://forms.office.com/x', required: false, sp_drive_item_id: null, file_name: null,
    });
  });

  it('PATCH enlace → documento por JSON se rechaza (debe subir el archivo)', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, type: 'LINK', orden: 0, sp_drive_item_id: null, file_name: null });
    expect((await editarMaterial(jsonReq('PATCH', { tipo: 'DOCUMENT' }), pMat)).status).toBe(400);
  });

  it('PATCH mover arriba renumera el curso en una transacción', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, type: 'LINK', orden: 5, sp_drive_item_id: null, file_name: null });
    db.portalCourseMaterial.findMany.mockResolvedValue([{ id: 10 }, { id: 99 }, { id: 11 }]);
    db.portalCourseMaterial.update.mockImplementation(async (a: unknown) => a);
    const res = await editarMaterial(jsonReq('PATCH', { mover: 'arriba' }), pMat);
    expect(res.status).toBe(200);
    const ordenes = db.portalCourseMaterial.update.mock.calls.map(([a]) => [a.where.id, a.data.orden]);
    expect(ordenes).toEqual([[99, 0], [10, 1], [11, 2]]);
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('PUT reemplaza el archivo: sube el nuevo, mueve el anterior a ELIMINADOS y conserva el progreso', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, sp_drive_item_id: 'VIEJO', file_name: 'v1.pdf' });
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'v2.pdf', { type: 'application/pdf' }));
    const res = await reemplazarArchivo(new Request('https://portal.test/x', { method: 'PUT', body: form }) as unknown as NextRequest, pMat);
    expect(res.status).toBe(200);
    const p = pasos();
    const iSubida = p.findIndex((x) => x.startsWith('PUT') && x.includes('/FORMACION/induccion-sst-7/materiales/v2.pdf'));
    const iMover = p.findIndex((x) => x.startsWith('PATCH') && x.includes('/drive/items/VIEJO'));
    expect(iSubida).toBeGreaterThan(-1);
    expect(iMover).toBeGreaterThan(iSubida);
    expect(db.portalCourseMaterial.update.mock.calls[0][0].data).toMatchObject({ type: 'DOCUMENT', url: null, sp_drive_item_id: 'ID-v2.pdf' });
  });

  it('PUT: si el anterior no se mueve, retira el nuevo y no toca la fila', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, sp_drive_item_id: 'VIEJO', file_name: 'v1.pdf' });
    const base = graph.getMockImplementation()!;
    graph.mockImplementation(async (url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH' && String(url).includes('/drive/items/VIEJO') ? new Response(null, { status: 423 }) : base(url, init)
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'v2.pdf', { type: 'application/pdf' }));
    const res = await reemplazarArchivo(new Request('https://portal.test/x', { method: 'PUT', body: form }) as unknown as NextRequest, pMat);
    expect(res.status).toBe(502);
    expect(pasos().some((x) => x.startsWith('PATCH') && x.includes('/drive/items/ID-v2.pdf'))).toBe(true);
    expect(db.portalCourseMaterial.update).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('PATCH curso', () => {
  const pCurso = { params: Promise.resolve({ id: '7' }) };

  it('edita título y descripción (solo formadores)', async () => {
    db.portalCourse.findUnique.mockResolvedValue({ id: 7 });
    db.portalCourse.update.mockResolvedValue({ id: 7, title: 'Inducción 2026', active: false });
    const res = await editarCurso(jsonReq('PATCH', { titulo: 'Inducción 2026', descripcion: 'Nueva' }), pCurso);
    expect(res.status).toBe(200);
    expect(db.portalCourse.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { title: 'Inducción 2026', description: 'Nueva' } });
    identificar.mockResolvedValue({ correo: 'otro@gsslatam.com' });
    expect((await editarCurso(jsonReq('PATCH', { titulo: 'X' }), pCurso)).status).toBe(403);
  });

  it('pasar a borrador (despublicar) y curso inexistente', async () => {
    db.portalCourse.findUnique.mockResolvedValueOnce({ id: 7 });
    db.portalCourse.update.mockResolvedValue({ id: 7, title: 'C', active: false });
    expect((await editarCurso(jsonReq('PATCH', { activo: false }), pCurso)).status).toBe(200);
    db.portalCourse.findUnique.mockResolvedValueOnce(null);
    expect((await editarCurso(jsonReq('PATCH', { activo: false }), pCurso)).status).toBe(404);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * FORMACIÓN — SUBIDA DIRECTA a SharePoint, sin tope de peso (Graph simulado).
 *
 * Pedido de Cristian Baldión (2026-10-08): "quita ese límite de peso en los
 * archivos". Se protege:
 *   - la upload session solo la abre un FORMADOR, en FORMACION/<curso>/materiales,
 *     y la respuesta lleva SOLO la uploadUrl (nunca el token de la app);
 *   - no hay tope de tamaño por defecto; `PORTAL_TH_MAX_UPLOAD_MB` lo pone si se quiere;
 *   - los tipos permitidos siguen siendo los mismos;
 *   - registrar el material exige que el driveItem esté en la carpeta del curso.
 */

const db = vi.hoisted(() => ({
  portalCourse: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  portalCourseMaterial: {
    aggregate: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(),
  },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
}));
const identificar = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({ prisma: db }));
vi.mock('../acceso', () => ({ identificar }));
vi.mock('../certificado-pdf', () => ({ generarCertificadoPdf: vi.fn() }));

import { POST as abrirSesion } from '../../../app/api/portal/courses/[id]/materials/upload-session/route';
import { POST as agregarMaterial } from '../../../app/api/portal/courses/[id]/materials/route';
import { PUT as reemplazarArchivo } from '../../../app/api/portal/courses/[id]/materials/[materialId]/file/route';
import { maxMaterialBytes } from '../config';
import { _reiniciarCacheToken } from '../formacion-storage';

const ENV = {
  PORTAL_TH_SP_TENANT_ID: 'tenant',
  PORTAL_TH_SP_CLIENT_ID: 'cliente',
  PORTAL_TH_SP_CLIENT_SECRET: 'secreto-de-la-app',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,024c062f,12fcaddd',
};
const UPLOAD_URL = 'https://gsslatam.sharepoint.com/sites/TalentoHumano/_api/v2.0/drive/items/x/uploadSession?guid=abc';

/** Dónde "está" cada driveItem en el SharePoint simulado. */
const items: Record<string, { name: string; size: number; padre: string; carpeta?: boolean }> = {};

let graph: ReturnType<typeof vi.fn>;
function instalarGraph() {
  graph = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('login.microsoftonline.com')) return Response.json({ access_token: 'TOKEN-APP', expires_in: 3600 });
    if (init?.method === 'POST' && u.endsWith(':/createUploadSession')) {
      return Response.json({ uploadUrl: UPLOAD_URL, expirationDateTime: '2026-10-09T00:00:00Z' });
    }
    if (!init?.method && u.includes('/drive/items/')) {
      const id = decodeURIComponent(u.split('/drive/items/')[1].split('?')[0]);
      const it = items[id];
      if (!it) return new Response(null, { status: 404 });
      return Response.json({
        id,
        name: it.name,
        size: it.size,
        webUrl: `https://sp/${it.name}`,
        ...(it.carpeta ? { folder: {} } : { file: { mimeType: 'video/mp4' } }),
        parentReference: { path: `/drives/b!xyz/root:/${it.padre}` },
      });
    }
    if (init?.method === 'PATCH' && u.includes('/drive/items/')) {
      const id = u.split('/drive/items/')[1].split('?')[0];
      return Response.json({ id, name: JSON.parse(String(init.body)).name, webUrl: `https://sp/ELIMINADOS/${id}` });
    }
    if (init?.method === 'POST' && u.endsWith('/children')) return Response.json({ id: 'DIR' }, { status: 201 });
    if (!init?.method && u.includes('/drive/root:/')) return Response.json({ id: 'DIR' });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', graph);
}

const pCurso = { params: Promise.resolve({ id: '7' }) };
const pMat = { params: Promise.resolve({ id: '7', materialId: '99' }) };
function jsonReq(metodo: string, cuerpo: unknown) {
  return new Request('https://portal.test/x', {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  }) as unknown as NextRequest;
}
const GB = 1024 * 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  _reiniciarCacheToken();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubEnv('PORTAL_TH_SP_FOLDER', '');
  vi.stubEnv('PORTAL_TH_MAX_UPLOAD_MB', '');
  identificar.mockResolvedValue({ correo: 'cristian.baldion@gsslatam.com' });
  db.portalCourse.findUnique.mockResolvedValue({ id: 7, title: 'Inducción SST', sp_folder_name: 'induccion-sst-7' });
  db.portalCourseMaterial.aggregate.mockResolvedValue({ _max: { orden: 0 } });
  db.portalCourseMaterial.create.mockResolvedValue({ id: 99 });
  db.portalCourseMaterial.update.mockResolvedValue({ id: 99 });
  for (const k of Object.keys(items)) delete items[k];
  items['01VIDEO'] = { name: 'Productos que realiza Farmalógica.mp4', size: 3 * GB, padre: 'FORMACION/induccion-sst-7/materiales' };
  items['01AJENO'] = { name: 'nomina.xlsx', size: 100, padre: 'NOMINA/2026' };
  items['01OTROCURSO'] = { name: 'x.mp4', size: 100, padre: 'FORMACION/otro-curso-8/materiales' };
  items['01CARPETA'] = { name: 'materiales', size: 0, padre: 'FORMACION/induccion-sst-7', carpeta: true };
  instalarGraph();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('maxMaterialBytes (PORTAL_TH_MAX_UPLOAD_MB)', () => {
  it('vacío, 0 o no numérico = sin tope; un número = megas', () => {
    expect(maxMaterialBytes({} as NodeJS.ProcessEnv)).toBeNull();
    expect(maxMaterialBytes({ PORTAL_TH_MAX_UPLOAD_MB: '' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(maxMaterialBytes({ PORTAL_TH_MAX_UPLOAD_MB: '0' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(maxMaterialBytes({ PORTAL_TH_MAX_UPLOAD_MB: 'abc' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(maxMaterialBytes({ PORTAL_TH_MAX_UPLOAD_MB: '2048' } as unknown as NodeJS.ProcessEnv)).toBe(2 * GB);
  });
});

describe('POST /api/portal/courses/:id/materials/upload-session', () => {
  const declarado = { nombre: 'Productos que realiza Farmalógica.mp4', mime: 'video/mp4', tamano: 3 * GB };

  it('formador: abre la sesión en FORMACION/<curso>/materiales y devuelve SOLO la uploadUrl', async () => {
    const res = await abrirSesion(jsonReq('POST', declarado), pCurso);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const data = await res.json();
    expect(data).toEqual({ uploadUrl: UPLOAD_URL, expiracion: '2026-10-09T00:00:00Z', nombre: declarado.nombre });
    expect(JSON.stringify(data)).not.toMatch(/TOKEN-APP|secreto|Bearer/);

    const llamada = graph.mock.calls.find(([u]) => String(u).endsWith(':/createUploadSession'));
    expect(decodeURIComponent(String(llamada?.[0]))).toContain(
      '/drive/root:/FORMACION/induccion-sst-7/materiales/Productos que realiza Farmalógica.mp4:/createUploadSession'
    );
    expect(JSON.parse(String(llamada?.[1]?.body))).toEqual({ item: { '@microsoft.graph.conflictBehavior': 'rename' } });
  });

  it('sin tope por defecto: un video de 3 GB se acepta (antes: "El tope es 25 MB")', async () => {
    const res = await abrirSesion(jsonReq('POST', declarado), pCurso);
    expect(res.status).toBe(200);
  });

  it('con PORTAL_TH_MAX_UPLOAD_MB configurado, lo respeta', async () => {
    vi.stubEnv('PORTAL_TH_MAX_UPLOAD_MB', '1024');
    const res = await abrirSesion(jsonReq('POST', declarado), pCurso);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('El archivo es muy grande. El tope configurado es 1024 MB.');
    expect(graph).not.toHaveBeenCalled();
  });

  it('los tipos permitidos NO se amplían', async () => {
    const res = await abrirSesion(jsonReq('POST', { ...declarado, nombre: 'a.zip', mime: 'application/zip' }), pCurso);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Formato no admitido/);
    expect(graph).not.toHaveBeenCalled();
  });

  it('archivo vacío o tamaño inválido: 400', async () => {
    expect((await abrirSesion(jsonReq('POST', { ...declarado, tamano: 0 }), pCurso)).status).toBe(400);
    expect((await abrirSesion(jsonReq('POST', { ...declarado, tamano: -5 }), pCurso)).status).toBe(400);
    expect((await abrirSesion(jsonReq('POST', { ...declarado, tamano: '9' }), pCurso)).status).toBe(400);
  });

  it('sin sesión 401; quien no es formador 403; ninguno toca Graph', async () => {
    identificar.mockResolvedValueOnce(null);
    expect((await abrirSesion(jsonReq('POST', declarado), pCurso)).status).toBe(401);
    identificar.mockResolvedValueOnce({ correo: 'estudiante@gsslatam.com' });
    expect((await abrirSesion(jsonReq('POST', declarado), pCurso)).status).toBe(403);
    expect(graph).not.toHaveBeenCalled();
  });

  it('curso inexistente: 404', async () => {
    db.portalCourse.findUnique.mockResolvedValueOnce(null);
    expect((await abrirSesion(jsonReq('POST', declarado), pCurso)).status).toBe(404);
  });

  it('sin configuración de SharePoint: 503 claro', async () => {
    vi.stubEnv('PORTAL_TH_SP_CLIENT_SECRET', '');
    const res = await abrirSesion(jsonReq('POST', declarado), pCurso);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/SharePoint/);
  });

  it('si Graph no abre la sesión: 502 sin filtrar detalles', async () => {
    graph.mockImplementation(async (url: string | URL | Request) =>
      String(url).includes('login.microsoftonline.com')
        ? Response.json({ access_token: 'TOKEN-APP', expires_in: 3600 })
        : new Response('{"error":{"code":"accessDenied"}}', { status: 403 })
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await abrirSesion(jsonReq('POST', declarado), pCurso);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('No se pudo preparar la subida a SharePoint.');
    error.mockRestore();
  });
});

describe('POST /api/portal/courses/:id/materials (JSON, archivo ya subido)', () => {
  const cuerpo = { type: 'DOCUMENT', title: 'Productos que realiza Farmalógica', required: 'true', driveItemId: '01VIDEO', mime: 'video/mp4' };

  it('registra el material con la referencia del driveItem (3 GB)', async () => {
    const res = await agregarMaterial(jsonReq('POST', cuerpo), pCurso);
    expect(res.status).toBe(200);
    expect(db.portalCourseMaterial.create.mock.calls[0][0].data).toMatchObject({
      course_id: 7,
      type: 'DOCUMENT',
      title: 'Productos que realiza Farmalógica',
      required: true,
      sp_drive_item_id: '01VIDEO',
      mime: 'video/mp4',
      file_name: 'Productos que realiza Farmalógica.mp4',
      file_size: BigInt(3 * GB),
    });
  });

  it('un driveItem de OTRA carpeta del sitio (o de otro curso) se rechaza', async () => {
    for (const id of ['01AJENO', '01OTROCURSO']) {
      const res = await agregarMaterial(jsonReq('POST', { ...cuerpo, driveItemId: id }), pCurso);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/carpeta de este curso/);
    }
    expect(db.portalCourseMaterial.create).not.toHaveBeenCalled();
  });

  it('una carpeta (no archivo) o un id inexistente no se registran', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await agregarMaterial(jsonReq('POST', { ...cuerpo, driveItemId: '01CARPETA' }), pCurso)).status).toBe(500);
    expect((await agregarMaterial(jsonReq('POST', { ...cuerpo, driveItemId: '01NOEXISTE' }), pCurso)).status).toBe(500);
    expect(db.portalCourseMaterial.create).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('mime no permitido o sin driveItemId: 400', async () => {
    expect((await agregarMaterial(jsonReq('POST', { ...cuerpo, mime: 'application/zip' }), pCurso)).status).toBe(400);
    expect((await agregarMaterial(jsonReq('POST', { ...cuerpo, driveItemId: '' }), pCurso)).status).toBe(400);
    expect((await agregarMaterial(jsonReq('POST', { ...cuerpo, driveItemId: '../x' }), pCurso)).status).toBe(400);
  });

  it('solo formadores', async () => {
    identificar.mockResolvedValue({ correo: 'estudiante@gsslatam.com' });
    expect((await agregarMaterial(jsonReq('POST', cuerpo), pCurso)).status).toBe(403);
  });

  it('si el archivo pasa el tope configurado, se mueve a ELIMINADOS y no se registra', async () => {
    vi.stubEnv('PORTAL_TH_MAX_UPLOAD_MB', '100');
    const res = await agregarMaterial(jsonReq('POST', cuerpo), pCurso);
    expect(res.status).toBe(400);
    expect(graph.mock.calls.some(([u, i]) => (i as RequestInit | undefined)?.method === 'PATCH' && String(u).includes('/drive/items/01VIDEO'))).toBe(true);
    expect(db.portalCourseMaterial.create).not.toHaveBeenCalled();
  });

  it('un enlace por JSON sigue funcionando', async () => {
    const res = await agregarMaterial(jsonReq('POST', { type: 'LINK', title: 'Formulario', url: 'https://forms.office.com/x' }), pCurso);
    expect(res.status).toBe(200);
    expect(db.portalCourseMaterial.create.mock.calls[0][0].data).toMatchObject({ type: 'LINK', url: 'https://forms.office.com/x' });
  });
});

describe('PUT /api/portal/courses/:id/materials/:materialId/file (JSON)', () => {
  it('reemplaza: comprueba el nuevo, mueve el anterior a ELIMINADOS y actualiza la fila', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, sp_drive_item_id: 'VIEJO', file_name: 'v1.mp4' });
    const res = await reemplazarArchivo(jsonReq('PUT', { driveItemId: '01VIDEO', mime: 'video/mp4' }), pMat);
    expect(res.status).toBe(200);
    const pasos = graph.mock.calls.map(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${String(u)}`);
    const iLeer = pasos.findIndex((p) => p.startsWith('GET') && p.includes('/drive/items/01VIDEO'));
    const iMover = pasos.findIndex((p) => p.startsWith('PATCH') && p.includes('/drive/items/VIEJO'));
    expect(iLeer).toBeGreaterThan(-1);
    expect(iMover).toBeGreaterThan(iLeer);
    expect(db.portalCourseMaterial.update.mock.calls[0][0].data).toMatchObject({
      type: 'DOCUMENT',
      url: null,
      sp_drive_item_id: '01VIDEO',
      file_size: BigInt(3 * GB),
    });
  });

  it('un driveItem de otra carpeta se rechaza y no se mueve el anterior', async () => {
    db.portalCourseMaterial.findFirst.mockResolvedValue({ id: 99, sp_drive_item_id: 'VIEJO', file_name: 'v1.mp4' });
    const res = await reemplazarArchivo(jsonReq('PUT', { driveItemId: '01AJENO', mime: 'video/mp4' }), pMat);
    expect(res.status).toBe(400);
    expect(graph.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
    expect(db.portalCourseMaterial.update).not.toHaveBeenCalled();
  });
});

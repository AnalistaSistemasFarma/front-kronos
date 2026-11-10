import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 2026-11-06 (reunión con Juan Mora): CARPETAS en los Archivos del proyecto.
 *   - crear carpeta (dueño o editor; el lector no), con la ruta validada;
 *   - subir archivos a una carpeta (la carpeta y sus padres se crean solas);
 *   - mover un archivo de carpeta (dueño, o quien lo cargó);
 *   - quitar una carpeta solo si está vacía (dueño, o quien la creó).
 */
const sessionUser = vi.hoisted(() => vi.fn());
const resolveProject = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  folders: [] as { id_project_folder: number; path: string; created_by: string | null }[],
  files: [] as { id_project_file: number; folder_path: string | null; uploaded_by: string | null }[],
  createdFiles: [] as unknown[],
  updates: [] as unknown[],
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({
  prisma: {
    chatProject: { update: vi.fn(async () => ({})) },
    chatProjectFolder: {
      findMany: vi.fn(async (q: { where: { path?: { in: string[] } } }) => (q.where.path ? db.folders.filter((f) => q.where.path!.in.includes(f.path)) : db.folders)),
      findUnique: vi.fn(async (q: { where: { id_project_path: { path: string } } }) => db.folders.find((f) => f.path === q.where.id_project_path.path) ?? null),
      create: vi.fn(async (q: { data: { path: string; created_by: string | null } }) => {
        const row = { id_project_folder: db.folders.length + 1, path: q.data.path, created_by: q.data.created_by };
        db.folders.push(row);
        return row;
      }),
      deleteMany: vi.fn(async (q: { where: { id_project_folder: { in: number[] } } }) => {
        db.folders = db.folders.filter((f) => !q.where.id_project_folder.in.includes(f.id_project_folder));
        return { count: 1 };
      }),
    },
    chatProjectFile: {
      count: vi.fn(async () => db.files.length),
      findMany: vi.fn(async () => db.files.filter((f) => f.folder_path).map((f) => ({ folder_path: f.folder_path }))),
      findFirst: vi.fn(async (q: { where: { id_project_file: number } }) => db.files.find((f) => f.id_project_file === q.where.id_project_file) ?? null),
      createMany: vi.fn(async (q: { data: unknown[] }) => {
        db.createdFiles.push(...q.data);
        return { count: q.data.length };
      }),
      update: vi.fn(async (q: unknown) => {
        db.updates.push(q);
        return {};
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: sessionUser };
});
vi.mock('../projects', () => ({ resolveProjectForUser: resolveProject }));
vi.mock('../attachmentStorage', () => ({
  uploadProjectFiles: vi.fn(async (_id: number, files: { fileName: string }[]) => files.map((f, i) => ({ file_name: f.fileName, content_type: 'application/pdf', size_bytes: 3, onedrive_item_id: `od-${i}` }))),
  downloadChatAttachment: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { DELETE as quitarCarpeta, POST as crearCarpeta } from '../../../app/api/proyectos/[id]/carpetas/route';
import { POST as subirArchivos } from '../../../app/api/proyectos/[id]/archivos/route';
import { PATCH as moverArchivo } from '../../../app/api/proyectos/[id]/archivos/[fileId]/route';

const params = (id = '7') => ({ params: Promise.resolve({ id }) });
const proyecto = (role: 'owner' | 'editor' | 'reader', archived = false) => ({ idProject: 7, name: 'Regulatorio', idCompany: 3, profile: 'olp', role, archived });
const json = (url: string, method: string, body?: unknown) => new NextRequest(`http://x${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const multipart = (fields: Record<string, string>, names: string[]) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (const n of names) f.append('files', new File(['pdf'], n, { type: 'application/pdf' }));
  return new NextRequest('http://x/api/proyectos/7/archivos', { method: 'POST', body: f });
};

beforeEach(() => {
  vi.clearAllMocks();
  db.folders = [];
  db.files = [];
  db.createdFiles = [];
  db.updates = [];
  sessionUser.mockResolvedValue({ id: 'u-juan', email: 'juan.mora@gsslatam.com' });
});

describe('Carpetas de los Archivos del proyecto', () => {
  it('el editor crea una carpeta (con sus padres); repetida 409; ruta inválida 400; el lector no', async () => {
    resolveProject.mockResolvedValue(proyecto('editor'));
    expect((await crearCarpeta(json('/api/proyectos/7/carpetas', 'POST', { path: ' Regulatorio / INVIMA ' }), params())).status).toBe(201);
    expect(db.folders.map((f) => f.path)).toEqual(['Regulatorio', 'Regulatorio/INVIMA']);
    expect((await crearCarpeta(json('/api/proyectos/7/carpetas', 'POST', { path: 'Regulatorio/INVIMA' }), params())).status).toBe(409);
    expect((await crearCarpeta(json('/api/proyectos/7/carpetas', 'POST', { path: '../fuera' }), params())).status).toBe(400);
    expect((await crearCarpeta(json('/api/proyectos/7/carpetas', 'POST', { path: '  ' }), params())).status).toBe(400);
    resolveProject.mockResolvedValue(proyecto('reader'));
    expect((await crearCarpeta(json('/api/proyectos/7/carpetas', 'POST', { path: 'Otra' }), params())).status).toBe(403);
    resolveProject.mockResolvedValue(proyecto('owner', true));
    expect((await crearCarpeta(json('/api/proyectos/7/carpetas', 'POST', { path: 'Otra' }), params())).status).not.toBe(201);
  });

  it('los archivos se suben a la carpeta indicada y la carpeta se crea sola; carpeta inválida 400', async () => {
    resolveProject.mockResolvedValue(proyecto('editor'));
    const r = await subirArchivos(multipart({ folder: 'Regulatorio/Fichas técnicas' }, ['ficha-1.pdf', 'ficha-2.pdf']), params());
    expect(r.status).toBe(201);
    expect(db.createdFiles).toEqual([expect.objectContaining({ file_name: 'ficha-1.pdf', folder_path: 'Regulatorio/Fichas técnicas' }), expect.objectContaining({ file_name: 'ficha-2.pdf', folder_path: 'Regulatorio/Fichas técnicas' })]);
    expect(db.folders.map((f) => f.path)).toEqual(['Regulatorio', 'Regulatorio/Fichas técnicas']);
    expect((await subirArchivos(multipart({}, ['raiz.pdf']), params())).status).toBe(201);
    expect(db.createdFiles.at(-1)).toMatchObject({ folder_path: null });
    expect((await subirArchivos(multipart({ folder: 'A/../B' }, ['x.pdf']), params())).status).toBe(400);
  });

  it('mover un archivo: el que lo cargó o el dueño; a la raíz con carpeta vacía', async () => {
    db.files = [{ id_project_file: 9, folder_path: null, uploaded_by: 'u-juan' }, { id_project_file: 10, folder_path: null, uploaded_by: 'u-otro' }];
    resolveProject.mockResolvedValue(proyecto('editor'));
    const ctx = (fileId: string) => ({ params: Promise.resolve({ id: '7', fileId }) });
    expect((await moverArchivo(json('/api/proyectos/7/archivos/9', 'PATCH', { folder: 'Artes' }), ctx('9'))).status).toBe(200);
    expect(db.updates[0]).toMatchObject({ data: { folder_path: 'Artes' } });
    expect(db.folders.map((f) => f.path)).toEqual(['Artes']);
    expect((await moverArchivo(json('/api/proyectos/7/archivos/10', 'PATCH', { folder: 'Artes' }), ctx('10'))).status).toBe(403);
    expect((await moverArchivo(json('/api/proyectos/7/archivos/99', 'PATCH', { folder: 'Artes' }), ctx('99'))).status).toBe(404);
    expect((await moverArchivo(json('/api/proyectos/7/archivos/9', 'PATCH', { folder: 'A:B' }), ctx('9'))).status).toBe(400);
    resolveProject.mockResolvedValue(proyecto('owner'));
    expect((await moverArchivo(json('/api/proyectos/7/archivos/10', 'PATCH', { folder: '' }), ctx('10'))).status).toBe(200);
    expect(db.updates.at(-1)).toMatchObject({ data: { folder_path: null } });
  });

  it('quitar una carpeta: solo vacía, con sus subcarpetas; el dueño o quien la creó', async () => {
    db.folders = [
      { id_project_folder: 1, path: 'Regulatorio', created_by: 'u-juan' },
      { id_project_folder: 2, path: 'Regulatorio/INVIMA', created_by: 'u-juan' },
      { id_project_folder: 3, path: 'Regulatorio_viejo', created_by: 'u-juan' },
      { id_project_folder: 4, path: 'Ajena', created_by: 'u-otro' },
    ];
    db.files = [{ id_project_file: 1, folder_path: 'Regulatorio/INVIMA', uploaded_by: 'u-juan' }];
    resolveProject.mockResolvedValue(proyecto('editor'));
    const del = (p: string) => quitarCarpeta(json(`/api/proyectos/7/carpetas?path=${encodeURIComponent(p)}`, 'DELETE'), params());
    expect((await del('Regulatorio')).status).toBe(409);
    expect((await del('Ajena')).status).toBe(403);
    expect((await del('No existe')).status).toBe(404);
    db.files = [];
    expect((await del('Regulatorio')).status).toBe(200);
    // Se quitan la carpeta y su subcarpeta, pero no «Regulatorio_viejo» (no es subcarpeta).
    expect(db.folders.map((f) => f.path)).toEqual(['Regulatorio_viejo', 'Ajena']);
    resolveProject.mockResolvedValue(proyecto('owner'));
    expect((await del('Ajena')).status).toBe(200);
  });
});

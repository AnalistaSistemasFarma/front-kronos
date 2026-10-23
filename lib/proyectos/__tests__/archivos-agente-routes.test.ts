import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Archivos del agente en los Archivos del proyecto (2026-10-23) — las rejas de
 * POST /api/chat/agent/projects/files:
 *   - solo la llave del puente (scope projects); 401 sin llave, 404 con llave de canal;
 *   - la conversación debe ser de un proyecto activo donde ESTE agente está designado (si no, 404);
 *   - mismas extensiones bloqueadas que el chat y el tope de archivos por proyecto;
 *   - un nombre repetido se archiva con sufijo, nunca se pisa;
 *   - queda con el agente de la LLAVE y la conversación, sin persona.
 */
const h = vi.hoisted(() => ({
  db: {
    chatProjectFile: { findMany: vi.fn(), create: vi.fn() },
    chatProject: { update: vi.fn() },
    $transaction: vi.fn(),
  },
  agent: vi.fn(),
  conv: vi.fn(),
  subir: vi.fn(),
}));

vi.mock('../../prisma', () => ({ prisma: h.db }));
vi.mock('../../chat/agent-auth', () => ({ authenticateAgent: h.agent }));
vi.mock('../../chat/projects', () => ({ assertAgentProjectConversation: h.conv }));
vi.mock('../../chat/attachmentStorage', () => ({ uploadProjectFiles: h.subir }));

import { NextRequest } from 'next/server';
import { POST as archivar } from '../../../app/api/chat/agent/projects/files/route';

const { db } = h;

function peticion(archivos: { nombre: string; texto?: string }[], idConversation: string | null = '27') {
  const form = new FormData();
  if (idConversation !== null) form.append('idConversation', idConversation);
  for (const a of archivos) form.append('files', new Blob([a.texto ?? 'hola'], { type: 'application/pdf' }), a.nombre);
  return new NextRequest('http://x/api/chat/agent/projects/files', { method: 'POST', body: form, headers: { Authorization: 'Bearer llave' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.agent.mockResolvedValue({ idAgent: 3, code: 'horus', displayName: 'Orus', scope: 'projects' });
  h.conv.mockResolvedValue({ id: 27, idProject: 7, projectName: 'Comex' });
  db.chatProjectFile.findMany.mockResolvedValue([]);
  h.subir.mockImplementation(async (_id: number, files: { fileName: string; contentType: string | null; size: number }[]) =>
    files.map((f, i) => ({ file_name: f.fileName, content_type: f.contentType, size_bytes: f.size, onedrive_item_id: `od-${i}`, web_url: null }))
  );
  let n = 100;
  db.chatProjectFile.create.mockImplementation((args: { data: { file_name: string } }) => ({ id_project_file: ++n, file_name: args.data.file_name }));
  db.chatProject.update.mockReturnValue({ id_project: 7 });
  db.$transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe('POST /api/chat/agent/projects/files', () => {
  it('sin llave válida: 401 y no sube nada', async () => {
    h.agent.mockResolvedValue(null);
    expect((await archivar(peticion([{ nombre: 'a.pdf' }]))).status).toBe(401);
    expect(h.subir).not.toHaveBeenCalled();
  });

  it('llave de canal (no de proyectos): 404', async () => {
    h.agent.mockResolvedValue({ idAgent: 3, code: 'horus', displayName: 'Orus', scope: 'channel' });
    expect((await archivar(peticion([{ nombre: 'a.pdf' }]))).status).toBe(404);
    expect(h.conv).not.toHaveBeenCalled();
  });

  it('conversación que no es de un proyecto del agente: 404 y no sube nada', async () => {
    h.conv.mockResolvedValue(null);
    const res = await archivar(peticion([{ nombre: 'a.pdf' }]));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Conversación no encontrada.' });
    expect(h.subir).not.toHaveBeenCalled();
  });

  it('el agente sale de la LLAVE y el id de conversación llega como número', async () => {
    await archivar(peticion([{ nombre: 'a.pdf' }], '27'));
    expect(h.conv).toHaveBeenCalledWith(3, 27);
  });

  it('id de conversación inválido no llega como número', async () => {
    h.conv.mockResolvedValue(null);
    await archivar(peticion([{ nombre: 'a.pdf' }], '27; DROP'));
    expect(h.conv.mock.calls[0][1]).not.toBe(27);
  });

  it('sin multipart: 400', async () => {
    const req = new NextRequest('http://x/api/chat/agent/projects/files', {
      method: 'POST',
      body: JSON.stringify({ idConversation: 27 }),
      headers: { Authorization: 'Bearer llave', 'Content-Type': 'application/json' },
    });
    expect((await archivar(req)).status).toBe(400);
  });

  it('extensión bloqueada: 400 y no sube nada', async () => {
    expect((await archivar(peticion([{ nombre: 'script.ps1' }]))).status).toBe(400);
    expect(h.subir).not.toHaveBeenCalled();
  });

  it('sin archivos: 400', async () => {
    expect((await archivar(peticion([]))).status).toBe(400);
  });

  it('proyecto lleno: 409 con un mensaje claro', async () => {
    db.chatProjectFile.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ file_name: `f${i}.pdf` })));
    const res = await archivar(peticion([{ nombre: 'a.pdf' }]));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/máximo de 20 archivos/);
    expect(h.subir).not.toHaveBeenCalled();
  });

  it('archiva con el agente y la conversación, sin persona, y cambia la versión del proyecto', async () => {
    const res = await archivar(peticion([{ nombre: 'informe.pdf' }]));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      archived: [{ id: 101, fileName: 'informe.pdf', originalName: 'informe.pdf', renamed: false }],
      idProject: 7,
    });
    expect(h.subir.mock.calls[0][0]).toBe(7);
    const data = db.chatProjectFile.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id_project: 7, file_name: 'informe.pdf', uploaded_by: null, uploaded_by_agent: 3, id_conversation: 27, onedrive_item_id: 'od-0' });
    expect(db.chatProject.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id_project: 7 } }));
  });

  it('un nombre que ya existe NO se pisa: se archiva con sufijo (también dentro del lote)', async () => {
    db.chatProjectFile.findMany.mockResolvedValue([{ file_name: 'Informe.pdf' }]);
    const res = await archivar(peticion([{ nombre: 'informe.pdf' }, { nombre: 'informe.pdf' }]));
    const cuerpo = await res.json();
    expect(cuerpo.archived.map((a: { fileName: string }) => a.fileName)).toEqual(['informe (2).pdf', 'informe (3).pdf']);
    expect(cuerpo.archived.every((a: { renamed: boolean }) => a.renamed)).toBe(true);
    expect(h.subir.mock.calls[0][1].map((f: { fileName: string }) => f.fileName)).toEqual(['informe (2).pdf', 'informe (3).pdf']);
  });

  it('si OneDrive falla: 502 y nada queda en la base', async () => {
    h.subir.mockRejectedValue(new Error('graph caído'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await archivar(peticion([{ nombre: 'a.pdf' }]))).status).toBe(502);
    expect(db.$transaction).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

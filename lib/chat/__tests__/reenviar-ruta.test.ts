import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * /api/chat/attachments/<id>/reenviar (2026-10-24) — «Compartir → Reenviar por
 * el chat» del visor. Lo que se prueba es la REJA:
 *   - sin sesión: 401 sin mirar el adjunto;
 *   - ORIGEN: adjunto inexistente o de una conversación que no puede ver → 404
 *     (nadie reenvía lo que no puede ver);
 *   - DESTINO: la puerta del destino manda; un hilo directo con agente no es
 *     destino; un proyecto sin escritura → 403 con el motivo;
 *   - el archivo se COPIA (baja y sube) y se publica en el DESTINO;
 *   - GET: personas, grupos y proyectos con escritura, sin la conversación de origen.
 */
const r = vi.hoisted(() => ({
  sesion: vi.fn(),
  guard: vi.fn(),
  adjunto: vi.fn(),
  bajar: vi.fn(),
  subir: vi.fn(),
  publicar: vi.fn(),
  bandeja: vi.fn(),
  proyectos: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: { chatAttachment: { findUnique: r.adjunto } } }));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: r.sesion, guardConversation: r.guard };
});
vi.mock('../attachmentStorage', () => ({ downloadChatAttachment: r.bajar, uploadChatAttachments: r.subir }));
vi.mock('../publicar-mensaje', () => ({ publicarMensajeDePersona: r.publicar }));
vi.mock('../projects', () => ({ conversacionesDeProyectoEscribibles: r.proyectos }));
vi.mock('../conversations', () => ({ listUserConversations: r.bandeja, serializeMessage: (m: { id: number }) => ({ id: m.id }) }));

import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '../../../app/api/chat/attachments/[id]/reenviar/route';

const USER = { id: 'u1', email: 'nicolas@x.com' };
const params = (id = '4431') => ({ params: Promise.resolve({ id }) });
const post = (cuerpo: unknown, id = '4431') =>
  POST(
    new NextRequest(`http://x/api/chat/attachments/${id}/reenviar`, {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      headers: { 'Content-Type': 'application/json' },
    }),
    params(id)
  );
const get = (id = '4431') => GET(new NextRequest(`http://x/api/chat/attachments/${id}/reenviar`), params(id));

const FILA = {
  file_name: 'excel-prueba-visor.xlsx',
  content_type: 'application/octet-stream',
  size_bytes: 6149,
  onedrive_item_id: 'ITEM-1',
  message: { id_conversation: 1 },
};
const ORIGEN_OK = { user: USER, conversationId: 1, kind: 'direct', idAgent: 9 };
const negado = () => ({ response: NextResponse.json({ error: 'No encontrada.' }, { status: 404 }) });

beforeEach(() => {
  vi.clearAllMocks();
  r.sesion.mockResolvedValue(USER);
  r.adjunto.mockResolvedValue(FILA);
  r.bajar.mockResolvedValue({ stream: new Response(new Uint8Array([1, 2, 3])).body, contentLength: '3', status: 200, contentRange: null });
  r.subir.mockResolvedValue([{ file_name: FILA.file_name, content_type: 'x', size_bytes: 3, onedrive_item_id: 'ITEM-2', web_url: null }]);
  r.publicar.mockResolvedValue({ message: { id: 500 }, notifiedAgents: [] });
  r.bandeja.mockResolvedValue([]);
  r.proyectos.mockResolvedValue([]);
});

describe('POST reenviar — reja del ORIGEN', () => {
  it('sin sesión: 401 sin consultar el adjunto', async () => {
    r.sesion.mockResolvedValue(null);
    const res = await post({ idConversation: 77 });
    expect(res.status).toBe(401);
    expect(r.adjunto).not.toHaveBeenCalled();
  });

  it('adjunto inexistente o sin archivo: 404', async () => {
    r.adjunto.mockResolvedValueOnce(null);
    expect((await post({ idConversation: 77 })).status).toBe(404);
    r.adjunto.mockResolvedValueOnce({ ...FILA, onedrive_item_id: null });
    expect((await post({ idConversation: 77 })).status).toBe(404);
  });

  it('si no puede ver la conversación del adjunto: 404 y no se copia nada', async () => {
    r.guard.mockResolvedValueOnce(negado());
    const res = await post({ idConversation: 77 });
    expect(res.status).toBe(404);
    expect(r.guard).toHaveBeenCalledWith('1');
    expect(r.bajar).not.toHaveBeenCalled();
    expect(r.publicar).not.toHaveBeenCalled();
  });

  it('id con basura: 404 sin sesión ni base', async () => {
    expect((await post({ idConversation: 77 }, '12abc')).status).toBe(404);
    expect(r.adjunto).not.toHaveBeenCalled();
  });
});

describe('POST reenviar — reja del DESTINO', () => {
  it('destino que no puede ver: la respuesta de la puerta tal cual', async () => {
    r.guard.mockResolvedValueOnce(ORIGEN_OK).mockResolvedValueOnce(negado());
    const res = await post({ idConversation: 77 });
    expect(res.status).toBe(404);
    expect(r.guard).toHaveBeenLastCalledWith('77');
    expect(r.bajar).not.toHaveBeenCalled();
  });

  it('hilo directo con un agente: no es destino', async () => {
    r.guard.mockResolvedValueOnce(ORIGEN_OK).mockResolvedValueOnce({ user: USER, conversationId: 77, kind: 'direct', idAgent: 3 });
    expect((await post({ idConversation: 77 })).status).toBe(400);
    expect(r.bajar).not.toHaveBeenCalled();
  });

  it('proyecto donde es lector: 403 con el motivo', async () => {
    r.guard.mockResolvedValueOnce(ORIGEN_OK).mockResolvedValueOnce({
      user: USER,
      conversationId: 77,
      kind: 'project',
      idAgent: 3,
      idProject: 5,
      projectRole: 'reader',
      projectWritable: { ok: false, motivo: 'Usted es lector en este proyecto.' },
    });
    const res = await post({ idConversation: 77 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('lector');
    expect(r.bajar).not.toHaveBeenCalled();
  });

  it('sin destino o el mismo de origen: 400', async () => {
    r.guard.mockResolvedValue(ORIGEN_OK);
    expect((await post({})).status).toBe(400);
    expect((await post({ idConversation: 1 })).status).toBe(400);
  });
});

describe('POST reenviar — copia y publica', () => {
  it('copia el archivo a la carpeta del destino y publica con la puerta del destino', async () => {
    const destino = { user: USER, conversationId: 77, kind: 'people', otherUserId: 'u2', myParticipantId: 4 };
    r.guard.mockResolvedValueOnce(ORIGEN_OK).mockResolvedValueOnce(destino);
    const res = await post({ idConversation: 77, body: '  Mire este  ' });
    expect(res.status).toBe(201);
    expect(r.bajar).toHaveBeenCalledWith('ITEM-1');
    const [idConv, archivos] = r.subir.mock.calls[0];
    expect(idConv).toBe(77);
    expect(archivos[0]).toMatchObject({ fileName: 'excel-prueba-visor.xlsx', size: 3 });
    const [guardUsado, datos] = r.publicar.mock.calls[0];
    expect(guardUsado).toBe(destino);
    expect(datos.body).toBe('Mire este');
    expect(datos.uploaded[0].onedrive_item_id).toBe('ITEM-2');
    expect((await res.json()).message).toEqual({ id: 500 });
  });

  it('si OneDrive falla: 502 y no se publica nada', async () => {
    r.guard.mockResolvedValueOnce(ORIGEN_OK).mockResolvedValueOnce({ user: USER, conversationId: 77, kind: 'group', groupRole: 'member', groupAgents: [] });
    r.bajar.mockResolvedValueOnce(null);
    const res = await post({ idConversation: 77 });
    expect(res.status).toBe(502);
    expect(r.publicar).not.toHaveBeenCalled();
  });
});

describe('GET reenviar — destinos', () => {
  it('personas, grupos y proyectos con escritura, sin el origen ni los hilos con agente', async () => {
    r.guard.mockResolvedValueOnce({ ...ORIGEN_OK, conversationId: 2, kind: 'group' });
    r.adjunto.mockResolvedValueOnce({ ...FILA, message: { id_conversation: 2 } });
    r.bandeja.mockResolvedValueOnce([
      { id: 1, kind: 'direct', title: null, lastMessageAt: null, participants: null, company: null },
      { id: 2, kind: 'group', title: 'Origen', lastMessageAt: null, participants: [], company: null },
      {
        id: 3,
        kind: 'people',
        title: null,
        lastMessageAt: '2026-10-24T10:00:00Z',
        participants: [
          { kind: 'user', id: 'u1', name: 'Yo' },
          { kind: 'user', id: 'u2', name: 'Laura Pérez' },
        ],
        company: null,
      },
      { id: 4, kind: 'group', title: 'Cierre', lastMessageAt: '2026-10-24T12:00:00Z', participants: [], company: { idCompany: 8, companyName: 'GSS' } },
    ]);
    r.proyectos.mockResolvedValueOnce([{ idConversation: 9, titulo: null, proyecto: 'SGC OLP', agente: 'Orus', lastMessageAt: null }]);

    const res = await get();
    expect(res.status).toBe(200);
    const { destinos } = await res.json();
    expect(destinos).toEqual([
      { idConversation: 4, tipo: 'grupo', titulo: 'Cierre', detalle: 'GSS', lastMessageAt: '2026-10-24T12:00:00Z' },
      { idConversation: 3, tipo: 'persona', titulo: 'Laura Pérez', detalle: null, lastMessageAt: '2026-10-24T10:00:00Z' },
      { idConversation: 9, tipo: 'proyecto', titulo: 'SGC OLP', detalle: 'Conversación · Orus', lastMessageAt: null },
    ]);
  });

  it('si no puede ver el adjunto, tampoco ve la lista: 404', async () => {
    r.guard.mockResolvedValueOnce(negado());
    expect((await get()).status).toBe(404);
    expect(r.bandeja).not.toHaveBeenCalled();
  });
});

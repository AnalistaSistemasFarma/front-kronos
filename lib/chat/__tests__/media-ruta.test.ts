import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * POST /api/chat/conversations/[id]/media (2026-10-20): el navegador manda solo
 * ids; el servidor decide qué se guarda. El mensaje queda con texto descriptivo
 * para los agentes y la fila de media va en la MISMA transacción.
 */
const r = vi.hoisted(() => ({
  guard: vi.fn(),
  acceso: vi.fn(),
  stickerFindFirst: vi.fn(),
  mensajeCreate: vi.fn(),
  mediaCreate: vi.fn(),
  conversacionUpdate: vi.fn(),
  mensajeFindUnique: vi.fn(),
  notificar: vi.fn(),
  obtenerGif: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => {
  const tx = {
    chatMessage: { create: r.mensajeCreate },
    chatMessageMedia: { create: r.mediaCreate },
    chatConversation: { update: r.conversacionUpdate },
  };
  return {
    prisma: {
      chatSticker: { findFirst: r.stickerFindFirst },
      chatMessage: { findUnique: r.mensajeFindUnique },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  };
});
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, guardConversation: r.guard };
});
vi.mock('../media-access', () => ({ accesoAMedia: r.acceso }));
vi.mock('../notifyPeople', () => ({ notifyPeopleMessage: r.notificar }));
vi.mock('../gif', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gif')>();
  return { ...real, obtenerGifParaEnviar: r.obtenerGif };
});

import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/chat/conversations/[id]/media/route';

const pedir = (body: unknown) =>
  POST(
    new NextRequest('http://x/api/chat/conversations/7/media', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.8' },
    }),
    { params: Promise.resolve({ id: '7' }) }
  );

const guardPersonas = { user: { id: 'yo', email: 'yo@x' }, conversationId: 7, kind: 'people', otherUserId: 'otra', myParticipantId: 1 };

function filaMensaje(body: string) {
  return {
    id: 501,
    role: 'user',
    body,
    created_at: new Date('2026-10-20T16:00:00Z'),
    delivered_at: null,
    read_at: null,
    attachments: [],
    userAuthor: { id: 'yo', name: 'Yo', email: 'yo@x', image: null },
    agentAuthor: null,
    replyTo: null,
  };
}

beforeEach(() => {
  for (const f of Object.values(r)) f.mockReset();
  process.env.NEXTAUTH_SECRET = 'secreto-de-pruebas-123456';
  delete process.env.CHAT_GIPHY_API_KEY;
  r.mensajeCreate.mockImplementation(async ({ data }: { data: { body: string } }) => filaMensaje(data.body));
  r.mediaCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }));
});

describe('stickers', () => {
  it('sticker propio: texto descriptivo en el cuerpo, fila de media y aviso a la otra persona', async () => {
    r.guard.mockResolvedValue(guardPersonas);
    const res = await pedir({ kind: 'sticker', code: 'pulgar-arriba' });
    expect(res.status).toBe(201);
    const data = r.mensajeCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ body: '[Sticker: ¡De acuerdo!]', role: 'user', id_user_author: 'yo', id_conversation: 7 });
    expect(r.mediaCreate.mock.calls[0][0].data).toMatchObject({ id_message: 501, kind: 'sticker', provider: 'gss', external_id: 'pulgar-arriba' });
    expect(r.conversacionUpdate).toHaveBeenCalled();
    expect(r.notificar).toHaveBeenCalledWith(expect.objectContaining({ idDestino: 'otra', body: '[Sticker: ¡De acuerdo!]' }));
    const json = await res.json();
    expect(json.message.media).toMatchObject({ kind: 'sticker', src: '/chat/stickers/pulgar-arriba.svg' });
    expect(json.notifiedAgents).toEqual([]);
  });

  it('sticker ANIMADO (Noto): mismo contrato «[Sticker: …]», provider gss y WebP con cuadro fijo', async () => {
    r.guard.mockResolvedValue(guardPersonas);
    const res = await pedir({ kind: 'sticker', code: 'noto-aplausos' });
    expect(res.status).toBe(201);
    expect(r.mensajeCreate.mock.calls[0][0].data).toMatchObject({ body: '[Sticker: ¡Aplausos!]' });
    expect(r.mediaCreate.mock.calls[0][0].data).toMatchObject({ kind: 'sticker', provider: 'gss', external_id: 'noto-aplausos' });
    const json = await res.json();
    expect(json.message.media).toMatchObject({
      kind: 'sticker',
      animated: true,
      src: '/chat/stickers/noto/aplausos.webp',
      poster: '/chat/stickers/noto/aplausos.poster.webp',
    });
  });

  it('un código que no está en el catálogo: 400 y nada escrito', async () => {
    r.guard.mockResolvedValue(guardPersonas);
    expect((await pedir({ kind: 'sticker', code: '../../etc/passwd' })).status).toBe(400);
    expect((await pedir({ kind: 'sticker', code: 'noto-../../x' })).status).toBe(400);
    expect(r.mensajeCreate).not.toHaveBeenCalled();
  });

  it('sticker de empresa: solo si está activo y es de una empresa de quien envía (o de todas)', async () => {
    r.guard.mockResolvedValue(guardPersonas);
    r.acceso.mockResolvedValue({ ok: true, empresas: [3] });
    r.stickerFindFirst.mockResolvedValue(null);
    expect((await pedir({ kind: 'sticker', idSticker: 12 })).status).toBe(400);
    expect(r.stickerFindFirst.mock.calls[0][0].where).toEqual({
      id_sticker: 12,
      active: true,
      OR: [{ id_company: null }, { id_company: { in: [3] } }],
    });
    r.stickerFindFirst.mockResolvedValue({ id_sticker: 12, label: 'Logo OLP' });
    const res = await pedir({ kind: 'sticker', idSticker: 12 });
    expect(res.status).toBe(201);
    expect((await res.json()).message.media).toMatchObject({ provider: 'empresa', src: '/api/chat/stickers/12' });
  });

  it('un lector de proyecto no envía (403)', async () => {
    r.guard.mockResolvedValue({ ...guardPersonas, kind: 'project', projectWritable: { ok: false, motivo: 'Solo lectura.' } });
    expect((await pedir({ kind: 'sticker', code: 'listo' })).status).toBe(403);
  });

  it('la cita debe ser de la MISMA conversación', async () => {
    r.guard.mockResolvedValue(guardPersonas);
    r.mensajeFindUnique.mockResolvedValue({ id_conversation: 99 });
    expect((await pedir({ kind: 'sticker', code: 'listo', replyTo: 5 })).status).toBe(400);
  });

  it('sin la tabla nueva: 503 claro', async () => {
    r.guard.mockResolvedValue(guardPersonas);
    r.mediaCreate.mockRejectedValue(Object.assign(new Error('x'), { code: 'P2021' }));
    expect((await pedir({ kind: 'sticker', code: 'listo' })).status).toBe(503);
  });
});

describe('GIF', () => {
  it('sin llave de GIPHY la función está apagada (404) y no se consulta nada', async () => {
    r.guard.mockResolvedValue(guardPersonas);
    expect((await pedir({ kind: 'gif', id: 'abc123' })).status).toBe(404);
    expect(r.obtenerGif).not.toHaveBeenCalled();
  });

  it('con llave: el servidor vuelve a pedir el GIF; si no es apto, 400', async () => {
    process.env.CHAT_GIPHY_API_KEY = 'llave';
    r.guard.mockResolvedValue(guardPersonas);
    r.obtenerGif.mockResolvedValue(null);
    expect((await pedir({ kind: 'gif', id: 'abc123' })).status).toBe(400);
    r.obtenerGif.mockResolvedValue({ id: 'abc123', title: 'gato feliz', rating: 'g', url: 'https://media.giphy.com/media/abc123/200w.webp', width: 200, height: 120 });
    const res = await pedir({ kind: 'gif', id: 'abc123' });
    expect(res.status).toBe(201);
    expect(r.mensajeCreate.mock.calls[0][0].data.body).toBe('[GIF: gato feliz]');
    const json = await res.json();
    expect(json.message.media.src).toMatch(/^\/api\/chat\/gifs\/proxy\?/);
    expect(JSON.stringify(json)).not.toContain('giphy.com');
  });

  it('si GIPHY no responde: 502 y nada escrito', async () => {
    process.env.CHAT_GIPHY_API_KEY = 'llave';
    r.guard.mockResolvedValue(guardPersonas);
    r.obtenerGif.mockRejectedValue(new Error('timeout'));
    expect((await pedir({ kind: 'gif', id: 'abc123' })).status).toBe(502);
    expect(r.mensajeCreate).not.toHaveBeenCalled();
  });
});

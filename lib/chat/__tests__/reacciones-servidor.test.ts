import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Reacciones, GIF y stickers (2026-10-20) — lado servidor con la base simulada:
 *   - el chat sigue funcionando si las tablas nuevas aún no existen;
 *   - el sondeo recibe el resumen completo de los mensajes tocados;
 *   - poner/quitar deja una fila nueva (el id crece) y respeta el tope;
 *   - la ruta exige ser parte de la conversación, emoji del catálogo y que el
 *     mensaje sea de ESA conversación; un lector de proyecto no reacciona.
 */
const r = vi.hoisted(() => ({
  reaccionFindMany: vi.fn(),
  reaccionFindFirst: vi.fn(),
  reaccionFindUnique: vi.fn(),
  reaccionCount: vi.fn(),
  reaccionDelete: vi.fn(),
  reaccionCreate: vi.fn(),
  mediaFindMany: vi.fn(),
  mensajeFindUnique: vi.fn(),
  guard: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => {
  const chatMessageReaction = {
    findMany: r.reaccionFindMany,
    findFirst: r.reaccionFindFirst,
    findUnique: r.reaccionFindUnique,
    count: r.reaccionCount,
    delete: r.reaccionDelete,
    create: r.reaccionCreate,
  };
  return {
    prisma: {
      chatMessageReaction,
      chatMessageMedia: { findMany: r.mediaFindMany },
      chatMessage: { findUnique: r.mensajeFindUnique },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ chatMessageReaction })),
    },
  };
});
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, guardConversation: r.guard };
});

import { NextRequest } from 'next/server';
import { cambiosDeReacciones, conExtras, cursorReacciones, serializarMedia, tablaAusente } from '../message-extras';
import { cambiarReaccion, ReaccionError } from '../reactions';
import { POST as reaccionar } from '../../../app/api/chat/conversations/[id]/messages/[messageId]/reactions/route';
import type { ChatMessagePayload } from '../conversations';

const P2021 = Object.assign(new Error('The table `dbo.chat_message_reaction` does not exist'), { code: 'P2021' });

const msg = (id: number): ChatMessagePayload => ({
  id,
  role: 'user',
  body: 'hola',
  createdAt: new Date().toISOString(),
  deliveredAt: null,
  readAt: null,
  attachments: [],
  author: null,
  replyTo: null,
  eventType: null,
});

beforeEach(() => {
  for (const f of Object.values(r)) f.mockReset();
  process.env.NEXTAUTH_SECRET = 'secreto-de-pruebas-123456';
});

describe('lectura tolerante (message-extras)', () => {
  it('reconoce la tabla ausente por Prisma (P2021) y por SQL Server (208)', () => {
    expect(tablaAusente(P2021)).toBe(true);
    expect(tablaAusente({ number: 208 })).toBe(true);
    expect(tablaAusente(new Error('otra cosa'))).toBe(false);
  });

  it('sin las tablas nuevas, los mensajes salen como siempre', async () => {
    r.reaccionFindMany.mockRejectedValue(P2021);
    r.mediaFindMany.mockRejectedValue(P2021);
    const entrada = [msg(1), msg(2)];
    expect(await conExtras(entrada, 'yo')).toEqual(entrada);
    r.reaccionFindFirst.mockRejectedValue(P2021);
    expect(await cursorReacciones(5)).toBeNull();
    expect(await cambiosDeReacciones(5, 10, 'yo')).toBeNull();
  });

  it('otros errores de la base NO se esconden', async () => {
    r.reaccionFindMany.mockRejectedValue(new Error('timeout'));
    r.mediaFindMany.mockResolvedValue([]);
    await expect(conExtras([msg(1)], 'yo')).rejects.toThrow('timeout');
  });

  it('pega reacciones y GIF/sticker solo a los mensajes que los tienen', async () => {
    r.reaccionFindMany.mockResolvedValue([
      { id: 1, id_message: 1, id_user: 'yo', emoji: '👍', user: { name: 'Yo', email: 'yo@x' } },
    ]);
    r.mediaFindMany.mockResolvedValue([
      { id_message: 2, kind: 'sticker', provider: 'gss', external_id: 'listo', id_sticker: null, title: '¡Listo!', media_url: null, width: 160, height: 160 },
    ]);
    const [a, b] = await conExtras([msg(1), msg(2)], 'yo');
    expect(a.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, users: [{ id: 'yo', name: 'Yo' }] }]);
    expect(a.media).toBeUndefined();
    expect(b.media).toMatchObject({ kind: 'sticker', src: '/chat/stickers/listo.svg' });
    expect(b.reactions).toBeUndefined();
    // Solo activas.
    expect(r.reaccionFindMany.mock.calls[0][0].where).toMatchObject({ active: true });
  });

  it('un GIF viaja por el proxy firmado; nunca con la URL del proveedor', () => {
    const m = serializarMedia({
      id_message: 9,
      kind: 'gif',
      provider: 'giphy',
      external_id: 'abc',
      id_sticker: null,
      title: 'Hola',
      media_url: 'https://media.giphy.com/media/abc/200w.webp',
      width: 200,
      height: 100,
    });
    expect(m?.src).toMatch(/^\/api\/chat\/gifs\/proxy\?u=.+&s=.+$/);
    expect(JSON.stringify(m)).not.toContain('giphy.com');
    // Una URL guardada que no es de GIPHY no se sirve.
    expect(serializarMedia({ id_message: 9, kind: 'gif', provider: 'giphy', external_id: 'abc', id_sticker: null, title: 'x', media_url: 'https://evil.com/x', width: null, height: null })).toBeNull();
  });

  it('el sondeo: con cursor 0 solo devuelve el cursor; después, el resumen COMPLETO de cada mensaje tocado', async () => {
    r.reaccionFindFirst.mockResolvedValue({ id: 40 });
    expect(await cambiosDeReacciones(7, 0, 'yo')).toEqual({ cursor: 40, cambios: {} });
    expect(r.reaccionFindMany).not.toHaveBeenCalled();
    expect(await cambiosDeReacciones(7, 40, 'yo')).toEqual({ cursor: 40, cambios: {} });

    r.reaccionFindMany
      .mockResolvedValueOnce([{ id_message: 3 }, { id_message: 4 }, { id_message: 3 }])
      .mockResolvedValueOnce([{ id: 39, id_message: 3, id_user: 'b', emoji: '😂', user: { name: 'Beto', email: 'b@x' } }]);
    const r2 = await cambiosDeReacciones(7, 35, 'yo');
    expect(r2?.cursor).toBe(40);
    // El 4 se quedó sin reacciones (se quitó la última): viaja vacío para borrar el chip.
    expect(r2?.cambios).toEqual({ 3: [{ emoji: '😂', count: 1, mine: false, users: [{ id: 'b', name: 'Beto' }] }], 4: [] });
    expect(r.reaccionFindMany.mock.calls[0][0].where).toEqual({ id_conversation: 7, id: { gt: 35, lte: 40 } });
  });
});

describe('poner y quitar (reactions.ts)', () => {
  const base = { idConversation: 7, idMessage: 3, idUser: 'yo', emoji: '👍' } as const;

  it('poner: crea la fila activa (sin borrar nada si no había)', async () => {
    r.reaccionFindUnique.mockResolvedValue(null);
    r.reaccionCount.mockResolvedValue(0);
    r.reaccionFindMany.mockResolvedValue([]);
    await cambiarReaccion({ ...base, accion: 'toggle' });
    expect(r.reaccionDelete).not.toHaveBeenCalled();
    expect(r.reaccionCreate).toHaveBeenCalledWith({
      data: { id_message: 3, id_conversation: 7, id_user: 'yo', emoji: '👍', active: true },
    });
  });

  it('quitar: borra la fila y deja una LÁPIDA nueva (el id crece para el sondeo)', async () => {
    r.reaccionFindUnique.mockResolvedValue({ id: 11, active: true });
    r.reaccionFindMany.mockResolvedValue([]);
    await cambiarReaccion({ ...base, accion: 'toggle' });
    expect(r.reaccionDelete).toHaveBeenCalledWith({ where: { id: 11 } });
    expect(r.reaccionCreate.mock.calls[0][0].data.active).toBe(false);
  });

  it('idempotente: «add» sobre una activa o «remove» sin fila no escriben', async () => {
    r.reaccionFindMany.mockResolvedValue([]);
    r.reaccionFindUnique.mockResolvedValue({ id: 11, active: true });
    await cambiarReaccion({ ...base, accion: 'add' });
    r.reaccionFindUnique.mockResolvedValue(null);
    await cambiarReaccion({ ...base, accion: 'remove' });
    expect(r.reaccionCreate).not.toHaveBeenCalled();
    expect(r.reaccionDelete).not.toHaveBeenCalled();
  });

  it('tope de reacciones distintas por persona', async () => {
    r.reaccionFindUnique.mockResolvedValue(null);
    r.reaccionCount.mockResolvedValue(10);
    await expect(cambiarReaccion({ ...base, accion: 'add' })).rejects.toBeInstanceOf(ReaccionError);
    expect(r.reaccionCreate).not.toHaveBeenCalled();
  });

  it('una carrera entre dos pestañas (P2002) devuelve el estado vigente, no un error', async () => {
    r.reaccionFindUnique.mockResolvedValue(null);
    r.reaccionCount.mockResolvedValue(0);
    r.reaccionCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    r.reaccionFindMany.mockResolvedValue([{ id: 1, id_message: 3, id_user: 'yo', emoji: '👍', user: { name: 'Yo', email: 'y' } }]);
    const vigentes = await cambiarReaccion({ ...base, accion: 'add' });
    expect(vigentes[0]).toMatchObject({ emoji: '👍', mine: true });
  });
});

describe('ruta POST …/messages/[messageId]/reactions', () => {
  const pedir = (body: unknown, id = '7', messageId = '3') =>
    reaccionar(
      new NextRequest(`http://x/api/chat/conversations/${id}/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id, messageId }) }
    );
  const guardOk = { user: { id: 'yo', email: 'yo@x' }, conversationId: 7, kind: 'people', otherUserId: 'b', myParticipantId: 1 };

  it('quien no es parte de la conversación recibe lo mismo que el guardia (404)', async () => {
    const { NextResponse } = await import('next/server');
    r.guard.mockResolvedValue({ response: NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 }) });
    expect((await pedir({ emoji: '👍' })).status).toBe(404);
    expect(r.mensajeFindUnique).not.toHaveBeenCalled();
  });

  it('emoji fuera del catálogo o acción inválida: 400', async () => {
    r.guard.mockResolvedValue(guardOk);
    expect((await pedir({ emoji: '<b>hola</b>' })).status).toBe(400);
    expect((await pedir({ emoji: '👍', action: 'borrar-todo' })).status).toBe(400);
  });

  it('un mensaje de OTRA conversación da 404 (anti-IDOR)', async () => {
    r.guard.mockResolvedValue(guardOk);
    r.mensajeFindUnique.mockResolvedValue({ id_conversation: 99, role: 'user' });
    expect((await pedir({ emoji: '👍' })).status).toBe(404);
    expect(r.reaccionCreate).not.toHaveBeenCalled();
  });

  it('no se reacciona a un aviso del sistema', async () => {
    r.guard.mockResolvedValue(guardOk);
    r.mensajeFindUnique.mockResolvedValue({ id_conversation: 7, role: 'system' });
    expect((await pedir({ emoji: '👍' })).status).toBe(400);
  });

  it('un LECTOR de proyecto no reacciona (403)', async () => {
    r.guard.mockResolvedValue({ ...guardOk, kind: 'project', projectWritable: { ok: false, motivo: 'Solo lectura.' } });
    expect((await pedir({ emoji: '👍' })).status).toBe(403);
  });

  it('camino feliz: guarda con el usuario de la SESIÓN y devuelve el resumen', async () => {
    r.guard.mockResolvedValue(guardOk);
    r.mensajeFindUnique.mockResolvedValue({ id_conversation: 7, role: 'agent' });
    r.reaccionFindUnique.mockResolvedValue(null);
    r.reaccionCount.mockResolvedValue(0);
    r.reaccionFindMany.mockResolvedValue([{ id: 1, id_message: 3, id_user: 'yo', emoji: '👍', user: { name: 'Yo', email: 'y' } }]);
    const res = await pedir({ emoji: '👍', idUser: 'otro-usuario' });
    expect(res.status).toBe(200);
    expect(r.reaccionCreate.mock.calls[0][0].data.id_user).toBe('yo');
    expect((await res.json()).reactions[0]).toMatchObject({ emoji: '👍', count: 1, mine: true });
  });

  it('sin las tablas: 503 con un mensaje claro', async () => {
    r.guard.mockResolvedValue(guardOk);
    r.mensajeFindUnique.mockResolvedValue({ id_conversation: 7, role: 'user' });
    r.reaccionFindUnique.mockRejectedValue(P2021);
    expect((await pedir({ emoji: '👍' })).status).toBe(503);
  });
});

import { describe, expect, it, vi } from 'vitest';

/*
 * Enviar un mensaje en una conversación de PROYECTO: leer basta con ser
 * miembro, pero escribir exige rol y el agente vigente. Un lector (o una
 * conversación con un agente retirado) recibe 403 y no se escribe nada.
 */
const guard = vi.hoisted(() => vi.fn());
const createMessage = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: { chatMessage: { create: createMessage, findUnique: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, guardConversation: guard };
});

import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/chat/conversations/[id]/messages/route';

describe('POST /api/chat/conversations/[id]/messages en un proyecto', () => {
  it('lector: 403 con el motivo, sin escribir', async () => {
    guard.mockResolvedValue({
      user: { id: 'u', email: 'u@x.com' },
      conversationId: 40,
      kind: 'project',
      idAgent: 21,
      idProject: 7,
      projectRole: 'reader',
      projectWritable: { ok: false, motivo: 'Usted es lector en este proyecto.' },
    });
    const r = await POST(
      new NextRequest('http://x/api/chat/conversations/40/messages', {
        method: 'POST',
        body: JSON.stringify({ body: 'hola' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '40' }) }
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/lector/);
    expect(createMessage).not.toHaveBeenCalled();
  });
});

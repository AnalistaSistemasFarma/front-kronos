import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Agent-initiated messages (2026-11-24): context handed to the agent when the person replies, the
 * badge rules and the push endpoint (secret, once-only claim, reuse of notifyAgentReply).
 */
const notify = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  initiatedFindMany: vi.fn(),
  initiatedUpdateMany: vi.fn(),
  initiatedFindUnique: vi.fn(),
  messageFindFirst: vi.fn(),
  messageFindMany: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../notifyAgentReply', () => ({ notifyAgentReply: notify }));
vi.mock('../../prisma', () => ({
  prisma: {
    chatAgentInitiatedMessage: {
      findMany: db.initiatedFindMany,
      updateMany: db.initiatedUpdateMany,
      findUnique: db.initiatedFindUnique,
    },
    chatMessage: { findFirst: db.messageFindFirst, findMany: db.messageFindMany },
  },
}));

import { NextRequest } from 'next/server';
import {
  agentInitiatedIds,
  mcpNotifySecret,
  verifyMcpNotifySecret,
  withInitiatedContext,
} from '../agent-initiated';
import { AGENT_INITIATED_BADGE, buildInitiatedContextPrefix, CONTEXT_ITEM_MAX_CHARS } from '../agent-initiated-rules';
import { POST } from '../../../app/api/chat/agent/initiated-notify/route';

const SECRET = 's'.repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CHAT_MCP_NOTIFY_SECRET;
});

describe('rules', () => {
  it('badge text', () => {
    expect(AGENT_INITIATED_BADGE).toBe('Mensaje iniciado por el asistente');
  });

  it('prefix quotes each message with time and reason, and is empty without items', () => {
    expect(buildInitiatedContextPrefix([])).toBe('');
    const p = buildInitiatedContextPrefix([
      { body: 'Hola Mauricio,\nya tiene SAP.', createdAt: new Date('2026-11-24T20:40:00Z'), reason: 'Avisar  acceso SAP' },
    ]);
    expect(p).toMatch(/^\[Contexto de SynerLink: antes de este mensaje, usted \(el asistente\) le escribió/);
    expect(p).toMatch(/Mensaje suyo del 24\/11\/2026,? 15:40 \(motivo registrado: Avisar acceso SAP\):/);
    expect(p).toContain('> Hola Mauricio,\n> ya tiene SAP.');
    expect(p.endsWith('[Respuesta de la persona:]\n')).toBe(true);
  });

  it('long messages are cut', () => {
    const p = buildInitiatedContextPrefix([{ body: 'x'.repeat(5000), createdAt: new Date(), reason: null }]);
    expect(p.length).toBeLessThan(CONTEXT_ITEM_MAX_CHARS + 400);
    expect(p).toContain('…');
  });
});

describe('withInitiatedContext (inbox)', () => {
  const pending = [
    { id: 120, id_conversation: 9, body: 'Gracias, ya entré', conversation: { kind: 'direct' } },
    { id: 121, id_conversation: 9, body: 'otra cosa', conversation: { kind: 'direct' } },
    { id: 122, id_conversation: 10, body: 'hola', conversation: { kind: 'direct' } },
    { id: 123, id_conversation: 11, body: '@paco', conversation: { kind: 'group' } },
  ];

  it('prepends the agent-initiated messages since the previous person message, only to the first pending one', async () => {
    db.initiatedFindMany.mockResolvedValue([
      { id_message: 100, id_conversation: 9, reason: 'viejo' },
      { id_message: 115, id_conversation: 9, reason: 'Avisar acceso SAP' },
    ]);
    // Person messages of conversation 9: 110 (delivered), 120 and 121 (pending).
    db.messageFindFirst.mockImplementation(async ({ where }: { where: { id: { lt: number } } }) => {
      const prev = [110, 120, 121].filter((id) => id < where.id.lt).pop();
      return prev ? { id: prev } : null;
    });
    db.messageFindMany.mockResolvedValue([{ id: 115, body: 'Ya tiene SAP.', created_at: new Date('2026-11-24T20:40:00Z') }]);
    const out = await withInitiatedContext(pending);
    expect(out[0].body).toMatch(/^\[Contexto de SynerLink/);
    expect(out[0].body).toMatch(/> Ya tiene SAP\.\n\[Respuesta de la persona:\]\nGracias, ya entré$/);
    expect(out[0].body).not.toContain('viejo');
    expect(out[1].body).toBe('otra cosa');
    expect(out[2].body).toBe('hola');
    expect(out[3].body).toBe('@paco');
    // Only direct conversations are looked up.
    expect(db.initiatedFindMany.mock.calls[0][0].where.id_conversation).toEqual({ in: [9, 10] });
    expect(db.messageFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [115] } } }));
  });

  it('an older undelivered backlog does not swallow the context: it goes with the first reply after it', async () => {
    const backlog = [
      { id: 50, id_conversation: 9, body: 'viejo sin entregar', conversation: { kind: 'direct' } },
      { id: 120, id_conversation: 9, body: 'Gracias, ya entré', conversation: { kind: 'direct' } },
    ];
    db.initiatedFindMany.mockResolvedValue([{ id_message: 115, id_conversation: 9, reason: 'Avisar acceso SAP' }]);
    db.messageFindFirst.mockResolvedValue({ id: 50 });
    db.messageFindMany.mockResolvedValue([{ id: 115, body: 'Ya tiene SAP.', created_at: new Date('2026-11-24T20:40:00Z') }]);
    const out = await withInitiatedContext(backlog);
    expect(out[0].body).toBe('viejo sin entregar');
    expect(out[1].body).toMatch(/^\[Contexto de SynerLink[\s\S]*Gracias, ya entré$/);
  });

  it('usual case: no agent-initiated messages → one query, bodies unchanged', async () => {
    db.initiatedFindMany.mockResolvedValue([]);
    const out = await withInitiatedContext(pending);
    expect(out.map((m) => m.body)).toEqual(pending.map((m) => m.body));
    expect(db.messageFindFirst).not.toHaveBeenCalled();
  });

  it('already answered (person wrote after it) → no context', async () => {
    db.initiatedFindMany.mockResolvedValue([{ id_message: 105, id_conversation: 9, reason: 'x' }]);
    db.messageFindFirst.mockResolvedValue({ id: 110 });
    const out = await withInitiatedContext(pending);
    expect(out[0].body).toBe('Gracias, ya entré');
  });

  it('missing table or any error → messages unchanged (never breaks the delivery)', async () => {
    db.initiatedFindMany.mockRejectedValue(Object.assign(new Error("Invalid object name 'dbo.chat_agent_initiated_message'"), { number: 208 }));
    expect((await withInitiatedContext(pending)).map((m) => m.body)).toEqual(pending.map((m) => m.body));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.initiatedFindMany.mockRejectedValue(new Error('boom'));
    expect((await withInitiatedContext(pending)).map((m) => m.body)).toEqual(pending.map((m) => m.body));
    err.mockRestore();
  });

  it('badge ids tolerate a missing table', async () => {
    db.initiatedFindMany.mockResolvedValue([{ id_message: 5 }]);
    expect([...(await agentInitiatedIds([5, 6]))]).toEqual([5]);
    db.initiatedFindMany.mockRejectedValue({ code: 'P2021' });
    expect((await agentInitiatedIds([5])).size).toBe(0);
    expect((await agentInitiatedIds([])).size).toBe(0);
  });
});

describe('secret', () => {
  it('needs 32+ characters and compares exactly', () => {
    expect(mcpNotifySecret({ CHAT_MCP_NOTIFY_SECRET: 'short' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(mcpNotifySecret({ CHAT_MCP_NOTIFY_SECRET: ` ${SECRET} ` } as unknown as NodeJS.ProcessEnv)).toBe(SECRET);
    expect(verifyMcpNotifySecret(SECRET, SECRET)).toBe(true);
    expect(verifyMcpNotifySecret(`${SECRET}x`, SECRET)).toBe(false);
    expect(verifyMcpNotifySecret(null, SECRET)).toBe(false);
    expect(verifyMcpNotifySecret(SECRET, null)).toBe(false);
  });
});

describe('POST /api/chat/agent/initiated-notify', () => {
  const call = (body: unknown, secret: string | null = SECRET) =>
    POST(
      new NextRequest('http://x/api/chat/agent/initiated-notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(secret ? { 'x-chat-mcp-secret': secret } : {}) },
        body: JSON.stringify(body),
      })
    );

  const validRow = {
    id_agent: 23,
    message: {
      role: 'agent',
      body: 'Ya tiene SAP.',
      id_agent_author: 23,
      conversation: { id: 900, kind: 'direct', id_user: 'u-mauricio', id_agent: 23 },
      agentAuthor: { code: 'vega', display_name: 'Paco', avatar_url: '/agents/paco.png' },
    },
  };

  it('without a configured secret the endpoint does not exist', async () => {
    expect((await call({ idMessage: 1 })).status).toBe(404);
    expect(notify).not.toHaveBeenCalled();
  });

  it('wrong or missing secret → 401, nothing claimed', async () => {
    process.env.CHAT_MCP_NOTIFY_SECRET = SECRET;
    expect((await call({ idMessage: 1 }, 'x'.repeat(40))).status).toBe(401);
    expect((await call({ idMessage: 1 }, null)).status).toBe(401);
    expect(db.initiatedUpdateMany).not.toHaveBeenCalled();
  });

  it('claims once and pushes through notifyAgentReply with data from the database', async () => {
    process.env.CHAT_MCP_NOTIFY_SECRET = SECRET;
    db.initiatedUpdateMany.mockResolvedValue({ count: 1 });
    db.initiatedFindUnique.mockResolvedValue(validRow);
    const r = await call({ idMessage: 7001 });
    expect(r.status).toBe(200);
    const where = db.initiatedUpdateMany.mock.calls[0][0].where;
    expect(where.id_message).toBe(7001);
    expect(where.push_sent_at).toBeNull();
    expect(where.created_at.gte).toBeInstanceOf(Date);
    expect(notify).toHaveBeenCalledWith({
      idConversation: 900,
      idUser: 'u-mauricio',
      agentCode: 'vega',
      agentName: 'Paco',
      agentAvatarUrl: '/agents/paco.png',
      body: 'Ya tiene SAP.',
      attachmentCount: 0,
    });
  });

  it('second call (already pushed, expired or unknown) → 409 without push', async () => {
    process.env.CHAT_MCP_NOTIFY_SECRET = SECRET;
    db.initiatedUpdateMany.mockResolvedValue({ count: 0 });
    expect((await call({ idMessage: 7001 })).status).toBe(409);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a row that does not match a direct agent message → 409 without push', async () => {
    process.env.CHAT_MCP_NOTIFY_SECRET = SECRET;
    db.initiatedUpdateMany.mockResolvedValue({ count: 1 });
    db.initiatedFindUnique.mockResolvedValue({ ...validRow, message: { ...validRow.message, conversation: { ...validRow.message.conversation, kind: 'group' } } });
    expect((await call({ idMessage: 7001 })).status).toBe(409);
    expect(notify).not.toHaveBeenCalled();
  });

  it('bad id → 400', async () => {
    process.env.CHAT_MCP_NOTIFY_SECRET = SECRET;
    expect((await call({ idMessage: 'x' })).status).toBe(400);
    expect((await call({ idMessage: -1 })).status).toBe(400);
  });
});

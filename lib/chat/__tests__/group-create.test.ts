import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Crear un grupo (POST /api/chat/groups).
 *
 * Desde el 2026-10-06 (decisión de Nicolás) cualquiera con el chat crea
 * grupos, pero SOLO con los agentes que tiene asignados en esa empresa. Estas
 * pruebas fijan que no haya reja de administrador y que un agente ajeno
 * metido en el cuerpo de la petición no pase.
 */
const sessionUser = vi.hoisted(() => vi.fn());
const chatAccess = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const adminCheck = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../access-control', () => ({ checkAdminPrivileges: adminCheck }));
vi.mock('../../prisma', () => ({
  prisma: { $transaction: transaction, user: { findMany: vi.fn() } },
}));
vi.mock('../access', () => ({ CHAT_MODULE_URL: '/process/chat', getChatAccess: chatAccess }));
vi.mock('../conversations', () => ({
  getConversationPayload: vi.fn(async (id: number) => ({ id })),
}));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: sessionUser };
});

import { POST } from '../../../app/api/chat/groups/route';

function peticion(body: unknown) {
  return new Request('http://x/api/chat/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Usuario SIN privilegios de administrador.
  adminCheck.mockResolvedValue(false);
  sessionUser.mockResolvedValue({ id: 'u-ana', email: 'ana@gsslatam.com' });
  chatAccess.mockResolvedValue({
    canUseChat: true,
    companies: [{ idCompany: 8, companyName: 'GSS', isPrimary: false }],
    agents: [
      { idAgent: 20, companies: [{ idCompany: 8, companyName: 'GSS', isPrimary: true }] },
      { idAgent: 21, companies: [{ idCompany: 3, companyName: 'Otra', isPrimary: true }] },
    ],
  });
  transaction.mockResolvedValue({ id: 55 });
});

describe('POST /api/chat/groups', () => {
  it('un usuario que no es administrador crea un grupo con su propio agente', async () => {
    const res = await POST(peticion({ title: 'Equipo', idCompany: 8, idAgents: [20] }));
    expect(res.status).toBe(201);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('rechaza un agente que el creador no tiene asignado', async () => {
    const res = await POST(peticion({ title: 'Equipo', idCompany: 8, idAgents: [20, 99] }));
    expect(res.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rechaza un agente propio pero asignado en OTRA empresa', async () => {
    const res = await POST(peticion({ title: 'Equipo', idCompany: 8, idAgents: [21] }));
    expect(res.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('sin el chat en la empresa del grupo no crea nada', async () => {
    const res = await POST(peticion({ title: 'Equipo', idCompany: 3, idAgents: [21] }));
    expect(res.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });
});

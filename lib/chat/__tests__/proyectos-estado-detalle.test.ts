import { describe, expect, it, vi } from 'vitest';

/*
 * Detalle de un proyecto (2026-10-20): cada conversación trae el estado de SU
 * agente (el mismo indicador del chat), para pintar «Orus está trabajando…» en
 * la lista sin esperar al pulso. La fila de otro agente no cuenta.
 */
const m = vi.hoisted(() => ({ findUnique: vi.fn(), userFindMany: vi.fn() }));
vi.mock('../../prisma', () => ({
  prisma: { chatProject: { findUnique: m.findUnique }, user: { findMany: m.userFindMany } },
}));
vi.mock('../access', () => ({ getChatAccess: vi.fn() }));

import { getProjectDetail } from '../projects';

const agente = { id_agent: 7, code: 'horus', display_name: 'Orus', handle: 'horus_gss_bot', avatar_url: null, avatar_updated_at: null };

describe('getProjectDetail · estado del agente por conversación', () => {
  it('trae el estado del agente dueño y null si nunca reportó', async () => {
    m.userFindMany.mockResolvedValue([]);
    m.findUnique.mockResolvedValue({
      id_project: 4,
      name: 'Farmalógica — Orus (piloto)',
      description: null,
      profile: 'farmalogica',
      instructions: null,
      archived: false,
      created_at: new Date('2026-10-18T10:00:00Z'),
      updated_at: new Date('2026-10-20T16:00:00Z'),
      company: { id_company: 3, company: 'FARMALOGICA ' },
      agents: [{ agent: { ...agente, is_active: true } }],
      members: [{ id_user: 'u-nr', role: 'owner', added_at: new Date(), user: { name: 'Nicolás Rivera', email: 'n@x', image: null } }],
      files: [],
      _count: { tasks: 0, subagents: 0 },
      conversations: [
        {
          id: 28,
          title: 'Conversación inicial',
          created_at: new Date('2026-10-18T10:00:00Z'),
          last_message_at: new Date('2026-10-18T10:05:00Z'),
          id_agent: 7,
          created_by: 'u-nr',
          agent: agente,
          statuses: [
            { id_agent: 9, state: 'tool', label: 'De otro agente', tasks: null, updated_at: new Date('2026-10-20T16:00:01Z') },
            {
              id_agent: 7,
              state: 'tool',
              label: 'Consultando SAP…',
              tasks: JSON.stringify([{ desc: 'Analista de cartera', startedAt: '2026-10-20T15:59:00.000Z' }]),
              updated_at: new Date('2026-10-20T16:00:05Z'),
            },
          ],
        },
        { id: 29, title: null, created_at: new Date(), last_message_at: null, id_agent: 7, created_by: null, agent: agente, statuses: [] },
      ],
    });

    const d = await getProjectDetail(
      { id: 'u-nr', email: 'n@x' },
      { idProject: 4, name: 'Farmalógica — Orus (piloto)', idCompany: 3, profile: 'farmalogica', role: 'reader', archived: false }
    );
    expect(d?.conversations[0].agentStatus).toEqual({
      idConversation: 28,
      idProject: 4,
      projectName: 'Farmalógica — Orus (piloto)',
      conversationTitle: 'Conversación inicial',
      agent: { idAgent: 7, code: 'horus', displayName: 'Orus', avatarUrl: null, avatarVersion: null },
      state: 'tool',
      label: 'Consultando SAP…',
      tasks: [{ desc: 'Analista de cartera', startedAt: '2026-10-20T15:59:00.000Z' }],
      updatedAt: '2026-10-20T16:00:05.000Z',
    });
    expect(d?.conversations[1].agentStatus).toBeNull();
    // La consulta pide el estado junto con la conversación (una sola ida a la base).
    expect(m.findUnique.mock.calls[0][0].select.conversations.select.statuses).toBeTruthy();
  });
});

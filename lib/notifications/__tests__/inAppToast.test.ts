import { describe, expect, it } from 'vitest';
import {
  MAX_VISIBLE_TOASTS,
  addToStack,
  bellSummaryToast,
  newBellNotifications,
  removeFromStack,
  samePage,
  toastFromBellNotification,
  toastFromInboxConversation,
  toastFromNudge,
  toastFromProjectEvent,
  toastTimeLabel,
  type InAppToast,
  type InboxConversationInput,
} from '../inAppToast';

const NOW = Date.parse('2026-11-24T15:00:00.000Z');

function card(key: string): InAppToast {
  return { ...toastFromNudge({ idConversation: 1, authorName: key, createdAt: '' }), key };
}

describe('stack of cards', () => {
  it('puts the newest on top and keeps at most 3', () => {
    let stack: InAppToast[] = [];
    for (const k of ['a', 'b', 'c', 'd']) stack = addToStack(stack, card(k));
    expect(stack.map((t) => t.key)).toEqual(['d', 'c', 'b']);
    expect(stack).toHaveLength(MAX_VISIBLE_TOASTS);
  });

  it('replaces the card of the same conversation instead of stacking a second one', () => {
    let stack = addToStack(addToStack([], card('chat-1')), card('chat-2'));
    stack = addToStack(stack, { ...card('chat-1'), title: 'nuevo' });
    expect(stack.map((t) => t.key)).toEqual(['chat-1', 'chat-2']);
    expect(stack[0].title).toBe('nuevo');
  });

  it('removes by key', () => {
    const stack = addToStack(addToStack([], card('x')), card('y'));
    expect(removeFromStack(stack, 'x').map((t) => t.key)).toEqual(['y']);
  });
});

describe('time label', () => {
  it('uses the bell wording', () => {
    expect(toastTimeLabel(new Date(NOW - 20_000).toISOString(), NOW)).toBe('Ahora');
    expect(toastTimeLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('Hace 5 min');
    expect(toastTimeLabel(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('Hace 3 h');
    expect(toastTimeLabel('nope', NOW)).toBe('');
  });
});

const agent = { idAgent: 7, code: 'orus', displayName: 'Orus', avatarUrl: '/agents/orus.png' };
const avatar = (a: InboxConversationInput['agent']) => `avatar:${a.code}`;
const last = { id: 99, role: 'agent', preview: 'Listo,   ya quedó el reporte\n de ventas', createdAt: '2026-11-24T14:59:00.000Z' };

describe('inbox conversation → card', () => {
  it('direct thread with an agent: agent name, avatar, conversation title, quick reply', () => {
    const t = toastFromInboxConversation(
      { id: 12, kind: 'direct', title: 'Ventas noviembre', agent, lastMessage: last, unreadCount: 1 },
      'u1',
      avatar
    )!;
    expect(t).toMatchObject({
      key: 'chat-12',
      title: 'Orus',
      label: 'Asistente',
      context: 'Ventas noviembre',
      preview: 'Listo, ya quedó el reporte de ventas',
      url: '/process/chat/orus',
      reply: { kind: 'chat', conversationId: 12, placeholder: 'Responder…' },
      tone: 'default',
    });
    expect(t.avatar).toEqual({ src: 'avatar:orus', name: 'Orus', colorKey: 'orus' });
  });

  it('a thread without kind (before groups) is direct', () => {
    expect(toastFromInboxConversation({ id: 3, title: null, agent, lastMessage: last, unreadCount: 2 }, 'u1', avatar))
      .toMatchObject({ title: 'Orus', context: 'Conversación (2 nuevos)' });
  });

  it('group: group title, company badge, host agent', () => {
    const t = toastFromInboxConversation(
      {
        id: 20,
        kind: 'group',
        title: 'Cierre contable',
        agent,
        company: { companyName: 'Farmalogica S.A.' },
        lastMessage: last,
        unreadCount: 1,
      },
      'u1',
      avatar
    )!;
    expect(t).toMatchObject({ title: 'Cierre contable', company: 'Farmalogica S.A.', label: 'Grupo', url: '/process/chat/grupo/20' });
  });

  it('people thread: the OTHER person, never me', () => {
    const t = toastFromInboxConversation(
      {
        id: 31,
        kind: 'people',
        title: null,
        agent,
        participants: [
          { kind: 'user', id: 'u1', name: 'Yo', avatarUrl: null },
          { kind: 'user', id: 'u2', name: 'Laura Gómez', avatarUrl: 'https://x/laura.png' },
        ],
        lastMessage: { ...last, role: 'user', preview: 'Hola' },
        unreadCount: 1,
      },
      'u1',
      avatar
    )!;
    expect(t).toMatchObject({ title: 'Laura Gómez', label: 'Mensaje', url: '/process/chat/persona/31', reply: { kind: 'chat', conversationId: 31, placeholder: 'Responder…' } });
    expect(t.avatar?.src).toBe('https://x/laura.png');
  });

  it('no last message → no card; empty preview → «Envió un archivo»', () => {
    expect(toastFromInboxConversation({ id: 1, title: null, agent, lastMessage: null, unreadCount: 1 }, 'u1', avatar)).toBeNull();
    expect(
      toastFromInboxConversation({ id: 1, title: null, agent, lastMessage: { ...last, preview: '  ' }, unreadCount: 1 }, 'u1', avatar)
        ?.preview
    ).toBe('Envió un archivo');
  });
});

describe('project pulse event → card', () => {
  const base = {
    idConversation: 40,
    idMessage: 500,
    authorName: 'Kepler',
    createdAt: '2026-11-24T14:59:00.000Z',
    muted: false,
    preview: 'PR #1100 listo para revisión',
    projectName: 'Infraestructura SynerLink',
    companyName: 'GSS',
    authorAvatarUrl: '/api/chat/agents/kepler/avatar?v=1',
    authorAgentCode: 'kepler',
    url: '/process/proyectos/19?conversacion=40',
  };

  it('shows author, project, company and links to the conversation', () => {
    expect(toastFromProjectEvent(base)).toMatchObject({
      key: 'chat-40',
      title: 'Kepler',
      label: 'Proyecto',
      context: 'Infraestructura SynerLink',
      company: 'GSS',
      url: '/process/proyectos/19?conversacion=40',
      reply: { kind: 'chat', conversationId: 40, placeholder: 'Responder en el proyecto…' },
    });
  });

  it('muted project (#1095) → no card', () => {
    expect(toastFromProjectEvent({ ...base, muted: true })).toBeNull();
  });

  it('older server without the extra fields still gives a usable card', () => {
    const t = toastFromProjectEvent({ idConversation: 1, idMessage: 2, authorName: 'Ana', createdAt: '', muted: false })!;
    expect(t).toMatchObject({ title: 'Ana', context: 'Proyecto', preview: null, url: '/process/proyectos' });
  });
});

describe('bell notification → card', () => {
  const n = (title: string, url: string | null, id = 1) => ({ id, title, body: 'Detalle #10', url, created_at: '2026-11-24T14:00:00.000Z' });

  it('signatures and validations are urgent', () => {
    expect(toastFromBellNotification(n('Le toca firmar: Contrato.docx', '/process/request-general/view-request?id=10')))
      .toMatchObject({ tone: 'urgent', label: 'Firma', icon: 'signature' });
    expect(toastFromBellNotification(n('Documento para validar: Contrato.docx', '/process/request-general/draft-board?requestId=10')))
      .toMatchObject({ tone: 'urgent', label: 'Validación', icon: 'validation' });
  });

  it('monitor alerts are urgent', () => {
    expect(toastFromBellNotification(n('Alerta: CPU alta · SynerLink', '/process/system-metrics#alertas')))
      .toMatchObject({ tone: 'urgent', label: 'Alerta', icon: 'alert', url: '/process/system-metrics#alertas', reply: null });
  });

  it('tickets and activities are normal', () => {
    expect(toastFromBellNotification(n('Nuevo ticket asignado', '/process/help-desk/view-ticket?id=5')))
      .toMatchObject({
        tone: 'default',
        label: 'Mesa de ayuda',
        icon: 'ticket',
        reply: { kind: 'notification', notificationId: 1, placeholder: 'Agregar una nota al ticket #5…' },
      });
    expect(toastFromBellNotification(n('Actividad asignada', null)).tone).toBe('default');
  });

  it('first poll only sets the baseline; later polls return the new ones, newest first', () => {
    const first = newBellNotifications(null, [n('a', null, 5), n('b', null, 3)]);
    expect(first).toEqual({ fresh: [], lastSeenId: 5 });
    const second = newBellNotifications(first.lastSeenId, [n('c', null, 7), n('d', null, 6), n('a', null, 5)]);
    expect(second.fresh.map((x) => x.id)).toEqual([7, 6]);
    expect(second.lastSeenId).toBe(7);
    // Everything read: the baseline does not go back.
    expect(newBellNotifications(7, [])).toEqual({ fresh: [], lastSeenId: 7 });
  });

  it('summary card for a burst', () => {
    expect(bellSummaryToast(5, '2026-11-24T14:00:00.000Z', true)).toMatchObject({
      key: 'bell-summary',
      title: 'Tiene 5 notificaciones nuevas',
      tone: 'urgent',
      url: null,
    });
  });
});

describe('samePage', () => {
  it('compares path and query, ignoring origin and trailing slash', () => {
    expect(samePage('/process/chat/orus', 'https://synerlink.test/process/chat/orus/')).toBe(true);
    expect(samePage('/process/proyectos/19?conversacion=40', '/process/proyectos/19?conversacion=41')).toBe(false);
    expect(samePage(null, '/x')).toBe(false);
  });
});

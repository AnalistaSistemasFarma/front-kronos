import { describe, expect, it } from 'vitest';
import {
  MAX_PINS,
  buildRailItems,
  buildRailSections,
  bumpConversationActivity,
  chatCreateHref,
  chatCreateOptions,
  compareByActivity,
  formatUnread,
  isChatCreateKind,
  isChatRailKey,
  railItemHref,
  railOpenDetail,
  sortConversationsByActivity,
  togglePin,
  totalUnread,
  type ChatRailItem,
} from '../rail';

function item(parcial: Partial<ChatRailItem> & Pick<ChatRailItem, 'key' | 'name'>): ChatRailItem {
  return {
    kind: 'agent',
    avatarCode: parcial.name.toLowerCase(),
    avatarUrl: null,
    preview: null,
    lastMessageAt: null,
    unread: 0,
    sortOrder: 0,
    ...parcial,
  };
}

const orus = item({ key: 'agent:1', name: 'Orus', sortOrder: 1, lastMessageAt: '2026-09-30T10:00:00Z' });
const mark = item({ key: 'agent:2', name: 'Mark', sortOrder: 2, lastMessageAt: '2026-09-30T12:00:00Z' });
const troy = item({ key: 'agent:3', name: 'Troy', sortOrder: 3 });
const cali = item({ key: 'agent:4', name: 'Cali', sortOrder: 0 });
const jose = item({
  key: 'conv:10',
  kind: 'people',
  name: 'José Pérez',
  lastMessageAt: '2026-09-30T11:00:00Z',
  unread: 2,
  sortOrder: Number.MAX_SAFE_INTEGER,
});
const ana = item({
  key: 'conv:11',
  kind: 'people',
  name: 'Ana',
  lastMessageAt: '2026-09-29T11:00:00Z',
  sortOrder: Number.MAX_SAFE_INTEGER,
});
const grupo = item({ key: 'conv:20', kind: 'group', name: 'Compras OLP', unread: 1 });

const todos = [orus, mark, troy, cali, jose, ana, grupo];

describe('compareByActivity (orden dentro de cada sección)', () => {
  it('pone primero el chat con el mensaje más reciente', () => {
    expect([orus, mark].sort(compareByActivity).map((i) => i.name)).toEqual(['Mark', 'Orus']);
  });

  it('manda al final los chats sin mensajes, y entre ellos el orden del catálogo', () => {
    expect([troy, cali, orus].sort(compareByActivity).map((i) => i.name)).toEqual([
      'Orus',
      'Cali',
      'Troy',
    ]);
  });

  it('con el mismo orden de catálogo desempata por nombre', () => {
    const a = item({ key: 'agent:8', name: 'Beta' });
    const b = item({ key: 'agent:9', name: 'Alfa' });
    expect([a, b].sort(compareByActivity).map((i) => i.name)).toEqual(['Alfa', 'Beta']);
  });

  it('trata una fecha inválida como "sin actividad"', () => {
    const rara = item({ key: 'agent:7', name: 'Rara', lastMessageAt: 'no-es-fecha', sortOrder: 9 });
    expect([rara, orus].sort(compareByActivity)[0].name).toBe('Orus');
  });
});

describe('buildRailSections (anclados primero)', () => {
  it('sin anclas arma Agentes, Personas y Grupos en ese orden', () => {
    const secciones = buildRailSections(todos, new Set());
    expect(secciones.map((s) => s.id)).toEqual(['agents', 'people', 'groups']);
    expect(secciones[0].items.map((i) => i.name)).toEqual(['Mark', 'Orus', 'Cali', 'Troy']);
    expect(secciones[1].items.map((i) => i.name)).toEqual(['José Pérez', 'Ana']);
  });

  it('un chat anclado sale SOLO en Anclados, que va de primero', () => {
    const secciones = buildRailSections(todos, new Set(['agent:3', 'conv:11']));
    expect(secciones[0].id).toBe('pinned');
    expect(secciones[0].items.map((i) => i.name)).toEqual(['Ana', 'Troy']);
    const agentes = secciones.find((s) => s.id === 'agents');
    expect(agentes?.items.some((i) => i.key === 'agent:3')).toBe(false);
    const personas = secciones.find((s) => s.id === 'people');
    expect(personas?.items.map((i) => i.name)).toEqual(['José Pérez']);
  });

  it('un ancla de algo que ya no se ve no pinta nada', () => {
    const secciones = buildRailSections(todos, new Set(['agent:999']));
    expect(secciones.some((s) => s.id === 'pinned')).toBe(false);
  });

  it('omite las secciones vacías', () => {
    const secciones = buildRailSections([orus], new Set());
    expect(secciones.map((s) => s.id)).toEqual(['agents']);
  });

  it('el buscador filtra por nombre sin importar mayúsculas ni tildes', () => {
    const secciones = buildRailSections(todos, new Set(['conv:10']), '  JOSE ');
    expect(secciones).toHaveLength(1);
    expect(secciones[0].id).toBe('pinned');
    expect(secciones[0].items[0].name).toBe('José Pérez');
  });

  it('un buscador sin resultados devuelve una lista vacía', () => {
    expect(buildRailSections(todos, new Set(), 'zzz')).toEqual([]);
  });
});

describe('contador de pendientes', () => {
  it('suma los no leídos de todos los chats', () => {
    expect(totalUnread(todos)).toBe(3);
  });

  it('ignora valores negativos o vacíos', () => {
    expect(totalUnread([item({ key: 'agent:1', name: 'x', unread: -4 })])).toBe(0);
  });

  it('formatea el número con tope de 99+', () => {
    expect(formatUnread(0)).toBe('');
    expect(formatUnread(7)).toBe('7');
    expect(formatUnread(99)).toBe('99');
    expect(formatUnread(100)).toBe('99+');
  });
});

describe('anclas', () => {
  it('valida las claves que acepta la ruta', () => {
    expect(isChatRailKey('agent:1')).toBe(true);
    expect(isChatRailKey('conv:2147483647')).toBe(true);
    expect(isChatRailKey('conv:2147483648')).toBe(false);
    expect(isChatRailKey('agent:0')).toBe(false);
    expect(isChatRailKey('agent:01')).toBe(false);
    expect(isChatRailKey('group:1')).toBe(false);
    expect(isChatRailKey('agent:1; DROP TABLE')).toBe(false);
    expect(isChatRailKey(5)).toBe(false);
  });

  it('anclar agrega sin duplicar y desanclar quita', () => {
    expect(togglePin(['agent:1'], 'conv:2', true)).toEqual(['agent:1', 'conv:2']);
    expect(togglePin(['agent:1'], 'agent:1', true)).toEqual(['agent:1']);
    expect(togglePin(['agent:1', 'conv:2'], 'agent:1', false)).toEqual(['conv:2']);
  });

  it('no pasa del tope de anclas', () => {
    const llenas = Array.from({ length: MAX_PINS }, (_, i) => `conv:${i + 1}`);
    expect(togglePin(llenas, 'agent:1', true)).toHaveLength(MAX_PINS);
    expect(togglePin(llenas, 'agent:1', true)).not.toContain('agent:1');
  });
});

describe('buildRailItems (desde la bandeja)', () => {
  const agents = [
    { idAgent: 1, code: 'horus', displayName: 'Orus', avatarUrl: null, sortOrder: 1, busy: true },
    { idAgent: 2, code: 'mark', displayName: 'Mark', avatarUrl: null, sortOrder: 2 },
  ];
  const conversacionOrus = {
    id: 5,
    kind: 'direct',
    title: null,
    lastMessageAt: '2026-09-30T10:00:00Z',
    lastMessage: { preview: '**Hola**' },
    unreadCount: 3,
    agent: { code: 'horus', displayName: 'Orus', avatarUrl: null },
  };
  const persona = {
    id: 10,
    kind: 'people',
    title: null,
    lastMessageAt: '2026-09-30T11:00:00Z',
    lastMessage: null,
    unreadCount: 1,
    agent: { code: 'horus', displayName: 'Orus', avatarUrl: null },
    participants: [
      { kind: 'user' as const, id: 'yo', name: 'Nicolás', avatarUrl: null },
      { kind: 'user' as const, id: 'otra', name: 'Laura', avatarUrl: '/l.png' },
    ],
  };
  const grupoSinTitulo = {
    id: 20,
    kind: 'group',
    title: '  ',
    lastMessageAt: null,
    lastMessage: null,
    unreadCount: 0,
    agent: { code: 'horus', displayName: 'Orus', avatarUrl: null },
  };

  const items = buildRailItems({
    agents,
    conversationByAgent: new Map([[1, conversacionOrus]]),
    unreadByAgent: new Map([[1, 3]]),
    people: [persona],
    groups: [grupoSinTitulo],
    miId: 'yo',
    toPreview: (md) => md.replace(/\*/g, ''),
  });

  it('un agente toma su último mensaje y sus no leídos del hilo directo', () => {
    const orusItem = items.find((i) => i.key === 'agent:1');
    expect(orusItem).toMatchObject({ preview: 'Hola', unread: 3, busy: true, agentCode: 'horus' });
  });

  it('un agente sin conversación sale igual, sin vista previa', () => {
    expect(items.find((i) => i.key === 'agent:2')).toMatchObject({ preview: null, unread: 0 });
  });

  it('un hilo entre personas lleva la cara de la OTRA persona', () => {
    expect(items.find((i) => i.key === 'conv:10')).toMatchObject({
      kind: 'people',
      name: 'Laura',
      avatarUrl: '/l.png',
      unread: 1,
    });
  });

  it('un grupo sin título se nombra por su agente anfitrión', () => {
    expect(items.find((i) => i.key === 'conv:20')?.name).toBe('Grupo con Orus');
  });

  it('cada chat sabe a dónde llevar', () => {
    const porClave = (k: string) => items.find((i) => i.key === k)!;
    expect(railItemHref(porClave('agent:1'))).toBe('/process/chat/horus');
    expect(railItemHref(porClave('conv:10'))).toBe('/process/chat/persona/10');
    expect(railItemHref(porClave('conv:20'))).toBe('/process/chat/grupo/20');
    expect(railOpenDetail(porClave('conv:10'))).toEqual({ tipo: 'persona', id: 10 });
    expect(railOpenDetail(porClave('agent:1'))).toEqual({ tipo: 'agente', code: 'horus' });
  });
});

describe('Anclados en su propio orden (lista de anclas)', () => {
  it('con la lista, el último anclado va arriba aunque tenga menos actividad', () => {
    // Se anclaron en este orden: Ana primero, luego Troy (sin mensajes).
    const secciones = buildRailSections(todos, ['conv:11', 'agent:3']);
    expect(secciones[0].id).toBe('pinned');
    expect(secciones[0].items.map((i) => i.name)).toEqual(['Troy', 'Ana']);
    // Los no anclados siguen por actividad.
    expect(secciones.find((s) => s.id === 'agents')?.items.map((i) => i.name)).toEqual([
      'Mark',
      'Orus',
      'Cali',
    ]);
  });
});

describe('sortConversationsByActivity (Personas y Grupos)', () => {
  type C = { id: number; lastMessageAt: string | null; nombre: string };
  const nombre = (c: C) => c.nombre;
  const lista: C[] = [
    { id: 1, lastMessageAt: '2026-10-01T10:00:00Z', nombre: 'Viejo' },
    { id: 2, lastMessageAt: null, nombre: 'Zeta' },
    { id: 3, lastMessageAt: '2026-10-01T12:00:00Z', nombre: 'Nuevo' },
    { id: 4, lastMessageAt: null, nombre: 'Alfa' },
    { id: 5, lastMessageAt: '2026-10-01T10:00:00Z', nombre: 'Empate' },
  ];

  it('más reciente arriba, empate por id mayor y sin mensajes al final por nombre', () => {
    expect(sortConversationsByActivity(lista, nombre).map((c) => c.id)).toEqual([3, 5, 1, 4, 2]);
  });

  it('no muta la lista original', () => {
    const copia = [...lista];
    sortConversationsByActivity(lista, nombre);
    expect(lista).toEqual(copia);
  });
});

describe('bumpConversationActivity (sube al enviar o recibir)', () => {
  const lista = [
    { id: 1, lastMessageAt: '2026-10-01T12:00:00Z' },
    { id: 2, lastMessageAt: '2026-10-01T10:00:00Z' },
    { id: 3, lastMessageAt: null },
  ];

  it('pone la nueva fecha y la conversación queda de primera al ordenar', () => {
    const nueva = bumpConversationActivity(lista, 2, '2026-10-01T13:00:00Z');
    expect(nueva).not.toBe(lista);
    expect(sortConversationsByActivity(nueva, () => '').map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it('una conversación sin mensajes también sube', () => {
    const nueva = bumpConversationActivity(lista, 3, '2026-10-01T13:00:00Z');
    expect(sortConversationsByActivity(nueva, () => '')[0].id).toBe(3);
  });

  it('nunca baja la fecha ni crea una lista nueva si no cambia nada', () => {
    expect(bumpConversationActivity(lista, 1, '2026-10-01T11:00:00Z')).toBe(lista);
    expect(bumpConversationActivity(lista, 99, '2026-10-01T13:00:00Z')).toBe(lista);
    expect(bumpConversationActivity(lista, 1, 'no-es-fecha')).toBe(lista);
  });
});

describe('botón "Nuevo" de la barra', () => {
  const base = { canMessagePeople: false, canCreateGroups: false, canBroadcast: false, totalAgents: 1 };

  it('sin ningún permiso no hay opciones (y no se pinta el botón)', () => {
    expect(chatCreateOptions(base)).toEqual([]);
  });

  it('cada opción sale solo con su permiso, en orden persona, grupo, masivo', () => {
    expect(chatCreateOptions({ ...base, canCreateGroups: true })).toEqual(['grupo']);
    expect(chatCreateOptions({ ...base, canMessagePeople: true })).toEqual(['persona']);
    expect(
      chatCreateOptions({ canMessagePeople: true, canCreateGroups: true, canBroadcast: true, totalAgents: 3 })
    ).toEqual(['persona', 'grupo', 'masivo']);
  });

  it('el masivo exige administrador Y más de un asistente, como "Enviar a todos"', () => {
    expect(chatCreateOptions({ ...base, canBroadcast: true, totalAgents: 1 })).toEqual([]);
    expect(chatCreateOptions({ ...base, canBroadcast: false, totalAgents: 5 })).toEqual([]);
    expect(chatCreateOptions({ ...base, canBroadcast: true, totalAgents: 2 })).toEqual(['masivo']);
  });

  it('valida el tipo que llega por la URL', () => {
    expect(isChatCreateKind('grupo')).toBe(true);
    expect(isChatCreateKind('persona')).toBe(true);
    expect(isChatCreateKind('masivo')).toBe(true);
    expect(isChatCreateKind('admin')).toBe(false);
    expect(isChatCreateKind(null)).toBe(false);
  });

  it('la URL de creación apunta a la página del chat', () => {
    expect(chatCreateHref('grupo')).toBe('/process/chat?nuevo=grupo');
  });
});

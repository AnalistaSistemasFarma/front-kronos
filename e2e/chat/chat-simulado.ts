import { type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Chat simulado para las e2e de stickers y del compositor (2026-10-20/21).
 * Sesión firmada con NEXTAUTH_SECRET y TODO el chat con `page.route`. No es un
 * *.spec.ts: lo importan stickers-animados.spec.ts y compositor-mis-stickers.spec.ts.
 */

export const SECRET = process.env.NEXTAUTH_SECRET;
export const REMOTO = Boolean(process.env.E2E_BASE_URL);
export const CAPTURAS = process.env.CAPTURAS_DIR;
export const USUARIO = { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-yo', role: 'user' };

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const AGENTE = {
  idAgent: 1,
  code: 'horus',
  displayName: 'Orus',
  sortOrder: 1,
  handle: '@horus_gss_bot',
  avatarUrl: null,
  avatarVersion: null,
  description: null,
  companies: [{ idCompany: 3, companyName: 'ONE LATAM PHARMA', isPrimary: true }],
  busy: false,
};

const CONVERSACION = {
  id: 101,
  kind: 'direct',
  title: null,
  createdAt: hace(10_000),
  updatedAt: hace(5),
  lastMessageAt: hace(5),
  archived: false,
  agent: { idAgent: 1, code: 'horus', displayName: 'Orus', handle: '@horus_gss_bot', avatarUrl: null },
  lastMessage: { id: 1004, role: 'agent', preview: 'Listo', createdAt: hace(5) },
  unreadCount: 0,
  agentStatus: { state: 'idle', label: null, updatedAt: hace(0) },
  agentStatuses: [],
};

type Msg = Record<string, unknown> & { id: number };

const base = (id: number, role: 'user' | 'agent', body: string, min: number): Msg => ({
  id,
  role,
  body,
  createdAt: hace(min),
  deliveredAt: hace(min),
  readAt: hace(1),
  attachments: [],
  author:
    role === 'agent'
      ? { kind: 'agent', id: 1, name: 'Orus', avatarUrl: null }
      : { kind: 'user', id: USUARIO.id, name: USUARIO.name, avatarUrl: null },
  replyTo: null,
});

const ANIMADOS: [string, string][] = [
  ['pulgar-arriba', '¡De acuerdo!'],
  ['listo', '¡Listo!'],
  ['gracias', '¡Gracias!'],
  ['aplausos', '¡Aplausos!'],
  ['celebracion', '¡A celebrar!'],
  ['fiesta', '¡Fiesta!'],
  ['risa', '¡Jajaja!'],
  ['cohete', '¡A producción!'],
];
const ETIQUETA = new Map(ANIMADOS.map(([c, l]) => [`noto-${c}`, l]));

const mediaAnimada = (nombre: string, titulo: string) => ({
  kind: 'sticker',
  provider: 'gss',
  title: titulo,
  src: `/chat/stickers/noto/${nombre}.webp`,
  poster: `/chat/stickers/noto/${nombre}.poster.webp`,
  animated: true,
  width: 160,
  height: 160,
});

function historial(largo: boolean): Msg[] {
  const msgs: Msg[] = [
    base(1001, 'user', 'Orus, ¿ya quedó el informe de compras de septiembre?', 40),
    { ...base(1002, 'agent', '[Sticker: ¡Listo!]', 39), media: mediaAnimada('listo', '¡Listo!') },
    base(1003, 'agent', 'Sí, quedó en SharePoint con las 6 empresas.', 38),
  ];
  if (largo) {
    // Muchos mensajes después: el sticker de arriba queda FUERA de pantalla.
    for (let i = 0; i < 24; i++) {
      msgs.push(base(1100 + i, i % 2 ? 'agent' : 'user', `Mensaje de relleno número ${i + 1} para empujar el sticker fuera de la vista.`, 30 - i));
    }
  }
  return msgs;
}

export async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({
    secret: SECRET!,
    token: { email: USUARIO.email, name: USUARIO.name, sub: USUARIO.id, kronosUserId: USUARIO.id, role: 'user' },
  });
  const u = new URL(baseURL);
  await context.addCookies([
    { name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
}

export async function simularChat(
  page: Page,
  opciones: { gif?: boolean; largo?: boolean; oscuro?: boolean; misStickers?: boolean; admin?: boolean } = {}
) {
  const estado = {
    mediaEnviada: [] as Record<string, unknown>[],
    subidos: 0,
    propuestas: [] as Record<string, unknown>[],
    revisiones: [] as Record<string, unknown>[],
  };
  // «Mis stickers» (2026-10-21) simulado: lo que la persona va cargando.
  const mios: { idSticker: number; label: string; src: string; estado: string | null; idCompany: number | null; companyName: string | null }[] = [];
  let siguienteId = 2000;

  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: { ...USUARIO, ...(opciones.oscuro ? { colorScheme: 'dark' } : {}) }, expires: '2099-01-01T00:00:00Z' } })
  );
  await page.route('**/api/chat/access', (r) =>
    r.fulfill({
      json: {
        canUseChat: true,
        canBroadcast: false,
        canCreateGroups: false,
        canMessagePeople: false,
        companies: [{ idCompany: 3, companyName: 'ONE LATAM PHARMA', isPrimary: true }],
        agents: [AGENTE],
      },
    })
  );
  await page.route('**/api/chat/conversations', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { conversations: [CONVERSACION] } });
    return r.fulfill({ json: { conversation: CONVERSACION } });
  });
  await page.route(/\/api\/chat\/conversations\/\d+\/messages(\?|$)/, (r) =>
    r.fulfill({ json: { messages: historial(Boolean(opciones.largo)).reverse(), hasMore: false, nextCursor: null, reactionCursor: 50 } })
  );
  await page.route(/\/api\/chat\/conversations\/\d+\/media/, async (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    estado.mediaEnviada.push(body);
    siguienteId += 1;
    const code = String(body.code ?? '');
    const titulo = ETIQUETA.get(code) ?? '¡Gracias!';
    const media = code.startsWith('noto-')
      ? mediaAnimada(code.slice(5), titulo)
      : { kind: 'sticker', provider: 'gss', title: titulo, src: `/chat/stickers/${code}.svg`, width: 160, height: 160 };
    return r.fulfill({
      status: 201,
      json: { message: { ...base(siguienteId, 'user', `[Sticker: ${titulo}]`, 0), media }, notifiedAgents: [] },
    });
  });
  await page.route(/\/api\/chat\/conversations\/\d+\/poll/, (r) => {
    const url = new URL(r.request().url());
    return r.fulfill({
      json: {
        messages: [],
        cursor: Number(url.searchParams.get('after') ?? 0),
        hasMore: false,
        status: { state: 'idle', label: null, updatedAt: new Date().toISOString() },
        statuses: [],
        nextPollMs: 600,
        serverTime: new Date().toISOString(),
      },
    });
  });
  await page.route(/\/api\/chat\/conversations\/\d+$/, (r) => r.fulfill({ json: { conversation: CONVERSACION } }));
  await page.route(/\/api\/chat\/conversations\/\d+\/read/, (r) => r.fulfill({ json: {} }));
  await page.route('**/api/chat/stickers', (r) =>
    r.fulfill({
      json: {
        gif: Boolean(opciones.gif),
        misStickers: Boolean(opciones.misStickers),
        empresas: [{ id: 3, nombre: 'ONE LATAM PHARMA' }],
        puedeRevisar: Boolean(opciones.admin),
        packs: [
          ...(opciones.misStickers ? [{ id: 'mios', nombre: 'Mis stickers' }] : []),
          { id: 'animados', nombre: 'Animados' },
          { id: 'gss', nombre: 'GSS' },
        ],
        stickers: [
          ...mios.map((m) => ({
            key: `mio:${m.idSticker}`,
            provider: 'empresa',
            pack: 'mios',
            idSticker: m.idSticker,
            label: m.label,
            keywords: m.label,
            src: m.src,
            animated: false,
            poster: null,
          })),
          ...ANIMADOS.map(([c, label]) => ({
            key: `gss:noto-${c}`,
            provider: 'gss',
            pack: 'animados',
            code: `noto-${c}`,
            label,
            keywords: label,
            src: `/chat/stickers/noto/${c}.webp`,
            poster: `/chat/stickers/noto/${c}.poster.webp`,
            animated: true,
          })),
          ...['pulgar-arriba', 'listo', 'gracias', 'hola', 'bravo', 'un-tinto'].map((code) => ({
            key: `gss:${code}`,
            provider: 'gss',
            pack: 'gss',
            code,
            label: code,
            keywords: code,
            src: `/chat/stickers/${code}.svg`,
            poster: null,
            animated: false,
          })),
        ],
      },
    })
  );
  // La imagen de un sticker propio: el WebP animado real de «aplausos».
  await page.route(/\/api\/chat\/stickers\/\d+$/, (r) => r.continue({ url: new URL('/chat/stickers/noto/aplausos.webp', r.request().url()).toString() }));
  await page.route('**/api/chat/stickers/mios', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { stickers: mios } });
    estado.subidos += 1;
    const nombre = /name="nombre"\r\n\r\n([^\r]*)/.exec(r.request().postData() ?? '')?.[1] ?? 'Sticker';
    const m = { idSticker: 500 + estado.subidos, label: nombre, src: `/api/chat/stickers/${500 + estado.subidos}`, estado: null, idCompany: null, companyName: null };
    mios.unshift(m);
    return r.fulfill({ status: 201, json: { sticker: { ...m, animated: true } } });
  });
  await page.route(/\/api\/chat\/stickers\/mios\/\d+\/propuesta$/, (r) => {
    const id = Number(/mios\/(\d+)\//.exec(r.request().url())![1]);
    estado.propuestas.push({ id, ...(r.request().postDataJSON() as object) });
    const m = mios.find((x) => x.idSticker === id);
    if (m) Object.assign(m, { estado: 'propuesto', idCompany: 3, companyName: 'ONE LATAM PHARMA' });
    return r.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/chat/stickers/propuestas', (r) =>
    r.fulfill({
      json: {
        propuestas: mios
          .filter((m) => m.estado === 'propuesto')
          .map((m) => ({ idSticker: m.idSticker, label: m.label, src: m.src, autor: 'Laura', idCompany: 3, companyName: 'ONE LATAM PHARMA' })),
      },
    })
  );
  await page.route(/\/api\/chat\/stickers\/propuestas\/\d+$/, (r) => {
    const id = Number(/propuestas\/(\d+)$/.exec(r.request().url())![1]);
    const accion = (r.request().postDataJSON() as { accion: string }).accion;
    estado.revisiones.push({ id, accion });
    const m = mios.find((x) => x.idSticker === id);
    if (m) m.estado = accion === 'aprobar' ? 'aprobado' : 'rechazado';
    return r.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/chat/gifs/search**', (r) => r.fulfill({ json: { enabled: true, items: [], next: null } }));
  await page.route('**/api/chat/pins', (r) => r.fulfill({ json: { pins: [], available: true } }));
  await page.route('**/api/chat/pulse**', (r) => r.fulfill({ status: 403, json: {} }));
  await page.route('**/api/correo/agente/acciones**', (r) => r.fulfill({ json: { acciones: [] } }));
  await page.route('**/api/profile/start-page', (r) => r.fulfill({ json: { available: false, options: [], current: null } }));
  return estado;
}

export const hilo = (page: Page) => page.locator('.chat-thread').first();
export const caja = (page: Page) => page.locator('textarea.chat-composer__input').first();

export async function capturar(page: Page, nombre: string) {
  if (!CAPTURAS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
}

/** Guarda el video de la prueba (para el GIF del PR). */
export async function guardarVideo(page: Page, info: TestInfo, nombre: string) {
  if (!CAPTURAS) return;
  const video = page.video();
  await page.close();
  if (video) await video.saveAs(`${CAPTURAS}/${nombre}.webm`).catch(() => info.annotations.push({ type: 'video', description: 'sin video' }));
}


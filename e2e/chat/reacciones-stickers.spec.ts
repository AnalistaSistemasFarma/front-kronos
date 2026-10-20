import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Chat · reacciones, stickers y GIF (2026-10-20).
 *
 * Con sesión firmada (NEXTAUTH_SECRET de la CI) y TODO el chat simulado con
 * `page.route`, igual que hilo-sin-parpadeo.spec.ts. Lo que se prueba es la
 * INTERFAZ en escritorio y en celular:
 *   - escritorio: botón de reaccionar al pasar el mouse, set rápido, chip con
 *     conteo y quitar tocando el chip;
 *   - celular: TOQUE LARGO sobre el mensaje → hoja inferior → reaccionar;
 *   - en vivo: una reacción de otra persona llega por el MISMO sondeo del hilo
 *     (campo `reactions` de /poll), sin pedidos nuevos;
 *   - el selector de stickers y GIF desde el clip, y cómo se pinta lo enviado.
 *
 * Capturas para el PR: con CAPTURAS_DIR definido se guardan ahí.
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const CAPTURAS = process.env.CAPTURAS_DIR;
const USUARIO = { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-yo', role: 'user' };
const ANA = { id: 'u-ana', name: 'Ana Gómez' };

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

function historial(): Msg[] {
  return [
    base(1001, 'user', 'Orus, ¿ya quedó el informe de compras de septiembre?', 40),
    {
      ...base(1002, 'agent', 'Sí, quedó en SharePoint con las 6 empresas. ¿Le preparo también el resumen para el comité?', 38),
      reactions: [
        { emoji: '👍', count: 2, mine: false, users: [ANA, { id: 'u-luis', name: 'Luis Pérez' }] },
        { emoji: '🙏', count: 1, mine: true, users: [{ id: USUARIO.id, name: USUARIO.name }] },
      ],
    },
    base(1003, 'user', 'Sí, por favor. Que quede corto.', 30),
    {
      ...base(1004, 'user', '[Sticker: ¡De acuerdo!]', 29),
      media: { kind: 'sticker', provider: 'gss', title: '¡De acuerdo!', src: '/chat/stickers/pulgar-arriba.svg', width: 160, height: 160 },
    },
    {
      ...base(1005, 'agent', 'Listo: le dejé el resumen de una página en la misma carpeta.', 5),
    },
  ];
}

/** Imagen de relleno para el «GIF» (el proxy se simula: nada sale a GIPHY). */
const GIF_FALSO = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><rect width="200" height="120" rx="10" fill="#1f7a8c"/><text x="100" y="68" text-anchor="middle" font-family="Arial" font-size="20" font-weight="700" fill="#fff">GIF de prueba</text></svg>`;

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({
    secret: SECRET!,
    token: { email: USUARIO.email, name: USUARIO.name, sub: USUARIO.id, kronosUserId: USUARIO.id, role: 'user' },
  });
  const u = new URL(baseURL);
  await context.addCookies([
    { name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
}

async function simularChat(page: Page) {
  const estado = {
    reaccionesPedidas: [] as { idMessage: number; emoji: string; action: string }[],
    mediaEnviada: [] as Record<string, unknown>[],
    cambiosPendientes: null as null | Record<string, unknown>,
    sondeosConRafter: 0,
    rutasDesconocidas: [] as string[],
  };
  let siguienteId = 2000;
  // Lo que el servidor «tiene»: se actualiza con cada reacción.
  const reacciones = new Map<number, { emoji: string; count: number; mine: boolean; users: { id: string; name: string }[] }[]>();
  for (const m of historial()) if (m.reactions) reacciones.set(m.id, m.reactions as never);

  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: { ...USUARIO }, expires: '2099-01-01T00:00:00Z' } })
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
    r.fulfill({ json: { messages: historial().reverse(), hasMore: false, nextCursor: null, reactionCursor: 50 } })
  );
  await page.route(/\/api\/chat\/conversations\/\d+\/messages\/\d+\/reactions/, async (r) => {
    const idMessage = Number(/messages\/(\d+)\/reactions/.exec(r.request().url())![1]);
    const { emoji, action } = r.request().postDataJSON() as { emoji: string; action: string };
    estado.reaccionesPedidas.push({ idMessage, emoji, action });
    const actuales = reacciones.get(idMessage) ?? [];
    const ex = actuales.find((x) => x.emoji === emoji);
    let nuevas;
    if (ex?.mine) {
      nuevas = actuales
        .map((x) => (x.emoji === emoji ? { ...x, count: x.count - 1, mine: false, users: x.users.filter((u) => u.id !== USUARIO.id) } : x))
        .filter((x) => x.count > 0);
    } else if (ex) {
      nuevas = actuales.map((x) => (x.emoji === emoji ? { ...x, count: x.count + 1, mine: true, users: [...x.users, { id: USUARIO.id, name: USUARIO.name }] } : x));
    } else {
      nuevas = [...actuales, { emoji, count: 1, mine: true, users: [{ id: USUARIO.id, name: USUARIO.name }] }];
    }
    reacciones.set(idMessage, nuevas);
    return r.fulfill({ json: { reactions: nuevas } });
  });
  await page.route(/\/api\/chat\/conversations\/\d+\/media/, async (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    estado.mediaEnviada.push(body);
    siguienteId += 1;
    const media =
      body.kind === 'gif'
        ? { kind: 'gif', provider: 'giphy', title: 'gato aplaudiendo', src: '/api/chat/gifs/proxy?u=prueba&s=firma', width: 200, height: 120 }
        : { kind: 'sticker', provider: 'gss', title: '¡Gracias!', src: `/chat/stickers/${body.code}.svg`, width: 160, height: 160 };
    return r.fulfill({
      status: 201,
      json: {
        message: { ...base(siguienteId, 'user', body.kind === 'gif' ? '[GIF: gato aplaudiendo]' : '[Sticker: ¡Gracias!]', 0), media },
        notifiedAgents: [],
      },
    });
  });
  await page.route(/\/api\/chat\/conversations\/\d+\/poll/, (r) => {
    const url = new URL(r.request().url());
    const rafter = url.searchParams.get('rafter');
    if (rafter !== null) estado.sondeosConRafter += 1;
    const cambios = estado.cambiosPendientes;
    estado.cambiosPendientes = null;
    return r.fulfill({
      json: {
        messages: [],
        cursor: Number(url.searchParams.get('after') ?? 0),
        hasMore: false,
        status: { state: 'idle', label: null, updatedAt: new Date().toISOString() },
        statuses: [],
        ...(rafter !== null ? { reactions: { cursor: cambios ? 60 : 50, changes: cambios ?? {} } } : {}),
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
        gif: true,
        stickers: ['pulgar-arriba', 'listo', 'gracias', 'hola', 'buen-trabajo', 'bravo', 'lo-reviso', 'un-momento', 'en-reunion', 'idea', 'a-produccion', 'un-tinto', 'feliz-cumpleanos', 'con-carino'].map(
          (code) => ({ key: `gss:${code}`, provider: 'gss', code, label: code, keywords: code, src: `/chat/stickers/${code}.svg` })
        ),
      },
    })
  );
  await page.route('**/api/chat/gifs/search**', (r) =>
    r.fulfill({
      json: {
        enabled: true,
        items: Array.from({ length: 6 }, (_, i) => ({
          id: `gif${i}`,
          title: `GIF ${i + 1}`,
          width: 200,
          height: 120,
          previewUrl: `/api/chat/gifs/proxy?u=p${i}&s=f`,
        })),
        next: null,
      },
    })
  );
  await page.route('**/api/chat/gifs/proxy**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: GIF_FALSO }));
  await page.route('**/api/chat/pins', (r) => r.fulfill({ json: { pins: [], available: true } }));
  await page.route('**/api/chat/pulse**', (r) => r.fulfill({ status: 403, json: {} }));
  await page.route('**/api/correo/agente/acciones**', (r) => r.fulfill({ json: { acciones: [] } }));
  await page.route('**/api/profile/start-page', (r) => r.fulfill({ json: { available: false, options: [], current: null } }));

  return estado;
}

const hilo = (page: Page) => page.locator('.chat-thread').first();
const burbuja = (page: Page, texto: string) => hilo(page).locator('.chat-bubble', { hasText: texto }).first();

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
}

test.describe('Chat · reacciones, stickers y GIF · escritorio', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('muestra reacciones y sticker, reacciona con el botón, quita tocando el chip y recibe en vivo', async ({ page }) => {
    const estado = await simularChat(page);
    await page.goto('/process/chat?agent=horus');
    const resp = burbuja(page, 'quedó en SharePoint');
    await expect(resp).toBeVisible();

    // Las reacciones que ya traía el historial, con conteo; la mía resaltada.
    const chips = resp.getByTestId('chat-reacciones');
    await expect(chips.getByRole('button', { name: /^👍 2/ })).toBeVisible();
    await expect(chips.getByRole('button', { name: /^🙏 1/ })).toHaveAttribute('aria-pressed', 'true');
    // El sticker se pinta como imagen, sin el texto descriptivo.
    const sticker = hilo(page).getByRole('img', { name: 'Sticker: ¡De acuerdo!' });
    await expect(sticker).toBeVisible();
    await expect(hilo(page).getByText('[Sticker: ¡De acuerdo!]')).toHaveCount(0);
    await capturar(page, 'escritorio-1-hilo-con-reacciones');

    // Botón de reaccionar al pasar el mouse → set rápido → 🎉 no está; usa «más».
    await resp.hover();
    await hilo(page)
      .locator('.chat-msg', { hasText: 'quedó en SharePoint' })
      .getByRole('button', { name: 'Reaccionar a este mensaje' })
      .click();
    await expect(page.getByRole('group', { name: 'Reacciones rápidas' })).toBeVisible();
    await capturar(page, 'escritorio-2-set-rapido');
    await page.getByRole('button', { name: 'Más emojis' }).click();
    await page.getByLabel('Buscar emoji').fill('fiesta');
    await capturar(page, 'escritorio-3-selector-completo');
    await page.getByRole('button', { name: 'fiesta celebración' }).click();
    await expect(chips.getByRole('button', { name: /^🎉 1/ })).toHaveAttribute('aria-pressed', 'true');
    expect(estado.reaccionesPedidas.at(-1)).toEqual({ idMessage: 1002, emoji: '🎉', action: 'toggle' });

    // Tocar MI chip lo quita.
    await chips.getByRole('button', { name: /^🎉 1/ }).click();
    await expect(chips.getByRole('button', { name: /^🎉/ })).toHaveCount(0);

    // En vivo: Ana reacciona con ❤️ a mi mensaje y llega por el MISMO sondeo.
    estado.cambiosPendientes = {
      1003: [{ emoji: '❤️', count: 1, mine: false, users: [ANA] }],
    };
    await expect(burbuja(page, 'Que quede corto').getByRole('button', { name: /^❤️ 1/ })).toBeVisible({ timeout: 5_000 });
    expect(estado.sondeosConRafter).toBeGreaterThan(0);
    await capturar(page, 'escritorio-4-reaccion-en-vivo');
  });

  test('envía un sticker y un GIF desde el clip; el GIF llega por el proxy', async ({ page }) => {
    const estado = await simularChat(page);
    await page.goto('/process/chat?agent=horus');
    await expect(burbuja(page, 'quedó en SharePoint')).toBeVisible();

    await page.getByRole('button', { name: 'Adjuntar y más opciones' }).click();
    await page.getByRole('menuitem', { name: 'Stickers y GIF' }).click();
    const selector = page.getByTestId('chat-media-picker');
    await expect(selector.getByRole('button', { name: 'Enviar sticker gracias' })).toBeVisible();
    await capturar(page, 'escritorio-5-selector-stickers');
    await selector.getByRole('button', { name: 'Enviar sticker gracias' }).click();
    await expect(hilo(page).getByRole('img', { name: 'Sticker: ¡Gracias!' })).toBeVisible();
    expect(estado.mediaEnviada.at(-1)).toEqual({ kind: 'sticker', code: 'gracias' });

    await page.getByRole('button', { name: 'Adjuntar y más opciones' }).click();
    await page.getByRole('menuitem', { name: 'Stickers y GIF' }).click();
    await page.getByRole('tab', { name: 'GIF' }).click();
    await expect(selector.getByRole('button', { name: 'Enviar GIF GIF 1' })).toBeVisible();
    await expect(selector.getByText(/Con tecnología de GIPHY/)).toBeVisible();
    await capturar(page, 'escritorio-6-selector-gif');
    await selector.getByRole('button', { name: 'Enviar GIF GIF 1' }).click();
    const gif = hilo(page).getByRole('img', { name: 'GIF: gato aplaudiendo' });
    await expect(gif).toBeVisible();
    expect(await gif.getAttribute('src')).toMatch(/^\/api\/chat\/gifs\/proxy\?/);
    expect(estado.mediaEnviada.at(-1)).toEqual({ kind: 'gif', id: 'gif0' });
    await capturar(page, 'escritorio-7-sticker-y-gif-enviados');
  });
});

test.describe('Chat · reacciones, stickers y GIF · celular', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('toque largo abre la hoja inferior y reacciona; el selector de stickers es hoja inferior', async ({ page }) => {
    const estado = await simularChat(page);
    await page.goto('/process/chat?agent=horus');
    const resp = burbuja(page, 'quedó en SharePoint');
    await expect(resp).toBeVisible();
    await capturar(page, 'celular-1-hilo');

    // En el celular no hay botón de pasar el mouse (se reacciona con toque largo).
    await expect(
      hilo(page).locator('.chat-msg', { hasText: 'quedó en SharePoint' }).getByRole('button', { name: 'Reaccionar a este mensaje' })
    ).toBeHidden();

    // TOQUE LARGO de verdad (eventos táctiles del navegador, 700 ms quieto).
    const caja = (await resp.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const punto = { x: Math.round(caja.x + caja.width / 2), y: Math.round(caja.y + caja.height / 2) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punto] });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const hoja = page.getByTestId('chat-hoja-mensaje');
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText('Responder')).toBeVisible();
    await expect(hoja.getByText('Copiar texto')).toBeVisible();
    // Quién reaccionó.
    await expect(hoja.getByText('Ana Gómez y Luis Pérez')).toBeVisible();
    await capturar(page, 'celular-2-hoja-toque-largo');
    await hoja.getByRole('button', { name: 'Reaccionar con 😂' }).click();
    await expect(hoja).toBeHidden();
    await expect(resp.getByRole('button', { name: /^😂 1/ })).toHaveAttribute('aria-pressed', 'true');
    expect(estado.reaccionesPedidas.at(-1)).toMatchObject({ idMessage: 1002, emoji: '😂' });
    // El toque largo no citó el mensaje.
    await expect(page.getByText(/^Respondiendo a/)).toHaveCount(0);
    await capturar(page, 'celular-3-reaccion-puesta');

    // Selector de stickers como hoja inferior.
    await page.getByRole('button', { name: 'Adjuntar y más opciones' }).click();
    await page.getByRole('menuitem', { name: 'Stickers y GIF' }).click();
    const selector = page.getByTestId('chat-media-picker');
    await expect(selector).toBeVisible();
    const cajaSel = (await page.locator('.chat-hoja').last().boundingBox())!;
    // Pegada abajo: el borde inferior coincide con el de la pantalla.
    expect(Math.round(cajaSel.y + cajaSel.height)).toBeGreaterThanOrEqual(840);
    await capturar(page, 'celular-4-selector-stickers');
    await page.getByRole('tab', { name: 'GIF' }).click();
    await expect(selector.getByRole('button', { name: 'Enviar GIF GIF 1' })).toBeVisible();
    await capturar(page, 'celular-5-selector-gif');
    await selector.getByRole('button', { name: 'Enviar GIF GIF 1' }).click();
    await expect(hilo(page).getByRole('img', { name: 'GIF: gato aplaudiendo' })).toBeVisible();
    await capturar(page, 'celular-6-gif-enviado');
  });
});

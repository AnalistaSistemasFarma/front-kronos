import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Chat · stickers ANIMADOS y panel Emoji | Stickers | GIF (2026-10-20).
 *
 * Pedido de Nicolás (2026-10-20, 12:16): stickers animados como Telegram o
 * WhatsApp y un botón propio AL LADO del clip (no dentro del menú del clip).
 *
 * Con sesión firmada (NEXTAUTH_SECRET de la CI) y TODO el chat simulado con
 * `page.route`, igual que reacciones-stickers.spec.ts. Las imágenes de los
 * stickers son las REALES de public/chat/stickers (no se simulan).
 *   - escritorio: botón al lado del clip → globo con pestañas; barra de
 *     paquetes; emoji en el texto; sticker animado enviado y en movimiento;
 *     sin llave de GIF no hay pestaña GIF; con prefers-reduced-motion queda
 *     quieto; fuera de pantalla se pausa (no se monta el animado).
 *   - celular: el panel es una hoja que reemplaza al teclado; el botón pasa a
 *     «Volver al teclado».
 *
 * Capturas y video para el PR: con CAPTURAS_DIR definido se guardan ahí.
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const CAPTURAS = process.env.CAPTURAS_DIR;
const USUARIO = { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-yo', role: 'user' };

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

async function simularChat(page: Page, opciones: { gif?: boolean; largo?: boolean } = {}) {
  const estado = { mediaEnviada: [] as Record<string, unknown>[] };
  let siguienteId = 2000;

  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { ...USUARIO }, expires: '2099-01-01T00:00:00Z' } }));
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
        packs: [
          { id: 'animados', nombre: 'Animados' },
          { id: 'gss', nombre: 'GSS' },
        ],
        stickers: [
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
  await page.route('**/api/chat/gifs/search**', (r) => r.fulfill({ json: { enabled: true, items: [], next: null } }));
  await page.route('**/api/chat/pins', (r) => r.fulfill({ json: { pins: [], available: true } }));
  await page.route('**/api/chat/pulse**', (r) => r.fulfill({ status: 403, json: {} }));
  await page.route('**/api/correo/agente/acciones**', (r) => r.fulfill({ json: { acciones: [] } }));
  await page.route('**/api/profile/start-page', (r) => r.fulfill({ json: { available: false, options: [], current: null } }));
  return estado;
}

// Video solo cuando se piden capturas (evidencia del PR); en la CI, apagado.
test.use({ video: CAPTURAS ? 'on' : 'off' });

const hilo = (page: Page) => page.locator('.chat-thread').first();
const caja = (page: Page) => page.locator('textarea.chat-composer__input').first();

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
}

/** Guarda el video de la prueba (para el GIF del PR). */
async function guardarVideo(page: Page, info: TestInfo, nombre: string) {
  if (!CAPTURAS) return;
  const video = page.video();
  await page.close();
  if (video) await video.saveAs(`${CAPTURAS}/${nombre}.webm`).catch(() => info.annotations.push({ type: 'video', description: 'sin video' }));
}

test.describe('Chat · stickers animados · escritorio', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('botón al lado del clip: Emoji | Stickers | GIF, paquetes, emoji en el texto y sticker animado en el hilo', async ({ page }, info) => {
    const estado = await simularChat(page, { gif: true });
    await page.goto('/process/chat?agent=horus');
    await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();

    // El sticker del historial se mueve (el animado ya cargó encima del cuadro fijo).
    const delHistorial = hilo(page).locator('.chat-sticker-anim').first();
    await expect(delHistorial).toHaveAttribute('data-animando', 'true');
    await expect(hilo(page).getByRole('img', { name: 'Sticker: ¡Listo!' })).toBeVisible();
    // El contrato con los agentes no cambia: el texto descriptivo no se pinta.
    await expect(hilo(page).getByText('[Sticker: ¡Listo!]')).toHaveCount(0);

    // El clip ya NO trae la opción de stickers.
    await page.getByRole('button', { name: 'Adjuntar y más opciones' }).click();
    await expect(page.getByRole('menuitem', { name: /Stickers/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Botón propio, al lado del clip (misma fila, a su izquierda).
    const boton = page.getByRole('button', { name: 'Emojis, stickers y GIF' });
    const clip = page.getByRole('button', { name: 'Adjuntar y más opciones' });
    const [b, c] = [(await boton.boundingBox())!, (await clip.boundingBox())!];
    expect(Math.abs(b.y - c.y)).toBeLessThan(4);
    expect(b.x).toBeLessThan(c.x);
    expect(c.x - (b.x + b.width)).toBeLessThan(12);

    await boton.click();
    const panel = page.getByTestId('chat-expresiones');
    await expect(panel.getByRole('tab', { name: 'Emoji' })).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'Stickers' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByRole('tab', { name: 'GIF' })).toBeVisible();
    await expect(panel.getByRole('toolbar', { name: 'Paquetes de stickers' }).getByRole('button')).toHaveCount(2);
    await expect(panel.getByText(/Noto Emoji Animation de Google · CC BY 4\.0/)).toBeVisible();
    // Las miniaturas animadas visibles se mueven.
    await expect(panel.locator('.chat-sticker-anim[data-animando="true"]').first()).toBeVisible();
    await capturar(page, 'escritorio-1-panel-stickers');

    // Paquete estático del #698: sigue ahí.
    await panel.getByRole('button', { name: 'Paquete GSS' }).click();
    await expect(panel.getByRole('button', { name: 'Enviar sticker un-tinto' })).toBeInViewport();
    await capturar(page, 'escritorio-2-paquete-gss');

    // Emoji: se inserta en el texto, el panel sigue abierto.
    await panel.getByRole('tab', { name: 'Emoji' }).click();
    await panel.getByLabel('Buscar emoji').fill('fiesta');
    await panel.getByRole('button', { name: 'fiesta celebración' }).click();
    await expect(caja(page)).toHaveValue('🎉');
    await capturar(page, 'escritorio-3-pestana-emoji');

    // Sticker animado: se envía con su código y llega en movimiento.
    await panel.getByRole('tab', { name: 'Stickers' }).click();
    await panel.getByRole('button', { name: 'Enviar sticker ¡Aplausos!' }).click();
    expect(estado.mediaEnviada.at(-1)).toEqual({ kind: 'sticker', code: 'noto-aplausos' });
    const enviado = hilo(page).getByRole('img', { name: 'Sticker: ¡Aplausos!' });
    await expect(enviado).toBeVisible();
    await expect(hilo(page).locator('.chat-sticker-anim').last()).toHaveAttribute('data-animando', 'true');
    // En escritorio el globo se cierra al enviar; el texto escrito se conserva.
    await expect(panel).toBeHidden();
    await expect(caja(page)).toHaveValue('🎉');
    await page.waitForTimeout(1500);
    await capturar(page, 'escritorio-4-sticker-animado-enviado');
    await guardarVideo(page, info, 'escritorio-video-panel-y-sticker');
  });

  test('sin llave de GIF no aparece la pestaña GIF', async ({ page }) => {
    await simularChat(page, { gif: false });
    await page.goto('/process/chat?agent=horus');
    await page.getByRole('button', { name: 'Emojis, stickers y GIF' }).click();
    const panel = page.getByTestId('chat-expresiones');
    await expect(panel.getByRole('tab', { name: 'Stickers' })).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'GIF' })).toHaveCount(0);
  });

  test('fuera de pantalla el sticker se pausa y vuelve a moverse al verse', async ({ page }) => {
    await simularChat(page, { largo: true });
    await page.goto('/process/chat?agent=horus');
    await expect(hilo(page).getByText('número 24')).toBeVisible();
    const sticker = hilo(page).locator('.chat-sticker-anim').first();
    // Arriba, fuera de la vista: solo el cuadro fijo, sin el animado montado.
    await expect(sticker).toHaveAttribute('data-animando', 'false');
    await expect(sticker.locator('.chat-sticker-anim__mov')).toHaveCount(0);
    await sticker.scrollIntoViewIfNeeded();
    await expect(sticker).toHaveAttribute('data-animando', 'true');
  });
});

test.describe('Chat · stickers animados · menos movimiento', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('con prefers-reduced-motion el sticker queda quieto (cuadro fijo)', async ({ context, baseURL, page }) => {
    await sesion(context, baseURL!);
    await simularChat(page);
    await page.goto('/process/chat?agent=horus');
    const sticker = hilo(page).locator('.chat-sticker-anim').first();
    await expect(hilo(page).getByRole('img', { name: 'Sticker: ¡Listo!' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(sticker).toHaveAttribute('data-animando', 'false');
    await expect(sticker.locator('.chat-sticker-anim__mov')).toHaveCount(0);
  });
});

test.describe('Chat · stickers animados · celular', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('el panel es una hoja que reemplaza al teclado y se vuelve al teclado con el mismo botón', async ({ page }, info) => {
    const estado = await simularChat(page, { gif: true });
    await page.goto('/process/chat?agent=horus');
    await expect(hilo(page).getByText('quedó en SharePoint')).toBeVisible();
    await capturar(page, 'celular-1-hilo-con-sticker');

    await caja(page).tap();
    await expect(caja(page)).toBeFocused();
    await page.getByRole('button', { name: 'Emojis, stickers y GIF' }).tap();

    const hoja = page.locator('.chat-expresiones-hoja');
    await expect(hoja).toBeVisible();
    // El teclado se va (la caja suelta el foco) y la hoja queda pegada abajo.
    await expect(caja(page)).not.toBeFocused();
    const h = (await hoja.boundingBox())!;
    expect(Math.round(h.y + h.height)).toBeGreaterThanOrEqual(830);
    await expect(page.getByRole('button', { name: 'Volver al teclado' })).toBeVisible();
    await capturar(page, 'celular-2-hoja-stickers');

    // Enviar un sticker: la hoja queda abierta, como en WhatsApp.
    await hoja.getByRole('button', { name: 'Enviar sticker ¡A celebrar!' }).tap();
    expect(estado.mediaEnviada.at(-1)).toEqual({ kind: 'sticker', code: 'noto-celebracion' });
    await expect(hilo(page).getByRole('img', { name: 'Sticker: ¡A celebrar!' })).toBeVisible();
    await expect(hoja).toBeVisible();
    await page.waitForTimeout(1200);
    await capturar(page, 'celular-3-sticker-enviado');

    await hoja.getByRole('tab', { name: 'Emoji' }).tap();
    await hoja.getByRole('button', { name: 'pulgar arriba me gusta de acuerdo' }).first().tap();
    await expect(caja(page)).toHaveValue('👍');
    // El emoji no abre el teclado encima del panel.
    await expect(caja(page)).not.toBeFocused();
    await capturar(page, 'celular-4-hoja-emoji');

    // Volver al teclado: la hoja se va y la caja recibe el foco.
    await page.getByRole('button', { name: 'Volver al teclado' }).tap();
    await expect(hoja).toBeHidden();
    await expect(caja(page)).toBeFocused();
    await guardarVideo(page, info, 'celular-video-hoja-y-sticker');
  });
});

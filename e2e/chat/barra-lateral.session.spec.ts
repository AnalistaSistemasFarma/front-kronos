import { expect, test, type Page } from '@playwright/test';

/**
 * Barra lateral del chat CON SESIÓN (2026-09-30).
 *
 * El usuario de pruebas (qa.sgc) no tiene chat, así que la BANDEJA se simula
 * con `page.route`: /api/chat/access, /api/chat/conversations y /api/chat/pins
 * responden datos fijos. Lo que se prueba es la barra —qué pinta, en qué orden,
 * cómo se expande, busca y ancla, y el menú del celular—, no el backend del
 * chat (ese tiene sus propias pruebas). Nunca se escribe la contraseña aquí.
 *
 * Capturas para el PR: con CAPTURAS_DIR definido se guardan ahí.
 */

// Id del usuario de pruebas qa.sgc en KRONOSDB_PRUEBAS: la barra muestra en
// cada hilo entre personas a la OTRA persona, la que no es quien mira.
const YO = 'cmuogywjf0000coao96r4p3gt';

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const AGENTES = [
  { idAgent: 1, code: 'horus', displayName: 'Orus', avatarUrl: '/agents/orus.jpg', sortOrder: 1 },
  { idAgent: 2, code: 'mark', displayName: 'Mark', avatarUrl: null, sortOrder: 2 },
  { idAgent: 3, code: 'troy', displayName: 'Troy', avatarUrl: null, sortOrder: 3 },
  { idAgent: 4, code: 'cali', displayName: 'Cali', avatarUrl: null, sortOrder: 4 },
  { idAgent: 5, code: 'nancy', displayName: 'Nancy', avatarUrl: null, sortOrder: 5 },
  { idAgent: 6, code: 'vision', displayName: 'Vision', avatarUrl: null, sortOrder: 6 },
  { idAgent: 7, code: 'lexa', displayName: 'Lexa', avatarUrl: null, sortOrder: 7 },
  { idAgent: 8, code: 'mechita', displayName: 'Mechita', avatarUrl: '/agents/mechita.jpg', sortOrder: 8 },
].map((a) => ({
  ...a,
  handle: `@${a.code}_gss_bot`,
  avatarVersion: null,
  description: null,
  companies: [{ idCompany: 3, companyName: 'ONE LATAM PHARMA', isPrimary: true }],
  busy: a.idAgent === 1,
}));

function directa(id: number, idAgent: number, preview: string, min: number, unread: number, state = 'idle') {
  const a = AGENTES.find((x) => x.idAgent === idAgent)!;
  return {
    id,
    kind: 'direct',
    title: null,
    createdAt: hace(10_000),
    updatedAt: hace(min),
    lastMessageAt: hace(min),
    archived: false,
    agent: { idAgent, code: a.code, displayName: a.displayName, handle: a.handle, avatarUrl: a.avatarUrl },
    lastMessage: { id: id * 10, role: 'agent', preview, createdAt: hace(min) },
    unreadCount: unread,
    agentStatus: { state, label: state === 'idle' ? null : 'Consultando SAP…', updatedAt: hace(0) },
    agentStatuses: [],
  };
}

function entrePersonas(id: number, nombre: string, preview: string, min: number, unread: number) {
  return {
    id,
    kind: 'people',
    title: null,
    createdAt: hace(10_000),
    updatedAt: hace(min),
    lastMessageAt: hace(min),
    archived: false,
    agent: { idAgent: 1, code: 'horus', displayName: 'Orus', handle: null, avatarUrl: null },
    participants: [
      { kind: 'user', id: YO, name: 'QA SGC Pruebas', avatarUrl: null, handle: null, role: 'member' },
      { kind: 'user', id: `p${id}`, name: nombre, avatarUrl: null, handle: null, role: 'member' },
    ],
    lastMessage: { id: id * 10, role: 'user', preview, createdAt: hace(min) },
    unreadCount: unread,
    agentStatus: null,
    agentStatuses: [],
  };
}

const CONVERSACIONES = [
  directa(101, 1, 'Listo, le dejé el informe de compras en SharePoint.', 3, 0, 'tool'),
  directa(102, 2, 'Ya revisé los pagos programados de hoy.', 25, 3),
  directa(103, 7, 'El contrato quedó radicado.', 60 * 26, 0),
  entrePersonas(201, 'Jorge Alba', '¿Revisamos el tablero a las 3?', 8, 2),
  entrePersonas(202, 'Laura Gómez', 'Gracias, quedo atenta.', 60 * 30, 0),
  {
    ...entrePersonas(301, 'x', 'Orus: resumen del día enviado', 40, 1),
    kind: 'group',
    title: 'Compras OLP',
    participants: [],
  },
];

async function simularBandeja(page: Page, pinsIniciales: string[] = ['agent:4']) {
  let pins = [...pinsIniciales];
  const puts: Array<{ key: string; pinned: boolean }> = [];

  await page.route('**/api/chat/access', (route) =>
    route.fulfill({
      json: {
        canUseChat: true,
        canBroadcast: false,
        canCreateGroups: false,
        canMessagePeople: true,
        companies: [{ idCompany: 3, companyName: 'ONE LATAM PHARMA', isPrimary: true }],
        agents: AGENTES,
      },
    })
  );
  await page.route('**/api/chat/conversations', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { conversations: CONVERSACIONES } })
      : route.fulfill({ status: 403, json: { error: 'simulado' } })
  );
  await page.route('**/api/chat/pins', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { key: string; pinned: boolean };
      puts.push(body);
      pins = body.pinned ? [...pins.filter((p) => p !== body.key), body.key] : pins.filter((p) => p !== body.key);
      return route.fulfill({ json: { pins } });
    }
    return route.fulfill({ json: { pins, available: true } });
  });
  // El pulso del chat entre personas no aporta nada a estas pruebas.
  await page.route('**/api/chat/pulse**', (route) => route.fulfill({ status: 403, json: {} }));
  return { puts };
}

async function captura(page: Page, nombre: string) {
  const dir = process.env.CAPTURAS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

test.describe('Chat · barra lateral · escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('e2e-rail-init')) {
          localStorage.removeItem('synerlink:chat-rail-expandida');
          sessionStorage.setItem('e2e-rail-init', '1');
        }
      } catch {}
    });
  });

  test('contraída por defecto: solo avatares con pendientes, anclados primero y nada en la cabecera', async ({ page }) => {
    await simularBandeja(page);
    await page.goto('/process');
    const barra = page.getByRole('complementary', { name: 'Chats' });
    await expect(barra).toBeVisible();
    await expect(barra.getByRole('button', { name: /Chat con Mark, 3 sin leer/ })).toBeVisible();

    // Anclado (Cali) primero; luego los agentes por actividad reciente.
    const nombres = await barra.locator('nav button[aria-label^="Chat con"], nav button[aria-label^="Grupo"]').evaluateAll(
      (els) => els.map((e) => (e.getAttribute('aria-label') ?? '').split(',')[0])
    );
    expect(nombres.slice(0, 4)).toEqual(['Chat con Cali', 'Chat con Orus', 'Chat con Mark', 'Chat con Lexa']);

    // Ya no hay avatares de chat en la cabecera.
    await expect(page.locator('header').getByRole('button', { name: /^Chat con/ })).toHaveCount(0);
    // El contenido se corre el ancho de la barra.
    await expect(page.locator('body')).toHaveClass(/con-chat-rail/);

    // Tooltip con el nombre al pasar el mouse.
    await barra.getByRole('button', { name: /Chat con Mark/ }).hover();
    await expect(page.getByRole('tooltip')).toContainText('Mark · 3 sin leer');
    await captura(page, 'escritorio-contraida');
  });

  test('expandida: secciones, último mensaje, buscador, anclar, y se recuerda', async ({ page }) => {
    const { puts } = await simularBandeja(page);
    await page.goto('/process');
    const barra = page.getByRole('complementary', { name: 'Chats' });
    await barra.getByRole('button', { name: 'Expandir la barra de chats' }).click();

    for (const titulo of ['Anclados', 'Agentes', 'Personas', 'Grupos']) {
      await expect(barra.getByRole('heading', { name: new RegExp(titulo) })).toBeVisible();
    }
    await expect(barra.getByText('Ya revisé los pagos programados de hoy.')).toBeVisible();
    await expect(barra.getByText('¿Revisamos el tablero a las 3?')).toBeVisible();
    await captura(page, 'escritorio-expandida');

    // Anclar a Troy: va a la BD (PUT) y sube a Anclados.
    await barra.getByRole('button', { name: 'Anclar Troy' }).click();
    await expect.poll(() => puts).toContainEqual({ key: 'agent:3', pinned: true });
    const anclados = barra.getByRole('region', { name: 'Anclados' });
    await expect(anclados.getByRole('button', { name: /Chat con Troy/ })).toBeVisible();
    await expect(barra.getByRole('button', { name: 'Desanclar Troy' })).toHaveAttribute('aria-pressed', 'true');

    // Buscador: sin tildes ni mayúsculas.
    await barra.getByRole('textbox', { name: 'Buscar chat por nombre' }).fill('JORGE');
    await expect(barra.getByRole('button', { name: /Chat con Jorge Alba/ })).toBeVisible();
    await expect(barra.getByRole('button', { name: /Chat con Mark/ })).toHaveCount(0);
    await barra.getByRole('textbox', { name: 'Buscar chat por nombre' }).fill('zzz');
    await expect(barra.getByText('Ningún chat coincide con «zzz».')).toBeVisible();

    // Se recuerda expandida al volver a entrar.
    await page.reload();
    await expect(
      page.getByRole('complementary', { name: 'Chats' }).getByRole('button', { name: 'Contraer la barra de chats' })
    ).toBeVisible();
  });

  test('se maneja con teclado', async ({ page }) => {
    await simularBandeja(page);
    await page.goto('/process');
    const barra = page.getByRole('complementary', { name: 'Chats' });
    const expandir = barra.getByRole('button', { name: 'Expandir la barra de chats' });
    await expandir.focus();
    await page.keyboard.press('Enter');
    await expect(barra.getByRole('button', { name: 'Contraer la barra de chats' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});

test.describe('Chat · barra lateral · celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no ocupa pantalla: se abre como menú deslizable desde la cabecera', async ({ page }) => {
    await simularBandeja(page);
    await page.goto('/process');
    await expect(page.getByRole('complementary', { name: 'Chats' })).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/con-chat-rail/);

    const boton = page.getByRole('button', { name: /Abrir chats, 6 sin leer/ });
    await expect(boton).toBeVisible();
    await captura(page, 'movil-cabecera');
    await boton.click();

    const menu = page.getByRole('dialog', { name: 'Chats' });
    await expect(menu).toBeVisible();
    // Que termine de deslizarse antes de la captura.
    await page.waitForTimeout(400);
    await expect(menu.getByRole('heading', { name: /Anclados/ })).toBeVisible();
    await expect(menu.getByRole('button', { name: /Chat con Jorge Alba, 2 sin leer/ })).toBeVisible();
    // 16 px en el buscador: con menos, Safari del iPhone hace zoom al enfocar.
    const tamano = await menu
      .getByRole('textbox', { name: 'Buscar chat por nombre' })
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(tamano)).toBeGreaterThanOrEqual(16);
    await captura(page, 'movil-menu');
  });
});

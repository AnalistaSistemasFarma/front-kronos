import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Estado en vivo del agente en Proyectos (2026-10-20, Nicolás Rivera: «cuando un agente está
 * trabajando no hay ningún estado por fuera que diga que está trabajando. Debería aparecer ahí
 * quién está trabajando»).
 *
 * Con sesión (JWT firmado con el NEXTAUTH_SECRET de la CI) y el API SIMULADO con `page.route`:
 *   - la lista de conversaciones del proyecto pasa a «Orus está trabajando… · Consultando SAP…»,
 *     con el logo animado y la tablita de subagentes, cuando el PULSO del chat entrega el cambio,
 *     y vuelve a lo normal cuando el agente termina (sin recargar ni sondeos nuevos);
 *   - un estado de OTRO proyecto no se pinta aquí;
 *   - la tarjeta del proyecto en la lista de proyectos y el panel del icono de la cabecera;
 *   - celular (390 px) sin desbordar la pantalla.
 * Con CAPTURAS_DIR deja las capturas de escritorio y celular (evidencia del PR).
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const CAPTURAS = process.env.CAPTURAS_DIR;

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', sub: 'u-nr', kronosUserId: 'u-nr', role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

const hace = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const ORUS = { idAgent: 7, code: 'horus', displayName: 'Orus', handle: 'horus_gss_bot', avatarUrl: null, avatarVersion: null };
const EMPRESA = { idCompany: 3, companyName: 'FARMALOGICA' };

type Estado = { state: string; label: string | null; tasks: { desc: string; startedAt: string }[]; updatedAt: string };

function dtoEstado(idConversation: number, e: Estado, idProject = 4) {
  return {
    idConversation,
    idProject,
    projectName: idProject === 4 ? 'Farmalógica — Orus (piloto)' : 'Comex Latam',
    conversationTitle: idConversation === 28 ? 'Conversación inicial' : 'Cartera vencida',
    agent: { idAgent: 7, code: 'horus', displayName: 'Orus', avatarUrl: null, avatarVersion: null },
    ...e,
  };
}

const REPOSO: Estado = { state: 'idle', label: null, tasks: [], updatedAt: hace(3600) };

function detalle(estado28: Estado) {
  const conversaciones = [
    { id: 28, title: 'Conversación inicial', createdAt: hace(2 * 86400), lastMessageAt: hace(2 * 86400), agent: ORUS, createdBy: { id: 'u-nr', name: 'Nicolás Rivera' }, soloLectura: null, agentStatus: dtoEstado(28, estado28) },
    { id: 29, title: 'Cartera vencida', createdAt: hace(3 * 86400), lastMessageAt: hace(3 * 86400), agent: ORUS, createdBy: { id: 'u-nr', name: 'Nicolás Rivera' }, soloLectura: null, agentStatus: null },
  ];
  return {
    idProject: 4,
    name: 'Farmalógica — Orus (piloto)',
    description: 'Piloto del módulo Proyectos con Orus.',
    instructions: null,
    company: EMPRESA,
    profile: { key: 'farmalogica', label: 'Farmalógica (SAP)' },
    myRole: 'owner',
    archived: false,
    capabilities: { write: true, contribute: true, removeAny: true, edit: true, manageAgents: true, manageMembers: true, archive: true, leave: false },
    createdAt: hace(3 * 86400),
    updatedAt: hace(3600),
    agents: [{ ...ORUS, disponible: true, puedoEscribir: true, motivo: null }],
    members: [{ id: 'u-nr', name: 'Nicolás Rivera', email: 'nicolas.rivera@gsslatam.com', avatarUrl: null, role: 'owner' }],
    files: [],
    conversations: conversaciones,
    links: { emails: [], requests: [] },
    memberCount: 1,
    conversationCount: 2,
    linkCount: 0,
    fileCount: 0,
    taskCount: 0,
    teamCount: 2,
  };
}

/** API simulado. `cambiar()` deja un estado nuevo que el pulso entrega en su próxima vuelta. */
async function simular(page: Page, inicial: Estado = REPOSO) {
  let actual = inicial;
  let pendientes: ReturnType<typeof dtoEstado>[] = [];
  const pulsos: string[] = [];
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', id: 'u-nr', role: 'user' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/correo/no-leidos', (r) => r.fulfill({ status: 403, json: { error: 'sin correo' } }));
  const cu = (id: number) => [{ id_subprocess_user_company: id, companyUser: { id_company_user: id, company: { id_company: 3, company: 'FARMALOGICA' } } }];
  await page.route('**/api/processes', (r) =>
    r.fulfill({ json: [{ id_process: 1, process: 'Tecnología', subprocesses: [{ id_subprocess: 112, subprocess: 'Proyectos', subprocess_url: '/process/proyectos', subprocessUserCompanies: cu(1) }] }] })
  );
  await page.route(/\/api\/proyectos\/no-leidos/, (r) => {
    const conDetalle = new URL(r.request().url()).searchParams.get('detalle') === '1';
    const trabajando = actual.state !== 'idle' ? [dtoEstado(28, actual)] : [];
    return r.fulfill({ json: conDetalle ? { noLeidos: 0, mensajes: 0, items: [], trabajando } : { noLeidos: 0, mensajes: 0 } });
  });
  await page.route(/\/api\/proyectos\/4(\?.*)?$/, (r) => r.fulfill({ json: { project: detalle(actual) } }));
  await page.route(/\/api\/proyectos\/4\/equipo/, (r) => r.fulfill({ json: { items: [] } }));
  await page.route(/\/api\/proyectos(\?.*)?$/, (r) =>
    r.fulfill({
      json: {
        companies: [EMPRESA],
        designables: { '3': [] },
        profiles: [],
        projects: [
          {
            idProject: 4,
            name: 'Farmalógica — Orus (piloto)',
            description: 'Piloto del módulo Proyectos con Orus.',
            company: EMPRESA,
            profile: { key: 'farmalogica', label: 'Farmalógica (SAP)' },
            myRole: 'owner',
            archived: false,
            agents: [ORUS],
            memberCount: 1,
            conversationCount: 2,
            linkCount: 0,
            fileCount: 0,
            taskCount: 0,
            updatedAt: hace(3600),
            trabajando: actual.state !== 'idle' ? [dtoEstado(28, actual)] : [],
          },
          {
            idProject: 7,
            name: 'Comex Latam',
            description: 'Importaciones y exportaciones.',
            company: EMPRESA,
            profile: { key: 'comex-latam', label: 'Comex Latam' },
            myRole: 'editor',
            archived: false,
            agents: [{ ...ORUS, idAgent: 9, code: 'silvia', displayName: 'Play', handle: 'silvia_gss_bot' }],
            memberCount: 4,
            conversationCount: 3,
            linkCount: 2,
            fileCount: 1,
            taskCount: 5,
            updatedAt: hace(7200),
            trabajando: [],
          },
        ],
      },
    })
  );
  // El hilo abierto (escritorio): ficha, historial y su propio sondeo, con el MISMO estado.
  const conversacion = (id: number) => ({
    id,
    title: id === 28 ? 'Conversación inicial' : 'Cartera vencida',
    kind: 'project',
    createdAt: hace(2 * 86400),
    updatedAt: hace(3600),
    lastMessageAt: hace(2 * 86400),
    archived: false,
    agent: { idAgent: 7, code: 'horus', displayName: 'Orus', handle: 'horus_gss_bot', avatarUrl: null },
    company: null,
    participants: null,
    lastMessage: null,
    unreadCount: 0,
    agentStatus: actual,
    agentStatuses: [],
  });
  const mensajes = [
    { id: 501, role: 'user', body: '¿Cómo va el inventario de octubre en la bodega 01?', createdAt: hace(2 * 86400 + 60), deliveredAt: hace(2 * 86400), readAt: null, attachments: [], author: { kind: 'user', id: 'u-nr', name: 'Nicolás Rivera' } },
    { id: 502, role: 'agent', body: 'Ya reviso el cierre de la bodega 01 y le cuento.', createdAt: hace(2 * 86400), deliveredAt: hace(2 * 86400), readAt: null, attachments: [], author: null },
  ];
  await page.route(/\/api\/chat\/conversations\/(28|29)$/, (r) => r.fulfill({ json: { conversation: conversacion(Number(r.request().url().split('/').pop())) } }));
  await page.route(/\/api\/chat\/conversations\/(28|29)\/messages/, (r) => r.fulfill({ json: { messages: [...mensajes].reverse(), hasMore: false, nextCursor: null } }));
  await page.route(/\/api\/chat\/conversations\/(28|29)\/poll/, (r) => r.fulfill({ json: { messages: [], cursor: 502, hasMore: false, status: actual, statuses: [], nextPollMs: 2000 } }));
  await page.route(/\/api\/chat\/conversations\/(28|29)\/read/, (r) => r.fulfill({ json: { ok: true, unreadCount: 0 } }));
  await page.route('**/api/chat/pulse**', async (r) => {
    const u = new URL(r.request().url());
    const since = Number(u.searchParams.get('since'));
    const st = u.searchParams.get('st');
    pulsos.push(st ?? '');
    if (since === 0) return r.fulfill({ json: { cursor: 900, events: [], statusCursor: hace(5), statuses: [] } });
    if (pendientes.length > 0) {
      const statuses = pendientes;
      pendientes = [];
      return r.fulfill({ json: { cursor: since, events: [], statusCursor: new Date().toISOString(), statuses } });
    }
    await new Promise((res) => setTimeout(res, 300));
    return r.fulfill({ json: { cursor: since, events: [], statusCursor: st, statuses: [] } });
  });
  return {
    pulsos: () => pulsos,
    cambiar: (e: Estado, idConversation = 28, idProject = 4) => {
      if (idConversation === 28 && idProject === 4) actual = e;
      pendientes.push(dtoEstado(idConversation, e, idProject));
    },
  };
}

const TRABAJANDO: () => Estado = () => ({
  state: 'tool',
  label: 'Consultando SAP…',
  tasks: [
    { desc: 'Analista de inventario: cruza la bodega 01 con SAP', startedAt: hace(42) },
    { desc: 'Analista de cartera: revisa vencidos de octubre', startedAt: hace(18) },
  ],
  updatedAt: new Date().toISOString(),
});
const LIBRE: () => Estado = () => ({ state: 'idle', label: null, tasks: [], updatedAt: new Date().toISOString() });

const filaConversacion = (page: Page, titulo: string) => page.getByTestId('proyecto-conversacion').filter({ hasText: titulo });

test.describe('Proyectos · estado en vivo del agente', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('escritorio: la conversación pasa a «Orus está trabajando…» por el pulso y vuelve a lo normal al terminar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page);
    await page.goto('/process/proyectos/4');
    const fila = filaConversacion(page, 'Conversación inicial');
    await expect(fila).toBeVisible();
    await expect(fila.getByText('Orus · Nicolás Rivera')).toBeVisible();
    await expect(fila.getByTestId('proyecto-conversacion-estado')).toHaveCount(0);
    // El pulso pide los estados en el MISMO long-poll (parámetro `st`): no hay sondeo nuevo.
    await expect.poll(() => api.pulsos().length).toBeGreaterThan(1);
    expect(api.pulsos().every((st) => st !== '')).toBe(true);

    api.cambiar(TRABAJANDO());
    const estado = fila.getByTestId('proyecto-conversacion-estado');
    await expect(estado).toBeVisible({ timeout: 10_000 });
    await expect(estado.getByText('Orus está trabajando…')).toBeVisible();
    await expect(estado.getByText('Consultando SAP…')).toBeVisible();
    await expect(estado.getByText('2 sub-agentes en curso')).toBeVisible();
    await expect(estado.getByText(/Analista de inventario/)).toBeVisible();
    await expect(estado.locator('svg').first()).toBeVisible(); // logo animado del chat
    await expect(fila).toHaveAttribute('data-trabajando', 'true');
    // La otra conversación sigue normal.
    await expect(filaConversacion(page, 'Cartera vencida').getByTestId('proyecto-conversacion-estado')).toHaveCount(0);
    // Un estado de OTRO proyecto no se pinta aquí.
    api.cambiar(TRABAJANDO(), 29, 7);
    await page.waitForTimeout(800);
    await expect(filaConversacion(page, 'Cartera vencida').getByTestId('proyecto-conversacion-estado')).toHaveCount(0);
    // El hilo abierto muestra su propio indicador (su sondeo de siempre): se espera a que coincida.
    await expect(page.getByTestId('proyecto-hilo').getByText('Consultando SAP…')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-conversaciones-trabajando.png` });

    api.cambiar(LIBRE());
    await expect(fila.getByTestId('proyecto-conversacion-estado')).toHaveCount(0, { timeout: 10_000 });
    await expect(fila).not.toHaveAttribute('data-trabajando', 'true');
    await expect(fila.getByText('Orus · Nicolás Rivera')).toBeVisible();
  });

  test('al cargar con el agente ya trabajando, se ve sin esperar al pulso', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simular(page, TRABAJANDO());
    await page.goto('/process/proyectos/4');
    await expect(filaConversacion(page, 'Conversación inicial').getByText('Orus está trabajando…')).toBeVisible();
  });

  test('lista de proyectos: la tarjeta dice quién está trabajando', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page);
    await page.goto('/process/proyectos');
    const tarjeta = page.getByTestId('proyecto-tarjeta').filter({ hasText: 'Farmalógica — Orus (piloto)' });
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.getByTestId('proyecto-tarjeta-estado')).toHaveCount(0);
    await expect.poll(() => api.pulsos().length).toBeGreaterThan(1);
    api.cambiar(TRABAJANDO());
    await expect(tarjeta.getByTestId('proyecto-tarjeta-estado')).toBeVisible({ timeout: 10_000 });
    await expect(tarjeta.getByText('Orus está trabajando…')).toBeVisible();
    await expect(tarjeta.getByText('Consultando SAP… · 2 subagentes en curso')).toBeVisible();
    await expect(page.getByTestId('proyecto-tarjeta').filter({ hasText: 'Comex Latam' }).getByTestId('proyecto-tarjeta-estado')).toHaveCount(0);
    await page.waitForTimeout(500);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-lista-proyectos-trabajando.png` });
    api.cambiar(LIBRE());
    await expect(tarjeta.getByTestId('proyecto-tarjeta-estado')).toHaveCount(0, { timeout: 10_000 });
  });

  test('icono de la cabecera: punto animado y «Trabajando ahora» en el panel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page);
    await page.goto('/process');
    const icono = page.getByTestId('header-proyectos');
    await expect(icono).toBeVisible();
    await expect.poll(() => api.pulsos().length).toBeGreaterThan(1);
    api.cambiar(TRABAJANDO());
    await expect(icono).toHaveAttribute('aria-label', 'Proyectos. Orus está trabajando', { timeout: 10_000 });
    await icono.click();
    const panel = page.getByTestId('proyectos-trabajando');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Trabajando ahora')).toBeVisible();
    await expect(panel.getByText('Farmalógica — Orus (piloto)')).toBeVisible();
    await expect(panel.getByText('Orus está trabajando…')).toBeVisible();
    await expect(panel.getByText('Consultando SAP… · 2 subagentes en curso')).toBeVisible();
    await page.waitForTimeout(500);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-panel-cabecera-trabajando.png` });
    await panel.getByRole('button', { name: /Abrir Conversación inicial en Farmalógica — Orus \(piloto\)/ }).click();
    await expect(page).toHaveURL(/\/process\/proyectos\/4\?conversacion=28$/);
  });

  test('celular: la lista de conversaciones y la de proyectos sin desbordar la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await simular(page);
    await page.goto('/process/proyectos/4');
    const fila = filaConversacion(page, 'Conversación inicial');
    await expect(fila).toBeVisible();
    await expect.poll(() => api.pulsos().length).toBeGreaterThan(1);
    api.cambiar(TRABAJANDO());
    await expect(fila.getByText('Orus está trabajando…')).toBeVisible({ timeout: 10_000 });
    await expect(fila.getByText(/Analista de inventario/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    const caja = await fila.boundingBox();
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(391);
    await page.waitForTimeout(500);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/celular-conversaciones-trabajando.png` });

    await page.goto('/process/proyectos');
    const tarjeta = page.getByTestId('proyecto-tarjeta').filter({ hasText: 'Farmalógica — Orus (piloto)' });
    await expect(tarjeta.getByText('Orus está trabajando…')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await page.waitForTimeout(500);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/celular-lista-proyectos-trabajando.png` });

    await page.getByTestId('header-proyectos').click();
    await expect(page.getByTestId('proyectos-trabajando')).toBeVisible();
    await page.waitForTimeout(500);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/celular-panel-cabecera-trabajando.png` });
  });
});

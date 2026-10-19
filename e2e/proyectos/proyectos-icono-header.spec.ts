import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Icono «Proyectos» en la cabecera (2026-10-19), con el mismo patrón del icono del Correo.
 *
 * - Sin sesión: /api/proyectos/no-leidos responde 401.
 * - Con sesión (JWT firmado con el NEXTAUTH_SECRET de la CI) y el API SIMULADO con `page.route`:
 *   con el permiso aparece con el contador; al tocarlo abre el panel con proyecto, conversación,
 *   asistente, autor, fragmento y hora; una fila lleva a ESA conversación; «Ver todos los proyectos»
 *   lleva al módulo. Sin el permiso (403) no aparece. El pulso del chat (simulado) avisa de un
 *   mensaje nuevo y el número sube sin recargar. En el celular el panel sale como hoja inferior.
 * - Con CAPTURAS_DIR deja las capturas de escritorio y celular (evidencia del PR).
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const CAPTURAS = process.env.CAPTURAS_DIR;

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', sub: 'u-nr', kronosUserId: 'u-nr', role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function items() {
  return [
    {
      idProject: 4,
      projectName: 'Farmalógica — Orus (piloto)',
      idConversation: 28,
      conversationTitle: 'Inventario de octubre',
      agent: { code: 'horus', displayName: 'Orus' },
      noLeidos: 2,
      ultimo: { idMessage: 910, autor: 'Orus', autorTipo: 'agente', fragmento: 'Listo: el inventario de bodega 01 cerró con 1.248 referencias y 3 diferencias por revisar.', createdAt: hace(4) },
    },
    {
      idProject: 7,
      projectName: 'Comex Latam',
      idConversation: 31,
      conversationTitle: 'Importaciones Venezuela',
      agent: { code: 'silvia', displayName: 'Play' },
      noLeidos: 1,
      ultimo: { idMessage: 905, autor: 'Angye Mancipe', autorTipo: 'persona', fragmento: '@Play ¿ya llegó la DIM del embarque de la semana pasada?', createdAt: hace(38) },
    },
    {
      idProject: 9,
      projectName: 'One Latam Pharma',
      idConversation: 40,
      conversationTitle: 'Compras nacionales',
      agent: { code: 'gilbert', displayName: 'Gilbert' },
      noLeidos: 5,
      ultimo: { idMessage: 870, autor: 'Diana Gómez', autorTipo: 'persona', fragmento: 'Comparto las tres cotizaciones del proveedor para revisarlas mañana.', createdAt: hace(60 * 26) },
    },
  ];
}

/** API simulado: `status` 200 (con permiso) o 403 (sin permiso). El pulso entrega un evento cuando se le pide. */
async function simular(page: Page, status: 200 | 403) {
  let llamadas = 0;
  let lista = items();
  let pulsoPendiente = false;
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', id: 'u-nr', role: 'user' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/correo/no-leidos', (r) => r.fulfill({ status: 403, json: { error: 'sin correo' } }));
  // El hub de Procesos de fondo, para que la captura se vea como la aplicación real.
  const cu = (id: number) => [{ id_subprocess_user_company: id, companyUser: { id_company_user: id, company: { id_company: 8, company: 'GROUP SHARED SERVICES' } } }];
  await page.route('**/api/processes', (r) =>
    r.fulfill({
      json: [
        { id_process: 1, process: 'Tecnología', subprocesses: [{ id_subprocess: 112, subprocess: 'Proyectos', subprocess_url: '/process/proyectos', subprocessUserCompanies: cu(1) }, { id_subprocess: 90, subprocess: 'Chat', subprocess_url: '/process/chat', subprocessUserCompanies: cu(2) }] },
        { id_process: 2, process: 'Gestión documental', subprocesses: [{ id_subprocess: 70, subprocess: 'SGC', subprocess_url: '/process/sgc', subprocessUserCompanies: cu(3) }] },
        { id_process: 3, process: 'Solicitudes', subprocesses: [{ id_subprocess: 10, subprocess: 'Solicitudes generales', subprocess_url: '/process/request-general', subprocessUserCompanies: cu(4) }] },
      ],
    })
  );
  await page.route('**/api/proyectos/no-leidos**', (r) => {
    llamadas++;
    if (status === 403) return r.fulfill({ status: 403, json: { error: 'No tiene habilitado el módulo Proyectos.' } });
    if (r.request().method() === 'POST') {
      lista = [];
      return r.fulfill({ json: { ok: true, conversaciones: 3 } });
    }
    const detalle = new URL(r.request().url()).searchParams.get('detalle') === '1';
    const cuerpo = { noLeidos: lista.length, mensajes: lista.reduce((n, i) => n + i.noLeidos, 0) };
    return r.fulfill({ json: detalle ? { ...cuerpo, items: lista } : cuerpo });
  });
  await page.route('**/api/chat/pulse**', async (r) => {
    const since = Number(new URL(r.request().url()).searchParams.get('since'));
    if (since === 0) return r.fulfill({ json: { cursor: 900, events: [] } });
    if (pulsoPendiente) {
      pulsoPendiente = false;
      return r.fulfill({ json: { cursor: 950, events: [{ type: 'project', idConversation: 50, idMessage: 950, authorName: 'Orus', createdAt: new Date().toISOString(), muted: false }] } });
    }
    await new Promise((res) => setTimeout(res, 400));
    return r.fulfill({ json: { cursor: since, events: [] } });
  });
  return {
    llamadas: () => llamadas,
    mensajeNuevo: () => {
      lista = [
        {
          idProject: 4,
          projectName: 'Farmalógica — Orus (piloto)',
          idConversation: 50,
          conversationTitle: 'Cartera vencida',
          agent: { code: 'horus', displayName: 'Orus' },
          noLeidos: 1,
          ultimo: { idMessage: 950, autor: 'Orus', autorTipo: 'agente', fragmento: 'Ya tengo el corte de cartera.', createdAt: new Date().toISOString() },
        },
        ...lista,
      ];
      pulsoPendiente = true;
    },
  };
}

const icono = (page: Page) => page.getByTestId('header-proyectos');

test.describe('Icono de Proyectos · sin sesión', () => {
  test('el API del contador responde 401', async ({ request }) => {
    expect((await request.get('/api/proyectos/no-leidos', { maxRedirects: 0 })).status()).toBe(401);
  });
});

test.describe('Icono de Proyectos · con sesión y API simulado', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('con el permiso: contador, panel con lo nuevo y una fila abre esa conversación', async ({ page }) => {
    await simular(page, 200);
    await page.goto('/process');
    await expect(icono(page)).toBeVisible();
    await expect(icono(page)).toHaveAttribute('aria-label', 'Proyectos: 3 conversaciones con mensajes nuevos');
    // Al lado de la campana, mismo tamaño.
    const campana = page.getByRole('button', { name: 'Notificaciones' }).first();
    const [a, b] = await Promise.all([icono(page).boundingBox(), campana.boundingBox()]);
    expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(2);

    await icono(page).click();
    const lista = page.getByTestId('proyectos-no-leidos');
    await expect(lista).toBeVisible();
    await expect(lista.getByText('Farmalógica — Orus (piloto)')).toBeVisible();
    await expect(lista.getByText('Inventario de octubre · Orus')).toBeVisible();
    await expect(lista.getByText(/el inventario de bodega 01/)).toBeVisible();
    await expect(lista.getByText('Angye Mancipe:')).toBeVisible();
    await expect(lista.getByText('Hace 4 min')).toBeVisible();
    await expect(page.getByText('Ver todos los proyectos')).toBeVisible();
    await page.waitForTimeout(400);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-panel.png` });

    await lista.getByRole('button', { name: /Abrir Importaciones Venezuela en Comex Latam/ }).click();
    await expect(page).toHaveURL(/\/process\/proyectos\/7\?conversacion=31$/);
    // Optimista: ya no cuenta esa conversación.
    await expect(icono(page)).toHaveAttribute('aria-label', 'Proyectos: 2 conversaciones con mensajes nuevos');
  });

  test('un mensaje nuevo en un proyecto sube el número sin recargar (pulso del chat)', async ({ page }) => {
    const api = await simular(page, 200);
    await page.goto('/process');
    await expect(icono(page)).toHaveAttribute('aria-label', 'Proyectos: 3 conversaciones con mensajes nuevos');
    if (CAPTURAS) await page.locator('header.app-header').screenshot({ path: `${CAPTURAS}/escritorio-cabecera.png` });
    api.mensajeNuevo();
    await expect(icono(page)).toHaveAttribute('aria-label', 'Proyectos: 4 conversaciones con mensajes nuevos', { timeout: 10_000 });
  });

  test('«Ver todos los proyectos» y «Marcar todo como leído»', async ({ page }) => {
    await simular(page, 200);
    await page.goto('/process');
    await icono(page).click();
    await page.getByTestId('proyectos-leer-todo').click();
    await expect(page.getByText('No tiene mensajes nuevos en sus proyectos')).toBeVisible();
    await expect(icono(page)).toHaveAttribute('aria-label', 'Proyectos');
    await page.getByText('Ver todos los proyectos').click();
    await expect(page).toHaveURL(/\/process\/proyectos$/);
  });

  test('sin el permiso (403): no aparece', async ({ page }) => {
    const api = await simular(page, 403);
    await page.goto('/process');
    await expect(page.getByRole('button', { name: 'Notificaciones' }).first()).toBeVisible();
    await expect.poll(() => api.llamadas()).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(icono(page)).toHaveCount(0);
  });

  test('celular: hoja inferior a todo lo ancho y sin desbordar la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page, 200);
    await page.goto('/process');
    await expect(icono(page)).toBeVisible();
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(390 + 1);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/celular-cabecera.png` });
    await icono(page).click();
    const lista = page.getByTestId('proyectos-no-leidos');
    await expect(lista).toBeVisible();
    const caja = await lista.boundingBox();
    expect(caja!.width).toBeGreaterThan(380);
    await page.waitForTimeout(400);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/celular-panel.png` });
  });

  test('modo oscuro: el panel usa las superficies del tema', async ({ page }) => {
    await simular(page, 200);
    await page.goto('/process');
    await page.getByRole('button', { name: /Activar modo oscuro/ }).first().click();
    await expect(page.getByRole('button', { name: /Activar modo claro/ }).first()).toBeVisible();
    await page.waitForTimeout(300);
    await icono(page).click();
    await expect(page.getByTestId('proyectos-no-leidos')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByTestId('proyectos-no-leidos')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-panel-oscuro.png` });
  });
});

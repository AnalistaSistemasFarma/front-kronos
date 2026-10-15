import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Icono del Correo en la cabecera, junto a la campana (2026-10-15).
 *
 * - Sin sesión: /api/correo/no-leidos responde 401.
 * - Con sesión (JWT firmado con el NEXTAUTH_SECRET de la CI) y el API del módulo
 *   SIMULADO con `page.route` (Microsoft Graph nunca se llama): con el permiso el
 *   icono aparece con el contador y abre /process/correo; sin el permiso (403) no
 *   aparece. También en el celular y en modo oscuro.
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'laura@gsslatam.com', name: 'Laura', sub: 'u-op', kronosUserId: 'u-op', role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

/** API del icono simulado: `status` 200 (con permiso) o 403 (sin permiso). */
async function simular(page: Page, status: 200 | 403, noLeidos: number | null = 5) {
  let llamadas = 0;
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-op', role: 'user' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/correo/no-leidos', (r) => {
    llamadas++;
    return status === 200
      ? r.fulfill({ json: { noLeidos } })
      : r.fulfill({ status: 403, json: { error: 'No tiene acceso al módulo Correo. Pídalo a TI.' } });
  });
  // La página del Correo (destino del clic) también simulada: nada llega a Graph.
  await page.route('**/api/correo', (r) =>
    r.fulfill({
      json: {
        usuario: { id: 'u-op', nombre: 'Laura', email: 'laura@gsslatam.com' },
        empresas: [{ idCompany: 1, companyName: 'GROUP SHARED SERVICES' }],
        empresaBuzon: 1,
        conexion: { modo: 'graph', disponible: true, correo: 'laura@gsslatam.com', envioHabilitado: true, etiquetarHabilitado: true, sincronizacionAutomatica: false },
      },
    })
  );
  await page.route('**/api/correo/carpetas', (r) => r.fulfill({ json: { carpetas: [] } }));
  await page.route('**/api/correo/mensajes**', (r) => r.fulfill({ json: { mensajes: [], siguiente: null } }));
  return { llamadas: () => llamadas };
}

const campana = (page: Page) => page.getByRole('button', { name: 'Notificaciones' }).first();

test.describe('Icono del Correo · sin sesión', () => {
  test('el API del contador responde 401', async ({ request }) => {
    expect((await request.get('/api/correo/no-leidos', { maxRedirects: 0 })).status()).toBe(401);
  });
});

test.describe('Icono del Correo · con sesión y Graph simulado', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('con el permiso: icono junto a la campana, con contador, tooltip y acceso por teclado', async ({ page }) => {
    const api = await simular(page, 200, 5);
    await page.goto('/process');
    const icono = page.getByTestId('header-correo');
    await expect(icono).toBeVisible();
    await expect(icono).toHaveAttribute('href', '/process/correo');
    await expect(icono).toHaveAttribute('aria-label', 'Correo: 5 sin leer');
    await expect(page.getByText('5', { exact: true }).first()).toBeVisible();
    // Al lado de la campana, mismo tamaño.
    await expect(campana(page)).toBeVisible();
    const [a, b] = await Promise.all([icono.boundingBox(), campana(page).boundingBox()]);
    expect(a && b).toBeTruthy();
    expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(2);
    expect(b!.x - (a!.x + a!.width)).toBeLessThan(40);
    await icono.hover();
    await expect(page.getByRole('tooltip', { name: 'Correo' })).toBeVisible();
    // Teclado: foco + Enter abre el módulo.
    await icono.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/process\/correo$/);
    // Caché: navegar no vuelve a consultar el contador.
    expect(api.llamadas()).toBe(1);
  });

  test('sin el permiso (403): no aparece', async ({ page }) => {
    const api = await simular(page, 403);
    await page.goto('/process');
    await expect(campana(page)).toBeVisible();
    await expect.poll(() => api.llamadas()).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('header-correo')).toHaveCount(0);
  });

  test('con permiso y sin contador: icono sin número', async ({ page }) => {
    await simular(page, 200, null);
    await page.goto('/process');
    await expect(page.getByTestId('header-correo')).toHaveAttribute('aria-label', 'Correo');
  });

  test('celular y modo oscuro: visible, sin desbordar la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page, 200, 120);
    await page.goto('/process');
    const icono = page.getByTestId('header-correo');
    await expect(icono).toBeVisible();
    await expect(page.getByText('99+', { exact: true }).first()).toBeVisible();
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(390 + 1);
    await page.getByRole('button', { name: /Activar modo (oscuro|claro)/ }).first().click();
    await expect(icono).toBeVisible();
  });
});

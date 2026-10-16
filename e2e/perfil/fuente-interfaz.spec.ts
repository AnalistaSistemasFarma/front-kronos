import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Perfil → «Fuente de la interfaz» (2026-10-16): la letra de SAPSEND.
 *
 * Con sesión (JWT firmado con el NEXTAUTH_SECRET de la CI) y /api/profile
 * SIMULADO con `page.route` (nada llega a la base):
 *   - escoger «Google Sans (SAPSEND)» cambia al instante, sin recargar, el
 *     `font-family` CALCULADO de toda la página (body, títulos de Mantine) y
 *     guarda la clave `sapsend` en el perfil (PUT uiFont);
 *   - la fuente web solo se descarga cuando se usa;
 *   - funciona en modo oscuro, en el celular y en el chat;
 *   - volver a «Predeterminada (SynerLink)» deja la de siempre.
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const USUARIO = { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-op', role: 'user' };

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: USUARIO.email, name: USUARIO.name, sub: USUARIO.id, kronosUserId: USUARIO.id, role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

/** Perfil simulado; devuelve las claves `uiFont` que la página fue guardando. */
async function simular(page: Page, inicial: { uiFont?: string; colorScheme?: 'light' | 'dark' } = {}) {
  const estado = { uiFont: inicial.uiFont ?? 'sistema', colorScheme: inicial.colorScheme ?? 'light' };
  const guardadas: string[] = [];
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: { ...USUARIO, uiFont: estado.uiFont, colorScheme: estado.colorScheme, themePalette: 'azul' }, expires: '2099-01-01T00:00:00Z' } }),
  );
  await page.route('**/api/profile', async (r) => {
    if (r.request().method() === 'PUT') {
      const cuerpo = r.request().postData() ?? '';
      const m = cuerpo.match(/name="uiFont"\r\n\r\n([^\r\n]*)/);
      if (m) {
        guardadas.push(m[1]);
        estado.uiFont = m[1];
      }
    }
    return r.fulfill({
      json: { user: { id: USUARIO.id, name: USUARIO.name, email: USUARIO.email, image: null, createdAt: '2026-01-01T00:00:00Z', themePalette: 'azul', colorScheme: estado.colorScheme, uiFont: estado.uiFont } },
    });
  });
  await page.route('**/api/profile/start-page', (r) => r.fulfill({ json: { available: false, options: [], current: null } }));
  return { guardadas };
}

const fuenteDe = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);

const opcion = (page: Page, etiqueta: string) => page.getByRole('button', { name: `Fuente ${etiqueta}` });

test.describe('Perfil · fuente de la interfaz', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('con la predeterminada no se descarga ninguna fuente web', async ({ page }) => {
    const fuentes: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'font' || /\.woff2?(\?|$)/.test(req.url())) fuentes.push(req.url());
    });
    await simular(page);
    await page.goto('/process');
    await page.waitForLoadState('load');
    await expect(page.locator('body')).toBeVisible();
    // El @font-face está declarado (para quien la escoja), pero nadie lo usa:
    // el navegador no lo descarga.
    await page.waitForTimeout(1500);
    expect(await fuenteDe(page, 'body')).not.toMatch(/google_?sans/i);
    const estados = await page.evaluate(() =>
      [...document.fonts].filter((f) => /google_?sans/i.test(f.family) && !/fallback/i.test(f.family)).map((f) => f.status),
    );
    expect(estados.every((e) => e === 'unloaded')).toBe(true);
    expect(fuentes).toEqual([]);
  });

  test('escoger SAPSEND cambia el font-family calculado al instante y lo guarda', async ({ page }) => {
    const api = await simular(page);
    await page.goto('/profile');
    const sapsend = opcion(page, 'Google Sans (SAPSEND)');
    await expect(sapsend).toBeVisible();
    await expect(page.getByText('Fuente de la interfaz')).toBeVisible();

    const antes = await fuenteDe(page, 'body');
    expect(antes).not.toMatch(/google_?sans/i);

    // La muestra de la opción ya se pinta con su propia fuente (vista previa).
    const muestra = sapsend.getByText('Solicitud #1234 — Aa Bb Cc 0123');
    expect(await muestra.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/google_?sans/i);

    await sapsend.click();
    await expect(sapsend).toHaveAttribute('aria-pressed', 'true');
    // Sin recargar: body y un título de Mantine heredan la nueva fuente.
    await expect.poll(() => fuenteDe(page, 'body')).toMatch(/google_?sans/i);
    expect(await fuenteDe(page, 'h1, h2, h3')).toMatch(/google_?sans/i);
    await expect(page.locator('html')).toHaveAttribute('data-font', 'sapsend');
    await expect.poll(() => api.guardadas).toContain('sapsend');

    // El archivo se descarga y queda en uso.
    const cargada = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some((f) => /google_?sans/i.test(f.family) && f.status === 'loaded');
    });
    expect(cargada).toBe(true);

    // Volver a la predeterminada.
    await opcion(page, 'Predeterminada (SynerLink)').click();
    await expect.poll(() => fuenteDe(page, 'body')).not.toMatch(/google_?sans/i);
    await expect.poll(() => api.guardadas.at(-1)).toBe('sistema');
  });

  test('desde el arranque se aplica en el chat, también en modo oscuro', async ({ page }) => {
    await simular(page, { uiFont: 'sapsend', colorScheme: 'dark' });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('theme-font', 'sapsend');
        localStorage.setItem('theme', 'dark');
      } catch {
        /* sin almacenamiento */
      }
    });
    await page.goto('/process/chat');
    // El script de arranque la aplica antes de pintar: ya está en el primer cálculo.
    await expect(page.locator('html')).toHaveAttribute('data-font', 'sapsend');
    await expect.poll(() => fuenteDe(page, 'body')).toMatch(/google_?sans/i);
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  });
});

test.describe('Perfil · fuente de la interfaz · celular', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('en pantalla de celular el selector se ve y aplica la fuente', async ({ page, context, baseURL }) => {
    await sesion(context, baseURL!);
    await simular(page);
    await page.goto('/profile');
    const sapsend = opcion(page, 'Google Sans (SAPSEND)');
    await sapsend.scrollIntoViewIfNeeded();
    await sapsend.tap();
    await expect.poll(() => fuenteDe(page, 'body')).toMatch(/google_?sans/i);
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(ancho).toBeLessThanOrEqual(1);
  });
});

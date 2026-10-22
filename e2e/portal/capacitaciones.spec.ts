import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · botón «CAPACITACIONES» (Cristian Baldión, 2026-10-22): espejo de «AYUDAS», justo debajo de él, que abre la
 * misma ventana de vista previa con los archivos de FORMACION/CAPACITACIONES.
 *
 * Sin sesión real ni SharePoint: las APIs del portal se simulan con `page.route`. Con `FORMACION_CAPTURAS=<carpeta>`
 * guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const EMBED = 'https://gsslatam.sharepoint.com/sites/TalentoHumano/_layouts/15/embed.aspx?e2e=1';

const archivos = [
  { id: 'C1', nombre: 'Inducción corporativa.mp4', tipo: 'mp4', mime: 'video/mp4', tamano: 15_728_640, modificado: '2026-10-22T13:00:00Z', carpeta: '' },
  { id: 'C2', nombre: 'Manual de seguridad.pdf', tipo: 'pdf', mime: 'application/pdf', tamano: 1_048_576, modificado: '2026-10-22T13:05:00Z', carpeta: '' },
].map((a) => ({ ...a, vistaPrevia: `/api/portal/capacitaciones/${a.id}/vista` }));

async function simular(page: Page, opciones: { vacia?: boolean } = {}) {
  await page.route('**/api/portal/content', (r) =>
    r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } })
  );
  await page.route('**/api/portal/capacitaciones', (r) =>
    r.fulfill({ json: { carpeta: 'FORMACION/CAPACITACIONES', truncado: false, archivos: opciones.vacia ? [] : archivos } })
  );
  await page.route('**/api/portal/capacitaciones/*/vista', (r) =>
    r.fulfill({ json: { url: `${EMBED}&id=${r.request().url().split('/').at(-2)}` } })
  );
  await page.route('**/api/portal/ayudas', (r) => r.fulfill({ json: { carpeta: 'FORMACION/AYUDAS', truncado: false, archivos: [] } }));
  await page.route('https://gsslatam.sharepoint.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html><body><h1 id="video">Vista previa de SharePoint</h1></body></html>' })
  );
}

const panel = (page: Page) => page.getByRole('navigation', { name: 'Secciones del portal' });

test.describe('Portal TH · CAPACITACIONES', () => {
  test('la API exige sesión', async ({ request }) => {
    expect((await request.get('/api/portal/capacitaciones')).status()).toBe(401);
    expect((await request.get('/api/portal/capacitaciones/C1/vista')).status()).toBe(401);
  });

  test('el botón CAPACITACIONES queda justo DEBAJO de AYUDAS en el panel', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await expect(panel(page).getByRole('button', { name: 'Capacitaciones' })).toBeVisible();
    const nombres = await panel(page).getByRole('button').allInnerTexts();
    const i = nombres.findIndex((n) => /^ayudas$/i.test(n.trim()));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(nombres[i + 1]).toMatch(/capacitaciones/i);
    const ayudas = (await panel(page).getByRole('button', { name: 'Ayudas' }).boundingBox())!;
    const capacitaciones = (await panel(page).getByRole('button', { name: 'Capacitaciones' }).boundingBox())!;
    expect(capacitaciones.y).toBeGreaterThan(ayudas.y + ayudas.height - 1);
    expect(Math.abs(capacitaciones.x - ayudas.x)).toBeLessThan(2); // misma columna
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/96-capacitaciones-boton.png` });
  });

  test('escritorio: abre SU ventana (no la de Ayudas), muestra la vista previa y se cierra con Escape', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Capacitaciones' }).click();

    const visor = page.getByTestId('capacitaciones-visor');
    await expect(visor).toBeVisible();
    await expect(page.getByTestId('ayudas-visor')).toHaveCount(0);
    await expect(visor.getByText('Elija una capacitación de la lista para verla aquí.')).toBeVisible();
    await expect(visor.getByRole('button', { name: /Inducción corporativa/ })).toBeVisible();
    await expect(visor.getByRole('button', { name: /Manual de seguridad/ })).toBeVisible();

    await visor.getByRole('button', { name: /Inducción corporativa/ }).click();
    await expect(visor.locator('iframe')).toHaveAttribute('src', /embed\.aspx\?e2e=1&id=C1/);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/97-capacitaciones-ventana.png` });

    await page.keyboard.press('Escape');
    await expect(visor).toBeHidden();
  });

  test('carpeta vacía se avisa en la ventana', async ({ page }) => {
    await simular(page, { vacia: true });
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Capacitaciones' }).click();
    await expect(page.getByTestId('capacitaciones-visor').getByText('Todavía no hay capacitaciones publicadas.')).toBeVisible();
  });

  test('celular: la ventana cabe sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Capacitaciones' }).click();
    const visor = page.getByTestId('capacitaciones-visor');
    await expect(visor).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await visor.getByRole('button', { name: /Inducción corporativa/ }).click();
    await expect(visor.locator('iframe')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/98-capacitaciones-celular.png` });
  });
});

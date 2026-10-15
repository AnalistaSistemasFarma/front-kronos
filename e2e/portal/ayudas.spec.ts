import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · botón «AYUDAS» (Cristian Baldión, 2026-10-15): debajo de CONTACTOS, abre una ventana de vista previa
 * (la misma de «Políticas y reglamentos») con los videos de FORMACION/AYUDAS.
 *
 * Sin sesión real ni SharePoint: las APIs del portal se simulan con `page.route` y la vista previa de SharePoint con una
 * página mínima. Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const EMBED = 'https://gsslatam.sharepoint.com/sites/TalentoHumano/_layouts/15/embed.aspx?e2e=1';

const videos = [
  { id: 'V1', nombre: 'Capacitaciones Centro de servicios - Cambio de contraseña.mp4', tipo: 'mp4', mime: 'video/mp4', tamano: 15_728_640, modificado: '2026-10-14T20:00:00Z', carpeta: '' },
  { id: 'V2', nombre: 'Capacitaciones Centro de Servicios - Como crear una solicitud.mp4', tipo: 'mp4', mime: 'video/mp4', tamano: 14_680_064, modificado: '2026-10-14T20:05:00Z', carpeta: '' },
].map((a) => ({ ...a, vistaPrevia: `/api/portal/ayudas/${a.id}/vista` }));

async function simular(page: Page, opciones: { listaFalla?: boolean; vacia?: boolean } = {}) {
  await page.route('**/api/portal/content', (r) =>
    r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } })
  );
  await page.route('**/api/portal/ayudas', (r) =>
    opciones.listaFalla
      ? r.fulfill({ status: 502, json: { error: 'No se encontró la carpeta de ayudas en SharePoint. Avise a Tecnología.' } })
      : r.fulfill({ json: { carpeta: 'FORMACION/AYUDAS', truncado: false, archivos: opciones.vacia ? [] : videos } })
  );
  await page.route('**/api/portal/ayudas/*/vista', (r) =>
    r.request().url().includes('/V2/')
      ? r.fulfill({ status: 502, json: { error: 'No se pudo preparar la vista previa del documento. Intente en un momento.' } })
      : r.fulfill({ json: { url: `${EMBED}&id=${r.request().url().split('/').at(-2)}` } })
  );
  await page.route('**/api/portal/politicas', (r) => r.fulfill({ json: { carpeta: 'POLITICAS Y REGLAMENTOS', truncado: false, archivos: [] } }));
  await page.route('https://gsslatam.sharepoint.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html><body><h1 id="video">Reproductor de SharePoint</h1></body></html>' })
  );
}

const panel = (page: Page) => page.getByRole('navigation', { name: 'Secciones del portal' });

test.describe('Portal TH · AYUDAS', () => {
  test('la API exige sesión', async ({ request }) => {
    expect((await request.get('/api/portal/ayudas')).status()).toBe(401);
    expect((await request.get('/api/portal/ayudas/V1/vista')).status()).toBe(401);
  });

  test('el botón AYUDAS queda justo DEBAJO de CONTACTOS en el panel', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    const nombres = await panel(page).getByRole('button').allInnerTexts();
    const i = nombres.findIndex((n) => /contactos/i.test(n));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(nombres[i + 1]).toMatch(/ayudas/i);
    const contactos = (await panel(page).getByRole('button', { name: 'Contactos' }).boundingBox())!;
    const ayudas = (await panel(page).getByRole('button', { name: 'Ayudas' }).boundingBox())!;
    expect(ayudas.y).toBeGreaterThan(contactos.y + contactos.height - 1);
    expect(Math.abs(ayudas.x - contactos.x)).toBeLessThan(2); // misma columna
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/90-ayudas-boton.png` });
  });

  test('escritorio: abre la ventana con los videos, muestra la vista previa y se cierra con Escape', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Ayudas' }).click();

    const visor = page.getByTestId('ayudas-visor');
    await expect(visor).toBeVisible();
    await expect(visor.getByText('Ayudas', { exact: true }).first()).toBeVisible();
    await expect(visor.getByText('Elija un video de la lista para verlo aquí.')).toBeVisible();
    await expect(visor.getByRole('button', { name: /Cambio de contraseña/ })).toBeVisible();
    await expect(visor.getByRole('button', { name: /Como crear una solicitud/ })).toBeVisible();
    await expect(visor.getByText('MP4').first()).toBeVisible();
    // No es la ventana de políticas.
    await expect(page.getByTestId('politicas-visor')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/91-ayudas-ventana.png` });

    await visor.getByRole('button', { name: /Cambio de contraseña/ }).click();
    await expect(visor.locator('iframe')).toHaveAttribute('src', /embed\.aspx\?e2e=1&id=V1/);
    await expect(page.frameLocator('[data-testid="ayudas-visor"] iframe').locator('#video')).toHaveText('Reproductor de SharePoint');
    await expect(visor.getByRole('link', { name: 'Abrir aparte' })).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/92-ayudas-video.png` });

    // Un error al preparar un video se ve y se puede reintentar; los demás videos siguen disponibles.
    await visor.getByRole('button', { name: /Como crear una solicitud/ }).click();
    await expect(visor.getByRole('alert')).toContainText('No se pudo preparar la vista previa del documento.');
    await expect(visor.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/93-ayudas-error-video.png` });

    await page.keyboard.press('Escape');
    await expect(visor).toBeHidden();
  });

  test('carpeta vacía y carpeta no encontrada se avisan en la ventana', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { vacia: true });
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Ayudas' }).click();
    await expect(page.getByTestId('ayudas-visor').getByText('Todavía no hay videos de ayuda.')).toBeVisible();

    const otra = await page.context().newPage();
    await simular(otra, { listaFalla: true });
    await otra.goto('/portal');
    await panel(otra).getByRole('button', { name: 'Ayudas' }).click();
    await expect(otra.getByTestId('ayudas-visor').getByRole('alert')).toContainText('No se encontró la carpeta de ayudas en SharePoint. Avise a Tecnología.');
    await expect(otra.getByTestId('ayudas-visor').getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });

  test('«Políticas y reglamentos» sigue abriendo su propia ventana, sin mezclarse con Ayudas', async ({ page }) => {
    await simular(page);
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Políticas y reglamentos' }).click();
    await expect(page.getByTestId('politicas-visor')).toBeVisible();
    await expect(page.getByTestId('ayudas-visor')).toHaveCount(0);
  });

  test('celular: la lista ocupa la ventana; al elegir un video se ve la vista previa y «← Documentos» vuelve', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Ayudas' }).click();
    const visor = page.getByTestId('ayudas-visor');
    await expect(visor).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/94-ayudas-celular-lista.png` });
    await visor.getByRole('button', { name: /Cambio de contraseña/ }).click();
    await expect(visor.locator('iframe')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/95-ayudas-celular-video.png` });
    await visor.getByRole('button', { name: '← Documentos' }).click();
    await expect(visor.getByRole('button', { name: /Como crear una solicitud/ })).toBeVisible();
  });
});

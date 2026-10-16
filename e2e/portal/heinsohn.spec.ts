import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · botón «HEINSOHN NÓMINA» (Cristian Baldión, 2026-10-15): en el panel, una ventana con un botón por empresa que abre su
 * enlace en una pestaña nueva. Sin sesión real ni SharePoint: las APIs se simulan con `page.route`. Con `FORMACION_CAPTURAS=<carpeta>`
 * guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const EMPRESAS = [
  { nombre: 'LABORATORIO RYAN DE COLOMBIA S.A.S', url: 'https://portal.heinsohn.com.co/?domain=ryanlab.com' },
  { nombre: 'ONE LATAM PHARMA SAS', url: 'https://portal.heinsohn.com.co/?domain=olp.com' },
  { nombre: 'GROUP SHARED SERVICES SAS', url: 'https://portal.heinsohn.com.co/?domain=gss.com' },
  { nombre: 'ABAMIA LABS SAS', url: 'https://portal.heinsohn.com.co/?domain=abamialabs.com' },
  { nombre: 'KELAB ANALÍTICA SAS', url: 'https://portal.heinsohn.com.co/?domain=kelabanalitica.com' },
  { nombre: 'MEDITRACK SAS', url: 'https://portal.heinsohn.com.co/?domain=meditrack.com' },
  { nombre: 'FARMALOGICA SA', url: 'https://portal.heinsohn.com.co/?domain=farmalogica.com.co' },
];

async function simular(page: Page, opciones: { falla?: boolean; vacia?: boolean; omitidas?: string[] } = {}) {
  await page.route('**/api/portal/content', (r) =>
    r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } })
  );
  await page.route('**/api/portal/heinsohn', (r) =>
    opciones.falla
      ? r.fulfill({ status: 502, json: { error: 'No se encontró el Excel de nómina en SharePoint. Avise a Tecnología.' } })
      : r.fulfill({ json: { empresas: opciones.vacia ? [] : EMPRESAS, omitidas: opciones.omitidas ?? [] } })
  );
}

const panel = (page: Page) => page.getByRole('navigation', { name: 'Secciones del portal' });

test.describe('Portal TH · HEINSOHN NÓMINA', () => {
  test('la API exige sesión', async ({ request }) => {
    expect((await request.get('/api/portal/heinsohn')).status()).toBe(401);
  });

  test('el botón queda en el panel izquierdo, debajo de CONTACTOS, con el mismo estilo', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await expect(panel(page).getByRole('button', { name: 'Heinsohn Nómina' })).toBeVisible();
    const nombres = await panel(page).getByRole('button').allInnerTexts();
    expect(nombres.findIndex((n) => /heinsohn/i.test(n))).toBeGreaterThan(nombres.findIndex((n) => /contactos/i.test(n)));
    const contactos = (await panel(page).getByRole('button', { name: 'Contactos' }).boundingBox())!;
    const heinsohn = (await panel(page).getByRole('button', { name: 'Heinsohn Nómina' }).boundingBox())!;
    expect(heinsohn.y).toBeGreaterThan(contactos.y + contactos.height - 1);
    expect(Math.abs(heinsohn.x - contactos.x)).toBeLessThan(2); // misma columna, a la izquierda
    expect(heinsohn.x).toBeLessThan(400);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/110-heinsohn-boton.png` });
  });

  test('abre la ventana con un botón por empresa; cada uno apunta a su enlace en pestaña nueva y sin opener', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Heinsohn Nómina' }).click();
    const ventana = page.getByTestId('heinsohn-ventana');
    await expect(ventana).toBeVisible();
    await expect(ventana.getByTestId('heinsohn-empresa')).toHaveCount(7);
    for (const e of EMPRESAS) {
      const enlace = ventana.getByRole('link', { name: e.nombre });
      await expect(enlace).toHaveAttribute('href', e.url);
      await expect(enlace).toHaveAttribute('target', '_blank');
      await expect(enlace).toHaveAttribute('rel', /noopener/);
      await expect(enlace).toHaveAttribute('rel', /noreferrer/);
    }
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/111-heinsohn-ventana.png` });
    // Pulsar una empresa abre una pestaña nueva con SU enlace (la navegación externa se intercepta).
    await page.route('https://portal.heinsohn.com.co/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Heinsohn</h1>' }));
    const [nueva] = await Promise.all([page.context().waitForEvent('page'), ventana.getByRole('link', { name: 'GROUP SHARED SERVICES SAS' }).click()]);
    await nueva.waitForLoadState('domcontentloaded');
    expect(nueva.url()).toBe('https://portal.heinsohn.com.co/?domain=gss.com');
    await nueva.close();
    // El portal sigue abierto y la ventana también.
    await expect(ventana).toBeVisible();
  });

  test('se cierra con Escape, con ✕ y haciendo clic afuera', async ({ page }) => {
    await simular(page);
    await page.goto('/portal');
    const abrir = () => panel(page).getByRole('button', { name: 'Heinsohn Nómina' }).click();
    const ventana = page.getByTestId('heinsohn-ventana');
    await abrir();
    await page.keyboard.press('Escape');
    await expect(ventana).toBeHidden();
    await abrir();
    await ventana.getByRole('button', { name: 'Cerrar' }).click();
    await expect(ventana).toBeHidden();
    await abrir();
    await page.mouse.click(5, 5);
    await expect(ventana).toBeHidden();
  });

  test('un error de carga sale arriba en rojo con «Reintentar»; vacía y con enlaces inválidos también avisan', async ({ page }) => {
    await simular(page, { falla: true });
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Heinsohn Nómina' }).click();
    const ventana = page.getByTestId('heinsohn-ventana');
    await expect(ventana.getByTestId('heinsohn-error')).toContainText('No se encontró el Excel de nómina en SharePoint. Avise a Tecnología.');
    await expect(ventana.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/112-heinsohn-error.png` });

    const otra = await page.context().newPage();
    await simular(otra, { vacia: true });
    await otra.goto('/portal');
    await otra.getByRole('navigation', { name: 'Secciones del portal' }).getByRole('button', { name: 'Heinsohn Nómina' }).click();
    await expect(otra.getByTestId('heinsohn-ventana').getByText('Todavía no hay empresas con enlace de acceso.')).toBeVisible();

    const tercera = await page.context().newPage();
    await simular(tercera, { omitidas: ['NUEVA EMPRESA SAS'] });
    await tercera.goto('/portal');
    await tercera.getByRole('navigation', { name: 'Secciones del portal' }).getByRole('button', { name: 'Heinsohn Nómina' }).click();
    await expect(tercera.getByTestId('heinsohn-omitidas')).toContainText('Una empresa no se muestra porque su enlace no es válido: NUEVA EMPRESA SAS. Avise a Talento Humano.');
    await expect(tercera.getByTestId('heinsohn-empresa')).toHaveCount(7);
  });

  test('celular: la ventana cabe en la pantalla y los botones se leen completos', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/portal');
    await panel(page).getByRole('button', { name: 'Heinsohn Nómina' }).click();
    await expect(page.getByTestId('heinsohn-ventana').getByTestId('heinsohn-empresa')).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/113-heinsohn-celular.png` });
  });
});

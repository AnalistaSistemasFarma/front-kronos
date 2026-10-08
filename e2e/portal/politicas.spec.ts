import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · Políticas y reglamentos · botón "VISUALIZAR" (Cristian, 2026-10-08).
 *
 * Sin sesión real ni SharePoint: las APIs del portal se simulan con
 * `page.route` y la vista previa de SharePoint con una página mínima. Lo que
 * se prueba es la ventana: lista, vista previa embebida, estados de carga y
 * error, y el ida y vuelta en celular. Además, que la API real exija sesión.
 */

const EMBED = 'https://gsslatam.sharepoint.com/sites/TalentoHumano/_layouts/15/embed.aspx?e2e=1';

const archivos = [
  { id: 'A1', nombre: 'Politica Desconexion Laboral.pdf', tipo: 'pdf', mime: 'application/pdf', tamano: 263241, modificado: '2026-09-09T16:59:21Z', carpeta: '' },
  { id: 'A2', nombre: 'Reglamento Interno de Trabajo.pdf', tipo: 'pdf', mime: 'application/pdf', tamano: 3131311, modificado: '2026-09-09T16:58:11Z', carpeta: '' },
  { id: 'A3', nombre: 'Formato de permisos.docx', tipo: 'docx', mime: null, tamano: 20480, modificado: null, carpeta: 'Formatos' },
].map((a) => ({ ...a, vistaPrevia: `/api/portal/politicas/${a.id}/vista` }));

async function simular(page: Page, opciones: { listaFalla?: boolean; vacia?: boolean } = {}) {
  await page.route('**/api/portal/content', (r) =>
    r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } })
  );
  await page.route('**/api/portal/politicas', (r) =>
    opciones.listaFalla
      ? r.fulfill({ status: 502, json: { error: 'El portal no tiene permiso para leer la carpeta de políticas en SharePoint. Avise a Tecnología.' } })
      : r.fulfill({ json: { carpeta: 'POLITICAS Y REGLAMENTOS', truncado: false, archivos: opciones.vacia ? [] : archivos } })
  );
  await page.route('**/api/portal/politicas/*/vista', (r) =>
    r.request().url().includes('/A3/')
      ? r.fulfill({ status: 502, json: { error: 'No se pudo preparar la vista previa del documento. Intente en un momento.' } })
      : r.fulfill({ json: { url: `${EMBED}&id=${r.request().url().split('/').at(-2)}` } })
  );
  await page.route('https://gsslatam.sharepoint.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html><body><h1 id="doc">Vista previa SharePoint</h1></body></html>' })
  );
}

test.describe('Portal TH · Políticas y reglamentos · VISUALIZAR', () => {
  test('la API exige sesión', async ({ request }) => {
    expect((await request.get('/api/portal/politicas')).status()).toBe(401);
    expect((await request.get('/api/portal/politicas/A1/vista')).status()).toBe(401);
  });

  test('escritorio: lista, vista previa embebida, error visible y cierre', async ({ page }) => {
    await simular(page);
    await page.goto('/portal');
    await page.getByRole('button', { name: 'VISUALIZAR' }).click();

    const visor = page.getByTestId('politicas-visor');
    await expect(visor).toBeVisible();
    await expect(visor.getByText('Elija un documento de la lista para verlo aquí.')).toBeVisible();
    await expect(visor.getByRole('button', { name: /Reglamento Interno de Trabajo/ })).toBeVisible();
    await expect(visor.getByText('Formatos')).toBeVisible();

    await visor.getByRole('button', { name: /Reglamento Interno de Trabajo/ }).click();
    const marco = visor.locator('iframe');
    await expect(marco).toHaveAttribute('src', /embed\.aspx\?e2e=1&id=A2/);
    await expect(page.frameLocator('[data-testid="politicas-visor"] iframe').locator('#doc')).toHaveText('Vista previa SharePoint');
    await expect(visor.getByRole('link', { name: 'Abrir aparte' })).toBeVisible();

    await visor.getByRole('button', { name: /Formato de permisos/ }).click();
    await expect(visor.getByRole('alert')).toContainText('No se pudo preparar la vista previa');

    await page.keyboard.press('Escape');
    await expect(visor).toBeHidden();
  });

  test('error al listar y carpeta vacía se ven en la ventana', async ({ page }) => {
    await simular(page, { listaFalla: true });
    await page.goto('/portal');
    await page.getByRole('button', { name: 'VISUALIZAR' }).click();
    await expect(page.getByTestId('politicas-visor').getByRole('alert')).toContainText('no tiene permiso');

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await simular(page, { vacia: true });
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByText('La carpeta de políticas y reglamentos está vacía por ahora.')).toBeVisible();
  });

  test('celular: lista primero, vista previa a pantalla y volver', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/portal');
    await page.getByRole('button', { name: 'VISUALIZAR' }).click();
    const visor = page.getByTestId('politicas-visor');
    await visor.getByRole('button', { name: /Politica Desconexion Laboral/ }).click();
    await expect(visor.locator('iframe')).toBeVisible();
    await expect(visor.getByRole('navigation')).toBeHidden();
    const caja = await visor.boundingBox();
    expect(caja?.width ?? 0).toBeLessThanOrEqual(390);
    await visor.getByRole('button', { name: '← Documentos' }).click();
    await expect(visor.getByRole('navigation')).toBeVisible();
    await expect(visor.locator('iframe')).toHaveCount(0);
  });
});

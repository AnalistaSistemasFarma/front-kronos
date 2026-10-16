import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · CUMPLEAÑOS en el calendario (Cristian Baldión, 2026-10-15): el día de cada cumpleaños aparece el evento «CUMPLEAÑOS»
 * (fecha importante) y, debajo, el nombre, la empresa contratante y el área de cada persona. Sin sesión real ni SharePoint: las APIs
 * se simulan con `page.route`; las personas son INVENTADAS. Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
// El calendario abre en el mes actual: los cumpleaños se piden para el mes que se ve y se ubican por día.
const hoy = new Date();
const año = hoy.getFullYear();
const mes = String(hoy.getMonth() + 1).padStart(2, '0');
const DIA = `${año}-${mes}-10`;
const OTRO = `${año}-${mes}-20`;

const PERSONAS = {
  [DIA]: [
    { nombre: 'ACOSTA RUIZ LUIS FERNANDO', empresa: 'GROUP SHARED SERVICES SAS', area: 'CONTABILIDAD' },
    { nombre: 'PEREZ GOMEZ ANA MARIA', empresa: 'LABORATORIO RYAN DE COLOMBIA S.A.S', area: 'CONTROL DE CALIDAD' },
  ],
  [OTRO]: [{ nombre: 'MORA PINTO JUAN', empresa: 'ABAMIA LABS SAS', area: 'COMERCIAL' }],
};

async function simular(page: Page, opciones: { falla?: boolean } = {}) {
  await page.route('**/api/portal/content', (r) =>
    r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } })
  );
  await page.route('**/api/portal/eventos?**', (r) => r.fulfill({ json: { eventos: [], puedeEditar: false } }));
  await page.route('**/api/portal/cumpleanos?**', (r) => {
    if (opciones.falla) return r.fulfill({ status: 502, json: { error: 'No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.' } });
    const url = new URL(r.request().url());
    const desde = url.searchParams.get('desde')!;
    const hasta = url.searchParams.get('hasta')!;
    const dias = Object.entries(PERSONAS).filter(([f]) => f >= desde && f <= hasta).map(([fecha, personas]) => ({ fecha, personas }));
    return r.fulfill({ json: { cumpleanos: dias } });
  });
}

const calendario = (page: Page) => page.getByTestId('portal-calendario');

test.describe('Portal TH · Cumpleaños en el calendario', () => {
  test('la API exige sesión', async ({ request }) => {
    expect((await request.get(`/api/portal/cumpleanos?desde=${DIA}&hasta=${DIA}`)).status()).toBe(401);
  });

  test('el día del cumpleaños sale marcado y, al elegirlo, «CUMPLEAÑOS» con nombre, empresa y área de cada persona', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    const celda = calendario(page).locator(`[data-fecha="${DIA}"]`);
    await expect(celda.locator('.portal-th__cal-punto--conmemoracion')).toHaveCount(1); // fecha importante (punto verde)
    await expect(celda).toHaveAttribute('aria-label', /1 evento/);
    await celda.click();

    const eventos = page.getByTestId('calendario-eventos');
    const item = eventos.getByTestId('evento-item').filter({ hasText: 'CUMPLEAÑOS' });
    await expect(item).toHaveCount(1);
    await expect(item.locator('strong').first()).toHaveText('CUMPLEAÑOS');
    await expect(item).toContainText('Fecha importante');
    const personas = item.getByTestId('cumple-persona');
    await expect(personas).toHaveCount(2);
    // ordenadas por nombre, con empresa contratante y área debajo del nombre
    await expect(personas.nth(0)).toContainText('ACOSTA RUIZ LUIS FERNANDO');
    await expect(personas.nth(0)).toContainText('GROUP SHARED SERVICES SAS · CONTABILIDAD');
    await expect(personas.nth(1)).toContainText('PEREZ GOMEZ ANA MARIA');
    await expect(personas.nth(1)).toContainText('LABORATORIO RYAN DE COLOMBIA S.A.S · CONTROL DE CALIDAD');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/120-cumpleanos-dia.png` });
  });

  test('cada día muestra solo SUS cumpleaños; un día sin cumpleaños no muestra el evento', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await calendario(page).locator(`[data-fecha="${OTRO}"]`).click();
    const eventos = page.getByTestId('calendario-eventos');
    await expect(eventos.getByTestId('cumple-persona')).toHaveCount(1);
    await expect(eventos).toContainText('MORA PINTO JUAN');
    await expect(eventos).not.toContainText('ACOSTA RUIZ');
    // un día cualquiera sin cumpleaños
    await calendario(page).locator(`[data-fecha="${año}-${mes}-12"]`).click();
    await expect(eventos.getByText('CUMPLEAÑOS')).toHaveCount(0);
  });

  test('al cambiar de mes se piden los cumpleaños de ese mes', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const pedidos: string[] = [];
    await simular(page);
    page.on('request', (r) => {
      if (r.url().includes('/api/portal/cumpleanos?')) pedidos.push(new URL(r.url()).searchParams.get('desde')!);
    });
    await page.goto('/portal');
    await expect(calendario(page).locator(`[data-fecha="${DIA}"] .portal-th__cal-punto--conmemoracion`)).toHaveCount(1);
    await page.getByTestId('mes-siguiente').click();
    await expect.poll(() => pedidos.length).toBeGreaterThan(1);
    expect(new Set(pedidos).size).toBeGreaterThan(1);
  });

  test('si BASE PERSONAL no se puede leer, el aviso rojo va arriba del recuadro y el calendario sigue funcionando', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { falla: true });
    await page.goto('/portal');
    const eventos = page.getByTestId('calendario-eventos');
    await expect(eventos.getByRole('alert')).toContainText('No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.');
    await expect(calendario(page).locator(`[data-fecha="${DIA}"]`)).toBeVisible();
    await expect(eventos.getByTestId('eventos-titulo')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/121-cumpleanos-error.png` });
  });

  test('celular: la lista de personas cabe en la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/portal');
    await page.getByTestId('calendario-alternar').click();
    await calendario(page).locator(`[data-fecha="${DIA}"]`).click();
    await expect(page.getByTestId('cumple-persona')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/122-cumpleanos-celular.png` });
  });
});

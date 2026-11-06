import { expect, test, type Page } from '@playwright/test';
import reporte from '../../lib/portal/formularios/sst-reporte-actos-condiciones.json';
import salud from '../../lib/portal/formularios/sst-condiciones-salud-osteomuscular.json';

/**
 * Portal TH · «LINKS PARA DILIGENCIAR EN CASO DE SER REQUERIDO» (Cristian Baldión, 2026-10-20), etapa 4: bajo la tarjeta «Formación» de la
 * página principal, el título con el estilo de «Políticas y reglamentos» y dos botones (B1 y B2) que abren los formularios SST. Sin sesión
 * real ni SharePoint: las APIs se simulan con `page.route`; las definiciones de los formularios son las REALES. Con
 * `FORMACION_CAPTURAS=<carpeta>` guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const TITULO = 'LINKS PARA DILIGENCIAR EN CASO DE SER REQUERIDO';
const B1 = 'REPORTE DE ACTOS Y CONDICIONES INSEGURAS SST';
const B2 = 'CONDICIONES DE SALUD Y SINTOMATOLOGÍA OSTEOMUSCULAR';
const DEFINICIONES: Record<string, unknown> = { 'SST-REPORTE-ACTOS': reporte, 'SST-SALUD-OSTEOMUSCULAR': salud };

async function simular(page: Page, o: { puedeVer?: boolean; listaFalla?: boolean } = {}) {
  await page.route('**/api/portal/content', (r) => r.fulfill({ json: { email: 'laura.gomez@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } }));
  await page.route('**/api/portal/eventos?**', (r) => r.fulfill({ json: { eventos: [], puedeEditar: false } }));
  await page.route('**/api/portal/cumpleanos?**', (r) => r.fulfill({ json: { cumpleanos: [] } }));
  await page.route('**/api/portal/formularios-sst', (r) =>
    o.listaFalla ? r.fulfill({ status: 502, json: { error: 'x' } }) : r.fulfill({ json: { formularios: [], puedeVerRespuestas: o.puedeVer === true } })
  );
  await page.route(/\/api\/portal\/formularios-sst\/[A-Z-]+$/, (r) => {
    const codigo = new URL(r.request().url()).pathname.split('/').pop()!;
    return r.fulfill({
      json: { material: { id: 0, titulo: codigo }, formulario: { versionId: 1, version: 1, definicion: DEFINICIONES[codigo] }, prellenado: { correo: 'laura.gomez@gsslatam.com', nombre: 'Laura Gómez' }, enviadaEl: null },
    });
  });
}

const seccion = (page: Page) => page.getByTestId('links-diligenciar');

test.describe('Portal TH · links para diligenciar (etapa 4)', () => {
  test('el título y los dos botones salen DEBAJO de la tarjeta «Formación» y de «Políticas y reglamentos», con el texto pedido', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await expect(seccion(page).getByRole('heading', { name: TITULO, level: 2 })).toBeVisible();
    await expect(seccion(page).getByRole('button')).toHaveText([B1, B2]);

    const formacion = (await page.locator('.portal-th__acceso-formacion').boundingBox())!;
    const politicas = (await page.getByRole('heading', { name: /Políticas y reglamentos/i }).boundingBox())!;
    const titulo = (await seccion(page).getByRole('heading').boundingBox())!;
    expect(titulo.y).toBeGreaterThan(formacion.y + formacion.height - 1);
    expect(titulo.y).toBeGreaterThan(politicas.y);
    // el título tiene el MISMO estilo que «Políticas y reglamentos»
    const estilo = (loc: ReturnType<Page['getByRole']>) => loc.evaluate((e) => { const c = getComputedStyle(e); return [c.color, c.fontSize, c.fontWeight, c.textTransform, c.fontFamily].join('|'); });
    expect(await estilo(seccion(page).getByRole('heading'))).toBe(await estilo(page.getByRole('heading', { name: /Políticas y reglamentos/i })));
    // y los botones quedan debajo del título, uno al lado del otro y del mismo ancho
    const botonesSeccion = seccion(page).getByRole('button');
    const b1 = (await botonesSeccion.nth(0).boundingBox())!;
    const b2 = (await botonesSeccion.nth(1).boundingBox())!;
    expect(b1.y).toBeGreaterThan(titulo.y + titulo.height - 1);
    expect(Math.abs(b1.y - b2.y)).toBeLessThan(2);
    expect(b2.x).toBeGreaterThan(b1.x + b1.width - 1);
    expect(Math.abs(b1.width - b2.width)).toBeLessThan(2);
    // el pie sigue debajo de todo
    const pie = (await page.locator('.portal-th__pie').boundingBox())!;
    expect(pie.y).toBeGreaterThan(b1.y + b1.height - 1);
    await page.waitForTimeout(200);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/180-links-diligenciar.png`, fullPage: true });
  });

  test('B1 abre el formulario de actos y condiciones inseguras, y se cierra', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await seccion(page).getByRole('button', { name: B1 }).click();
    const f = page.getByTestId('formulario-propio');
    await expect(f).toBeVisible();
    await expect(f).toContainText(B1);
    await expect(f.locator('[id^="fp-r"]')).toHaveCount(6);
    await expect(f.locator('#fp-r01 input')).toHaveValue('Laura Gómez');
    await page.keyboard.press('Escape');
    await expect(f).toBeHidden();
    await expect(seccion(page).getByRole('button')).toHaveCount(2); // el portal sigue ahí
  });

  test('B2 abre el formulario de salud, con su autorización de datos y la imagen del cuerpo', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await seccion(page).getByRole('button', { name: B2 }).click();
    const f = page.getByTestId('formulario-propio');
    await expect(f).toBeVisible();
    await expect(f).toContainText(B2);
    await expect(f.locator('#fp-autorizacion')).toContainText('totalmente confidencial');
    await expect(f.locator('[id^="fp-o"]')).toHaveCount(26);
    await expect(f.getByTestId('imagen-o10')).toHaveAttribute('src', '/portal-th/cuerpo-dolor.png');
  });

  test('el acceso a las respuestas solo sale a quien puede verlas (administrador y lectores SST)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await expect(seccion(page).getByRole('button')).toHaveCount(2);
    await expect(page.getByTestId('ver-respuestas-formularios-sst')).toHaveCount(0);

    const lector = await page.context().newPage();
    await lector.setViewportSize({ width: 1366, height: 900 });
    await simular(lector, { puedeVer: true });
    await lector.goto('/portal');
    await expect(lector.getByTestId('ver-respuestas-formularios-sst')).toHaveAttribute('href', '/portal/formularios-sst');
  });

  test('si la lista de formularios no responde, los botones se pintan igual y no aparece el acceso a las respuestas', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { listaFalla: true });
    await page.goto('/portal');
    await expect(seccion(page).getByRole('button')).toHaveText([B1, B2]);
    await expect(page.getByTestId('ver-respuestas-formularios-sst')).toHaveCount(0);
  });

  test('celular: los botones van uno debajo del otro, caben en la pantalla y los textos se leen completos', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/portal');
    const botones = seccion(page).getByRole('button');
    await expect(botones).toHaveCount(2);
    await botones.first().scrollIntoViewIfNeeded();
    const [b1, b2] = [(await botones.nth(0).boundingBox())!, (await botones.nth(1).boundingBox())!];
    expect(b2.y).toBeGreaterThan(b1.y + b1.height - 1);
    for (const b of [b1, b2]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.waitForTimeout(200);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/181-links-celular.png` });
  });
});

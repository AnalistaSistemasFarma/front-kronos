import { expect, test, type Page } from '@playwright/test';

/**
 * Formación · Top 10 de estudiantes (Cristian Baldión, 2026-10-16): una tabla con los mejores estudiantes (más cursos completados y
 * mejor nota), con medallas de oro, plata y bronce para los tres primeros. A la derecha de los cursos en pantallas anchas.
 * Sin sesión real ni base: las APIs se simulan con `page.route`; las personas son INVENTADAS. Con `FORMACION_CAPTURAS=<carpeta>`
 * guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const cursos = ['INDUCCIÓN SISTEMAS', 'INDUCCIÓN SAGRILAFT / PTEE', 'INDUCCIÓN MICROBIOLOGÍA', 'INDUCCIÓN CALIDAD', 'INDUCCIÓN ORGANIZACIONAL - SST', 'INDUCCIÓN FARMALOGICA'].map((titulo, i) => ({
  id: i + 1,
  titulo,
  descripcion: i % 2 ? 'Descripción del curso' : null,
  activo: true,
  totalMateriales: 2 + (i % 3),
  totalInscritos: 1,
  inscrito: true,
  porcentaje: 0,
  certificado: null,
}));
const NOMBRES = ['María Fernanda Ospina', 'Luis Fernando Acosta', 'Ana María Pérez', 'Carlos Andrés Mora', 'Diana Patricia Ruiz', 'Jorge Iván Soto', 'Paola Andrea Gil', 'Camilo Ernesto Vega', 'Natalia Rojas', 'Sergio Alejandro Díaz'];
const TOP = NOMBRES.map((nombre, i) => ({ puesto: i + 1, nombre, cursos: 6 - Math.floor(i / 2), nota: i === 4 ? null : 98 - i * 2.5, esUsted: i === 2 }));

async function simular(page: Page, opciones: { top?: unknown; falla?: boolean; sinSesion?: boolean } = {}) {
  await page.route('**/api/portal/courses', (r) => r.fulfill({ json: { esFormador: false, cursos } }));
  await page.route('**/api/portal/ranking-formacion', (r) => {
    if (opciones.sinSesion) return r.fulfill({ status: 401, json: { error: 'Sesión no válida.' } });
    if (opciones.falla) return r.fulfill({ status: 500, json: { error: 'No se pudo cargar el top de estudiantes. Intente en un momento.' } });
    return r.fulfill({ json: opciones.top ?? { top: TOP, total: 23, usted: null } });
  });
}
const panel = (page: Page) => page.getByTestId('top-estudiantes');

test.describe('Formación · Top 10 de estudiantes', () => {
  test('la API exige sesión', async ({ request }) => {
    expect((await request.get('/api/portal/ranking-formacion')).status()).toBe(401);
  });

  test('tabla del top 10 con medalla de ORO, PLATA y BRONCE para los tres primeros y número para el resto', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await simular(page);
    await page.goto('/portal/formacion');
    await expect(page.getByRole('heading', { name: /Top 10 de estudiantes/ })).toBeVisible();
    const filas = panel(page).getByTestId('top-fila');
    await expect(filas).toHaveCount(10);
    await expect(filas.nth(0)).toContainText('María Fernanda Ospina');
    // medallas, una por puesto
    await expect(filas.nth(0).getByTestId('medalla-oro')).toBeVisible();
    await expect(filas.nth(1).getByTestId('medalla-plata')).toBeVisible();
    await expect(filas.nth(2).getByTestId('medalla-bronce')).toBeVisible();
    await expect(filas.nth(0).getByRole('img', { name: 'Medalla de oro' })).toBeVisible();
    await expect(filas.nth(1).getByRole('img', { name: 'Medalla de plata' })).toBeVisible();
    await expect(filas.nth(2).getByRole('img', { name: 'Medalla de bronce' })).toBeVisible();
    await expect(panel(page).locator('[data-testid^="medalla-"]')).toHaveCount(3);
    for (let i = 3; i < 10; i++) await expect(filas.nth(i).locator('.portal-th__top-numero')).toHaveText(String(i + 1));
    // columnas: cursos y nota con coma decimal; sin nota, «—»
    await expect(filas.nth(0)).toContainText('6');
    await expect(filas.nth(0)).toContainText('98 %');
    await expect(filas.nth(1)).toContainText('95,5 %');
    await expect(filas.nth(4)).toContainText('—');
    await expect(panel(page).getByRole('columnheader')).toHaveText(['Puesto', 'Estudiante', 'Cursos', 'Nota']);
    // quien mira, resaltado
    await expect(filas.nth(2)).toHaveClass(/portal-th__top-usted/);
    await expect(filas.nth(2)).toContainText('(usted)');
    await expect(panel(page).locator('.portal-th__top-usted')).toHaveCount(1);
    await page.waitForTimeout(300);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/140-top10-ancha.png` });
  });

  test('en pantalla ancha el top queda a la DERECHA de los cursos, sin taparlos', async ({ page }) => {
    for (const ancho of [1920, 1440]) {
      await page.setViewportSize({ width: ancho, height: 1000 });
      await simular(page);
      await page.goto('/portal/formacion');
      await expect(panel(page)).toBeVisible();
      const tarjetas = page.locator('.portal-th__curso-tarjeta');
      await expect(tarjetas).toHaveCount(6);
      const tp = (await panel(page).boundingBox())!;
      const maxDerechaTarjetas = Math.max(...(await tarjetas.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))));
      expect(tp.x, `ancho ${ancho}`).toBeGreaterThanOrEqual(maxDerechaTarjetas);
      expect(tp.x + tp.width).toBeLessThanOrEqual(ancho);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    }
  });

  test('muy ancha (1920) los cursos conservan su lugar de siempre: el top ocupa el margen libre', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await simular(page);
    await page.goto('/portal/formacion');
    const grilla = (await page.locator('.portal-th__curso-grilla').boundingBox())!;
    const cuerpo = (await page.locator('.portal-th__cuerpo').boundingBox())!;
    expect(grilla.x + grilla.width).toBeLessThanOrEqual(cuerpo.x + cuerpo.width);
    const tp = (await panel(page).boundingBox())!;
    expect(tp.x).toBeGreaterThanOrEqual(cuerpo.x + cuerpo.width - 4); // en el margen que quedaba libre
  });

  test('en pantalla angosta (celular) el top va DEBAJO de los cursos y cabe en la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/portal/formacion');
    await expect(panel(page)).toBeVisible();
    const ultimaTarjeta = (await page.locator('.portal-th__curso-tarjeta').last().boundingBox())!;
    const tp = (await panel(page).boundingBox())!;
    expect(tp.y).toBeGreaterThanOrEqual(ultimaTarjeta.y + ultimaTarjeta.height - 1);
    expect(tp.x + tp.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/141-top10-celular.png`, fullPage: true });
  });

  test('si quien mira está fuera del top, ve su propio puesto debajo de la tabla', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await simular(page, { top: { top: TOP.map((f) => ({ ...f, esUsted: false })), total: 23, usted: { puesto: 14, nombre: 'Yo', cursos: 2, nota: 88.5, esUsted: true } } });
    await page.goto('/portal/formacion');
    await expect(panel(page).getByTestId('top-usted')).toHaveText('Su puesto: #14 de 23 · 2 cursos · nota 88,5 %');
    await expect(panel(page).locator('.portal-th__top-usted')).toHaveCount(0);
  });

  test('sin nadie en el top: mensaje de ánimo; un error se avisa ARRIBA en rojo con «Reintentar»; sin sesión no aparece', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await simular(page, { top: { top: [], total: 0, usted: null } });
    await page.goto('/portal/formacion');
    await expect(panel(page).getByTestId('top-vacio')).toHaveText('Todavía nadie ha completado un curso. ¡Sea la primera persona del top!');
    await expect(panel(page).locator('table')).toHaveCount(0);

    const otra = await page.context().newPage();
    await otra.setViewportSize({ width: 1920, height: 1000 });
    await simular(otra, { falla: true });
    await otra.goto('/portal/formacion');
    await expect(otra.getByTestId('top-error')).toContainText('No se pudo cargar el top de estudiantes.');
    await expect(otra.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    await expect(otra.locator('.portal-th__curso-tarjeta')).toHaveCount(6); // los cursos no se ven afectados

    const tercera = await page.context().newPage();
    await simular(tercera, { sinSesion: true });
    await tercera.goto('/portal/formacion');
    await expect(tercera.locator('.portal-th__curso-tarjeta')).toHaveCount(6);
    await expect(tercera.getByTestId('top-estudiantes')).toHaveCount(0);
  });

  test('no aparece dentro de un curso ni en la vista del formador', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await simular(page);
    await page.route('**/api/portal/courses/1', (r) =>
      r.fulfill({ json: { curso: { id: 1, titulo: cursos[0].titulo, descripcion: '', activo: true, creadoPor: 'x' }, esFormador: false, puedeMarcarManual: false, porcentaje: 0, materiales: [], certificado: null } })
    );
    await page.goto('/portal/formacion');
    await expect(panel(page)).toBeVisible();
    await page.getByRole('button', { name: /INDUCCIÓN SISTEMAS/ }).click();
    await expect(page.getByRole('button', { name: '← Volver a Formación' })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });
});

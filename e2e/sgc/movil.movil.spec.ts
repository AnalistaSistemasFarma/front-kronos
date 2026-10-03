import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * SGC documental EN CELULAR (revisión móvil del 2026-10-03: «hay muchas cosas
 * que no se pueden trabajar»). Corre en el proyecto `movil` (pantalla de
 * iPhone 390×844 y de Android 360×740, con toque) contra PRUEBAS, con la
 * sesión de qa.sgc. Escribe la contraseña al firmar, así que el proyecto va
 * sin traza, capturas automáticas ni video, como `firma`.
 *   1. «Ubicar firmas»: el documento ocupa el ancho de la pantalla, los
 *      firmantes se eligen en una fila de botones, un toque coloca la caja,
 *      la caja se arrastra con el dedo y el documento se desplaza con el dedo.
 *   2. Firma electrónica: el modal cabe en la pantalla (la huella SHA-256 ya
 *      no lo ensancha) y se firma «Elaboró» con la contraseña.
 *   3. Pantallas del módulo: sin desborde horizontal, campos de 16 px (iOS no
 *      hace zoom), «Autorizar» siempre a la vista y el calendario en agenda.
 *   4. Visor de la copia controlada: «Acercar» agranda la página también en
 *      el celular.
 * La solicitud de prueba usa solo personas QA y se cancela al final.
 */
const OLP = 3;
const PW1 = process.env.E2E_USER_PASSWORD ?? '';
const U3 = process.env.E2E_USER_EMAIL3 ?? '';
const TEMPLATE = '<p><strong>Nombre del documento:</strong> {{NOMBRE_DOCUMENTO}}</p><h2>1. OBJETIVO</h2><p>Prueba de la ubicación de firmas en el celular (e2e).</p><h2>10. HISTORIAL DE CAMBIOS</h2><p>{{HISTORIAL_CAMBIOS}}</p>';

async function ok<T = Record<string, unknown>>(res: Awaited<ReturnType<APIRequestContext['get']>>, status = [200, 201]): Promise<T> {
  const body = await res.json().catch(() => ({}));
  expect(status, JSON.stringify(body)).toContain(res.status());
  return body as T;
}

/** Cajas de firma dibujadas en el lienzo (su esquina «Redimensionar» marca cada una). */
async function boxes(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="sgc-ubicar-documento"] [title="Redimensionar"]')].map((h) => {
      const r = h.parentElement!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })
  );
}

/**
 * Elige una opción de un Select de Mantine. En la emulación táctil de Chrome,
 * enfocar un campo hace que el navegador desplace la página como si abriera
 * un teclado virtual y el menú se cierra por quedar fuera de la vista (no pasa
 * en un celular real); si eso ocurre, se agranda la pantalla un instante.
 */
async function choose(page: Page, testId: string, option: RegExp) {
  const field = page.getByTestId(testId);
  await field.click();
  const opt = page.getByRole('option', { name: option }).first();
  if (!(await opt.isVisible().catch(() => false))) {
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: 2400 });
    await field.click();
    if (!(await opt.isVisible().catch(() => false))) await field.click();
    await opt.click();
    await page.setViewportSize(vp);
    return;
  }
  await opt.click();
}

/** Ancho que se sale de la pantalla (0 = nada se sale). */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe.serial('SGC documental · celular', () => {
  test.skip(!PW1 || !U3, 'Requiere los usuarios de pruebas qa.sgc y qa.sgc3 (secretos E2E_SGC_USER*/E2E_SGC_PASSWORD*).');
  test.setTimeout(240_000);
  let idRequest = 0;

  test.afterAll(async ({ browser }) => {
    if (!idRequest) return;
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    await ctx.request.post(`/api/sgc/requests/${idRequest}/cancel`, { data: { reason: 'Limpieza de la prueba e2e del SGC en celular.' } });
    await ctx.close();
  });

  test('[SGC-REQ-105] «Ubicar firmas» en el celular: documento a todo el ancho, tocar para ubicar, arrastrar con el dedo y desplazar el documento', async ({ page }) => {
    const cat = await ok<{ processes: { id: number; code: string }[]; documentTypes: { id: number; code: string }[] }>(await page.request.get(`/api/sgc/catalogs?company=${OLP}`));
    ({ idRequest } = await ok<{ idRequest: number }>(
      await page.request.post('/api/sgc/requests', {
        data: { company: OLP, requestType: 'nuevo', subject: `E2E celular · ubicar firmas ${new Date().toISOString()}`, description: 'Recorrido automático de la e2e del SGC en celular (datos de prueba).', idProcess: cat.processes.find((p) => p.code === 'GC')!.id, idDocumentType: cat.documentTypes.find((t) => t.code === 'PR')!.id, formValues: { urgencia: 'Normal' } },
      }),
      [201]
    ));
    for (const stepKey of ['revision', 'aprobacion']) await ok(await page.request.post(`/api/sgc/requests/${idRequest}/signers`, { data: { stepKey, signers: [U3], mode: 'orden' } }));
    await ok(await page.request.post(`/api/sgc/requests/${idRequest}/draft`, { data: { html: TEMPLATE, origin: 'plantilla', originRef: 'Plantilla institucional de procedimiento' } }));

    await page.goto(`/process/sgc-documental/solicitudes/${idRequest}?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-abrir-ubicar-firmas')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('sgc-abrir-ubicar-firmas').tap();
    const pageImg = page.getByTestId('sgc-ubicar-firmas').getByAltText('Página 1');
    await expect(pageImg).toBeVisible({ timeout: 60_000 });

    // El documento usa casi todo el ancho (antes quedaba en ~40 px detrás de la lista «Orden de firma»).
    const vw = page.viewportSize()!.width;
    const img = (await pageImg.boundingBox())!;
    expect(img.width).toBeGreaterThan(vw * 0.75);
    await expect(page.getByTestId('sgc-ubicar-firmante-movil')).toHaveCount(4);

    // Tocar para ubicar: con «Elaboró» elegido, un toque en el documento lleva su caja ahí.
    await page.getByTestId('sgc-ubicar-firmante-movil').first().tap();
    await expect(page.getByTestId('sgc-ubicar-firmante-movil').first()).toHaveAttribute('data-active', 'true');
    const target = { x: img.x + img.width * 0.5, y: Math.min(img.y + img.height * 0.6, page.viewportSize()!.height - 160) };
    await page.touchscreen.tap(target.x, target.y);
    const moved = (await boxes(page)).find((b) => Math.abs(b.x + b.w / 2 - target.x) < 30 && Math.abs(b.y + b.h / 2 - target.y) < 30);
    expect(moved, 'la caja de «Elaboró» quedó donde se tocó').toBeTruthy();

    // Arrastrar la caja con el dedo.
    const cdp = await page.context().newCDPSession(page);
    const start = { x: moved!.x + 6, y: moved!.y + moved!.h / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - 5 * i, y: start.y + 6 * i }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const dragged = (await boxes(page)).find((b) => Math.abs(b.x - (moved!.x - 50)) < 15 && Math.abs(b.y - (moved!.y + 60)) < 15);
    expect(dragged, 'la caja se movió con el dedo').toBeTruthy();

    // Desplazar el documento con el dedo sobre la página (antes el lienzo atrapaba el gesto).
    const viewport = page.getByTestId('sgc-ubicar-documento').locator('.mantine-ScrollArea-viewport').first();
    const before = await viewport.evaluate((el) => el.scrollTop);
    await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(img.x + 12), y: Math.round(page.viewportSize()!.height - 220), yDistance: -250, speed: 1500, gestureSourceType: 'touch' });
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);

    await page.getByTestId('sgc-ubicar-guardar').tap();
    await expect(page.getByTestId('sgc-mensaje')).toContainText('Ubicación de firmas guardada', { timeout: 30_000 });
    const layout = await ok<{ fields: unknown[] }>(await page.request.get(`/api/sgc/requests/${idRequest}/layout`));
    expect(layout.fields).toHaveLength(4);
  });

  test('[SGC-REQ-106] la firma electrónica cabe en la pantalla del celular y se firma «Elaboró» con la contraseña', async ({ page }) => {
    const { tasks } = await ok<{ tasks: { idTask: number; task: string; status: string }[] }>(await page.request.get(`/api/sgc/tasks?request=${idRequest}`));
    const elab = tasks.find((t) => t.task.startsWith('Elaboración') && t.status === 'abierta')!;
    await page.goto(`/process/sgc-documental/tareas/${elab.idTask}?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-editar-tarea')).toBeVisible({ timeout: 45_000 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.getByTestId('sgc-editar-tarea').tap();
    await choose(page, 'sgc-decision', /enviar a revisión/);
    await page.getByTestId('sgc-guardar-tarea').click();
    await expect(page.getByTestId('sgc-firma-modal')).toBeVisible();
    const body = page.locator('.mantine-Modal-body').filter({ has: page.getByTestId('sgc-firma-modal') });
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByTestId('sgc-firma-motivo').fill('Soy el autor y lo envío a revisión desde el celular (e2e).');
    await page.getByTestId('sgc-firma-consentimiento').check();
    await page.getByTestId('sgc-firma-contrasena').fill(PW1);
    const confirm = page.getByTestId('sgc-firma-confirmar');
    await confirm.scrollIntoViewIfNeeded();
    const cb = (await confirm.boundingBox())!;
    expect(cb.x + cb.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await confirm.tap();
    await expect(page.getByTestId('sgc-mensaje')).toContainText('Firma registrada', { timeout: 60_000 });
  });

  test('[SGC-REQ-107] las pantallas del SGC caben en el celular: sin desborde, campos de 16 px, «Autorizar» a la vista y calendario en agenda', async ({ page }) => {
    for (const path of ['', '/listado', '/areas', '/solicitudes', '/solicitudes/nueva', '/tareas', '/autorizaciones', '/vencimientos', '/firmas', '/configuracion', '/flujos', '/relaciones']) {
      await page.goto(`/process/sgc-documental${path}?empresa=${OLP}`);
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(1500);
      expect(await horizontalOverflow(page), `desborde horizontal en ${path || '/'}`).toBeLessThanOrEqual(1);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), textarea, select')]
          .filter((el) => (el as HTMLElement).offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => (el as HTMLInputElement).placeholder || el.getAttribute('data-testid') || el.tagName)
      );
      expect(small, `campos con letra menor a 16 px en ${path || '/'} (iOS hace zoom)`).toEqual([]);
    }
    // Calendario: en el celular abre en «Agenda» (la cuadrícula mensual solo mostraba tres días).
    await page.goto(`/process/sgc-documental/vencimientos?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-cal-vista')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('sgc-cal-mes')).toHaveCount(0);
    // Autorizaciones: la columna «Acciones» queda fija a la derecha de la tabla.
    await page.goto(`/process/sgc-documental/autorizaciones?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-autorizaciones-tabla')).toBeVisible({ timeout: 45_000 });
    const sticky = await page.getByTestId('sgc-autorizaciones-tabla').locator('th').last().evaluate((el) => getComputedStyle(el).position);
    expect(sticky).toBe('sticky');
  });

  test('[SGC-REQ-108] el visor de la copia controlada acerca la página también en el celular', async ({ page }) => {
    const { documents } = await ok<{ documents: { idDocument: number; idVersion: number | null }[] }>(await page.request.get(`/api/sgc/documents?company=${OLP}`));
    const doc = documents.find((d) => d.idVersion);
    test.skip(!doc, 'No hay documentos vigentes cargados en pruebas para abrir en el visor.');
    await page.goto(`/process/sgc-documental/documentos/${doc!.idDocument}?empresa=${OLP}`);
    await page.getByTestId('sgc-abrir-visor').tap();
    const first = page.getByTestId('sgc-visor-pagina').first();
    await expect(first).toBeVisible({ timeout: 45_000 });
    const w0 = (await first.boundingBox())!.width;
    await page.getByRole('button', { name: 'Acercar' }).tap();
    await page.getByRole('button', { name: 'Acercar' }).tap();
    await expect.poll(async () => (await page.getByTestId('sgc-visor-pagina').first().boundingBox())!.width).toBeGreaterThan(w0 * 1.2);
    const pages = page.getByTestId('sgc-visor-paginas');
    expect(await pages.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});

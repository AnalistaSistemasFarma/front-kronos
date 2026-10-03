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
 *   4. Selectores con el dedo cerca del final de la página (Prioridad,
 *      Elaborador…): el valor queda guardado.
 *   5. Visor de la copia controlada: «Acercar» agranda la página también en
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
 * Elige una opción como lo haría la persona con el dedo, sin trucos de
 * pantalla. En el celular, las listas cortas del SGC son el selector NATIVO
 * del sistema (se toca y se elige); las largas con búsqueda son el Select de
 * Mantine, que ya no se cierra cuando la página se mueve.
 */
async function pick(page: Page, testId: string, option: RegExp) {
  const field = page.getByTestId(testId).first();
  // Las opciones llegan del servidor: espera a que la lista tenga la opción (o a que sea el Select con búsqueda).
  let native = false;
  await expect
    .poll(
      async () => {
        native = (await field.evaluate((el) => el.tagName)) === 'SELECT';
        if (!native) return true;
        const labels = await field.evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.label));
        return labels.some((l) => option.test(l));
      },
      { message: `opción ${option} en ${testId}`, timeout: 30_000 }
    )
    .toBe(true);
  await field.scrollIntoViewIfNeeded();
  if (native) {
    await field.tap();
    const labels = await field.evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.label));
    await field.selectOption({ label: labels.find((l) => option.test(l))! });
    return;
  }
  await field.tap();
  const opt = page.getByRole('option', { name: option }).first();
  await expect(opt).toBeVisible();
  await opt.tap();
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

    // Espera a que el lienzo deje de moverse (las páginas se dibujan después de abrir el modal).
    let img = (await pageImg.boundingBox())!;
    await expect
      .poll(async () => {
        const now = (await pageImg.boundingBox())!;
        const stable = Math.abs(now.y - img.y) < 1 && Math.abs(now.height - img.height) < 1 && now.height > 100;
        img = now;
        return stable;
      }, { timeout: 30_000 })
      .toBe(true);

    // El documento usa casi todo el ancho (antes quedaba en ~40 px detrás de la lista «Orden de firma»).
    const vw = page.viewportSize()!.width;
    expect(img.width).toBeGreaterThan(vw * 0.75);
    await expect(page.getByTestId('sgc-ubicar-firmante-movil')).toHaveCount(4);
    await expect(page.getByTestId('sgc-ubicar-documento')).toContainText('Toque el documento para colocar');

    // Tocar para ubicar: con «Elaboró» elegido, un toque en el documento lleva su caja ahí.
    await page.getByTestId('sgc-ubicar-firmante-movil').first().tap();
    await expect(page.getByTestId('sgc-ubicar-firmante-movil').first()).toHaveAttribute('data-active', 'true');
    const docArea = (await page.getByTestId('sgc-ubicar-documento').boundingBox())!;
    const visibleBottom = Math.min(img.y + img.height, docArea.y + docArea.height) - 30;
    const target = { x: img.x + img.width * 0.5, y: Math.max(img.y + 40, Math.min(img.y + img.height * 0.6, visibleBottom)) };
    const near = async () => (await boxes(page)).find((b) => Math.abs(b.x + b.w / 2 - target.x) < 30 && Math.abs(b.y + b.h / 2 - target.y) < 30);
    await expect
      .poll(async () => {
        if (!(await near())) await page.touchscreen.tap(target.x, target.y);
        return Boolean(await near());
      }, { message: 'la caja de «Elaboró» quedó donde se tocó', timeout: 20_000 })
      .toBe(true);
    const moved = (await near())!;

    // Arrastrar la caja con el dedo.
    const cdp = await page.context().newCDPSession(page);
    const start = { x: moved.x + 6, y: moved.y + moved.h / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - 5 * i, y: start.y + 3 * i }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => Boolean((await boxes(page)).find((b) => Math.abs(b.x - (moved.x - 50)) < 15 && Math.abs(b.y - (moved.y + 30)) < 15)), { message: 'la caja se movió con el dedo', timeout: 10_000 })
      .toBe(true);

    // Desplazar el documento con el dedo sobre la página (antes el lienzo atrapaba el gesto),
    // si el documento es más alto que el área visible.
    const viewport = page.getByTestId('sgc-ubicar-documento').locator('.mantine-ScrollArea-viewport').first();
    const { top, max } = await viewport.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    if (max > 20) {
      const vb = (await viewport.boundingBox())!;
      await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(img.x + 12), y: Math.round(vb.y + vb.height * 0.75), yDistance: -Math.round(vb.height * 0.4), speed: 1200, gestureSourceType: 'touch' });
      await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(top);
    }
    // La página no bloquea los gestos del dedo (en escritorio sí, como en SynerLink).
    // «pan-x pan-y pinch-zoom» lo serializa Chrome como «manipulation».
    expect(await pageImg.evaluate((el) => getComputedStyle(el.parentElement!).touchAction)).toMatch(/manipulation|pan-y/);

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
    await pick(page, 'sgc-decision', /enviar a revisión/);
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
    await expect(confirm).toBeEnabled();
    // click() y no tap(): con el campo de contraseña enfocado, la emulación táctil de Chrome
    // desplaza la página (teclado virtual simulado) entre medir y tocar.
    await confirm.click();
    // movil-ios y movil-android corren a la vez con la misma persona: el servidor serializa
    // la reautenticación por persona y responde «Hay otra firma suya en curso»; se reintenta.
    await expect
      .poll(async () => {
        if (await page.getByTestId('sgc-mensaje').filter({ hasText: 'Firma registrada' }).count()) return true;
        const err = page.getByTestId('sgc-firma-error');
        if ((await err.count()) && /otra firma suya en curso/.test(await err.innerText())) {
          await page.getByTestId('sgc-firma-contrasena').fill(PW1);
          if (await confirm.isEnabled()) await confirm.click();
        }
        return false;
      }, { timeout: 90_000, intervals: [2_000] })
      .toBe(true);
  });

  test('[SGC-REQ-109] los selectores funcionan con el dedo cerca del final de la página: la nueva solicitud guarda prioridad, proceso, tipo y elaborador, y la prioridad se edita en la solicitud', async ({ page }) => {
    await page.goto(`/process/sgc-documental/solicitudes/nueva?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-nueva-asunto')).toBeVisible({ timeout: 45_000 });
    await pick(page, 'sgc-nueva-proceso', /^GC · /);
    await pick(page, 'sgc-nueva-tipo-documental', /^PR · /);
    await page.getByTestId('sgc-nueva-asunto').fill(`E2E celular · selectores ${new Date().toISOString()}`);
    await page.getByTestId('sgc-nueva-justificacion').fill('Recorrido automático de la e2e del SGC en celular (selectores, datos de prueba).');
    // Al final de la página: elaborador (lista larga con búsqueda) y prioridad (lista corta).
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await pick(page, 'sgc-nueva-elaborador', /qa\.sgc3@/);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await pick(page, 'sgc-campo-urgencia', /^Alta$/);
    await page.getByTestId('sgc-nueva-crear').tap();
    await page.waitForURL(/\/process\/sgc-documental\/solicitudes\/\d+/, { timeout: 45_000 });
    const id = Number(/solicitudes\/(\d+)/.exec(page.url())![1]);
    try {
      type Detail = { request: { elaboratorEmail: string; process: { code: string }; documentType: { code: string } }; formFields: { key: string; value: string | null }[] };
      const d = await ok<Detail>(await page.request.get(`/api/sgc/requests/${id}`));
      expect(d.request.process.code).toBe('GC');
      expect(d.request.documentType.code).toBe('PR');
      expect(d.request.elaboratorEmail).toBe(U3.toLowerCase());
      expect(d.formFields.find((f) => f.key === 'urgencia')?.value).toBe('Alta');
      // Editar la prioridad desde la solicitud (Información adicional, al final de la página).
      await expect(page.getByTestId('sgc-info-adicional')).toBeVisible({ timeout: 45_000 });
      await page.getByTestId('sgc-campo-editar-urgencia').scrollIntoViewIfNeeded();
      await page.getByTestId('sgc-campo-editar-urgencia').tap();
      await pick(page, 'sgc-campo-valor-urgencia', /^Requerimiento regulatorio$/);
      await page.getByTestId('sgc-campo-guardar-urgencia').tap();
      await expect
        .poll(async () => (await ok<Detail>(await page.request.get(`/api/sgc/requests/${id}`))).formFields.find((f) => f.key === 'urgencia')?.value, { timeout: 30_000 })
        .toBe('Requerimiento regulatorio');
    } finally {
      await page.request.post(`/api/sgc/requests/${id}/cancel`, { data: { reason: 'Limpieza de la prueba e2e de selectores en celular.' } });
    }
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
    await expect
      .poll(() => page.getByTestId('sgc-autorizaciones-tabla').locator('th').last().evaluate((el) => getComputedStyle(el).position).catch(() => ''), { timeout: 15_000 })
      .toBe('sticky');
  });

  test('[SGC-REQ-108] el visor de la copia controlada acerca la página también en el celular', async ({ page }) => {
    const { documents } = await ok<{ documents: { idDocument: number; idVersion: number | null }[] }>(await page.request.get(`/api/sgc/documents?company=${OLP}`));
    const doc = documents.find((d) => d.idVersion);
    test.skip(!doc, 'No hay documentos vigentes cargados en pruebas para abrir en el visor.');
    await page.goto(`/process/sgc-documental/documentos/${doc!.idDocument}?empresa=${OLP}`);
    await page.getByTestId('sgc-abrir-visor').tap();
    const first = page.getByTestId('sgc-visor-pagina').first();
    await expect(first).toBeVisible({ timeout: 45_000 });
    const zoomIn = page.getByRole('button', { name: 'Acercar' });
    await expect(zoomIn).toBeEnabled({ timeout: 45_000 });
    const w0 = (await first.boundingBox())!.width;
    await zoomIn.tap();
    await expect(zoomIn).toBeEnabled();
    await zoomIn.tap();
    await expect.poll(async () => (await page.getByTestId('sgc-visor-pagina').first().boundingBox())!.width).toBeGreaterThan(w0 * 1.2);
    const pages = page.getByTestId('sgc-visor-paginas');
    expect(await pages.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});

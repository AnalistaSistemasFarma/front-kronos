import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { STORAGE_STATE_2, STORAGE_STATE_3 } from '../../playwright.config';

/**
 * SGC documental · Sprint 2 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   - recorrido del flujo documental: qa.sgc crea la solicitud y elabora;
 *     qa.sgc2 y qa.sgc3 REVISAN EN PARALELO y APRUEBAN EN ORDEN; qa.sgc2
 *     (grupo de Calidad en pruebas) hace la verificación de estructura; la
 *     solicitud queda en espera de divulgación (Sprint 4);
 *   - administrador de flujos: se crea y se edita un flujo sin código, se
 *     publica y queda en el registro de cambios;
 *   - paridad visual de «Tareas documentales» con «Tareas Asignadas» de SynerLink.
 * La sesión la deja auth.setup.ts; aquí nunca se escribe una contraseña.
 */
const OLP = 3;
const U2 = process.env.E2E_USER_EMAIL2 ?? '';
const U3 = process.env.E2E_USER_EMAIL3 ?? '';
const hasThree = Boolean(process.env.E2E_USER_EMAIL2 && process.env.E2E_USER_PASSWORD2 && process.env.E2E_USER_EMAIL3 && process.env.E2E_USER_PASSWORD3);

async function asUser(browser: Browser, storageState: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState, locale: 'es-CO', timezoneId: 'America/Bogota' });
  return ctx.newPage();
}

async function taskRow(api: APIRequestContext, idRequest: number, taskName: RegExp) {
  const res = await api.get(`/api/sgc/tasks?request=${idRequest}`);
  expect(res.status()).toBe(200);
  const { tasks } = (await res.json()) as { tasks: { idTask: number; task: string; status: string }[] };
  return tasks.find((t) => taskName.test(t.task));
}

async function chooseOption(page: Page, testId: string, option: string | RegExp) {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: option }).first().click();
}

async function decideInUi(page: Page, idTask: number, option: RegExp, text: string) {
  await page.goto(`/process/sgc-documental/tareas/${idTask}?empresa=${OLP}`);
  await expect(page.getByTestId('sgc-tarea-titulo')).toContainText(`Tarea #${idTask}`);
  await page.getByTestId('sgc-editar-tarea').click();
  await chooseOption(page, 'sgc-decision', option);
  await page.getByTestId('sgc-resolucion').fill(text);
  await page.getByTestId('sgc-guardar-tarea').click();
  await expect(page.getByTestId('sgc-mensaje')).toContainText('Tarea actualizada correctamente');
}

test.describe.serial('SGC documental · Sprint 2 · recorrido del flujo documental', () => {
  test.skip(!hasThree, 'Requiere los usuarios de pruebas qa.sgc2 y qa.sgc3 (secretos E2E_SGC_USER2/3).');
  let idRequest = 0;

  test('[SGC-REQ-028][SGC-REQ-032] qa.sgc crea la solicitud documental y la ve en su bandeja de Tareas documentales', async ({ page }) => {
    await page.goto(`/process/sgc-documental?empresa=${OLP}`);
    await expect(page.locator('[data-testid="sgc-module-card"][data-enabled="true"]').filter({ hasText: 'Tareas documentales' })).toBeVisible();
    await page.goto(`/process/sgc-documental/solicitudes/nueva?empresa=${OLP}`);
    await chooseOption(page, 'sgc-nueva-proceso', /^GC · /);
    await chooseOption(page, 'sgc-nueva-tipo-documental', /^PR · /);
    await page.getByTestId('sgc-nueva-asunto').fill(`E2E S2 · procedimiento de prueba ${new Date().toISOString()}`);
    await page.getByTestId('sgc-nueva-justificacion').fill('Recorrido automático de la e2e del Sprint 2 (datos de prueba).');
    await chooseOption(page, 'sgc-campo-urgencia', 'Normal');
    await page.getByTestId('sgc-nueva-crear').click();
    await page.waitForURL(/\/process\/sgc-documental\/solicitudes\/\d+/, { timeout: 45_000 });
    idRequest = Number(/solicitudes\/(\d+)/.exec(page.url())![1]);
    await expect(page.getByTestId('sgc-tarea-titulo')).toContainText(`Solicitud #${idRequest}`);

    await page.goto(`/process/sgc-documental/tareas?empresa=${OLP}`);
    const row = page.locator(`[data-testid="bandeja-fila"][data-request="${idRequest}"]`);
    await expect(row).toContainText('Elaboración');
    await expect(row).toContainText('Abierto');
    await row.click();
    await expect(page.getByTestId('sgc-tarea-titulo')).toContainText(`Solicitud #${idRequest}`);
  });

  test('[SGC-REQ-030][SGC-REQ-032] el elaborador carga el borrador, asigna 2 revisores en paralelo y 2 aprobadores en orden, y envía', async ({ page }) => {
    const up = await page.request.post(`/api/sgc/requests/${idRequest}/attachments`, {
      multipart: { purpose: 'borrador', file: { name: 'E2E-borrador.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK e2e borrador') } },
    });
    expect(up.status()).toBe(201);
    for (const [stepKey, mode] of [['revision', 'paralelo'], ['aprobacion', 'orden']] as const) {
      const r = await page.request.post(`/api/sgc/requests/${idRequest}/signers`, { data: { stepKey, signers: [U2, U3], mode } });
      expect(r.status()).toBe(200);
    }
    const elab = await taskRow(page.request, idRequest, /^Elaboración/);
    await page.goto(`/process/sgc-documental/tareas/${elab!.idTask}?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-firmantes-revision')).toContainText('Firma en paralelo');
    await expect(page.getByTestId('sgc-firmantes-aprobacion')).toContainText('Firma en orden');
    await expect(page.getByTestId('sgc-adjunto')).toContainText('E2E-borrador.docx');
    await decideInUi(page, elab!.idTask, /enviar a revisión/, 'Borrador listo para revisión (e2e).');
    await expect(page.getByTestId('sgc-historial')).toContainText('Envió el documento');
  });

  test('[SGC-REQ-029][SGC-REQ-036] qa.sgc2 y qa.sgc3 revisan EN PARALELO: a ambos les toca a la vez y el paso no avanza hasta que firmen los dos', async ({ browser }) => {
    const p2 = await asUser(browser, STORAGE_STATE_2);
    const p3 = await asUser(browser, STORAGE_STATE_3);
    const r2 = await taskRow(p2.request, idRequest, /^Revisión/);
    const r3 = await taskRow(p3.request, idRequest, /^Revisión/);
    expect(r2?.status).toBe('abierta');
    expect(r3?.status).toBe('abierta');
    await p3.goto(`/process/sgc-documental/tareas/${r3!.idTask}?empresa=${OLP}`);
    await p3.getByTestId('sgc-editar-tarea').click();
    await expect(p3.getByTestId('sgc-firma-pendiente')).toContainText('Revisó');
    await decideInUi(p3, r3!.idTask, /Resuelto — aprobar/, 'Revisado sin observaciones (e2e).');
    expect((await taskRow(p2.request, idRequest, /^Aprobación/)) ?? null).toBeNull();
    const dec = await p2.request.post(`/api/sgc/tasks/${r2!.idTask}/decision`, { data: { decision: 'aprobar', comment: 'Revisado (e2e).' } });
    expect(dec.status()).toBe(200);
    expect(await dec.json()).toMatchObject({ outcome: 'resuelta', next: 'aprobacion' });
    await p2.context().close();
    await p3.context().close();
  });

  test('[SGC-REQ-029][SGC-REQ-033] la aprobación va EN ORDEN (qa.sgc2 → qa.sgc3 → grupo de Calidad) y se decide desde Autorizaciones SGC', async ({ browser, page }) => {
    const p2 = await asUser(browser, STORAGE_STATE_2);
    const p3 = await asUser(browser, STORAGE_STATE_3);
    const a3 = await taskRow(p3.request, idRequest, /^Aprobación/);
    expect(a3?.status).toBe('sin_empezar');
    expect((await p3.request.post(`/api/sgc/tasks/${a3!.idTask}/decision`, { data: { decision: 'aprobar' } })).status()).toBe(409);

    await p2.goto(`/process/sgc-documental/autorizaciones?empresa=${OLP}`);
    await expect(p2.getByTestId('sgc-autorizaciones-titulo')).toContainText('Autorizaciones SGC');
    const mine = p2.locator(`[data-testid="sgc-autorizacion-fila"][data-request="${idRequest}"][data-status="pendiente"]`).filter({ hasText: 'Aprobación de documento SGC' });
    await mine.getByTestId('sgc-autorizar').click();
    await p2.getByTestId('sgc-autorizar-confirmar').click();
    await expect(p2.getByTestId('sgc-autorizaciones-mensaje')).toContainText('Autorización registrada');

    expect((await taskRow(p3.request, idRequest, /^Aprobación/))?.status).toBe('abierta');
    await decideInUi(p3, a3!.idTask, /Resuelto — autorizar/, 'Aprobado por el área (e2e).');

    await p2.reload();
    const pool = p2.locator(`[data-testid="sgc-autorizacion-fila"][data-request="${idRequest}"][data-status="pendiente"]`).filter({ hasText: 'Verificación de estructura documental' });
    await expect(pool).toContainText('grupo');
    await pool.getByTestId('sgc-autorizar').click();
    await p2.getByTestId('sgc-autorizar-confirmar').click();
    await expect(p2.getByTestId('sgc-autorizaciones-mensaje')).toContainText('Autorización registrada');

    const res = await page.request.get(`/api/sgc/requests/${idRequest}`);
    const detail = (await res.json()) as { request: { status: string; currentTaskKey: string }; tasks: { key: string; status: string; assignees: { signatureStatus: string }[] }[] };
    expect(detail.request).toMatchObject({ status: 'en_espera', currentTaskKey: 'divulgacion' });
    const apr = detail.tasks.find((t) => t.key === 'aprobacion')!;
    expect(apr.status).toBe('resuelta');
    expect(apr.assignees.every((a) => a.signatureStatus === 'pendiente_s3')).toBe(true);
    await page.goto(`/process/sgc-documental/solicitudes/${idRequest}?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-tarea-estado')).toHaveText('En espera');
    await page.getByTestId('sgc-ver-tareas').click();
    await expect(page.getByTestId('sgc-linea-tarea')).toHaveCount(5);
    await p2.context().close();
    await p3.context().close();
  });

  test('[SGC-REQ-037] quien no participa no ve la solicitud (404)', async ({ browser }) => {
    // qa.sgc3 sí participa; se prueba con una solicitud inexistente y con la API de otra empresa.
    const p3 = await asUser(browser, STORAGE_STATE_3);
    expect((await p3.request.get('/api/sgc/requests/99999999')).status()).toBe(404);
    expect((await p3.request.get('/api/sgc/flows?company=3')).status()).toBe(403);
    await p3.context().close();
  });
});

test.describe('SGC documental · Sprint 2 · administración de flujos validados', () => {
  test('[SGC-REQ-024][SGC-REQ-025][SGC-REQ-026] se crea y se edita un flujo SIN CÓDIGO, se publica y queda en el registro de cambios', async ({ page }) => {
    const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    await page.goto(`/process/sgc-documental/flujos?empresa=${OLP}`);
    await expect(page.locator('[data-testid="sgc-flujo-fila"][data-code="DOC"]')).toBeVisible();
    await page.getByTestId('sgc-flujo-nuevo').click();
    await page.getByTestId('sgc-nuevo-flujo-codigo').fill(code);
    await page.getByTestId('sgc-nuevo-flujo-nombre').fill('Flujo de prueba e2e (se puede ignorar)');
    await page.getByTestId('sgc-nuevo-flujo-motivo').fill('Prueba automática del administrador de flujos (Sprint 2).');
    await page.getByTestId('sgc-nuevo-flujo-crear').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Flujo creado');
    await expect(page.getByTestId('sgc-version-estado')).toHaveText('borrador');
    await page.getByTestId('sgc-flujo-tarea-nombre').nth(1).fill('Ejecución editada en e2e');
    await page.getByTestId('sgc-flujo-motivo').fill('Cambio de nombre de la tarea (e2e).');
    await page.getByTestId('sgc-flujo-guardar').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Borrador guardado');
    await page.getByTestId('sgc-flujo-publicar').click();
    await page.getByTestId('sgc-modal-motivo').fill('Publicación de prueba (e2e).');
    await page.getByTestId('sgc-modal-confirmar').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Versión publicada');
    await expect(page.getByTestId('sgc-version-estado')).toHaveText('vigente');
    await expect(page.getByTestId('sgc-flujo-tarea-nombre').nth(1)).toBeDisabled();
    await page.getByRole('tab', { name: 'Registro de cambios' }).click();
    await expect(page.getByTestId('sgc-cambio').filter({ hasText: 'Publicación de prueba (e2e).' })).toBeVisible();
    await expect(page.getByTestId('sgc-cambio').filter({ hasText: 'Cambio de nombre de la tarea (e2e).' })).toBeVisible();
  });
});

test.describe('SGC documental · Sprint 2 · paridad visual con SynerLink', () => {
  type Shape = { title: string; titleFont: string; card: string; kpis: string[]; kpiStyle: string; filters: string; headers: string[] };
  async function shape(page: Page): Promise<Shape> {
    return page.evaluate(() => {
      const card = document.querySelector('.mantine-Card-root') as HTMLElement;
      const h1 = card.querySelector('h1') as HTMLElement;
      const cs = (el: Element, props: string[]) => {
        const s = getComputedStyle(el);
        return props.map((p) => `${p}:${s.getPropertyValue(p)}`).join(';');
      };
      const kpiCards = [...card.querySelectorAll('.mantine-Grid-col .mantine-Card-root')] as HTMLElement[];
      const filtersTitle = [...document.querySelectorAll('h3')].map((h) => h.textContent?.trim()).find((t) => t?.startsWith('Filtros')) ?? '';
      return {
        title: h1.textContent?.trim() ?? '',
        titleFont: cs(h1, ['font-size', 'font-weight', 'line-height', 'display', 'gap']),
        card: cs(card, ['border-radius', 'box-shadow', 'padding-top', 'padding-left', 'border-top-width']),
        kpis: kpiCards.map((k) => k.querySelector('p')?.textContent?.trim() ?? ''),
        kpiStyle: kpiCards[0] ? cs(kpiCards[0], ['border-radius', 'padding-top', 'background-color']) : '',
        filters: filtersTitle,
        headers: [...document.querySelectorAll('table th')].map((th) => th.textContent?.trim() ?? ''),
      };
    });
  }

  test('[SGC-REQ-032] «Tareas documentales» se ve igual que «Tareas Asignadas» de SynerLink (misma cabecera, indicadores, filtros y columnas)', async ({ page }, testInfo) => {
    await page.goto('/process/request-general/assigned-activities');
    await expect(page.getByRole('heading', { level: 1, name: /Tareas Asignadas/ })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Lista de Tareas Asignadas')).toBeVisible();
    const synerlink = await shape(page);
    await testInfo.attach('synerlink-tareas-asignadas.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.goto(`/process/sgc-documental/tareas?empresa=${OLP}`);
    await expect(page.getByTestId('bandeja-titulo')).toBeVisible({ timeout: 45_000 });
    const sgc = await shape(page);
    await testInfo.attach('sgc-tareas-documentales.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await testInfo.attach('paridad.json', { body: JSON.stringify({ synerlink, sgc }, null, 2), contentType: 'application/json' });

    expect(sgc.title).toBe('Tareas documentales');
    expect(synerlink.title).toBe('Tareas Asignadas');
    expect(sgc.titleFont).toBe(synerlink.titleFont);
    expect(sgc.card).toBe(synerlink.card);
    expect(sgc.kpis).toEqual(synerlink.kpis);
    expect(sgc.kpiStyle).toBe(synerlink.kpiStyle);
    expect(sgc.filters).toBe(synerlink.filters);
    expect(sgc.headers).toEqual(synerlink.headers);
  });
});

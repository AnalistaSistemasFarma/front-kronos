import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { STORAGE_STATE_3 } from '../../playwright.config';
import { cancelQuietly, OLP, takeElaboration, U1, U3 } from './roles';

/**
 * RECORRIDO MANUAL CORTO (2026-10-09, Duo) en PRUEBAS, con capturas como
 * evidencia: solicitud, encabezado obligatorio, «Mapa de documentos», firma sin
 * autocompletar, «Mis pendientes», carga masiva (S9) y aprobadores (S12).
 * Rama desechable: no va a testing. No escribe contraseñas (el modal de firma
 * se abre y se cierra sin firmar).
 */
async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(800);
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

test.describe.serial('Recorrido manual SGC 2026-10-09', () => {
  test.setTimeout(240_000);
  let idRequest = 0;

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    await cancelQuietly(ctx.request, idRequest, 'Limpieza del recorrido manual de la e2e (2026-10-09).');
    await ctx.close();
  });

  test('1 · solicitud nueva (qa.sgc3): sin selector de elaborador; el elaborador sale de la configuración', async ({ browser, page }, testInfo) => {
    const ctx3 = await browser.newContext({ storageState: STORAGE_STATE_3 });
    const p3 = await ctx3.newPage();
    await p3.goto(`/process/sgc-documental/solicitudes/nueva?empresa=${OLP}`);
    await expect(p3.getByTestId('sgc-nueva-asunto')).toBeVisible({ timeout: 45_000 });
    await expect(p3.getByTestId('sgc-nueva-elaborador')).toHaveCount(0);
    for (const [id, opt] of [['sgc-nueva-proceso', /^GC · /], ['sgc-nueva-tipo-documental', /^PR · /], ['sgc-campo-urgencia', 'Normal'], ['sgc-nueva-capacitacion', 'No requiere capacitación']] as const) {
      await p3.getByTestId(id).click();
      await p3.getByRole('option', { name: opt }).first().click();
    }
    await p3.getByTestId('sgc-nueva-asunto').fill(`E2E recorrido manual ${new Date().toISOString()}`);
    await p3.getByTestId('sgc-nueva-justificacion').fill('Recorrido manual de la e2e del 2026-10-09 (datos de prueba; se cancela al final).');
    await shot(p3, testInfo, '01-solicitud-nueva.png');
    await p3.getByTestId('sgc-nueva-crear').click();
    await p3.waitForURL(/\/process\/sgc-documental\/solicitudes\/\d+/, { timeout: 45_000 });
    idRequest = Number(/solicitudes\/(\d+)/.exec(p3.url())![1]);
    const d = (await (await p3.request.get(`/api/sgc/requests/${idRequest}`)).json()) as { request: { elaboratorEmail: string; requesterEmail: string } };
    testInfo.annotations.push({ type: 'elaborador-por-configuracion', description: `solicitud ${idRequest}: pide ${d.request.requesterEmail}, elabora ${d.request.elaboratorEmail}` });
    expect(d.request.requesterEmail.toLowerCase()).toBe(U3.toLowerCase());
    expect(d.request.elaboratorEmail.toLowerCase()).not.toBe(U3.toLowerCase());
    await shot(p3, testInfo, '02-solicitud-creada.png');
    await ctx3.close();
    await takeElaboration(page.request, idRequest, U1);
  });

  test('2 · encabezado institucional obligatorio (configuración y solicitud)', async ({ page }, testInfo) => {
    await page.goto(`/process/sgc-documental/configuracion?empresa=${OLP}`);
    await page.getByRole('tab', { name: 'Encabezado y divulgación' }).click();
    await expect(page.getByTestId('sgc-config-encabezado-obligatorio')).toContainText('Encabezado obligatorio');
    await shot(page, testInfo, '03-config-encabezado-obligatorio.png');
    await page.goto(`/process/sgc-documental/solicitudes/${idRequest}?empresa=${OLP}`);
    const header = page.getByTestId('sgc-encabezado-institucional');
    await expect(header).toBeVisible({ timeout: 45_000 });
    await expect(header).toBeChecked();
    testInfo.annotations.push({ type: 'encabezado', description: `casilla marcada; deshabilitada=${await header.isDisabled()}` });
    await header.scrollIntoViewIfNeeded();
    await shot(page, testInfo, '04-solicitud-encabezado.png');
  });

  test('3 · «Mapa de documentos»', async ({ page }, testInfo) => {
    await page.goto(`/process/sgc-documental/mapa?empresa=${OLP}`);
    await expect(page.getByText('Mapa de documentos').first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Mapa de procesos')).toHaveCount(0);
    await page.getByTestId('sgc-mapa-tipo').first().click();
    await shot(page, testInfo, '05-mapa-de-documentos.png');
  });

  test('4 · firma sin autocompletar: la contraseña arranca vacía, de solo lectura y new-password', async ({ page }, testInfo) => {
    const { tasks } = (await (await page.request.get(`/api/sgc/tasks?request=${idRequest}`)).json()) as { tasks: { idTask: number; task: string; status: string }[] };
    const elab = tasks.find((t) => /^Elaboración/.test(t.task) && t.status === 'abierta')!;
    await page.goto(`/process/sgc-documental/tareas/${elab.idTask}?empresa=${OLP}`);
    await page.getByTestId('sgc-editar-tarea').click();
    await page.getByTestId('sgc-decision').click();
    await page.getByRole('option', { name: /enviar a revisión/ }).first().click();
    await page.getByTestId('sgc-guardar-tarea').click();
    await expect(page.getByTestId('sgc-firma-modal')).toBeVisible();
    const pw = page.getByTestId('sgc-firma-contrasena');
    await expect(pw).toHaveAttribute('autocomplete', 'new-password');
    await expect(pw).toHaveValue('');
    await expect(pw).toHaveAttribute('readonly', '');
    await expect(pw).not.toHaveAttribute('name', /^(password|current-password)$/);
    testInfo.annotations.push({ type: 'firma', description: `autocomplete=${await pw.getAttribute('autocomplete')} name=${await pw.getAttribute('name')} readonly=${(await pw.getAttribute('readonly')) !== null}` });
    await shot(page, testInfo, '06-firma-sin-autocompletar.png');
    await page.keyboard.press('Escape');
  });

  test('5 · «Mis pendientes del SGC»', async ({ page }, testInfo) => {
    await page.goto(`/process/sgc-documental?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-mis-pendientes')).toBeVisible({ timeout: 45_000 });
    const api = await (await page.request.get(`/api/sgc/pendings?company=${OLP}`)).json();
    testInfo.annotations.push({ type: 'pendientes-qa.sgc', description: JSON.stringify(api.counts) });
    await shot(page, testInfo, '07-mis-pendientes.png');
  });

  test('6 · carga masiva de PDF (S9): vista previa sin guardar', async ({ page }, testInfo) => {
    await page.goto(`/process/sgc-documental/carga?empresa=${OLP}`);
    const settings = await (await page.request.get(`/api/sgc/company-settings?company=${OLP}`)).json();
    if (settings.initialLoad.open) await expect(page.getByTestId('sgc-carga-archivos-abrir')).toBeVisible({ timeout: 45_000 });
    else await expect(page.getByTestId('sgc-carga-cerrada')).toBeVisible({ timeout: 45_000 });
    testInfo.annotations.push({ type: 'carga-inicial', description: `abierta=${settings.initialLoad.open} correo=${settings.emailMode}` });
    await shot(page, testInfo, '08-carga-masiva.png');
    if (settings.initialLoad.open) {
      await page.getByTestId('sgc-carga-archivos-abrir').click();
      await shot(page, testInfo, '09-carga-masiva-modal.png');
      await page.keyboard.press('Escape');
    }
  });

  test('7 · aprobadores autorizados (S12)', async ({ page }, testInfo) => {
    await page.goto(`/process/sgc-documental/configuracion?empresa=${OLP}`);
    const tab = page.getByRole('tab', { name: 'Aprobadores autorizados' });
    await expect(tab).toBeVisible({ timeout: 45_000 });
    await tab.click();
    await expect(page.getByTestId('sgc-aprobadores')).toBeVisible();
    const list = await (await page.request.get(`/api/sgc/approvers?company=${OLP}`)).json();
    testInfo.annotations.push({ type: 'aprobadores', description: `aplica=${Boolean(list.applies)}` });
    await shot(page, testInfo, '10-aprobadores-autorizados.png');
  });
});

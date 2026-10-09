import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { STORAGE_STATE, STORAGE_STATE_2, STORAGE_STATE_3 } from '../../playwright.config';
import { cancelQuietly, takeElaboration, U1 } from './roles';

/**
 * SGC documental · Sprint 3 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 * recorrido del flujo documental con la FIRMA ELECTRÓNICA PROPIA del SGC.
 *   - qa.sgc3 crea la solicitud; el elaborador lo fija la configuración y
 *     Calidad (qa.sgc) toma la elaboración (reglas del 2026-10-05, ver
 *     ./roles.ts: quien pide no elabora, ni revisa, ni aprueba);
 *   - qa.sgc edita el borrador EN LA APP y firma «Elaboró» (primero con una
 *     contraseña errada: no se firma);
 *   - qa.sgc2 firma «Revisó» (modo en paralelo; dos revisores distintos
 *     requieren un cuarto usuario QA);
 *   - la aprobación va EN ORDEN (qa.sgc2 → grupo de Calidad, que responde la
 *     lista de chequeo de estructura documental) desde Autorizaciones SGC;
 *   - al cerrar la Aprobación sale el PDF CONTROLADO con su manifiesto, que
 *     se verifica, y el reporte de auditoría del documento lo muestra.
 * Este archivo corre en el proyecto `firma` (sin traza, capturas ni video):
 * escribe contraseñas para reautenticar. Antes lo cubría el recorrido del S2.
 */
const OLP = 3;
const PW1 = process.env.E2E_USER_PASSWORD ?? '';
const PW2 = process.env.E2E_USER_PASSWORD2 ?? '';
const PW3 = process.env.E2E_USER_PASSWORD3 ?? '';
const U2 = process.env.E2E_USER_EMAIL2 ?? '';
const U3 = process.env.E2E_USER_EMAIL3 ?? '';
const hasThree = Boolean(U2 && PW2 && U3 && PW3);

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

/** Completa el formulario de firma (motivo, consentimiento, contraseña y, si aplica, la lista de chequeo). */
async function fillSignature(page: Page, password: string, reason: string, checklist = false) {
  const modal = page.getByTestId('sgc-firma-modal');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('sgc-firma-contenido')).toBeVisible();
  if (checklist) {
    for (const [key, answer] of [['chk_codificacion', 'Cumple'], ['chk_formato', 'Cumple'], ['chk_anexos', 'No aplica']] as const) {
      await page.getByTestId(`sgc-chequeo-${key}`).getByText(answer, { exact: true }).click();
    }
  }
  await page.getByTestId('sgc-firma-motivo').fill(reason);
  await expect(page.getByTestId('sgc-firma-confirmar')).toBeDisabled();
  await page.getByTestId('sgc-firma-consentimiento').check();
  // S7 (SGC-REQ-110): la contraseña de la firma no se autocompleta — arranca vacía, de solo lectura y con new-password.
  const pw = page.getByTestId('sgc-firma-contrasena');
  await expect(pw).toHaveAttribute('autocomplete', 'new-password');
  await expect(pw).not.toHaveAttribute('name', /^(password|current-password)$/);
  await expect(pw).toHaveValue('');
  await expect(pw).toHaveAttribute('readonly', '');
  await pw.click();
  await expect(pw).not.toHaveAttribute('readonly', '');
  await pw.fill(password);
}

async function signInTask(page: Page, idTask: number, option: RegExp, password: string, reason: string) {
  await page.goto(`/process/sgc-documental/tareas/${idTask}?empresa=${OLP}`);
  await expect(page.getByTestId('sgc-tarea-titulo')).toContainText(`Tarea #${idTask}`);
  await page.getByTestId('sgc-editar-tarea').click();
  await chooseOption(page, 'sgc-decision', option);
  await page.getByTestId('sgc-guardar-tarea').click();
  await fillSignature(page, password, reason);
  await page.getByTestId('sgc-firma-confirmar').click();
  await expect(page.getByTestId('sgc-mensaje')).toContainText('Firma registrada', { timeout: 60_000 });
}

async function draftOf(api: APIRequestContext, idRequest: number) {
  const d = (await (await api.get(`/api/sgc/requests/${idRequest}`)).json()) as { currentDraft: { ref: string; sha256: string } };
  return d.currentDraft;
}

test.describe.serial('SGC documental · Sprint 3 · recorrido con firma electrónica propia', () => {
  test.skip(!hasThree || !PW1, 'Requiere los usuarios de pruebas qa.sgc, qa.sgc2 y qa.sgc3 (secretos E2E_SGC_USER*/E2E_SGC_PASSWORD*).');
  let idRequest = 0;

  // Si una prueba falla a mitad, la solicitud de prueba no queda abierta en pruebas.
  test.afterAll(async ({ browser }) => {
    const p1 = await asUser(browser, STORAGE_STATE);
    await cancelQuietly(p1.request, idRequest, 'Limpieza de la prueba e2e del S3 (corrida interrumpida).');
    await p1.context().close();
  });

  test('[SGC-REQ-028][SGC-REQ-032] qa.sgc3 crea la solicitud documental, el elaborador sale de la configuración y Calidad (qa.sgc) la ve en su bandeja de Tareas documentales', async ({ browser, page }) => {
    const p3 = await asUser(browser, STORAGE_STATE_3);
    await p3.goto(`/process/sgc-documental/solicitudes/nueva?empresa=${OLP}`);
    await chooseOption(p3, 'sgc-nueva-proceso', /^GC · /);
    await chooseOption(p3, 'sgc-nueva-tipo-documental', /^PR · /);
    await p3.getByTestId('sgc-nueva-asunto').fill(`E2E S3 · procedimiento firmado ${new Date().toISOString()}`);
    await p3.getByTestId('sgc-nueva-justificacion').fill('Recorrido automático de la e2e del Sprint 3 (datos de prueba, firma electrónica).');
    await chooseOption(p3, 'sgc-campo-urgencia', 'Normal');
    // Sprint 10: esta e2e prueba la firma (no la capacitación): la solicitud se crea sin capacitación.
    await chooseOption(p3, 'sgc-nueva-capacitacion', 'No requiere capacitación');
    // 2026-10-05: quien pide ya no elige al elaborador.
    await expect(p3.getByTestId('sgc-nueva-elaborador')).toHaveCount(0);
    await p3.getByTestId('sgc-nueva-crear').click();
    await p3.waitForURL(/\/process\/sgc-documental\/solicitudes\/\d+/, { timeout: 45_000 });
    idRequest = Number(/solicitudes\/(\d+)/.exec(p3.url())![1]);
    await p3.context().close();
    await takeElaboration(page.request, idRequest, U1);
    await page.goto(`/process/sgc-documental/tareas?empresa=${OLP}`);
    await expect(page.locator(`[data-testid="bandeja-fila"][data-request="${idRequest}"]`)).toContainText('Elaboración');
  });

  test('[SGC-REQ-047][SGC-REQ-048] el elaborador edita el borrador EN LA APP y cada guardado es una revisión con su SHA-256', async ({ page }) => {
    await page.goto(`/process/sgc-documental/solicitudes/${idRequest}/borrador?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-borrador-titulo')).toContainText(`Solicitud #${idRequest}`);
    const editor = page.getByTestId('sgc-borrador-editor').locator('.ProseMirror');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Procedimiento de prueba e2e del Sprint 3. Objetivo: validar la firma electrónica propia del SGC.');
    await page.getByTestId('sgc-borrador-nota').fill('Primera revisión (e2e)');
    await page.getByTestId('sgc-borrador-guardar').click();
    await expect(page.getByTestId('sgc-borrador-mensaje')).toContainText('Revisión 1 guardada');
    await expect(page.getByTestId('sgc-borrador-fila')).toHaveCount(1);
    for (const [stepKey, mode] of [['revision', 'paralelo'], ['aprobacion', 'orden']] as const) {
      const r = await page.request.post(`/api/sgc/requests/${idRequest}/signers`, { data: { stepKey, signers: [U2], mode } });
      expect(r.status()).toBe(200);
    }
  });

  test('[SGC-REQ-038][SGC-REQ-039][SGC-REQ-040][SGC-REQ-110] firmar «Elaboró» exige reautenticación: con contraseña errada NO se firma; con la correcta sí', async ({ page }) => {
    const elab = await taskRow(page.request, idRequest, /^Elaboración/);
    // Sin firma no se aprueba; sin contraseña, 401.
    expect((await page.request.post(`/api/sgc/tasks/${elab!.idTask}/decision`, { data: { decision: 'aprobar' } })).status()).toBe(409);
    expect((await page.request.post(`/api/sgc/tasks/${elab!.idTask}/sign`, { data: { meaning: 'elaboro', reason: 'Soy el autor', consentAccepted: true } })).status()).toBe(401);
    await page.goto(`/process/sgc-documental/tareas/${elab!.idTask}?empresa=${OLP}`);
    await page.getByTestId('sgc-editar-tarea').click();
    await chooseOption(page, 'sgc-decision', /enviar a revisión/);
    await page.getByTestId('sgc-guardar-tarea').click();
    await expect(page.getByTestId('sgc-firma-significado')).toHaveText('Elaboró');
    await fillSignature(page, `${PW1}-errada`, 'Soy el autor del documento y lo envío a revisión.');
    await page.getByTestId('sgc-firma-confirmar').click();
    await expect(page.getByTestId('sgc-firma-error')).toContainText('Contraseña incorrecta');
    expect((await taskRow(page.request, idRequest, /^Elaboración/))?.status).toBe('abierta');
    await page.getByTestId('sgc-firma-contrasena').click();
    await page.getByTestId('sgc-firma-contrasena').fill(PW1);
    await page.getByTestId('sgc-firma-confirmar').click();
    await expect(page.getByTestId('sgc-mensaje')).toContainText('Firma registrada', { timeout: 60_000 });
    await expect(page.getByTestId('sgc-firma-fila').filter({ hasText: 'Elaboró' })).toBeVisible();
    await expect(page.getByTestId('sgc-historial')).toContainText('firmó como «Elaboró»');
  });

  test('[SGC-REQ-029][SGC-REQ-040] qa.sgc2 firma «Revisó» (modo en paralelo) sobre el mismo contenido; qa.sgc3, que pidió, no revisa', async ({ browser }) => {
    const p2 = await asUser(browser, STORAGE_STATE_2);
    const p3 = await asUser(browser, STORAGE_STATE_3);
    // 2026-10-05: quien pidió no revisa ni aprueba (el servidor no le asigna la tarea).
    expect((await taskRow(p3.request, idRequest, /^Revisión/))?.status).not.toBe('abierta');
    const draft = await draftOf(p2.request, idRequest);
    const r2 = await taskRow(p2.request, idRequest, /^Revisión/);
    expect(r2?.status).toBe('abierta');
    await signInTask(p2, r2!.idTask, /Resuelto — aprobar/, PW2, 'Revisé el contenido y es técnicamente correcto.');
    const after = (await (await p2.request.get(`/api/sgc/requests/${idRequest}`)).json()) as { request: { currentTaskKey: string } };
    expect(after.request.currentTaskKey).toBe('aprobacion');
    // Firmó sobre el mismo contenido que dejó el elaborador.
    expect((await draftOf(p2.request, idRequest)).sha256).toBe(draft.sha256);
    await p2.context().close();
    await p3.context().close();
  });

  test('[SGC-REQ-033][SGC-REQ-044][SGC-REQ-045] aprobación EN ORDEN desde Autorizaciones SGC; Calidad responde la lista de chequeo y se genera el PDF controlado', async ({ browser, page }) => {
    const p2 = await asUser(browser, STORAGE_STATE_2);
    const p3 = await asUser(browser, STORAGE_STATE_3);
    await p2.goto(`/process/sgc-documental/autorizaciones?empresa=${OLP}`);
    const mine = p2.locator(`[data-testid="sgc-autorizacion-fila"][data-request="${idRequest}"][data-status="pendiente"]`).filter({ hasText: 'Aprobación de documento SGC' });
    await mine.getByTestId('sgc-autorizar').click();
    await fillSignature(p2, PW2, 'Apruebo el documento para su emisión.');
    await p2.getByTestId('sgc-firma-confirmar').click();
    await expect(p2.getByTestId('sgc-autorizaciones-mensaje')).toContainText('Autorización registrada');

    await p2.reload();
    const pool = p2.locator(`[data-testid="sgc-autorizacion-fila"][data-request="${idRequest}"][data-status="pendiente"]`).filter({ hasText: 'Verificación de estructura documental' });
    await pool.getByTestId('sgc-autorizar').click();
    await expect(p2.getByTestId('sgc-chequeo-calidad')).toBeVisible();
    await fillSignature(p2, PW2, 'Verifiqué la estructura documental y apruebo su emisión.', true);
    await p2.getByTestId('sgc-firma-confirmar').click();
    await expect(p2.getByTestId('sgc-autorizaciones-mensaje')).toContainText('Autorización registrada', { timeout: 90_000 });
    await expect(p2.getByTestId('sgc-autorizaciones-mensaje')).toContainText('PDF controlado');

    const detail = (await (await page.request.get(`/api/sgc/requests/${idRequest}`)).json()) as {
      request: { status: string; currentTaskKey: string };
      signatures: { meaning: string }[];
      qualityChecks: { result: string }[];
      controlledPdf: { status: string; idDocument: number; idDocumentVersion: number };
    };
    // Desde el Sprint 4 la divulgación está habilitada: la solicitud sigue ABIERTA en «Divulgación».
    expect(detail.request).toMatchObject({ status: 'abierta', currentTaskKey: 'divulgacion' });
    expect(detail.signatures.map((s) => s.meaning)).toEqual(['elaboro', 'reviso', 'aprobo', 'aprobo']);
    expect(detail.qualityChecks[0]).toMatchObject({ result: 'conforme' });
    expect(detail.controlledPdf).toMatchObject({ status: 'generado' });
    await p2.context().close();
    await p3.context().close();
  });

  test('[SGC-REQ-046][SGC-REQ-051] el PDF controlado verifica contra su manifiesto y el reporte de auditoría del documento muestra las firmas', async ({ page }) => {
    const detail = (await (await page.request.get(`/api/sgc/requests/${idRequest}`)).json()) as { controlledPdf: { idDocument: number; idDocumentVersion: number } };
    const { idDocument, idDocumentVersion } = detail.controlledPdf;
    const ver = await page.request.get(`/api/sgc/documents/${idDocument}/versions/${idDocumentVersion}/verify`);
    expect(ver.status()).toBe(200);
    expect(await ver.json()).toMatchObject({ ok: true, pdfMatches: true, manifestMatches: true, hasManifest: true });
    await page.goto(`/process/sgc-documental/documentos/${idDocument}?empresa=${OLP}`);
    await page.getByTestId('sgc-verificar-version').first().click();
    await expect(page.getByTestId('sgc-verificacion')).toHaveAttribute('data-ok', 'true');
    await page.keyboard.press('Escape');
    await page.getByTestId('sgc-reporte-cargar').click();
    await expect(page.getByTestId('sgc-cadena-firmas')).toContainText('íntegra');
    await expect(page.locator('[data-testid="sgc-reporte-evento"][data-action="firma.registrada"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="sgc-reporte-evento"][data-action="documento.pdf_controlado"]')).toHaveCount(1);
  });

  test('[SGC-REQ-062] limpieza: Calidad cancela la solicitud de prueba en la divulgación (la versión aprobada queda anulada y no se acumulan lecturas)', async ({ page }) => {
    // Sprint 6: antes cada corrida dejaba una solicitud abierta en divulgación con lecturas para los usuarios QA.
    const res = await page.request.post(`/api/sgc/requests/${idRequest}/cancel`, { data: { reason: 'Limpieza de la prueba e2e del S3: la solicitud de prueba no se divulga.' } });
    expect(res.status()).toBe(200);
    const detail = (await (await page.request.get(`/api/sgc/requests/${idRequest}`)).json()) as { request: { status: string } };
    expect(detail.request.status).toBe('cancelada');
  });
});

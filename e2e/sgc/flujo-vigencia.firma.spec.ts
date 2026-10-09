import ExcelJS from 'exceljs';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { STORAGE_STATE, STORAGE_STATE_2, STORAGE_STATE_3 } from '../../playwright.config';
import { cancelQuietly, takeElaboration } from './roles';

/**
 * SGC documental · Sprint 4 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 * divulgación, capacitación y vigencia.
 *   1. Un documento NUEVO llega aprobado (firmas por la API: ya las cubre la
 *      e2e del S3) y entra a la DIVULGACIÓN con alcance de 3 personas (los
 *      usuarios QA; nunca departamentos, para no notificar a personas reales).
 *   2. qa.sgc3 abre su lectura: «Leído» está deshabilitado y el servidor
 *      rechaza la firma hasta que llega al FINAL del documento; al llegar, firma
 *      «Leído» con reautenticación.
 *   3. Calidad (qa.sgc) registra la capacitación y carga el Excel de
 *      resultados de Forms desde la pantalla; qa.sgc2 (grupo de Calidad)
 *      cierra con «Capacitó» (con reprobados exige justificación) y el
 *      documento queda VIGENTE.
 *   4. Una NUEVA VERSIÓN recorre el flujo: la V2 queda vigente y la V1
 *      OBSOLETA; la verificación del QR lo confirma.
 * Corre en el proyecto `firma` (sin traza, capturas ni video): escribe contraseñas.
 */
const OLP = 3;
const U1 = process.env.E2E_USER_EMAIL ?? '';
const PW1 = process.env.E2E_USER_PASSWORD ?? '';
const U2 = process.env.E2E_USER_EMAIL2 ?? '';
const PW2 = process.env.E2E_USER_PASSWORD2 ?? '';
const U3 = process.env.E2E_USER_EMAIL3 ?? '';
const PW3 = process.env.E2E_USER_PASSWORD3 ?? '';
const hasThree = Boolean(U1 && PW1 && U2 && PW2 && U3 && PW3);
const CHECKLIST = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };

async function ctxFor(browser: Browser, storageState: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState, locale: 'es-CO', timezoneId: 'America/Bogota' });
  return ctx.newPage();
}

async function ok<T = Record<string, unknown>>(res: Awaited<ReturnType<APIRequestContext['get']>>, status = [200, 201]): Promise<T> {
  const body = await res.json().catch(() => ({}));
  expect(status, JSON.stringify(body)).toContain(res.status());
  return body as T;
}

async function taskId(api: APIRequestContext, idRequest: number, name: RegExp): Promise<number> {
  const { tasks } = await ok<{ tasks: { idTask: number; task: string; status: string }[] }>(await api.get(`/api/sgc/tasks?request=${idRequest}`));
  const t = tasks.find((x) => name.test(x.task) && x.status === 'abierta') ?? tasks.find((x) => name.test(x.task));
  expect(t, `tarea ${name} de la solicitud ${idRequest}`).toBeTruthy();
  return t!.idTask;
}

async function sign(api: APIRequestContext, idTask: number, meaning: string, password: string, extra: Record<string, unknown> = {}) {
  return api.post(`/api/sgc/tasks/${idTask}/sign`, { data: { meaning, reason: `Firma ${meaning} de la e2e del Sprint 4.`, consentAccepted: true, password, ...extra } });
}

async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Form1');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const HEAD = ['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Total de puntos'];

/** Lleva una solicitud por elaboración, revisión y aprobación (API) y deja el alcance con las personas dadas. */
// Roles (reglas del 2026-10-05, ver ./roles.ts): qa.sgc3 pide, qa.sgc (Calidad) elabora y qa.sgc2 revisa, aprueba y verifica.
async function throughApproval(p1: Page, p2: Page, idRequest: number, readers: string[]) {
  await takeElaboration(p1.request, idRequest, U1);
  for (const stepKey of ['revision', 'aprobacion']) await ok(await p1.request.post(`/api/sgc/requests/${idRequest}/signers`, { data: { stepKey, signers: [U2], mode: 'orden' } }));
  await ok(await p1.request.post(`/api/sgc/requests/${idRequest}/draft`, { data: { html: '<h1>Procedimiento e2e S4</h1><p>Contenido de prueba de la divulgación, la capacitación y la vigencia.</p>', origin: 'blanco', note: 'e2e S4' } }));
  for (const email of readers) {
    await ok(await p1.request.post(`/api/sgc/requests/${idRequest}/dissemination`, { data: { action: 'agregar', entry: { kind: 'persona', email }, reason: 'Alcance de la e2e del Sprint 4' } }), [201]);
  }
  await ok(await sign(p1.request, await taskId(p1.request, idRequest, /^Elaboración/), 'elaboro', PW1));
  await ok(await sign(p2.request, await taskId(p2.request, idRequest, /^Revisión/), 'reviso', PW2));
  const apr = await taskId(p2.request, idRequest, /^Aprobación/);
  await ok(await sign(p2.request, apr, 'aprobo', PW2));
  const res = await ok<{ controlledPdf: { status: string } }>(await sign(p2.request, apr, 'aprobo', PW2, { checklist: CHECKLIST }));
  expect(res.controlledPdf.status).toBe('generado');
  // Sprint 10: con el flujo de capacitación previa, Calidad registra el material ANTES de la divulgación.
  const d = await ok<{ request: { currentTaskKey: string } }>(await p1.request.get(`/api/sgc/requests/${idRequest}`));
  if (d.request.currentTaskKey === 'preparacion_capacitacion') {
    // El material lo registra Aseguramiento de Calidad (permiso de Calidad del SGC: qa.sgc); la tarea la resuelve el grupo SGC-VERIF-CALIDAD (qa.sgc2).
    await ok(await p1.request.post(`/api/sgc/requests/${idRequest}/training`, { data: TRAINING }));
    await ok(await p2.request.post(`/api/sgc/tasks/${await taskId(p2.request, idRequest, /^Preparación de la capacitación/)}/decision`, { data: { decision: 'aprobar', comment: 'Material listo (e2e).' } }));
  }
}

/** Sprint 10: material de la capacitación de la e2e (evaluación en Microsoft Forms). */
const TRAINING = { mode: 'mixta', title: 'Capacitación e2e del procedimiento', videoUrl: 'https://stream.example.com/e2e-s4', formsUrl: 'https://forms.office.com/r/e2e-s4', sessionDate: '2026-10-05', maxScore: 10, minScorePct: 80 };

/** Lectura completa por la API: abrir el PDF desde el servidor, llegar al final y firmar «Leído». */
async function readAndSign(page: Page, idRequest: number, password: string) {
  const idTask = await taskId(page.request, idRequest, /^Divulgación/);
  const d = await ok<{ reading: { idAssignee: number; content: { ref: string; sha256: string } } }>(await page.request.get(`/api/sgc/tasks/${idTask}`));
  const file = await page.request.get(`/api/sgc/reading/${d.reading.idAssignee}/file`);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('application/pdf');
  await ok(await page.request.post(`/api/sgc/reading/${d.reading.idAssignee}/progress`, { data: { event: 'final', pages: 3 } }));
  return ok<{ outcome: string; next: string }>(await sign(page.request, idTask, 'leyo', password, { idAssignee: d.reading.idAssignee, draftRef: d.reading.content.ref, draftSha256: d.reading.content.sha256 }));
}

test.describe.serial('SGC documental · Sprint 4 · divulgación, capacitación y vigencia', () => {
  test.skip(!hasThree, 'Requiere los usuarios de pruebas qa.sgc, qa.sgc2 y qa.sgc3 (secretos E2E_SGC_USER*/E2E_SGC_PASSWORD*).');
  test.setTimeout(300_000);
  let idRequest = 0;
  let idDocument = 0;
  let code = '';
  let id2 = 0;

  // Si una prueba falla a mitad, las solicitudes de prueba no quedan abiertas en pruebas.
  test.afterAll(async ({ browser }) => {
    const p1 = await ctxFor(browser, STORAGE_STATE);
    for (const id of [idRequest, id2]) await cancelQuietly(p1.request, id, 'Limpieza de la prueba e2e del Sprint 4 (corrida interrumpida).');
    await p1.context().close();
  });

  test('[SGC-REQ-052][SGC-REQ-053][SGC-REQ-054] el documento aprobado entra a la DIVULGACIÓN con una tarea de lectura por persona del alcance', async ({ browser, page }) => {
    const p2 = await ctxFor(browser, STORAGE_STATE_2);
    const p3 = await ctxFor(browser, STORAGE_STATE_3);
    const cat = await ok<{ processes: { id: number; code: string }[]; documentTypes: { id: number; code: string }[] }>(await page.request.get(`/api/sgc/catalogs?company=${OLP}`));
    const created = await ok<{ idRequest: number }>(
      await p3.request.post('/api/sgc/requests', {
        data: { company: OLP, requestType: 'nuevo', subject: `E2E S4 · lectura y vigencia ${new Date().toISOString()}`, description: 'Recorrido automático de la e2e del Sprint 4 (datos de prueba).', idProcess: cat.processes.find((p) => p.code === 'GC')!.id, idDocumentType: cat.documentTypes.find((t) => t.code === 'PR')!.id, requiresTraining: 'si', formValues: { urgencia: 'Normal' } },
      }),
      [201]
    );
    idRequest = created.idRequest;
    await throughApproval(page, p2, idRequest, [U1, U2, U3]);
    const detail = await ok<{ request: { status: string; currentTaskKey: string }; dissemination: { readers: { email: string; status: string }[]; started: boolean }; controlledPdf: { idDocument: number } }>(await page.request.get(`/api/sgc/requests/${idRequest}`));
    expect(detail.request).toMatchObject({ status: 'abierta', currentTaskKey: 'divulgacion' });
    expect(detail.dissemination.readers.map((r) => r.email).sort()).toEqual([U1, U2, U3].map((e) => e.toLowerCase()).sort());
    idDocument = detail.controlledPdf.idDocument;
    await p3.goto(`/process/sgc-documental/tareas?empresa=${OLP}`);
    // La única tarea ABIERTA de qa.sgc3 en esta solicitud es su lectura (revisión y aprobación ya quedaron resueltas).
    const open = p3.locator(`[data-testid="bandeja-fila"][data-request="${idRequest}"][data-status="abierta"]`);
    await expect(open).toHaveCount(1);
    await expect(open).toContainText('Divulgación');
    await p2.context().close();
    await p3.context().close();
  });

  test('[SGC-REQ-055][SGC-REQ-056] «Leído» NO se habilita (ni el servidor lo acepta) sin llegar al final; al llegar, se firma con reautenticación', async ({ browser }) => {
    const p3 = await ctxFor(browser, STORAGE_STATE_3);
    const idTask = await taskId(p3.request, idRequest, /^Divulgación/);
    await p3.goto(`/process/sgc-documental/tareas/${idTask}?empresa=${OLP}`);
    await expect(p3.getByTestId('sgc-lectura')).toBeVisible();
    await expect(p3.getByTestId('sgc-visor-pagina').first()).toBeVisible({ timeout: 60_000 });
    await expect(p3.getByTestId('sgc-lectura-leido')).toBeDisabled();
    const d = await ok<{ reading: { idAssignee: number } }>(await p3.request.get(`/api/sgc/tasks/${idTask}`));
    const early = await sign(p3.request, idTask, 'leyo', PW3, { idAssignee: d.reading.idAssignee });
    expect(early.status()).toBe(409);
    expect((await early.json()).error).toMatch(/final/);
    await p3.getByTestId('sgc-visor-paginas').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(p3.getByTestId('sgc-lectura-avance')).toContainText('Llegó al final');
    await expect(p3.getByTestId('sgc-lectura-leido')).toBeEnabled({ timeout: 30_000 });
    await p3.getByTestId('sgc-lectura-leido').click();
    await expect(p3.getByTestId('sgc-firma-significado')).toHaveText('Leyó');
    await p3.getByTestId('sgc-firma-motivo').fill('Leí el documento completo y entiendo su contenido.');
    await p3.getByTestId('sgc-firma-consentimiento').check();
    await p3.getByTestId('sgc-firma-contrasena').click();
    await p3.getByTestId('sgc-firma-contrasena').fill(PW3);
    await p3.getByTestId('sgc-firma-confirmar').click();
    await expect(p3.getByTestId('sgc-mensaje')).toContainText('Lectura firmada', { timeout: 60_000 });
    await expect(p3.getByTestId('sgc-lectura-estado')).toHaveText('Leído y firmado');
    await p3.context().close();
  });

  test('[SGC-REQ-057] Calidad ve la cobertura y, al firmar los demás, la divulgación pasa a la capacitación', async ({ browser, page }) => {
    await page.goto(`/process/sgc-documental/solicitudes/${idRequest}?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-cobertura')).toContainText('1 de 3');
    const p2 = await ctxFor(browser, STORAGE_STATE_2);
    expect((await readAndSign(p2, idRequest, PW2)).outcome).toBe('abierta');
    expect(await readAndSign(page, idRequest, PW1)).toMatchObject({ outcome: 'resuelta', next: 'capacitacion' });
    await p2.context().close();
  });

  test('[SGC-REQ-058][SGC-REQ-059] Calidad registra la capacitación y carga el Excel de resultados de Forms desde la pantalla', async ({ page }) => {
    await page.goto(`/process/sgc-documental/solicitudes/${idRequest}?empresa=${OLP}`);
    const card = page.getByTestId('sgc-capacitacion');
    await expect(card).toBeVisible();
    // Sprint 10: con la capacitación previa, el material ya quedó registrado antes de la divulgación.
    if (await page.getByTestId('sgc-capacitacion-titulo').isVisible()) {
      await page.getByTestId('sgc-capacitacion-titulo').fill('Capacitación e2e del procedimiento');
      await page.getByTestId('sgc-capacitacion-video').fill('https://stream.example.com/e2e-s4');
      await page.getByTestId('sgc-capacitacion-forms').fill('https://forms.office.com/r/e2e-s4');
      await page.getByTestId('sgc-capacitacion-fecha').fill('2026-10-05');
      await page.getByTestId('sgc-capacitacion-guardar').click();
      await expect(page.getByTestId('sgc-mensaje')).toContainText('Capacitación registrada');
    }
    await expect(page.getByTestId('sgc-capacitacion-tema')).toHaveText('Capacitación e2e del procedimiento');
    const buffer = await xlsx([HEAD, [1, 'a', 'b', U1, 'QA 1', 10], [2, 'a', 'b', U2, 'QA 2', 9], [3, 'a', 'b', U3, 'QA 3', 5]]);
    await card.locator('input[type="file"]').setInputFiles({ name: 'Resultados Forms e2e.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    await expect(page.getByTestId('sgc-mensaje')).toContainText('Resultados de la capacitación cargados', { timeout: 60_000 });
    await expect(page.getByTestId('sgc-capacitacion-resumen')).toContainText('2 aprobaron, 1 reprobaron');
    // Sprint 10: un solo intento reprobado (de 2 permitidos) sigue siendo «Reprobó» (no recapacitación).
    await expect(page.getByTestId(`sgc-capacitado-${U3.toLowerCase()}`)).toContainText('Reprobó');
  });

  test('[SGC-REQ-060][SGC-REQ-061] «Capacitó» con reprobados exige justificación; al firmar, el documento queda VIGENTE', async ({ browser, page }) => {
    const p2 = await ctxFor(browser, STORAGE_STATE_2);
    const idTask = await taskId(p2.request, idRequest, /^Capacitación/);
    const d = await ok<{ training: { upload: { id: number; sha256: string } } }>(await page.request.get(`/api/sgc/requests/${idRequest}`));
    const content = { draftRef: `training_upload:${d.training.upload.id}`, draftSha256: d.training.upload.sha256 };
    const noJust = await sign(p2.request, idTask, 'capacito', PW2, content);
    expect(noJust.status()).toBe(409);
    expect((await noJust.json()).error).toMatch(/justificación/);
    const res = await ok<{ outcome: string; next: string; published: { versionNumber: number; code: string; obsolete: unknown } }>(await sign(p2.request, idTask, 'capacito', PW2, { ...content, comment: 'QA 3 se reprograma para la próxima sesión (e2e).' }));
    expect(res).toMatchObject({ outcome: 'resuelta', next: 'completada', published: { versionNumber: 1, obsolete: null } });
    code = res.published.code;
    const v = await ok<{ verdict: string }>(await page.request.get(`/api/sgc/verify?empresa=${OLP}&codigo=${encodeURIComponent(code)}&version=1`));
    expect(v.verdict).toBe('vigente');
    await p2.context().close();
  });

  test('[SGC-REQ-061][SGC-REQ-062][SGC-REQ-063] una nueva versión recorre el flujo: la V2 queda vigente, la V1 OBSOLETA y la verificación del QR lo muestra', async ({ browser, page }) => {
    const p2 = await ctxFor(browser, STORAGE_STATE_2);
    const p3 = await ctxFor(browser, STORAGE_STATE_3);
    const created = await ok<{ idRequest: number }>(
      await p3.request.post('/api/sgc/requests', { data: { company: OLP, requestType: 'nueva_version', subject: `E2E S4 · nueva versión ${new Date().toISOString()}`, description: 'Nueva versión de la e2e del Sprint 4 (datos de prueba).', idDocument, formValues: { urgencia: 'Normal' } } }),
      [201]
    );
    id2 = created.idRequest;
    await throughApproval(page, p2, id2, [U1]);
    // Mientras se divulga la V2, la V1 sigue vigente.
    expect((await ok<{ verdict: string }>(await page.request.get(`/api/sgc/verify?empresa=${OLP}&codigo=${encodeURIComponent(code)}&version=1`))).verdict).toBe('vigente');
    expect((await ok<{ verdict: string }>(await page.request.get(`/api/sgc/verify?empresa=${OLP}&codigo=${encodeURIComponent(code)}&version=2`))).verdict).toBe('en_divulgacion');
    expect((await readAndSign(page, id2, PW1)).next).toBe('capacitacion');
    await ok(await page.request.post(`/api/sgc/requests/${id2}/training`, { data: { mode: 'video', title: 'Capacitación e2e de la V2', videoUrl: 'https://stream.example.com/e2e-s4-v2', formsUrl: 'https://forms.office.com/r/e2e-s4-v2', maxScore: 10 } }));
    const up = await page.request.post(`/api/sgc/requests/${id2}/training/results`, { multipart: { file: { name: 'Resultados V2.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await xlsx([HEAD, [1, 'a', 'b', U1, 'QA 1', 10]]) } } });
    expect(up.status()).toBe(201);
    const res = await ok<{ published: { versionNumber: number; obsolete: { versionNumber: number } } }>(await sign(p2.request, await taskId(p2.request, id2, /^Capacitación/), 'capacito', PW2));
    expect(res.published).toMatchObject({ versionNumber: 2, obsolete: { versionNumber: 1 } });
    await page.goto(`/process/sgc-documental/verificar?empresa=${OLP}&codigo=${encodeURIComponent(code)}&version=1`);
    await expect(page.getByTestId('sgc-verificar-veredicto')).toHaveText('OBSOLETA');
    await expect(page.getByTestId('sgc-verificar-vigente')).toContainText('V2');
    await page.goto(`/process/sgc-documental/verificar?empresa=${OLP}&codigo=${encodeURIComponent(code)}&version=2`);
    await expect(page.getByTestId('sgc-verificar-veredicto')).toHaveText('VIGENTE');
    await p2.context().close();
    await p3.context().close();
  });
});

import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { STORAGE_STATE, STORAGE_STATE_2, STORAGE_STATE_3 } from '../../playwright.config';
import { cancelQuietly, takeElaboration } from './roles';

/**
 * SGC documental · CORRECCIONES DE CALIDAD OLP (reunión 2026-10-02) CON
 * SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   1. Documento NUEVO desde la PLANTILLA INSTITUCIONAL: el elaborador abre
 *      «Ubicar firmas» (pantalla copiada de SynerLink), las firmas sugeridas
 *      quedan en los recuadros «Firma» del encabezado y las guarda; al aprobar,
 *      el PDF controlado trae el encabezado con los campos de sistema, las
 *      firmas dentro del documento y la fecha de emisión «pendiente» mientras
 *      se divulga.
 *   2. Divulgación a personas QA elegidas a mano: aviso por UMBRAL (se baja a
 *      50 % solo durante la prueba y se restaura) y «No entendí» desde la
 *      pantalla de lectura.
 *   3. «Toda la empresa» deja por fuera los correos de otra empresa (los QA
 *      son @gsslatam.com) sin crear lecturas (la solicitud no se aprueba).
 *   4. Navegación por área → tipo documental.
 *   5. REVISIÓN MENOR de Calidad durante la aprobación y verificación del PDF.
 * Roles (reglas del 2026-10-05, ver ./roles.ts): qa.sgc3 pide, qa.sgc
 * (Calidad) elabora y qa.sgc2 revisa, aprueba y verifica como Calidad.
 * Toda solicitud de prueba que llega a la divulgación usa SOLO personas QA y se
 * cancela al final (no se notifica a personas reales). Corre en el proyecto
 * `firma` (sin traza, capturas automáticas ni video): escribe contraseñas.
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
const TEMPLATE = '<p><strong>Nombre del documento:</strong> {{NOMBRE_DOCUMENTO}}</p><h2>1. OBJETIVO</h2><p>Establecer el procedimiento de prueba de las correcciones de Calidad (e2e).</p><h2>10. HISTORIAL DE CAMBIOS</h2><p>{{HISTORIAL_CAMBIOS}}</p>';

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
  return api.post(`/api/sgc/tasks/${idTask}/sign`, { data: { meaning, reason: `Firma ${meaning} de la e2e de las correcciones de Calidad.`, consentAccepted: true, password, ...extra } });
}

async function newRequest(api: APIRequestContext, subject: string): Promise<number> {
  const cat = await ok<{ processes: { id: number; code: string }[]; documentTypes: { id: number; code: string }[] }>(await api.get(`/api/sgc/catalogs?company=${OLP}`));
  const created = await ok<{ idRequest: number }>(
    await api.post('/api/sgc/requests', { data: { company: OLP, requestType: 'nuevo', subject: `${subject} ${new Date().toISOString()}`, description: 'Recorrido automático de la e2e de las correcciones de Calidad (datos de prueba).', idProcess: cat.processes.find((p) => p.code === 'GC')!.id, idDocumentType: cat.documentTypes.find((t) => t.code === 'PR')!.id, requiresTraining: 'no', formValues: { urgencia: 'Normal' } } }),
    [201]
  );
  return created.idRequest;
}

async function addReaders(api: APIRequestContext, idRequest: number, emails: string[]) {
  for (const email of emails) await ok(await api.post(`/api/sgc/requests/${idRequest}/dissemination`, { data: { action: 'agregar', entry: { kind: 'persona', email }, reason: 'Alcance de la e2e de las correcciones' } }), [201]);
}

async function pdfText(bytes: Buffer, pageNumber: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  return ((await page.getTextContent()).items as { str: string }[]).map((i) => i.str).join(' ');
}

async function cancel(api: APIRequestContext, idRequest: number) {
  const res = await api.post(`/api/sgc/requests/${idRequest}/cancel`, { data: { reason: 'Limpieza de la prueba e2e de las correcciones de Calidad.' } });
  expect([200, 409]).toContain(res.status());
}

test.describe.serial('SGC documental · correcciones de Calidad OLP', () => {
  test.skip(!hasThree, 'Requiere los usuarios de pruebas qa.sgc, qa.sgc2 y qa.sgc3 (secretos E2E_SGC_USER*/E2E_SGC_PASSWORD*).');
  test.setTimeout(300_000);
  let idRequest = 0;

  // Si una prueba falla a mitad, la solicitud de prueba no queda abierta en pruebas.
  test.afterAll(async ({ browser }) => {
    const p1 = await ctxFor(browser, STORAGE_STATE);
    await cancelQuietly(p1.request, idRequest, 'Limpieza de la prueba e2e de las correcciones de Calidad (corrida interrumpida).');
    await p1.context().close();
  });

  test('[SGC-REQ-094][SGC-REQ-095][SGC-REQ-096][SGC-REQ-097] documento desde la plantilla institucional: el elaborador ubica las firmas en el documento y el PDF controlado sale con el encabezado, los campos de sistema y las firmas dentro', async ({ browser, page }, testInfo) => {
    const p2 = await ctxFor(browser, STORAGE_STATE_2);
    const p3 = await ctxFor(browser, STORAGE_STATE_3);
    idRequest = await newRequest(p3.request, 'E2E Calidad · firmas en el documento');
    await takeElaboration(page.request, idRequest, U1);
    for (const stepKey of ['revision', 'aprobacion']) await ok(await page.request.post(`/api/sgc/requests/${idRequest}/signers`, { data: { stepKey, signers: [U2], mode: 'orden' } }));
    await ok(await page.request.post(`/api/sgc/requests/${idRequest}/draft`, { data: { html: TEMPLATE, origin: 'plantilla', originRef: 'Plantilla institucional de procedimiento' } }));
    await addReaders(page.request, idRequest, [U1, U2, U3]);
    const layout = await ok<{ institutionalHeader: boolean; participants: { key: string }[]; suggested: unknown[]; canEdit: boolean }>(await page.request.get(`/api/sgc/requests/${idRequest}/layout`));
    expect(layout).toMatchObject({ institutionalHeader: true, canEdit: true });
    expect(layout.participants).toHaveLength(4);
    expect(layout.suggested).toHaveLength(4);
    // Pantalla «Ubicar firmas» (copia congelada de SynerLink).
    await page.goto(`/process/sgc-documental/solicitudes/${idRequest}?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-firmas-documento')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('sgc-encabezado-institucional')).toBeChecked();
    await page.getByTestId('sgc-abrir-ubicar-firmas').click();
    const modal = page.getByTestId('sgc-ubicar-firmas');
    await expect(modal.getByText('Orden de firma')).toBeVisible();
    await expect(modal.getByAltText('Página 1')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('sgc-ubicar-sugeridas')).toBeVisible();
    await expect(page.getByTestId('sgc-ubicar-conteo')).toHaveText('4 de 4 firmante(s) con cajas listas');
    await testInfo.attach('sgc-ubicar-firmas.png', { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
    await page.getByTestId('sgc-ubicar-guardar').click();
    await expect(page.getByTestId('sgc-mensaje')).toContainText('Ubicación de firmas guardada', { timeout: 30_000 });
    await expect(page.getByTestId('sgc-firmas-documento-conteo')).toHaveText('4 de 4 ubicada(s)');
    // Firmas (reautenticación) hasta la aprobación de Calidad.
    await ok(await sign(page.request, await taskId(page.request, idRequest, /^Elaboración/), 'elaboro', PW1));
    await ok(await sign(p2.request, await taskId(p2.request, idRequest, /^Revisión/), 'reviso', PW2));
    const apr = await taskId(p2.request, idRequest, /^Aprobación/);
    await ok(await sign(p2.request, apr, 'aprobo', PW2));
    const res = await ok<{ controlledPdf: { status: string } }>(await sign(p2.request, apr, 'aprobo', PW2, { checklist: CHECKLIST }));
    expect(res.controlledPdf.status).toBe('generado');
    // El PDF controlado (copia del visor): encabezado y firmas dentro del documento.
    const d = await ok<{ controlledPdf: { idDocument: number; idDocumentVersion: number } }>(await page.request.get(`/api/sgc/requests/${idRequest}`));
    const file = await page.request.get(`/api/sgc/documents/${d.controlledPdf.idDocument}/versions/${d.controlledPdf.idDocumentVersion}/file?modo=consulta`);
    expect(file.status()).toBe(200);
    const text = await pdfText(await file.body(), 2);
    for (const t of ['NOMBRE DEL DOCUMENTO', 'CÓDIGO: OLP-', 'VERSIÓN: 1', 'PÁGINA 1 DE', 'ELABORÓ:', 'REVISÓ:', 'APROBÓ:', 'FECHA DE EMISIÓN:', 'Pendiente: en divulgación', 'PROCESO:']) expect(text, t).toContain(t);
    // 2026-10-05 (#534): la caja de firma lleva solo la representación gráfica (trazo o nombre en cursiva), sin rótulos.
    for (const t of ['Firma electrónica · SynerLink', 'Elaboró ·', 'Revisó ·', 'Aprobó ·']) expect(text, t).not.toContain(t);
    expect(await pdfText(await file.body(), 1)).toContain('estampadas dentro del documento');
    await p2.context().close();
    await p3.context().close();
  });

  test('[SGC-REQ-099][SGC-REQ-100] la lectura avisa al llegar al umbral (una vez) y «No entendí» queda en el historial', async ({ browser, page }) => {
    const before = await ok<{ readThresholdPct: number }>(await page.request.get(`/api/sgc/company-settings?company=${OLP}`));
    await ok(await page.request.put('/api/sgc/company-settings', { data: { company: OLP, readThresholdPct: 50, reason: 'Umbral temporal de la e2e de las correcciones (se restaura al terminar).' } }));
    try {
      const p2 = await ctxFor(browser, STORAGE_STATE_2);
      const p3 = await ctxFor(browser, STORAGE_STATE_3);
      for (const [p, pw] of [[p3, PW3], [p2, PW2]] as const) {
        const idTask = await taskId(p.request, idRequest, /^Divulgación/);
        const det = await ok<{ reading: { idAssignee: number; content: { ref: string; sha256: string } } }>(await p.request.get(`/api/sgc/tasks/${idTask}`));
        expect((await p.request.get(`/api/sgc/reading/${det.reading.idAssignee}/file`)).status()).toBe(200);
        await ok(await p.request.post(`/api/sgc/reading/${det.reading.idAssignee}/progress`, { data: { event: 'final', pages: 2 } }));
        await ok(await sign(p.request, idTask, 'leyo', pw, { idAssignee: det.reading.idAssignee, draftRef: det.reading.content.ref, draftSha256: det.reading.content.sha256 }));
      }
      const view = await ok<{ dissemination: { threshold: { pct: number; notifiedAt: string | null }; coverage: { read: number } } }>(await page.request.get(`/api/sgc/requests/${idRequest}`));
      expect(view.dissemination.coverage.read).toBe(2);
      expect(view.dissemination.threshold.pct).toBe(50);
      expect(view.dissemination.threshold.notifiedAt).not.toBeNull();
      // «No entendí» desde la pantalla de lectura de qa.sgc.
      const idTask = await taskId(page.request, idRequest, /^Divulgación/);
      await page.goto(`/process/sgc-documental/tareas/${idTask}?empresa=${OLP}`);
      await expect(page.getByTestId('sgc-lectura')).toBeVisible({ timeout: 45_000 });
      await page.getByTestId('sgc-no-entendi').click();
      await page.getByTestId('sgc-no-entendi-texto').fill('No entendí qué formato se usa en el paso 3 (e2e).');
      await page.getByTestId('sgc-no-entendi-enviar').click();
      await expect(page.getByTestId('sgc-no-entendi-enviado')).toBeVisible({ timeout: 30_000 });
      const after = await ok<{ dissemination: { doubts: { email: string; body: string }[] }; interactions: { kind: string }[] }>(await page.request.get(`/api/sgc/requests/${idRequest}`));
      expect(after.dissemination.doubts.map((x) => x.email)).toContain(U1.toLowerCase());
      expect(after.interactions.some((i) => i.kind === 'duda')).toBe(true);
      await page.goto(`/process/sgc-documental/solicitudes/${idRequest}?empresa=${OLP}`);
      await expect(page.getByTestId('sgc-no-entendi-lista')).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId('sgc-umbral-lectura')).toContainText('avisado el');
      await p2.context().close();
      await p3.context().close();
    } finally {
      await page.request.put('/api/sgc/company-settings', { data: { company: OLP, readThresholdPct: before.readThresholdPct, reason: 'Se restaura el umbral de aviso de lectura después de la e2e.' } });
      await cancel(page.request, idRequest);
    }
  });

  test('[SGC-REQ-098] «toda la empresa» solo incluye correos de la empresa: los QA (@gsslatam.com) quedan por fuera del alcance automático', async ({ browser, page }) => {
    const p3 = await ctxFor(browser, STORAGE_STATE_3);
    const id = await newRequest(p3.request, 'E2E Calidad · alcance por empresa');
    await p3.context().close();
    try {
      await takeElaboration(page.request, id, U1);
      await ok(await page.request.post(`/api/sgc/requests/${id}/dissemination`, { data: { action: 'agregar', entry: { kind: 'empresa' }, reason: 'Prueba del alcance por empresa (no se aprueba)' } }), [201]);
      const view = await ok<{ dissemination: { companyDomains: string[] | null; outsideCompany: string[] } }>(await page.request.get(`/api/sgc/requests/${id}`));
      expect(view.dissemination.companyDomains).toEqual(['onelatampharma.com']);
      expect(view.dissemination.outsideCompany).toContain(U1.toLowerCase());
      await page.goto(`/process/sgc-documental/solicitudes/${id}?empresa=${OLP}`);
      await expect(page.getByTestId('sgc-alcance-otra-empresa')).toBeVisible({ timeout: 45_000 });
    } finally {
      await cancel(page.request, id);
    }
  });

  test('[SGC-REQ-101] navegación por área → tipo documental → documento (el listado maestro se conserva)', async ({ page }) => {
    await page.goto(`/process/sgc-documental/areas?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-areas')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('sgc-area').first().click();
    await page.getByTestId('sgc-area-tipo').first().click();
    await expect(page.getByTestId('sgc-area-documentos')).toBeVisible();
    await expect(page.getByTestId('sgc-fila-documento').first()).toBeVisible();
    await page.getByTestId('sgc-areas-inicio').click();
    await expect(page.getByTestId('sgc-area').first()).toBeVisible();
    await page.goto(`/process/sgc-documental/listado?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-listado')).toBeVisible({ timeout: 45_000 });
  });

  test('[SGC-REQ-102] Calidad hace una revisión menor durante la aprobación (con motivo) sin devolver el documento; el PDF controlado la declara y verifica', async ({ browser, page }) => {
    // Desde el 2026-10-05 quien pide no elabora y Calidad (qa.sgc) no puede ser la elaboradora para hacer la
    // revisión menor: con solo tres QA no hay quién pida (qa.sgc2 revisa y verifica como Calidad).
    // Requiere un cuarto usuario QA solo con permiso de gestión (propuesta qa.sgc4).
    test.skip(true, 'Requiere un cuarto usuario QA (qa.sgc4): con las reglas del 2026-10-05 tres usuarios no alcanzan para solicitante, elaborador, firmante y Calidad.');
    const p2 = await ctxFor(browser, STORAGE_STATE_2);
    const p3 = await ctxFor(browser, STORAGE_STATE_3);
    // Elabora qa.sgc3 (así Calidad, qa.sgc, no es la elaboradora); revisa y aprueba qa.sgc2.
    const id = await newRequest(p3.request, 'E2E Calidad · revisión menor');
    try {
      for (const stepKey of ['revision', 'aprobacion']) await ok(await p3.request.post(`/api/sgc/requests/${id}/signers`, { data: { stepKey, signers: [U2], mode: 'orden' } }));
      await ok(await p3.request.post(`/api/sgc/requests/${id}/draft`, { data: { html: '<h1>Procedimiento e2e de revisión menor</h1><p>Contenido de prueba, con una coma mal puesta , para corregir.</p>', origin: 'blanco' } }));
      await addReaders(p3.request, id, [U3]);
      await ok(await sign(p3.request, await taskId(p3.request, id, /^Elaboración/), 'elaboro', PW3));
      await ok(await sign(p2.request, await taskId(p2.request, id, /^Revisión/), 'reviso', PW2));
      const apr = await taskId(p2.request, id, /^Aprobación/);
      await ok(await sign(p2.request, apr, 'aprobo', PW2));
      // Calidad (qa.sgc) corrige la coma: revisión menor con motivo.
      const base = await ok<{ html: string; baseSha256: string }>(await page.request.get(`/api/sgc/requests/${id}/draft/base?actual=1`));
      const short = await page.request.post(`/api/sgc/requests/${id}/draft`, { data: { html: base.html.replace(' ,', ','), minor: true, minorReason: 'coma' } });
      expect(short.status()).toBe(400);
      await ok(await page.request.post(`/api/sgc/requests/${id}/draft`, { data: { html: base.html.replace(' ,', ','), minor: true, minorReason: 'Se corrige una coma mal puesta en el contenido (e2e).' } }), [201]);
      const meta = await ok<{ revisions: { minorReason: string | null; baseSha256: string | null }[] }>(await page.request.get(`/api/sgc/requests/${id}/draft`));
      expect(meta.revisions[0]).toMatchObject({ minorReason: 'Se corrige una coma mal puesta en el contenido (e2e).', baseSha256: base.baseSha256 });
      const res = await ok<{ controlledPdf: { status: string } }>(await sign(p2.request, apr, 'aprobo', PW2, { checklist: CHECKLIST }));
      expect(res.controlledPdf.status).toBe('generado');
      const d = await ok<{ controlledPdf: { idDocument: number; idDocumentVersion: number } }>(await page.request.get(`/api/sgc/requests/${id}`));
      const v = await ok<{ ok: boolean; problems: string[] }>(await page.request.get(`/api/sgc/documents/${d.controlledPdf.idDocument}/versions/${d.controlledPdf.idDocumentVersion}/verify`));
      expect(v.ok, JSON.stringify(v.problems)).toBe(true);
      const file = await page.request.get(`/api/sgc/documents/${d.controlledPdf.idDocument}/versions/${d.controlledPdf.idDocumentVersion}/file?modo=consulta`);
      expect(await pdfText(await file.body(), 1)).toContain('Revisión menor de Calidad');
    } finally {
      await cancel(page.request, id);
      await p2.context().close();
      await p3.context().close();
    }
  });
});

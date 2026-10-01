import { PDFDocument, StandardFonts } from 'pdf-lib';
import { expect, request as pwRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { STORAGE_STATE, STORAGE_STATE_3 } from '../../playwright.config';

/**
 * SGC documental · Sprint 5 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   1. Calendario de vencimientos: un documento de prueba que vence en 20
 *      días aparece en su FECHA correcta (mensual y agenda; la semanal muestra 7 días), «próximo a
 *      vencer», en «Mis vencimientos»; desde el calendario se abre la ficha y
 *      se inicia la nueva versión en un clic. «Ejecutar ahora» registra el
 *      aviso UNA sola vez.
 *   2. Mapa de relaciones: Calidad relaciona documentos; el mapa respeta
 *      permisos (qa.sgc3, sin Calidad, no ve el confidencial ni la relación).
 *   3. Solicitud de acceso: qa.sgc3 pide consultar el confidencial
 *      OLP-QA-VERIF-001; Calidad (qa.sgc) la aprueba; qa.sgc3 lo ve; al final
 *      se revoca el acceso para dejar las pruebas como estaban.
 *   4. iCal privado: el enlace entrega el calendario sin sesión y deja de
 *      hacerlo al revocarlo.
 * Nunca escribe contraseñas (usa las sesiones de auth.setup.ts). Al final
 * anula el documento de prueba (no se borra: un sistema auditado anula).
 */
const OLP = 3;
const CONF = 'OLP-QA-VERIF-001';
const has3 = Boolean(process.env.E2E_USER_EMAIL3 && process.env.E2E_USER_PASSWORD3);

async function ok<T = Record<string, unknown>>(res: Awaited<ReturnType<APIRequestContext['get']>>, status = [200, 201]): Promise<T> {
  const body = await res.json().catch(() => ({}));
  expect(status, JSON.stringify(body)).toContain(res.status());
  return body as T;
}

async function ctxFor(browser: Browser, storageState: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState, locale: 'es-CO', timezoneId: 'America/Bogota' });
  return ctx.newPage();
}

const colombiaToday = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
function shift(date: string, months: number, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return new Date(t.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

test.describe.serial('SGC documental · Sprint 5 · vencimientos, mapa y accesos', () => {
  test.setTimeout(180_000);
  let idDoc = 0;
  let code = '';
  let due = '';
  let idConf = 0;

  test('[SGC-REQ-066] Calidad carga un documento de prueba que vence en 20 días', async ({ page }) => {
    const cat = await ok<{ processes: { id: number; code: string }[]; documentTypes: { id: number; code: string }[] }>(await page.request.get(`/api/sgc/catalogs?company=${OLP}`));
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595, 842]).drawText('Documento de prueba de la e2e del Sprint 5 (no oficial).', { x: 60, y: 760, size: 12, font });
    // Vigente desde hace 36 meses menos 20 días: su revisión trienal vence en 20 días.
    const effective = shift(colombiaToday(), -36, 20);
    const res = await ok<{ idDocument: number; code: string }>(
      await page.request.post('/api/sgc/documents', {
        multipart: {
          company: String(OLP), idProcess: String(cat.processes.find((p) => p.code === 'GC')!.id), idDocumentType: String(cat.documentTypes.find((t) => t.code === 'PR')!.id),
          title: `E2E S5 · vencimiento ${new Date().toISOString()}`, confidentiality: 'publica', versionNumber: '1', effectiveDate: effective,
          changeDescription: 'Documento de prueba de la e2e del Sprint 5 (calendario de vencimientos). No es un documento del SGC.',
          pdf: { name: 'e2e-s5.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) },
        },
      }),
      [201]
    );
    idDoc = res.idDocument;
    code = res.code;
    const d = await ok<{ document: { reviewDueDate: string } }>(await page.request.get(`/api/sgc/documents/${idDoc}`));
    due = d.document.reviewDueDate;
    expect(due).toBe(shift(effective, 36, 0));
    const docs = await ok<{ documents: { idDocument: number; code: string }[] }>(await page.request.get(`/api/sgc/documents?company=${OLP}`));
    idConf = docs.documents.find((x) => x.code === CONF)?.idDocument ?? 0;
  });

  test('[SGC-REQ-067][SGC-REQ-079] el calendario muestra la fecha correcta (mensual y agenda), el estado y «Mis vencimientos»; desde él se abre la ficha y se inicia la nueva versión en un clic', async ({ page }) => {
    await page.goto(`/process/sgc-documental/vencimientos?empresa=${OLP}&mes=${due.slice(0, 7)}`);
    const chip = page.locator(`[data-testid="sgc-cal-dia"][data-date="${due}"] [data-testid="sgc-cal-item"][data-code="${code}"]`);
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toHaveAttribute('data-state', 'proximo');
    // «Mis vencimientos»: qa.sgc lo cargó (último elaborador).
    await page.getByTestId('sgc-cal-mios').check();
    await expect(chip).toBeVisible();
    // Agenda: la misma fecha. Semanal: la vista existe y navega por semanas.
    await page.getByTestId('sgc-cal-vista').getByText('Semanal').click();
    await expect(page.getByTestId('sgc-cal-semana')).toBeVisible();
    await expect(page.locator('[data-testid="sgc-cal-semana"] [data-testid="sgc-cal-dia"]')).toHaveCount(7);
    await page.getByTestId('sgc-cal-vista').getByText('Agenda').click();
    await expect(page.locator(`[data-testid="sgc-cal-agenda-fila"][data-code="${code}"]`)).toHaveAttribute('data-date', due);
    await page.getByTestId('sgc-cal-vista').getByText('Mensual').click();
    await page.locator(`[data-testid="sgc-cal-dia"][data-date="${due}"] [data-testid="sgc-cal-item"][data-code="${code}"]`).click();
    await expect(page.getByTestId('sgc-cal-detalle')).toContainText(code);
    await expect(page.getByTestId('sgc-cal-detalle')).toContainText('Próximo a vencer');
    const [y, m, d] = due.split('-').map(Number);
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    await expect(page.getByTestId('sgc-cal-detalle-fecha')).toHaveText(`${d} de ${meses[m - 1]} de ${y}`);
    await expect(page.getByTestId('sgc-cal-abrir-ficha')).toHaveAttribute('href', new RegExp(`/documentos/${idDoc}\\?empresa=${OLP}`));
    await page.getByTestId('sgc-cal-nueva-version').click();
    await page.waitForURL(/\/solicitudes\/nueva\?/);
    expect(page.url()).toContain('tipo=nueva_version');
    expect(page.url()).toContain(`documento=${idDoc}`);
    await expect(page.getByTestId('sgc-nueva-documento')).toHaveValue(new RegExp(code));
    await expect(page.getByTestId('sgc-nueva-asunto')).toHaveValue(new RegExp(`Nueva versión de ${code}`));
    // La ficha también ofrece la nueva versión.
    await page.goto(`/process/sgc-documental/documentos/${idDoc}?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-ficha-nueva-version')).toBeVisible();
  });

  test('[SGC-REQ-068][SGC-REQ-070][SGC-REQ-074] «Ejecutar ahora» registra el aviso anticipado UNA sola vez (con destinatarios y canal) y el registro de Calidad lo muestra', async ({ page }) => {
    const first = await ok<{ summary: { runDate: string } }>(await page.request.post('/api/sgc/review-alerts/run', { data: { company: OLP } }));
    expect(first.summary.runDate).toBe(colombiaToday());
    await ok(await page.request.post('/api/sgc/review-alerts/run', { data: { company: OLP } }));
    const log = await ok<{ alerts: { kind: string; offsetDays: number; status: string; recipients: { email: string }[]; channels: { campana: string }[] }[] }>(await page.request.get(`/api/sgc/review-alerts/log?company=${OLP}&document=${idDoc}`));
    // Vence en 20 días: sale el de 30 y el de 60 queda como omitido (no corrió hace 40 días: el documento no existía).
    expect(log.alerts.filter((a) => a.status === 'enviado').map((a) => `${a.kind}:${a.offsetDays}`)).toEqual(['anticipado:30']);
    expect(log.alerts.filter((a) => a.status === 'omitido').map((a) => a.offsetDays)).toEqual([60]);
    const sent = log.alerts.find((a) => a.status === 'enviado')!;
    expect(sent.recipients.map((r) => r.email)).toContain((process.env.E2E_USER_EMAIL ?? '').toLowerCase());
    expect(sent.channels.every((c) => c.campana === 'enviado')).toBe(true);
    await page.goto(`/process/sgc-documental/vencimientos?empresa=${OLP}`);
    await page.getByTestId('sgc-tab-registro').click();
    await expect(page.locator(`[data-testid="sgc-aviso-fila"][data-code="${code}"][data-status="enviado"]`)).toHaveCount(1);
    await page.getByTestId('sgc-tab-avisos').click();
    await expect(page.getByTestId('sgc-programador')).toBeVisible();
    await expect(page.getByTestId('sgc-avisos-config')).toContainText('60, 30, 15, 7, 0');
  });

  test('[SGC-REQ-071][SGC-REQ-072][SGC-REQ-073][SGC-REQ-075] el mapa de relaciones muestra los documentos relacionados, busca por código y respeta permisos', async ({ browser, page }) => {
    test.skip(!has3 || !idConf, 'Requiere qa.sgc3 y el documento confidencial de verificación.');
    const rel = await ok<{ saved: { id_document_relation: number } }>(
      await page.request.post('/api/sgc/relations', { data: { idSource: idDoc, idTarget: idConf, type: 'referencia', reason: 'Relación de la e2e del Sprint 5' } }),
      [201]
    );
    try {
      await page.goto(`/process/sgc-documental/relaciones?empresa=${OLP}`);
      await expect(page.getByTestId('sgc-mapa-lienzo')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`[data-testid="sgc-mapa-nodo"][data-code="${code}"]`)).toBeVisible();
      await expect(page.locator(`[data-testid="sgc-mapa-nodo"][data-code="${CONF}"]`)).toHaveCount(1);
      await page.getByTestId('sgc-mapa-buscar').fill(code);
      await page.getByTestId('sgc-mapa-centrar').click();
      await expect(page.getByTestId('sgc-mapa-buscar')).not.toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('.react-flow__edge')).not.toHaveCount(0);
      // Ficha: la relación aparece para Calidad.
      await page.goto(`/process/sgc-documental/documentos/${idDoc}?empresa=${OLP}`);
      await expect(page.locator(`[data-testid="sgc-relacion-fila"][data-code="${CONF}"]`)).toBeVisible();
      // qa.sgc3 (sin Calidad) no ve el confidencial ni la relación hacia él.
      const p3 = await ctxFor(browser, STORAGE_STATE_3);
      const g = await ok<{ nodes: { code: string }[]; edges: { source: number; target: number }[] }>(await p3.request.get(`/api/sgc/relations?company=${OLP}`));
      expect(g.nodes.map((n) => n.code)).toContain(code);
      expect(g.nodes.map((n) => n.code)).not.toContain(CONF);
      expect(g.edges.some((e) => e.target === idConf)).toBe(false);
      expect(await ok<{ relations: unknown[] }>(await p3.request.get(`/api/sgc/documents/${idDoc}/relations`))).toEqual({ relations: [] });
      await p3.goto(`/process/sgc-documental/relaciones?empresa=${OLP}`);
      await expect(p3.locator(`[data-testid="sgc-mapa-nodo"][data-code="${code}"]`)).toBeVisible({ timeout: 30_000 });
      await expect(p3.locator(`[data-testid="sgc-mapa-nodo"][data-code="${CONF}"]`)).toHaveCount(0);
      await p3.context().close();
    } finally {
      await ok(await page.request.post(`/api/sgc/relations/${rel.saved.id_document_relation}/remove`, { data: { reason: 'Limpieza de la e2e del Sprint 5' } }));
    }
  });

  test('[SGC-REQ-018][SGC-REQ-077][SGC-REQ-078] qa.sgc3 no ve el confidencial; pide acceso con justificación, Calidad lo aprueba y lo ve (luego se revoca)', async ({ browser, page }) => {
    test.skip(!has3 || !idConf, 'Requiere qa.sgc3 y el documento confidencial de verificación.');
    const p3 = await ctxFor(browser, STORAGE_STATE_3);
    try {
      expect((await p3.request.get(`/api/sgc/documents/${idConf}`)).status()).toBe(404);
      // Si quedó una solicitud pendiente de una corrida anterior, se cancela.
      const before = await ok<{ mine: { id: number; code: string; status: string }[] }>(await p3.request.get(`/api/sgc/access-requests?company=${OLP}`));
      for (const r of before.mine.filter((x) => x.code === CONF && x.status === 'pendiente')) await ok(await p3.request.post(`/api/sgc/access-requests/${r.id}/cancel`, { data: {} }));
      await p3.goto(`/process/sgc-documental/accesos?empresa=${OLP}`);
      await p3.getByText('Escribir el código').click();
      await p3.getByTestId('sgc-acceso-codigo').fill(CONF);
      await p3.getByTestId('sgc-acceso-justificacion').fill('Necesito consultarlo para la prueba automática del Sprint 5.');
      await p3.getByTestId('sgc-acceso-enviar').click();
      await expect(p3.getByTestId('sgc-feedback')).toContainText('Solicitud registrada');
      const mine = await ok<{ mine: { id: number; code: string; status: string }[] }>(await p3.request.get(`/api/sgc/access-requests?company=${OLP}`));
      const req = mine.mine.find((x) => x.code === CONF && x.status === 'pendiente')!;
      expect(req).toBeTruthy();
      // Calidad decide desde la pantalla.
      await page.goto(`/process/sgc-documental/accesos?empresa=${OLP}`);
      await page.getByTestId('sgc-tab-accesos-calidad').click();
      const row = page.locator(`[data-testid="sgc-acceso-fila"][data-id="${req.id}"]`);
      await row.getByTestId('sgc-acceso-aprobar').click();
      await page.getByTestId('sgc-acceso-motivo').fill('Aprobado para la prueba automática del Sprint 5.');
      await page.getByTestId('sgc-acceso-confirmar').click();
      await expect(page.getByTestId('sgc-feedback')).toContainText('aprobado');
      await expect(row).toHaveAttribute('data-status', 'aprobada');
      expect((await p3.request.get(`/api/sgc/documents/${idConf}`)).status()).toBe(200);
    } finally {
      // Se revoca el acceso para que la regla «sin permiso no ve el confidencial» siga valiendo.
      const detail = await ok<{ accesses: { id: number; userEmail: string | null; revokedAt: string | null }[] }>(await page.request.get(`/api/sgc/documents/${idConf}`));
      const me3 = (process.env.E2E_USER_EMAIL3 ?? '').toLowerCase();
      for (const a of detail.accesses.filter((x) => x.userEmail === me3 && !x.revokedAt)) {
        await ok(await page.request.post(`/api/sgc/documents/${idConf}/access/${a.id}/revoke`, { data: { reason: 'Fin de la prueba automática del Sprint 5' } }));
      }
      expect((await p3.request.get(`/api/sgc/documents/${idConf}`)).status()).toBe(404);
      await p3.context().close();
    }
  });

  test('[SGC-REQ-076] el enlace iCal privado entrega el calendario sin sesión y deja de hacerlo al revocarlo', async ({ page, baseURL }) => {
    const link = await ok<{ url: string }>(await page.request.post('/api/sgc/ical', { data: { company: OLP } }), [201]);
    const anon = await pwRequest.newContext({ baseURL });
    const pathOnly = new URL(link.url).pathname;
    const ics = await anon.get(pathOnly);
    expect(ics.status()).toBe(200);
    expect(ics.headers()['content-type']).toContain('text/calendar');
    const text = await ics.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain(`DTSTART;VALUE=DATE:${due.replace(/-/g, '')}`);
    expect(text).toContain(code);
    await ok(await page.request.delete(`/api/sgc/ical?company=${OLP}`));
    expect((await anon.get(pathOnly)).status()).toBe(404);
    await anon.dispose();
  });

  test.afterAll(async ({ browser }) => {
    if (!idDoc) return;
    const page = await ctxFor(browser, STORAGE_STATE);
    await page.request.post(`/api/sgc/documents/${idDoc}/annul`, { data: { reason: 'Fin de la e2e del Sprint 5: documento de prueba.' } }).catch(() => undefined);
    await page.context().close();
  });
});

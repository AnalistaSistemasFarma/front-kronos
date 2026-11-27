import ExcelJS from 'exceljs';
import { expect, test } from '@playwright/test';
import { OLP, createRequestElaboratedByQaSgc } from './flujo-v7';

/**
 * SGC documental · SPRINT 16 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   1. Configuración → «Encabezados»: la lista de plantillas (la por defecto)
 *      y su vista previa. No crea ni cambia plantillas.
 *   2. «Tipos documentales»: el tipo «Formato» admite Word y Excel.
 *   3. Un FORMATO con el borrador en Excel: se carga (sin convertirlo a Word) y
 *      el visor lo muestra compuesto con su encabezado. La solicitud se cancela.
 * Requiere la migración y el SQL de OLP del S16 en KRONOSDB_PRUEBAS.
 */
test.describe('SGC · Sprint 16 (con sesión)', () => {
  test('[SGC-REQ-163] «Encabezados» muestra las plantillas y la vista previa del encabezado', async ({ page }) => {
    const list = await page.request.get(`/api/sgc/header-templates?company=${OLP}`);
    test.skip(list.status() !== 200, 'Sin la migración del S16 en PRUEBAS.');
    const { templates } = (await list.json()) as { templates: { code: string; isDefault: boolean }[] };
    await page.goto(`/process/sgc-documental/configuracion?empresa=${OLP}`);
    await page.getByRole('tab', { name: 'Encabezados' }).click();
    await expect(page.getByTestId('sgc-encabezados')).toBeVisible({ timeout: 45_000 });
    if (templates.length) await expect(page.locator('[data-testid="sgc-encabezado-fila"]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Ver el encabezado institucional' }).click();
    await expect(page.getByTestId('sgc-encabezado-vista-previa').getByRole('img').first()).toBeVisible({ timeout: 45_000 });
  });

  test('[SGC-REQ-164] un formato en Excel se carga como borrador y el visor lo muestra compuesto (sin Word)', async ({ browser, page }) => {
    const cat = (await (await page.request.get(`/api/sgc/catalogs?company=${OLP}`)).json()) as { processes: { id: number; code: string }[]; documentTypes: { id: number; code: string; draftExtensions?: string[] }[] };
    const fo = cat.documentTypes.find((t) => t.code === 'FO');
    test.skip(!fo?.draftExtensions?.includes('xlsx'), 'El tipo «Formato» aún no admite Excel en PRUEBAS (falta el SQL del S16).');
    const { idRequest } = await createRequestElaboratedByQaSgc(browser, page.request, {
      requestType: 'nuevo',
      subject: `E2E S16 · formato en Excel ${new Date().toISOString()}`,
      description: 'Prueba automática del Sprint 16: borrador de un formato en Excel (datos de prueba).',
      idProcess: cat.processes.find((p) => p.code === 'GC')!.id,
      idDocumentType: fo!.id,
      requiresTraining: 'no',
      formValues: { urgencia: 'Normal' },
    });
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Registro');
      ws.mergeCells('A1:C1');
      ws.getCell('A1').value = 'REGISTRO E2E S16';
      ws.addRow(['Fecha', 'Lote', 'Firma']);
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      const up = await page.request.post(`/api/sgc/requests/${idRequest}/attachments`, { multipart: { purpose: 'borrador', file: { name: 'Registro E2E.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer } } });
      expect(up.status(), await up.text()).toBe(201);
      const d = (await (await page.request.get(`/api/sgc/requests/${idRequest}`)).json()) as { currentDraft: { format: string } };
      expect(d.currentDraft.format).toBe('xlsx');
      const preview = await page.request.get(`/api/sgc/requests/${idRequest}/layout/preview`);
      expect(preview.status()).toBe(200);
      expect(preview.headers()['content-type']).toBe('application/pdf');
    } finally {
      await page.request.post(`/api/sgc/requests/${idRequest}/cancel`, { data: { reason: 'Limpieza de la prueba e2e del Sprint 16.' } });
    }
  });
});

import ExcelJS from 'exceljs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { STORAGE_STATE_3 } from '../../playwright.config';
import { takeElaboration, U1 } from './roles';

/**
 * SGC documental · SPRINT 8 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   1. Configuración del SGC muestra el encabezado institucional OBLIGATORIO y
 *      la carga inicial ABIERTA.
 *   2. «Cargar listado maestro (Excel)»: se sube un Excel de EJEMPLO y la
 *      VISTA PREVIA muestra las filas que se cargarían y las que tienen error.
 *      La prueba NO confirma la carga (no deja documentos en PRUEBAS).
 *   3. Un borrador PDF de un documento nuevo se rechaza (va en Word o en el
 *      editor); la solicitud de prueba se cancela al final.
 * Requiere el DDL del Sprint 8 aplicado en KRONOSDB_PRUEBAS.
 */
const OLP = 3;

async function ok<T = Record<string, unknown>>(res: Awaited<ReturnType<APIRequestContext['get']>>, status = [200, 201]): Promise<T> {
  const body = await res.json().catch(() => ({}));
  expect(status, JSON.stringify(body)).toContain(res.status());
  return body as T;
}

async function exampleWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Listado maestro');
  ws.addRow(['Código', 'Nombre del documento', 'Tipo documental (código)', 'Proceso (código)', 'Versión', 'Fecha de vigencia', 'Confidencialidad', 'Código del documento padre']);
  const stamp = Date.now().toString().slice(-6);
  ws.addRow([`E2E-GC-${stamp}`, 'Procedimiento de ejemplo de la e2e del S8', 'PR', 'GC', 2, '2024-05-10', 'publica', '']);
  ws.addRow([`E2E-GC-${stamp}-FO01`, 'Formato de ejemplo de la e2e del S8', 'FO', 'GC', 1, '10/05/2024', '', `E2E-GC-${stamp}`]);
  ws.addRow([`E2E-XX-${stamp}`, 'Fila con proceso inexistente', 'PR', 'XX', 1, '2024-01-01', '', '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test.describe('SGC · Sprint 8 (con sesión)', () => {
  test('[SGC-REQ-111][SGC-REQ-112] Configuración muestra el encabezado obligatorio y la carga inicial abierta', async ({ page }) => {
    await page.goto(`/process/sgc-documental/configuracion?empresa=${OLP}`);
    await page.getByRole('tab', { name: 'Encabezado y divulgación' }).click();
    await expect(page.getByTestId('sgc-config-encabezado-obligatorio')).toContainText('Encabezado obligatorio');
    await expect(page.getByTestId('sgc-config-carga-inicial')).toBeVisible();
  });

  test('[SGC-REQ-114][SGC-REQ-115] el Excel del listado maestro se valida en la vista previa sin cargar nada', async ({ page }) => {
    const before = await ok<{ imports: unknown[] }>(await page.request.get(`/api/sgc/master-list?company=${OLP}`));
    await page.goto(`/process/sgc-documental/carga?empresa=${OLP}`);
    await page.getByTestId('sgc-carga-listado-abrir').click();
    const modal = page.getByTestId('sgc-listado-importar');
    await expect(modal.getByTestId('sgc-listado-plantilla')).toBeVisible();
    await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles({ name: 'listado-ejemplo-e2e.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await exampleWorkbook() });
    await expect(modal).toContainText('3 fila(s) con datos');
    await modal.getByTestId('sgc-listado-simular').click();
    await expect(modal.getByTestId('sgc-listado-importar-resumen')).toContainText('Vista previa (no se cargó nada)');
    await expect(modal.getByTestId('sgc-listado-importar-resumen')).toContainText('Se cargarían: 2');
    await expect(modal.getByTestId('sgc-listado-fila-error')).toHaveCount(1);
    await expect(modal.getByTestId('sgc-listado-cargar')).toBeEnabled();
    const after = await ok<{ imports: unknown[] }>(await page.request.get(`/api/sgc/master-list?company=${OLP}`));
    expect(after.imports).toHaveLength(before.imports.length);
  });

  test('[SGC-REQ-111] el borrador de un documento nuevo no se admite en PDF', async ({ browser, page }) => {
    const api = page.request;
    const cat = await ok<{ processes: { id: number; code: string }[]; documentTypes: { id: number; code: string }[] }>(await api.get(`/api/sgc/catalogs?company=${OLP}`));
    // Reglas del 2026-10-05 (./roles.ts): pide qa.sgc3 y elabora qa.sgc, así el rechazo es por el formato y no por el rol.
    const asker = await browser.newContext({ storageState: STORAGE_STATE_3 });
    const { idRequest } = await ok<{ idRequest: number }>(
      await asker.request.post('/api/sgc/requests', { data: { company: OLP, requestType: 'nuevo', subject: `E2E S8 borrador PDF ${new Date().toISOString()}`, description: 'Prueba automática del Sprint 8: el borrador en PDF se rechaza (datos de prueba).', idProcess: cat.processes.find((p) => p.code === 'GC')!.id, idDocumentType: cat.documentTypes.find((t) => t.code === 'PR')!.id, formValues: { urgencia: 'Normal' } } }),
      [201]
    );
    await asker.close();
    try {
      await takeElaboration(api, idRequest, U1);
      const res = await api.post(`/api/sgc/requests/${idRequest}/attachments`, { multipart: { purpose: 'borrador', file: { name: 'borrador.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') } } });
      expect(res.status()).toBe(415);
      expect((await res.json()).error).toContain('Word');
    } finally {
      await api.post(`/api/sgc/requests/${idRequest}/cancel`, { data: { reason: 'Limpieza de la prueba e2e del Sprint 8.' } });
    }
  });
});

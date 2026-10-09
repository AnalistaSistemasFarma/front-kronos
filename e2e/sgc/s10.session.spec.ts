import { expect, test } from '@playwright/test';
import { STORAGE_STATE_3 } from '../../playwright.config';

/**
 * SGC documental · SPRINT 10 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 * la solicitud nueva pregunta «¿Requiere capacitación?» (sugerencia del
 * solicitante) y la solicitud la muestra como sugerida; quien crea el
 * documento o Calidad la confirma. La solicitud de prueba se cancela.
 * El recorrido completo con el material previo está en flujo-vigencia.firma.spec.ts.
 * Requiere el DDL de los Sprints 8 a 10 y el SQL del flujo con capacitación previa.
 */
const OLP = 3;

test.describe('SGC · Sprint 10 (con sesión)', () => {
  test('[SGC-REQ-122] la solicitud nueva sugiere la capacitación y la solicitud la muestra como sugerida', async ({ browser, page }) => {
    await page.goto(`/process/sgc-documental/solicitudes/nueva?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-nueva-capacitacion')).toBeVisible({ timeout: 30_000 });
    const cat = await (await page.request.get(`/api/sgc/catalogs?company=${OLP}`)).json();
    // Pide qa.sgc3: si pidiera qa.sgc (Calidad), la configuración asignaría la elaboración a una persona real (reglas del 2026-10-05, ver ./roles.ts).
    const asker = await browser.newContext({ storageState: STORAGE_STATE_3 });
    const res = await asker.request.post('/api/sgc/requests', {
      data: { company: OLP, requestType: 'nuevo', subject: `E2E S10 · capacitación sugerida ${new Date().toISOString()}`, description: 'Prueba automática del Sprint 10 (datos de prueba).', idProcess: cat.processes.find((p: { code: string }) => p.code === 'GC').id, idDocumentType: cat.documentTypes.find((t: { code: string }) => t.code === 'PR').id, requiresTraining: 'no', formValues: { urgencia: 'Normal' } },
    });
    expect(res.status()).toBe(201);
    const { idRequest } = await res.json();
    await asker.close();
    try {
      const detail = await (await page.request.get(`/api/sgc/requests/${idRequest}`)).json();
      expect(detail.request.trainingFlag).toMatchObject({ effective: false, source: 'sugerida', suggested: false });
      await page.goto(`/process/sgc-documental/solicitudes/${idRequest}?empresa=${OLP}`);
      await expect(page.getByTestId('sgc-capacitacion-bandera-valor')).toContainText('No', { timeout: 45_000 });
    } finally {
      await page.request.post(`/api/sgc/requests/${idRequest}/cancel`, { data: { reason: 'Limpieza de la prueba e2e del Sprint 10.' } });
    }
  });
});

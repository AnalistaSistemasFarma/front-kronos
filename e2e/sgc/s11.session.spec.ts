import { expect, test } from '@playwright/test';

/**
 * SGC documental · SPRINT 11 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   1. «Copias no controladas»: pestañas y formulario; si hay un formato
 *      vigente, se pide una copia por API y se CANCELA al final (no queda
 *      nada pendiente para Calidad).
 *   2. Visor: el PDF de un documento vigente sale con la protección del
 *      visor (cabecera X-Sgc-Proteccion) y el intento de «Imprimir pantalla»
 *      queda en la auditoría.
 * Requiere el DDL de los Sprints 8 a 11 aplicado en KRONOSDB_PRUEBAS.
 */
const OLP = 3;

type Doc = { idDocument: number; code: string; idVersion: number | null; documentType: { code: string } };

test.describe('SGC · Sprint 11 (con sesión)', () => {
  test('[SGC-REQ-127][SGC-REQ-130] «Copias no controladas» muestra las copias propias y permite pedir (y cancelar) una copia de un formato', async ({ page }) => {
    await page.goto(`/process/sgc-documental/copias?empresa=${OLP}`);
    await expect(page.getByRole('tab', { name: 'Mis copias' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Solicitar copia' }).click();
    await expect(page.getByTestId('sgc-copia-formulario')).toBeVisible();
    const { documents } = (await (await page.request.get(`/api/sgc/documents?company=${OLP}`)).json()) as { documents: Doc[] };
    const { config } = await (await page.request.get(`/api/sgc/uncontrolled-copies?company=${OLP}`)).json();
    const formato = documents.find((d) => config.types.includes(d.documentType.code));
    test.skip(!formato, 'No hay formatos vigentes en PRUEBAS.');
    const res = await page.request.post('/api/sgc/uncontrolled-copies', { data: { company: OLP, idDocument: formato!.idDocument, justification: 'Prueba automática del Sprint 11 (se cancela al final).', destination: 'interno', days: 1 } });
    expect([201, 409]).toContain(res.status());
    if (res.status() === 201) {
      const { idCopyRequest } = await res.json();
      const mine = await (await page.request.get(`/api/sgc/uncontrolled-copies?company=${OLP}`)).json();
      expect(mine.copies.find((c: { id: number }) => c.id === idCopyRequest)).toMatchObject({ status: 'pendiente', canPrint: false });
      expect((await page.request.post(`/api/sgc/uncontrolled-copies/${idCopyRequest}/cancel`, { data: { company: OLP } })).status()).toBe(200);
    }
  });

  test('[SGC-REQ-130][SGC-REQ-131] el visor recibe el PDF con la protección y el intento de captura queda en la auditoría', async ({ page }) => {
    const { documents } = (await (await page.request.get(`/api/sgc/documents?company=${OLP}`)).json()) as { documents: Doc[] };
    const doc = documents.find((d) => d.idVersion);
    test.skip(!doc, 'No hay documentos vigentes en PRUEBAS.');
    const file = await page.request.get(`/api/sgc/documents/${doc!.idDocument}/versions/${doc!.idVersion}/file`);
    expect(file.status()).toBe(200);
    expect(['0', '1']).toContain(file.headers()['x-sgc-proteccion']);
    const ev = await page.request.post('/api/sgc/viewer-events', { data: { event: 'imprimir_pantalla', resource: `/api/sgc/documents/${doc!.idDocument}/versions/${doc!.idVersion}/file` } });
    expect(ev.status()).toBe(201);
  });
});

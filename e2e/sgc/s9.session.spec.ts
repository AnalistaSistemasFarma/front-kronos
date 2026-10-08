import { expect, test } from '@playwright/test';

/**
 * SGC documental · SPRINT 9 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   1. La entrada del módulo muestra «Mis pendientes del SGC».
 *   2. Configuración muestra la política de correo (por defecto «Nunca») y,
 *      con la carga inicial abierta, el botón para cerrarla (no se pulsa).
 *   3. Carga de vigentes: botón «Cargar archivos (PDF)» y vista previa de la
 *      carga masiva por API con nombres de ejemplo (no guarda nada).
 *   4. Mapa de relaciones: Calidad ve «Relacionar documentos» (no se pulsa:
 *      proponer escribe en PRUEBAS).
 * Requiere el DDL de los Sprints 8 y 9 aplicado en KRONOSDB_PRUEBAS.
 */
const OLP = 3;

test.describe('SGC · Sprint 9 (con sesión)', () => {
  test('[SGC-REQ-120] la entrada del SGC muestra «Mis pendientes del SGC» con sus grupos', async ({ page }) => {
    await page.goto(`/process/sgc-documental?empresa=${OLP}`);
    const board = page.getByTestId('sgc-mis-pendientes');
    await expect(board).toBeVisible({ timeout: 30_000 });
    await expect(board.getByTestId('sgc-pendientes-tareas')).toContainText('Tareas documentales');
    await expect(board.getByTestId('sgc-pendientes-lecturas')).toContainText('Lecturas obligatorias');
    const api = await (await page.request.get(`/api/sgc/pendings?company=${OLP}`)).json();
    await expect(page.getByTestId('sgc-mis-pendientes-total')).toContainText(api.counts.total === 0 ? 'No tiene pendientes' : String(api.counts.total));
  });

  test('[SGC-REQ-119][SGC-REQ-121] Configuración muestra la política de correo y el cierre de la carga inicial', async ({ page }) => {
    await page.goto(`/process/sgc-documental/configuracion?empresa=${OLP}`);
    await page.getByRole('tab', { name: 'Encabezado y divulgación' }).click();
    await expect(page.getByTestId('sgc-config-correo')).toBeVisible();
    const settings = await (await page.request.get(`/api/sgc/company-settings?company=${OLP}`)).json();
    expect(['nunca', 'vencimientos', 'resumen_diario']).toContain(settings.emailMode);
    if (settings.initialLoad.open) await expect(page.getByTestId('sgc-config-cerrar-carga')).toBeDisabled();
  });

  test('[SGC-REQ-117] la carga masiva de PDF empareja por código en la vista previa sin guardar nada', async ({ page }) => {
    await page.goto(`/process/sgc-documental/carga?empresa=${OLP}`);
    const settings = await (await page.request.get(`/api/sgc/company-settings?company=${OLP}`)).json();
    if (settings.initialLoad.open) await expect(page.getByTestId('sgc-carga-archivos-abrir')).toBeVisible();
    else await expect(page.getByTestId('sgc-carga-cerrada')).toBeVisible();
    const res = await page.request.post('/api/sgc/master-list/files', { data: { company: OLP, action: 'vista_previa', fileNames: ['NO-EXISTE-E2E-001 Documento.pdf', 'otro.docx'] } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.files.map((f: { status: string }) => f.status)).toEqual(['error', 'error']);
  });

  test('[SGC-REQ-118] Calidad ve «Relacionar documentos» sobre el mapa de relaciones', async ({ page }) => {
    await page.goto(`/process/sgc-documental/relaciones?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-relacionar')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sgc-relacionar-proponer')).toBeEnabled();
  });
});

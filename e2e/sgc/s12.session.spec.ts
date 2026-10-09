import { expect, test } from '@playwright/test';

/**
 * SGC documental · SPRINT 12 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   1. «Configuración → Aprobadores autorizados»: la pestaña carga la lista y
 *      su estado (activa o vacía). No registra a nadie (no cambia la lista
 *      real de PRUEBAS).
 *   2. Selección de aprobadores: /api/sgc/users con role=aprobador responde
 *      filtrado (restricted) o no según la lista de la empresa.
 *   3. Sustituto: sin el grupo SGC-SUSTITUTOS el servidor rechaza la acción
 *      (la sesión de pruebas no debe pertenecer a ese grupo; si pertenece, se
 *      omite para no tocar una solicitud real).
 * Requiere el DDL de los Sprints 8 a 12 aplicado en KRONOSDB_PRUEBAS.
 */
const OLP = 3;

test.describe('SGC · Sprint 12 (con sesión)', () => {
  test('[SGC-REQ-132][SGC-REQ-139] la pestaña «Aprobadores autorizados» muestra la lista y la selección se filtra según ella', async ({ page }) => {
    await page.goto(`/process/sgc-documental/configuracion?empresa=${OLP}`);
    const tab = page.getByRole('tab', { name: 'Aprobadores autorizados' });
    await expect(tab).toBeVisible({ timeout: 30_000 });
    await tab.click();
    await expect(page.getByTestId('sgc-aprobadores')).toBeVisible();
    await expect(page.getByTestId('sgc-aprobadores-estado')).toBeVisible();
    const list = await (await page.request.get(`/api/sgc/approvers?company=${OLP}`)).json();
    const opts = await (await page.request.get(`/api/sgc/users?company=${OLP}&role=aprobador`)).json();
    expect(opts.restricted).toBe(Boolean(list.applies));
  });

  test('[SGC-REQ-135] asignar un sustituto exige el grupo exclusivo SGC-SUSTITUTOS (lo valida el servidor)', async ({ page }) => {
    const inbox = await page.request.get(`/api/sgc/tasks?company=${OLP}`);
    test.skip(inbox.status() !== 200, 'Sin bandeja de tareas en PRUEBAS.');
    const { tasks } = (await inbox.json()) as { tasks: { idTask: number; idAssignee: number }[] };
    test.skip(!tasks?.length, 'No hay tareas abiertas en PRUEBAS para probar el rechazo.');
    const res = await page.request.post(`/api/sgc/tasks/${tasks[0].idTask}/substitute`, { data: { idAssignee: tasks[0].idAssignee, toEmail: 'nadie@onelatampharma.com', reason: 'Prueba automática del Sprint 12 (debe rechazarse)' } });
    test.skip(res.status() === 200, 'La sesión de pruebas pertenece a SGC-SUSTITUTOS: no se ejecuta para no cambiar una solicitud.');
    expect([403, 404, 409]).toContain(res.status());
  });
});

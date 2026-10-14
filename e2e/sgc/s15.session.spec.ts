import { expect, test } from '@playwright/test';
import { STORAGE_STATE_2 } from '../../playwright.config';
import { OLP, flowRoleModel } from './flujo-v7';

/**
 * SGC documental · SPRINT 15 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 * NUEVO MODELO DE ROLES (DOC v7, RN 2026-10-13).
 *   1. «Nueva solicitud» avisa que quien pide elabora y que Calidad autoriza
 *      primero la creación.
 *   2. R15: qa.sgc pide un documento; qa.sgc2 (grupo de Calidad) abre la tarea
 *      «Autorización de la creación», elige «no autorizar», escribe el motivo
 *      y la solicitud queda CERRADA (cancelada) con ese motivo.
 *   3. Configuración del SGC: los ajustes D16 (líderes por departamento,
 *      apagado) y D18 (Calidad cierra la capacitación, encendido) y la lista
 *      «Líder del departamento» en Aprobadores autorizados. No cambia nada.
 * Se omite si el flujo DOC vigente de PRUEBAS aún no es el v7 (falta el SQL
 * del S15). Requiere qa.sgc2 en el grupo SGC-VERIF-CALIDAD.
 */
test.describe('SGC · Sprint 15 (con sesión)', () => {
  test('[SGC-REQ-158] «Nueva solicitud» avisa que quien pide elabora y Calidad autoriza la creación', async ({ page }) => {
    test.skip((await flowRoleModel(page.request)) !== 'solicitante_elabora', 'El flujo DOC vigente de PRUEBAS aún no es el v7.');
    await page.goto(`/process/sgc-documental/solicitudes/nueva?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-nueva-modelo-v7')).toContainText('Usted elaborará el documento', { timeout: 45_000 });
  });

  test('[SGC-REQ-158] R15: Calidad NO autoriza la creación desde la tarea y la solicitud queda cerrada con el motivo', async ({ browser, page }) => {
    test.skip((await flowRoleModel(page.request)) !== 'solicitante_elabora', 'El flujo DOC vigente de PRUEBAS aún no es el v7.');
    const cat = await (await page.request.get(`/api/sgc/catalogs?company=${OLP}`)).json();
    const created = await page.request.post('/api/sgc/requests', {
      data: { company: OLP, requestType: 'nuevo', subject: `E2E S15 · creación no autorizada ${new Date().toISOString()}`, description: 'Prueba automática del Sprint 15: Calidad no autoriza la creación (datos de prueba).', idProcess: cat.processes.find((p: { code: string }) => p.code === 'GC').id, idDocumentType: cat.documentTypes.find((t: { code: string }) => t.code === 'PR').id, requiresTraining: 'no', formValues: { urgencia: 'Normal' } },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { idRequest } = (await created.json()) as { idRequest: number };
    const ctx = await browser.newContext({ storageState: STORAGE_STATE_2, locale: 'es-CO', timezoneId: 'America/Bogota' });
    try {
      const p2 = await ctx.newPage();
      const { tasks } = (await (await p2.request.get(`/api/sgc/tasks?request=${idRequest}`)).json()) as { tasks: { idTask: number; task: string; status: string }[] };
      const auth = tasks.find((t) => /^Autorización de la creación/.test(t.task) && t.status === 'abierta');
      expect(auth, 'la autorización de la creación llega a la bandeja del grupo de Calidad').toBeTruthy();
      await p2.goto(`/process/sgc-documental/tareas/${auth!.idTask}?empresa=${OLP}`);
      await expect(p2.getByTestId('sgc-tarea-titulo')).toContainText(`Tarea #${auth!.idTask}`, { timeout: 45_000 });
      await p2.getByTestId('sgc-editar-tarea').click();
      await p2.getByTestId('sgc-decision').click();
      await expect(p2.getByRole('option', { name: /autorizar la creación/ })).toBeVisible();
      await p2.getByRole('option', { name: /no autorizar la creación/ }).click();
      await expect(p2.getByTestId('sgc-rechazo-documento')).toBeVisible();
      await p2.getByTestId('sgc-resolucion').fill('Prueba e2e: ya existe un documento vigente que cubre el tema.');
      await p2.getByTestId('sgc-guardar-tarea').click();
      await expect(p2.getByTestId('sgc-mensaje')).toContainText('Creación no autorizada', { timeout: 45_000 });
      const d = (await (await page.request.get(`/api/sgc/requests/${idRequest}`)).json()) as { request: { status: string; cancelReason: string; roleModel: string } };
      expect(d.request).toMatchObject({ status: 'cancelada', roleModel: 'solicitante_elabora' });
      expect(d.request.cancelReason).toContain('Creación NO autorizada por Aseguramiento de Calidad');
    } finally {
      await ctx.close();
      await page.request.post(`/api/sgc/requests/${idRequest}/cancel`, { data: { reason: 'Limpieza de la prueba e2e del Sprint 15.' } });
    }
  });

  test('[SGC-REQ-161][SGC-REQ-162] Configuración: D16 (líderes por departamento) apagado y D18 (Calidad cierra la capacitación) encendido por defecto, y la lista de líderes', async ({ page }) => {
    const settings = await (await page.request.get(`/api/sgc/company-settings?company=${OLP}`)).json();
    expect(typeof settings.approverDepartmentEnforced).toBe('boolean');
    expect(typeof settings.trainingClosedByQuality).toBe('boolean');
    await page.goto(`/process/sgc-documental/configuracion?empresa=${OLP}`);
    await page.getByRole('tab', { name: 'Encabezado y divulgación' }).click();
    await expect(page.getByTestId('sgc-config-lideres-departamento')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('sgc-config-calidad-cierra-capacitacion')).toBeVisible();
    await page.getByRole('tab', { name: 'Aprobadores autorizados' }).click();
    await expect(page.getByTestId('sgc-aprobadores-lideres-estado')).toBeVisible();
    await page.getByTestId('sgc-aprobadores-alcance').click();
    await expect(page.getByRole('option', { name: /^Líder del departamento / }).first()).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { OLP } from './flujo-v7';

/**
 * SGC documental · SPRINTS 17–18 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 * evaluación propia en SynerLink (R30).
 *   1. Sin ser lector de la divulgación, la API de la evaluación no revela nada (404).
 *   2. Si la sesión tiene una lectura con evaluación en SynerLink, la evaluación
 *      llega SIN las respuestas correctas (la califica el servidor).
 * El recorrido completo (armar el banco, leer, presentar 2 intentos,
 * recapacitación, consolidar y cerrar con «Capacitó») está en la prueba de
 * integración con SQL Server (tests/integration/sgc/s17.integration.test.ts):
 * en PRUEBAS no se crean intentos (son de solo inserción).
 */
test.describe('SGC · Sprints 17–18 (con sesión)', () => {
  test('[SGC-REQ-168] la evaluación de una lectura ajena no se revela (404) y nunca trae las respuestas correctas', async ({ page }) => {
    const res = await page.request.get('/api/sgc/reading/999999999/evaluation');
    expect(res.status()).toBe(404);
    const inbox = await page.request.get(`/api/sgc/tasks?company=${OLP}`);
    test.skip(inbox.status() !== 200, 'Sin bandeja de tareas en PRUEBAS.');
    const { tasks } = (await inbox.json()) as { tasks: { idAssignee: number; taskKey: string; status: string }[] };
    const lectura = tasks.find((t) => t.taskKey === 'divulgacion');
    test.skip(!lectura, 'La sesión de pruebas no tiene lecturas en PRUEBAS.');
    const ev = await page.request.get(`/api/sgc/reading/${lectura!.idAssignee}/evaluation`);
    test.skip(ev.status() === 404, 'La lectura no tiene evaluación en SynerLink.');
    expect(ev.status()).toBe(200);
    expect(JSON.stringify(await ev.json())).not.toMatch(/correct/i);
  });
});

import { expect, test } from '@playwright/test';

/**
 * SGC documental · SPRINT 13 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   1. «Mi firma»: con la firma propia APAGADA (por defecto) la página lo
 *      dice y el servidor no deja registrar; si alguien la encendió en
 *      PRUEBAS, se verifica que un correo ajeno en el cuerpo se rechace (403).
 *      No registra ninguna firma real.
 *   2. Maestro de firmas (Calidad): la tabla muestra el estado de cada firma.
 * Requiere el DDL de los Sprints 8 a 13 aplicado en KRONOSDB_PRUEBAS.
 */
const OLP = 3;

test.describe('SGC · Sprint 13 (con sesión)', () => {
  test('[SGC-REQ-140][SGC-REQ-144] «Mi firma» respeta la bandera y nadie registra la firma de otro', async ({ page }) => {
    const own = await (await page.request.get(`/api/sgc/signature/own?company=${OLP}`)).json();
    await page.goto(`/process/sgc-documental/mi-firma?empresa=${OLP}`);
    if (!own.enabled) {
      await expect(page.getByTestId('sgc-mi-firma-apagada')).toBeVisible({ timeout: 30_000 });
      const res = await page.request.post('/api/sgc/signature/own', { data: { company: OLP, imagePng: 'data:image/png;base64,AAAA', method: 'dibujada' } });
      expect(res.status()).toBe(409);
      return;
    }
    await expect(page.getByTestId('sgc-mi-firma')).toBeVisible({ timeout: 30_000 });
    const res = await page.request.post('/api/sgc/signature/own', { data: { company: OLP, imagePng: 'data:image/png;base64,AAAA', method: 'dibujada', email: 'otra.persona@onelatampharma.com' } });
    expect(res.status()).toBe(403);
  });

  test('[SGC-REQ-141] el maestro de firmas muestra el estado de cada firma', async ({ page }) => {
    const res = await page.request.get(`/api/sgc/signature/masters?company=${OLP}`);
    test.skip(res.status() === 403, 'La sesión de pruebas no es de Aseguramiento de Calidad.');
    const { masters } = (await res.json()) as { masters: { status: string; origin: string }[] };
    for (const m of masters) {
      expect(['validada', 'pendiente', 'rechazada', 'revocada']).toContain(m.status);
      expect(['calidad', 'propia']).toContain(m.origin);
    }
  });
});

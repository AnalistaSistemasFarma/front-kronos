import { expect, test } from '@playwright/test';

/**
 * Humo del SGC documental (Sprint 0). El ID del requisito va en el título
 * para la matriz de trazabilidad.
 */

test.describe('SGC documental · humo sin sesión', () => {
  test('[SGC-REQ-008] la página del módulo exige sesión y redirige al login', async ({ page }) => {
    await page.goto('/process/sgc-documental');
    await expect(page).toHaveURL(/\/login/);
  });

  test('[SGC-REQ-007] la API de acceso del SGC responde 401 sin sesión', async ({ request }) => {
    const res = await request.get('/api/sgc/access');
    expect(res.status()).toBe(401);
  });

  test('[SGC-REQ-009] las rutas del módulo documental retirado ya no existen', async ({ request }) => {
    for (const path of ['/api/document-management/access', '/api/authorization/document-detail']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
    }
  });
});

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;

test.describe('SGC documental · con sesión', () => {
  test.skip(!email || !password, 'Sin usuario de pruebas (E2E_USER_EMAIL / E2E_USER_PASSWORD).');

  test('[SGC-REQ-010] un usuario con permiso en OLP ve el esqueleto del módulo', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico', { exact: true }).first().fill(email!);
    await page.getByLabel('Contraseña', { exact: true }).first().fill(password!);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    await page.goto('/process/sgc-documental');
    await expect(page.getByTestId('sgc-titulo')).toContainText('Sistema de Gestión de Calidad');
    await expect(page.getByRole('tab', { name: 'Documentos' })).toBeVisible();
    await expect(page.getByTestId('sgc-module-card').first()).toBeVisible();
  });
});

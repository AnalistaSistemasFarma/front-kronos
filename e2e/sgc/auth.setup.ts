import { expect, test as setup, type Page } from '@playwright/test';
import { STORAGE_STATE, STORAGE_STATE_2, STORAGE_STATE_3 } from '../../playwright.config';

/**
 * Inicia sesión una sola vez con cada usuario de pruebas del SGC y guarda la
 * sesión. Este proyecto corre SIN traza ni capturas (ver playwright.config.ts):
 * las contraseñas se escriben solo aquí y no deben quedar en ningún artefacto.
 * Sprint 2: qa.sgc2 y qa.sgc3 (revisores/aprobadores del recorrido), si hay credenciales.
 */
async function login(page: Page, email: string, password: string, path: string) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico', { exact: true }).first().fill(email);
  await page.getByLabel('Contraseña', { exact: true }).first().fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 });
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path });
}

setup('inicio de sesión del usuario de pruebas', async ({ page }) => {
  await login(page, process.env.E2E_USER_EMAIL!, process.env.E2E_USER_PASSWORD!, STORAGE_STATE);
});

setup('inicio de sesión de los usuarios de pruebas 2 y 3 (Sprint 2)', async ({ browser }) => {
  const users = [
    [process.env.E2E_USER_EMAIL2, process.env.E2E_USER_PASSWORD2, STORAGE_STATE_2],
    [process.env.E2E_USER_EMAIL3, process.env.E2E_USER_PASSWORD3, STORAGE_STATE_3],
  ] as const;
  setup.skip(users.some(([e, p]) => !e || !p), 'Sin credenciales de los usuarios de pruebas 2 y 3.');
  for (const [email, password, path] of users) {
    const context = await browser.newContext();
    await login(await context.newPage(), email!, password!, path);
    await context.close();
  }
});

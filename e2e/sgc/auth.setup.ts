import { expect, test as setup } from '@playwright/test';
import { STORAGE_STATE } from '../../playwright.config';

/**
 * Inicia sesión una sola vez con el usuario de pruebas del SGC y guarda la
 * sesión. Este proyecto corre SIN traza ni capturas (ver playwright.config.ts):
 * la contraseña se escribe solo aquí y no debe quedar en ningún artefacto.
 */
setup('inicio de sesión del usuario de pruebas', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico', { exact: true }).first().fill(process.env.E2E_USER_EMAIL!);
  await page.getByLabel('Contraseña', { exact: true }).first().fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 });
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: STORAGE_STATE });
});

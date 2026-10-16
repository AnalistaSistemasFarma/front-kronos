import { expect, test } from '@playwright/test';

/**
 * Humo del SGC documental SIN sesión (Sprint 0 y 1). El ID del requisito va
 * en el título para la matriz de trazabilidad. Las pruebas con sesión están
 * en *.session.spec.ts.
 */

test.describe('SGC documental · humo sin sesión', () => {
  test('[SGC-REQ-008] la página del módulo exige sesión y redirige al login', async ({ page }) => {
    await page.goto('/process/sgc-documental');
    await expect(page).toHaveURL(/\/login/);
  });

  test('[SGC-REQ-008] las páginas del Sprint 1 (listado, mapa, ficha, carga, configuración) exigen sesión', async ({ page }) => {
    for (const path of ['listado', 'mapa', 'documentos/1', 'carga', 'configuracion']) {
      await page.goto(`/process/sgc-documental/${path}`);
      await expect(page, path).toHaveURL(/\/login/);
    }
  });

  test('[SGC-REQ-007] la API de acceso del SGC responde 401 sin sesión', async ({ request }) => {
    const res = await request.get('/api/sgc/access');
    expect(res.status()).toBe(401);
  });

  test('[SGC-REQ-007][SGC-REQ-017] las APIs del Sprint 1 (incluido el archivo del visor) responden 401 sin sesión', async ({ request }) => {
    const gets = ['/api/sgc/catalogs?company=3', '/api/sgc/documents?company=3', '/api/sgc/documents/1', '/api/sgc/documents/1/versions/1/file'];
    for (const path of gets) expect((await request.get(path)).status(), path).toBe(401);
    const posts = ['/api/sgc/documents', '/api/sgc/documents/1/annul', '/api/sgc/documents/1/access', '/api/sgc/config/processes'];
    for (const path of posts) expect((await request.post(path, { data: {} })).status(), path).toBe(401);
  });

  test('[SGC-REQ-009] las rutas del módulo documental retirado ya no existen', async ({ request }) => {
    for (const path of ['/api/document-management/access', '/api/authorization/document-detail']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
    }
  });
});

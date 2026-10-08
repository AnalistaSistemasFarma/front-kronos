import { expect, test } from '@playwright/test';
import { STORAGE_STATE_3 } from '../../playwright.config';

/**
 * SGC documental CON SESIÓN (usuario de pruebas qa.sgc, con los permisos del
 * SGC en One Latam Pharma — incluido Aseguramiento de Calidad — solo en
 * KRONOSDB_PRUEBAS). La sesión la deja auth.setup.ts; aquí nunca se escribe la
 * contraseña. El ID del requisito va en el título (matriz de trazabilidad).
 */
const OLP = 3;

test.describe('SGC documental · con sesión', () => {
  test('[SGC-REQ-010] el tablero muestra la pestaña Documentos con los accesos del Sprint 1 habilitados', async ({ page }) => {
    await page.goto(`/process/sgc-documental?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-titulo')).toContainText('Documentos');
    await expect(page.getByRole('tab', { name: 'Documentos' })).toBeVisible();
    const activos = page.locator('[data-testid="sgc-module-card"][data-enabled="true"]');
    await expect(activos.filter({ hasText: 'Listado maestro' })).toBeVisible();
    await expect(activos.filter({ hasText: 'Mapa de documentos' })).toBeVisible();
    await expect(activos.filter({ hasText: 'Manuales' })).toBeVisible();
  });

  test('[SGC-REQ-015] el listado maestro carga y el buscador filtra por código o título', async ({ page }) => {
    await page.goto(`/process/sgc-documental/listado?empresa=${OLP}`);
    await expect(page.getByTestId('sgc-conteo')).toContainText('documento');
    await page.getByTestId('sgc-buscador').fill('zz-no-existe-ningun-documento-zz');
    await expect(page.getByTestId('sgc-listado-vacio')).toBeVisible();
  });

  test('[SGC-REQ-016] el mapa de documentos muestra los tipos de proceso y sus procesos en cascada', async ({ page }) => {
    await page.goto(`/process/sgc-documental/mapa?empresa=${OLP}`);
    // S7: el rótulo visible es «Mapa de documentos» (recomendación de Calidad); la ruta /mapa no cambia.
    await expect(page.getByText('Mapa de documentos').first()).toBeVisible();
    const tipos = page.getByTestId('sgc-mapa-tipo');
    await expect(tipos.first()).toBeVisible();
    expect(await tipos.count()).toBeGreaterThanOrEqual(4);
    await tipos.first().click();
    await expect(page.getByTestId('sgc-mapa-proceso').first()).toBeVisible();
  });

  test('[SGC-REQ-017] el visor muestra la copia controlada sin descarga ni impresión, y la API niega la descarga', async ({ page }) => {
    const res = await page.request.get(`/api/sgc/documents?company=${OLP}`);
    expect(res.status()).toBe(200);
    const { documents } = (await res.json()) as { documents: { idDocument: number; idVersion: number | null }[] };
    const doc = documents.find((d) => d.idVersion);
    test.skip(!doc, 'No hay documentos vigentes cargados en pruebas para abrir en el visor.');

    await page.goto(`/process/sgc-documental/documentos/${doc!.idDocument}?empresa=${OLP}`);
    await page.getByTestId('sgc-abrir-visor').click();
    await expect(page.getByTestId('sgc-visor-pagina').first()).toBeVisible({ timeout: 45_000 });
    // Sin permiso excepcional: no hay botones de descarga ni impresión, ni visor nativo del navegador.
    await expect(page.getByTestId('sgc-visor-descargar')).toHaveCount(0);
    await expect(page.getByTestId('sgc-visor-imprimir')).toHaveCount(0);
    await expect(page.locator('embed, object, iframe[src*="/file"]')).toHaveCount(0);
    // El menú contextual (guardar imagen) está bloqueado sobre las páginas.
    const bloqueado = await page.getByTestId('sgc-visor-paginas').evaluate((el) => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(bloqueado).toBe(true);
    // La API no entrega descarga ni impresión sin el permiso excepcional.
    const base = `/api/sgc/documents/${doc!.idDocument}/versions/${doc!.idVersion}/file`;
    expect((await page.request.get(`${base}?modo=descarga`)).status()).toBe(403);
    expect((await page.request.get(`${base}?modo=impresion`)).status()).toBe(403);
    const consulta = await page.request.get(base);
    expect(consulta.status()).toBe(200);
    expect(consulta.headers()['content-disposition']).toMatch(/^inline;/);
    expect(consulta.headers()['cache-control']).toContain('no-store');
  });

  test('[SGC-REQ-018][SGC-REQ-004] no se revela un documento inexistente y no hay acceso a una empresa no activada', async ({ page }) => {
    expect((await page.request.get('/api/sgc/documents/99999999')).status()).toBe(404);
    expect((await page.request.get('/api/sgc/documents?company=1')).status()).toBe(403);
    expect((await page.request.get('/api/sgc/catalogs?company=1')).status()).toBe(403);
  });

  test('[SGC-REQ-012] Calidad ve la configuración del SGC con la guía de codificación de OLP', async ({ page }) => {
    await page.goto(`/process/sgc-documental/configuracion?empresa=${OLP}`);
    await expect(page.getByRole('tab', { name: 'Guía de codificación' })).toBeVisible();
    await expect(page.getByText('OLP-GC-PR-001')).toBeVisible();
  });

  // Sprint 5: se usa qa.sgc3 (consulta + gestión, SIN Calidad), creado en el S2.
  test('[SGC-REQ-018] un usuario SIN permiso no ve el documento confidencial', async ({ browser, page }) => {
    test.skip(!process.env.E2E_USER_EMAIL3 || !process.env.E2E_USER_PASSWORD3, 'Requiere el usuario de pruebas qa.sgc3 (sin Calidad).');
    const all = await (await page.request.get(`/api/sgc/documents?company=${OLP}`)).json();
    const conf = (all.documents as { idDocument: number; code: string; confidentiality: string }[]).find((d) => d.confidentiality === 'confidencial');
    test.skip(!conf, 'No hay un documento confidencial vigente en pruebas.');
    const ctx = await browser.newContext({ storageState: STORAGE_STATE_3 });
    const p3 = await ctx.newPage();
    expect((await p3.request.get(`/api/sgc/documents/${conf!.idDocument}`)).status()).toBe(404);
    const mine = await (await p3.request.get(`/api/sgc/documents?company=${OLP}`)).json();
    expect((mine.documents as { code: string }[]).map((d) => d.code)).not.toContain(conf!.code);
    await p3.goto(`/process/sgc-documental/documentos/${conf!.idDocument}?empresa=${OLP}`);
    await expect(p3.getByTestId('sgc-ficha-error')).toBeVisible();
    await ctx.close();
  });
});

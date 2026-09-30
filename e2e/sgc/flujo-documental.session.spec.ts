import { expect, test, type Page } from '@playwright/test';

/**
 * SGC documental · Sprint 2 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 *   - el recorrido del flujo documental pasó a e2e/sgc/flujo-firma.firma.spec.ts
 *     (Sprint 3: cada paso se FIRMA con reautenticación, así que esa prueba
 *     escribe contraseñas y corre sin traza ni capturas);
 *   - administrador de flujos: se crea y se edita un flujo sin código, se
 *     publica y queda en el registro de cambios;
 *   - paridad visual de «Tareas documentales» con «Tareas Asignadas» de SynerLink.
 * La sesión la deja auth.setup.ts; aquí nunca se escribe una contraseña.
 */
const OLP = 3;

test.describe('SGC documental · Sprint 2 · administración de flujos validados', () => {
  test('[SGC-REQ-024][SGC-REQ-025][SGC-REQ-026] se crea y se edita un flujo SIN CÓDIGO, se publica y queda en el registro de cambios', async ({ page }) => {
    const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    await page.goto(`/process/sgc-documental/flujos?empresa=${OLP}`);
    await expect(page.locator('[data-testid="sgc-flujo-fila"][data-code="DOC"]')).toBeVisible();
    await page.getByTestId('sgc-flujo-nuevo').click();
    await page.getByTestId('sgc-nuevo-flujo-codigo').fill(code);
    await page.getByTestId('sgc-nuevo-flujo-nombre').fill('Flujo de prueba e2e (se puede ignorar)');
    await page.getByTestId('sgc-nuevo-flujo-motivo').fill('Prueba automática del administrador de flujos (Sprint 2).');
    await page.getByTestId('sgc-nuevo-flujo-crear').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Flujo creado');
    await expect(page.getByTestId('sgc-version-estado')).toHaveText('borrador');
    await page.getByTestId('sgc-flujo-tarea-nombre').nth(1).fill('Ejecución editada en e2e');
    await page.getByTestId('sgc-flujo-motivo').fill(`Cambio de nombre de la tarea (e2e ${code}).`);
    await page.getByTestId('sgc-flujo-guardar').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Borrador guardado');
    await page.getByTestId('sgc-flujo-publicar').click();
    await page.getByTestId('sgc-modal-motivo').fill(`Publicación de prueba (e2e ${code}).`);
    await page.getByTestId('sgc-modal-confirmar').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Versión publicada');
    await expect(page.getByTestId('sgc-version-estado')).toHaveText('vigente');
    await expect(page.getByTestId('sgc-flujo-tarea-nombre').nth(1)).toBeDisabled();
    await page.getByRole('tab', { name: 'Registro de cambios' }).click();
    await expect(page.getByTestId('sgc-cambio').filter({ hasText: `Publicación de prueba (e2e ${code}).` })).toBeVisible();
    await expect(page.getByTestId('sgc-cambio').filter({ hasText: `Cambio de nombre de la tarea (e2e ${code}).` })).toBeVisible();
  });
});

test.describe('SGC documental · Sprint 2 · paridad visual con SynerLink', () => {
  type Shape = { title: string; titleFont: string; card: string; kpis: string[]; kpiStyle: string; filters: string; headers: string[] };
  async function shape(page: Page): Promise<Shape> {
    return page.evaluate(() => {
      const card = document.querySelector('.mantine-Card-root') as HTMLElement;
      const h1 = card.querySelector('h1') as HTMLElement;
      const cs = (el: Element, props: string[]) => {
        const s = getComputedStyle(el);
        return props.map((p) => `${p}:${s.getPropertyValue(p)}`).join(';');
      };
      const kpiCards = [...card.querySelectorAll('.mantine-Grid-col .mantine-Card-root')] as HTMLElement[];
      const filtersTitle = [...document.querySelectorAll('h3')].map((h) => h.textContent?.trim()).find((t) => t?.startsWith('Filtros')) ?? '';
      return {
        title: h1.textContent?.trim() ?? '',
        titleFont: cs(h1, ['font-size', 'font-weight', 'line-height', 'display', 'gap']),
        card: cs(card, ['border-radius', 'box-shadow', 'padding-top', 'padding-left', 'border-top-width']),
        kpis: kpiCards.map((k) => k.querySelector('p')?.textContent?.trim() ?? ''),
        kpiStyle: kpiCards[0] ? cs(kpiCards[0], ['border-radius', 'padding-top', 'background-color']) : '',
        filters: filtersTitle,
        headers: [...document.querySelectorAll('table th')].map((th) => th.textContent?.trim() ?? ''),
      };
    });
  }

  test('[SGC-REQ-032] «Tareas documentales» se ve igual que «Tareas Asignadas» de SynerLink (misma cabecera, indicadores, filtros y columnas)', async ({ page }, testInfo) => {
    await page.goto('/process/request-general/assigned-activities');
    await expect(page.getByRole('heading', { level: 1, name: /Tareas Asignadas/ })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Lista de Tareas Asignadas')).toBeVisible();
    const synerlink = await shape(page);
    await testInfo.attach('synerlink-tareas-asignadas.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.goto(`/process/sgc-documental/tareas?empresa=${OLP}`);
    await expect(page.getByTestId('bandeja-titulo')).toBeVisible({ timeout: 45_000 });
    const sgc = await shape(page);
    await testInfo.attach('sgc-tareas-documentales.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await testInfo.attach('paridad.json', { body: JSON.stringify({ synerlink, sgc }, null, 2), contentType: 'application/json' });

    expect(sgc.title).toBe('Tareas documentales');
    expect(synerlink.title).toBe('Tareas Asignadas');
    expect(sgc.titleFont).toBe(synerlink.titleFont);
    expect(sgc.card).toBe(synerlink.card);
    expect(sgc.kpis).toEqual(synerlink.kpis);
    expect(sgc.kpiStyle).toBe(synerlink.kpiStyle);
    expect(sgc.filters).toBe(synerlink.filters);
    expect(sgc.headers).toEqual(synerlink.headers);
  });
});

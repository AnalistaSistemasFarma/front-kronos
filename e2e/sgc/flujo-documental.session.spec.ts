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
  // 2026-10-01: el administrador es copia de «Flujos de Trabajo» de SynerLink:
  // lista con filas clicables y vista interna por flujo (/flujos/<id>).
  test('[SGC-REQ-024][SGC-REQ-025][SGC-REQ-026] se crea y se edita un flujo SIN CÓDIGO, se publica y queda en el registro de cambios', async ({ page }) => {
    const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    await page.goto(`/process/sgc-documental/flujos?empresa=${OLP}`);
    await expect(page.locator('[data-testid="sgc-flujo-fila"][data-code="DOC"]')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('sgc-flujo-nuevo').click();
    await page.getByTestId('sgc-nuevo-flujo-codigo').fill(code);
    await page.getByTestId('sgc-nuevo-flujo-nombre').fill('Flujo de prueba e2e (se puede ignorar)');
    await page.getByTestId('sgc-nuevo-flujo-siguiente').click();
    await page.getByTestId('sgc-nuevo-flujo-motivo').fill('Prueba automática del administrador de flujos (Sprint 2).');
    await page.getByTestId('sgc-nuevo-flujo-crear').click();

    // Vista interna del flujo nuevo: versión 1 en borrador.
    await expect(page).toHaveURL(/\/process\/sgc-documental\/flujos\/\d+/, { timeout: 45_000 });
    await expect(page.getByTestId('sgc-titulo')).toContainText(code);
    await expect(page.getByTestId('sgc-version-estado')).toHaveText('borrador');
    await page.getByTestId('sgc-flujo-editar').click();
    await page.getByTestId('sgc-flujo-tarea-nombre').nth(1).fill('Ejecución editada en e2e');
    await page.getByTestId('sgc-flujo-guardar').click();
    await page.getByTestId('sgc-modal-motivo').fill(`Cambio de nombre de la tarea (e2e ${code}).`);
    await page.getByTestId('sgc-modal-confirmar').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Borrador guardado');
    await expect(page.getByTestId('sgc-flujo-tarea').nth(1)).toContainText('Ejecución editada en e2e');

    await page.getByTestId('sgc-flujo-publicar').click();
    await page.getByTestId('sgc-modal-motivo').fill(`Publicación de prueba (e2e ${code}).`);
    await page.getByTestId('sgc-modal-confirmar').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Versión publicada');
    await expect(page.getByTestId('sgc-version-estado')).toHaveText('vigente');
    // La vigente no se edita: solo se crea un borrador nuevo.
    await expect(page.getByTestId('sgc-flujo-editar')).toHaveCount(0);

    // Nueva versión → se inactiva el flujo de prueba (dato del proceso) → se descarta el borrador.
    await page.getByTestId('sgc-flujo-nueva-version').click();
    await page.getByTestId('sgc-modal-motivo').fill(`Nueva versión de prueba (e2e ${code}).`);
    await page.getByTestId('sgc-modal-confirmar').click();
    await expect(page.getByTestId('sgc-version-estado')).toHaveText('borrador');
    await expect(page).toHaveURL(/version=2/);
    await page.getByTestId('sgc-flujo-editar').click();
    await page.getByRole('switch').click({ force: true });
    await page.getByTestId('sgc-flujo-guardar').click();
    await page.getByTestId('sgc-modal-motivo').fill(`Inactivar el flujo de prueba (e2e ${code}).`);
    await page.getByTestId('sgc-modal-confirmar').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Borrador guardado');
    await page.getByTestId('sgc-flujo-descartar').click();
    await page.getByTestId('sgc-modal-motivo').fill(`Descartar borrador de prueba (e2e ${code}).`);
    await page.getByTestId('sgc-modal-confirmar').click();
    await expect(page.getByTestId('sgc-flujos-mensaje')).toContainText('Borrador descartado');
    await expect(page.getByTestId('sgc-version-estado')).toHaveText('vigente');
    await expect(page.getByTestId('sgc-flujo-cabecera')).toContainText('Inactivo');

    await page.getByTestId('sgc-abrir-registro').click();
    for (const reason of [`Publicación de prueba (e2e ${code}).`, `Cambio de nombre de la tarea (e2e ${code}).`, `Inactivar el flujo de prueba (e2e ${code}).`, `Descartar borrador de prueba (e2e ${code}).`]) {
      await expect(page.getByTestId('sgc-cambio').filter({ hasText: reason })).toBeVisible();
    }
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

test.describe('SGC documental · paridad visual del administrador de flujos con SynerLink', () => {
  /**
   * La vista interna de un flujo de Documentos es copia congelada de
   * «view-workflows» de SynerLink. Se compara la estructura y el estilo
   * calculado (tipografía, tarjetas, cajas de datos, tareas y botones), no
   * los datos. view-workflows lee el flujo elegido de sessionStorage (lo deja
   * la lista); como el usuario QA no tiene flujos generales asignados, se deja
   * ahí un flujo de solo lectura (el 110 de pruebas) y la página carga sus
   * tareas. Solo lee: no escribe nada de SynerLink general.
   */
  type FlowShape = {
    titleFont: string;
    headerCard: string;
    headerButton: string;
    sections: string[];
    sectionFont: string;
    sectionCards: string[];
    infoCard: string;
    taskCard: string;
    taskNumber: string;
    infoBox: string;
    infoLabel: string;
    backButton: string;
  };
  async function flowShape(page: Page): Promise<FlowShape> {
    return page.evaluate(() => {
      const cs = (el: Element | null | undefined, props: string[]) => {
        if (!el) return '';
        const s = getComputedStyle(el);
        return props.map((p) => `${p}:${s.getPropertyValue(p)}`).join(';');
      };
      const header = document.querySelector('.mantine-Card-root') as HTMLElement;
      const h2 = [...document.querySelectorAll('h2')] as HTMLElement[];
      const cardOf = (title: string) => h2.find((h) => h.textContent?.trim() === title)?.closest('.mantine-Card-root');
      const activities = cardOf('Flujo de Actividades');
      const back = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Volver a Flujos de Trabajo'));
      return {
        titleFont: cs(header.querySelector('h1'), ['font-size', 'font-weight', 'line-height', 'display', 'gap']),
        headerCard: cs(header, ['border-radius', 'box-shadow', 'padding-top', 'padding-left', 'border-top-width']),
        headerButton: cs(header.querySelector('button'), ['height', 'font-size', 'font-weight', 'border-radius', 'padding-left']),
        sections: h2.slice(0, 3).map((h) => h.textContent?.trim() ?? ''),
        sectionFont: cs(h2[0], ['font-size', 'font-weight', 'line-height', 'color']),
        sectionCards: ['Categoría', 'Proceso', 'Flujo de Actividades'].map((t) => cs(cardOf(t), ['background-color', 'border-radius', 'padding-top', 'box-shadow'])),
        infoCard: cs(cardOf('Categoría')?.querySelector('.mantine-Card-root'), ['border-radius', 'padding-top', 'background-color', 'border-top-width']),
        taskCard: cs(activities?.querySelector('.mantine-Card-root'), ['border-radius', 'padding-top', 'box-shadow', 'border-top-color']),
        taskNumber: cs(activities?.querySelector('.rounded-full.w-12'), ['width', 'height', 'background-color', 'border-radius', 'color']),
        infoBox: cs(activities?.querySelector('.rounded-lg.p-3'), ['padding-top', 'border-radius', 'background-color']),
        infoLabel: cs(activities?.querySelector('.rounded-lg.p-3 .uppercase'), ['font-size', 'font-weight', 'text-transform', 'color']),
        backButton: cs(back, ['height', 'font-size', 'font-weight', 'border-radius', 'border-top-width']),
      };
    });
  }

  test('[SGC-REQ-032] la vista interna de un flujo de Documentos se ve igual que «view-workflows» de SynerLink (tipografía, tarjetas, tablas de tareas y botones)', async ({ page }, testInfo) => {
    await page.goto('/process');
    await page.evaluate(() =>
      sessionStorage.setItem(
        'selectedRequest',
        JSON.stringify({ id: 110, id_category: 0, category: 'Categoría', process: 'Proceso', description: '', active: 1, id_status_process: 0, status_process: '', assigned_category: '', assigned_process_category: '—', company: 'Empresa', id_assigned_process_category: '' })
      )
    );
    await page.goto('/process/request-general/view-workflows?id=110&from=workflows');
    await expect(page.getByRole('heading', { level: 1, name: /Flujo de Trabajo #110/ })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.rounded-full.w-12').first()).toBeVisible({ timeout: 45_000 });
    const synerlink = await flowShape(page);
    await testInfo.attach('synerlink-view-workflows.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.goto(`/process/sgc-documental/flujos?empresa=${OLP}`);
    await page.locator('[data-testid="sgc-flujo-fila"][data-code="DOC"]').click();
    await expect(page.getByTestId('sgc-titulo')).toContainText('Flujo de Trabajo #DOC', { timeout: 45_000 });
    await expect(page.getByTestId('sgc-flujo-tarea-numero').first()).toBeVisible();
    const sgc = await flowShape(page);
    await testInfo.attach('sgc-flujo-doc.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await testInfo.attach('paridad-flujos.json', { body: JSON.stringify({ synerlink, sgc }, null, 2), contentType: 'application/json' });

    expect(sgc.sections).toEqual(['Categoría', 'Proceso', 'Flujo de Actividades']);
    expect(sgc.sections).toEqual(synerlink.sections);
    for (const k of ['titleFont', 'headerCard', 'headerButton', 'sectionFont', 'infoCard', 'taskCard', 'taskNumber', 'infoBox', 'infoLabel', 'backButton'] as const) {
      expect(sgc[k], k).toBe(synerlink[k]);
    }
    expect(sgc.sectionCards).toEqual(synerlink.sectionCards);
  });
});

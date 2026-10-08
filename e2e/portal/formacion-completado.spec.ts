import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · Formación · completado AUTOMÁTICO (Cristian, 2026-10-08).
 *
 * Sin sesión real ni SharePoint: las APIs del portal se simulan con
 * `page.route`. Se prueba que el estudiante vea las casillas bloqueadas con
 * su ayuda, que al revisar un material la casilla quede marcada con
 * "Completado" a la derecha, y que un administrador/formador las tenga
 * editables. Además, que las rutas reales exijan sesión.
 *
 * Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;

const curso = { id: 3, titulo: 'INDUCCIÓN FARMALOGICA', descripcion: 'Inducción corporativa', activo: true, creadoPor: 'th@gsslatam.com' };

function material(id: number, titulo: string, completado: boolean, mime = 'video/mp4') {
  return {
    id,
    tipo: 'DOCUMENT',
    titulo,
    orden: id,
    url: null,
    nombreArchivo: `${titulo}.mp4`,
    mime,
    obligatorio: true,
    completadoEl: completado ? '2026-10-08T15:00:00Z' : null,
  };
}

async function simular(page: Page, opciones: { puedeMarcarManual: boolean; completados: number[] }) {
  const estado = { completados: new Set(opciones.completados) };
  const detalle = () => {
    const materiales = [
      material(1, 'Bienvenida Farmalogica', estado.completados.has(1)),
      material(2, 'Reglamento interno', estado.completados.has(2), 'application/pdf'),
    ];
    return {
      curso,
      esFormador: false,
      puedeMarcarManual: opciones.puedeMarcarManual,
      porcentaje: Math.round((estado.completados.size / materiales.length) * 100),
      materiales,
      certificado: null,
    };
  };
  await page.route('**/api/portal/courses', (r) =>
    r.fulfill({
      json: {
        esFormador: false,
        cursos: [{ ...curso, totalMateriales: 2, totalInscritos: 4, inscrito: true, porcentaje: detalle().porcentaje, certificado: null }],
      },
    })
  );
  await page.route('**/api/portal/courses/3', (r) => r.fulfill({ json: detalle() }));
  await page.route('**/api/portal/materials/*/vista', (r) =>
    r.fulfill({
      json: { token: '11111111-2222-4333-8444-555555555555', regla: { tipo: 'pdf', segundosMinimos: 2, fraccionVideo: 0.9 }, completado: false },
    })
  );
  await page.route('**/api/portal/materials/*/vista/*', (r) => {
    const id = Number(r.request().url().split('/materials/')[1].split('/')[0]);
    estado.completados.add(id);
    return r.fulfill({ json: { ok: true, completado: true, porcentaje: detalle().porcentaje, certificado: null } });
  });
  await page.route('**/api/portal/courses/3/materials/*/file', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html><body><h1>Reglamento interno (simulado)</h1></body></html>' })
  );
  await page.route('**/api/portal/materials/*/progress', (r) =>
    opciones.puedeMarcarManual
      ? r.fulfill({ json: { ok: true, porcentaje: 100, certificado: null } })
      : r.fulfill({ status: 403, json: { error: 'Solo administradores y formadores.' } })
  );
}

test.describe('Portal TH · Formación · completado automático', () => {
  test('las rutas de marcado y revisión exigen sesión', async ({ request }) => {
    expect((await request.post('/api/portal/materials/1/progress')).status()).toBe(401);
    expect((await request.post('/api/portal/materials/1/vista')).status()).toBe(401);
    expect(
      (await request.post('/api/portal/materials/1/vista/11111111-2222-4333-8444-555555555555', { data: { segundosVistos: 1 } })).status()
    ).toBe(401);
  });

  test('estudiante: casillas bloqueadas y "Completado" al revisar', async ({ page }) => {
    await simular(page, { puedeMarcarManual: false, completados: [] });
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: /INDUCCIÓN FARMALOGICA/ }).click();

    const casillas = page.getByRole('checkbox');
    await expect(casillas).toHaveCount(2);
    for (const c of await casillas.all()) {
      await expect(c).toHaveAttribute('aria-disabled', 'true');
      await expect(c).toHaveAttribute('title', 'Se marca automáticamente al revisar el material');
    }
    await expect(page.getByTestId('insignia-completado')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/1-estudiante-casillas-bloqueadas.png`, fullPage: true });

    // Abre el PDF en el visor: el tiempo corre y el servidor (simulado) lo marca.
    await page.getByRole('button', { name: 'Reglamento interno' }).click();
    const visor = page.getByTestId('visor-material');
    await expect(visor.getByTestId('estado-revision')).toContainText('Revisando');
    await expect(visor.getByTestId('estado-revision')).toContainText('Completado', { timeout: 10_000 });
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/2-visor-material-completado.png` });
    await page.keyboard.press('Escape');

    await expect(page.getByText('"Reglamento interno" quedó completado.')).toBeVisible();
    const fila = page.locator('.portal-th__material-item', { hasText: 'Reglamento interno' });
    await expect(fila.getByTestId('insignia-completado')).toHaveText('✓ Completado');
    await expect(fila.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/3-estudiante-material-completado.png`, fullPage: true });
  });

  test('curso al 100 %: "Completado" a la derecha de la barra', async ({ page }) => {
    await simular(page, { puedeMarcarManual: false, completados: [1, 2] });
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: /INDUCCIÓN FARMALOGICA/ }).click();
    await expect(page.locator('.portal-th__progreso-fila').getByTestId('insignia-completado')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/4-curso-completado.png`, fullPage: true });
  });

  test('administrador/formador: casillas editables a mano', async ({ page }) => {
    await simular(page, { puedeMarcarManual: true, completados: [1] });
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: /INDUCCIÓN FARMALOGICA/ }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    const boton = page.getByRole('button', { name: 'Marcar Reglamento interno como completado' });
    await expect(boton).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Marcar Bienvenida Farmalogica como pendiente' })).toBeEnabled();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/5-formador-casillas-editables.png`, fullPage: true });
  });
});

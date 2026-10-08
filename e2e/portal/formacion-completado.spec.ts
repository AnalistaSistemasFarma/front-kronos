import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Portal TH · Formación · completado AUTOMÁTICO (Cristian, 2026-10-08) y sus
 * ajustes del mismo día:
 *   - documentos sin tiempo mínimo (se marcan al abrirlos);
 *   - video en la ventana de vista previa, sin poder adelantar, con contador
 *     y completado al 100 %;
 *   - PDF página por página con barra de lectura, completado en la última.
 *
 * Sin sesión real ni SharePoint: las APIs del portal se simulan con
 * `page.route`; el video es un webm de 4 s de `e2e/fixtures/portal` y los PDF
 * se generan aquí con pdf-lib. Además, que las rutas reales exijan sesión.
 *
 * Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const VIDEO = readFileSync(path.join(__dirname, '..', 'fixtures', 'portal', 'video-4s.webm'));
const DURACION_VIDEO = 4;

async function pdfDePaginas(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= n; i++) {
    const pagina = doc.addPage([595, 842]);
    // Helvetica estándar de pdf-lib no trae tildes: texto sin ellas.
    pagina.drawText(`Manual de induccion - pagina ${i} de ${n}`, {
      x: 60,
      y: 760,
      size: 22,
      font: fuente,
      color: rgb(0.1, 0.235, 0.43),
    });
  }
  return Buffer.from(await doc.save());
}

const curso = { id: 3, titulo: 'INDUCCIÓN FARMALOGICA', descripcion: 'Inducción corporativa', activo: true, creadoPor: 'th@gsslatam.com' };

function material(id: number, titulo: string, completado: boolean, mime: string) {
  return {
    id,
    tipo: 'DOCUMENT',
    titulo,
    orden: id,
    url: null,
    nombreArchivo: titulo,
    mime,
    obligatorio: true,
    completadoEl: completado ? '2026-10-08T15:00:00Z' : null,
  };
}

/** 1 = video (4 s), 2 = PDF de 1 página, 3 = PDF de 5 páginas. */
async function simular(page: Page, opciones: { puedeMarcarManual: boolean; completados: number[] }) {
  const estado = { completados: new Set(opciones.completados) };
  const pdf1 = await pdfDePaginas(1);
  const pdf5 = await pdfDePaginas(5);
  const detalle = () => {
    const materiales = [
      material(1, 'Bienvenida Farmalogica', estado.completados.has(1), 'video/webm'),
      material(2, 'Reglamento interno', estado.completados.has(2), 'application/pdf'),
      material(3, 'Manual de inducción', estado.completados.has(3), 'application/pdf'),
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
  const idDe = (url: string) => Number(url.split('/materials/')[1].split('/')[0]);

  await page.route('**/api/portal/courses', (r) =>
    r.fulfill({
      json: {
        esFormador: false,
        cursos: [{ ...curso, totalMateriales: 3, totalInscritos: 4, inscrito: true, porcentaje: detalle().porcentaje, certificado: null }],
      },
    })
  );
  await page.route('**/api/portal/courses/3', (r) => r.fulfill({ json: detalle() }));
  // Apertura: imitan al servidor. El PDF de 1 página se marca al abrirlo.
  await page.route('**/api/portal/materials/*/vista', (r) => {
    const id = idDe(r.request().url());
    const token = '11111111-2222-4333-8444-555555555555';
    if (id === 1) {
      return r.fulfill({ json: { token, regla: { tipo: 'video', segundosMinimos: 0, fraccionVideo: 1, paginas: null }, completado: false } });
    }
    if (id === 2) {
      estado.completados.add(2);
      return r.fulfill({ json: { token, regla: { tipo: 'pdf', segundosMinimos: 0, fraccionVideo: 1, paginas: 1 }, completado: true } });
    }
    return r.fulfill({ json: { token, regla: { tipo: 'pdf', segundosMinimos: 0, fraccionVideo: 1, paginas: 5 }, completado: false } });
  });
  // Reporte: imitan la validación del servidor.
  await page.route('**/api/portal/materials/*/vista/*', (r) => {
    const id = idDe(r.request().url());
    const cuerpo = r.request().postDataJSON() as { segundosVistos: number; duracion?: number; paginaMaxima?: number };
    const ok = id === 1 ? cuerpo.segundosVistos + 1 >= (cuerpo.duracion ?? Infinity) : (cuerpo.paginaMaxima ?? 0) >= 5;
    if (!ok) return r.fulfill({ status: 422, json: { error: 'Aún no.' } });
    estado.completados.add(id);
    return r.fulfill({ json: { ok: true, completado: true, porcentaje: detalle().porcentaje, certificado: null } });
  });
  await page.route('**/api/portal/courses/3/materials/*/file', (r) => {
    const id = idDe(r.request().url());
    if (id === 1) return r.fulfill({ contentType: 'video/webm', body: VIDEO });
    return r.fulfill({ contentType: 'application/pdf', body: id === 2 ? pdf1 : pdf5 });
  });
  await page.route('**/api/portal/materials/*/progress', (r) =>
    opciones.puedeMarcarManual
      ? r.fulfill({ json: { ok: true, porcentaje: 100, certificado: null } })
      : r.fulfill({ status: 403, json: { error: 'Solo administradores y formadores.' } })
  );
}

async function abrirCurso(page: Page) {
  await page.goto('/portal/formacion');
  await page.getByRole('button', { name: /INDUCCIÓN FARMALOGICA/ }).click();
}

test.describe('Portal TH · Formación · completado automático', () => {
  test('las rutas de marcado y revisión exigen sesión', async ({ request }) => {
    expect((await request.post('/api/portal/materials/1/progress')).status()).toBe(401);
    expect((await request.post('/api/portal/materials/1/vista')).status()).toBe(401);
    expect(
      (await request.post('/api/portal/materials/1/vista/11111111-2222-4333-8444-555555555555', { data: { segundosVistos: 1 } })).status()
    ).toBe(401);
  });

  test('estudiante: casillas bloqueadas y PDF de 1 página "Completado" al abrirlo', async ({ page }) => {
    await simular(page, { puedeMarcarManual: false, completados: [] });
    await abrirCurso(page);

    const casillas = page.getByRole('checkbox');
    await expect(casillas).toHaveCount(3);
    for (const c of await casillas.all()) {
      await expect(c).toHaveAttribute('aria-disabled', 'true');
      await expect(c).toHaveAttribute('title', 'Se marca automáticamente al revisar el material');
    }
    await expect(page.getByTestId('insignia-completado')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/1-estudiante-casillas-bloqueadas.png`, fullPage: true });

    await page.getByRole('button', { name: 'Reglamento interno' }).click();
    const visor = page.getByTestId('visor-material');
    await expect(visor.getByTestId('estado-revision')).toContainText('Completado', { timeout: 5_000 });
    // Una sola página: sin barra ni botones.
    await expect(visor.getByTestId('lectura-pdf')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/2-visor-pdf-una-pagina-completado.png` });
    await page.keyboard.press('Escape');

    await expect(page.getByText('"Reglamento interno" quedó completado.')).toBeVisible();
    const fila = page.locator('.portal-th__material-item', { hasText: 'Reglamento interno' });
    await expect(fila.getByTestId('insignia-completado')).toHaveText('✓ Completado');
    await expect(fila.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/3-estudiante-material-completado.png`, fullPage: true });
  });

  test('PDF de 5 páginas: una página a la vez, barra de lectura y completado solo en la página 5', async ({ page }) => {
    await simular(page, { puedeMarcarManual: false, completados: [] });
    await abrirCurso(page);
    await page.getByRole('button', { name: 'Manual de inducción' }).click();
    const visor = page.getByTestId('visor-material');

    await expect(visor.getByTestId('pagina-pdf')).toHaveText('Página 1 de 5');
    await expect(visor.getByTestId('pdf-material')).toHaveAttribute('data-pagina-pintada', '1');
    await expect(visor.getByTestId('lectura-pdf')).toHaveAttribute('aria-valuenow', '20');
    await expect(visor.getByRole('button', { name: '← Página anterior' })).toBeDisabled();

    const siguiente = visor.getByRole('button', { name: 'Página siguiente →' });
    await siguiente.click();
    await siguiente.click();
    await expect(visor.getByTestId('pagina-pdf')).toHaveText('Página 3 de 5');
    await expect(visor.getByTestId('lectura-pdf')).toHaveAttribute('aria-valuenow', '60');
    await expect(visor.getByTestId('estado-revision')).not.toContainText('Completado');
    await expect(visor.getByTestId('pdf-material')).toHaveAttribute('data-pagina-pintada', '3');
    await page.waitForTimeout(400); // que termine la animación de la barra
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/11-visor-pdf-varias-paginas-barra-a-mitad.png` });

    // Volver atrás no baja la barra (cuenta la página máxima alcanzada).
    await visor.getByRole('button', { name: '← Página anterior' }).click();
    await expect(visor.getByTestId('lectura-pdf')).toHaveAttribute('aria-valuenow', '60');

    await siguiente.click();
    await siguiente.click();
    await expect(visor.getByTestId('pagina-pdf')).toHaveText('Página 4 de 5');
    await expect(visor.getByTestId('estado-revision')).not.toContainText('Completado');
    await siguiente.click();
    await expect(visor.getByTestId('pagina-pdf')).toHaveText('Página 5 de 5');
    await expect(visor.getByTestId('lectura-pdf')).toHaveAttribute('aria-valuenow', '100');
    await expect(visor.getByTestId('estado-revision')).toContainText('Completado');
    await expect(siguiente).toBeDisabled();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/12-visor-pdf-ultima-pagina-completado.png` });
  });

  test('video: ventana de vista previa, sin adelantar, contador y completado al 100 %', async ({ page }) => {
    await simular(page, { puedeMarcarManual: false, completados: [] });
    await abrirCurso(page);
    await page.getByRole('button', { name: 'Bienvenida Farmalogica' }).click();
    const visor = page.getByTestId('visor-material');
    const video = visor.getByTestId('video-material');

    // Sin la barra nativa del reproductor.
    await expect(video).not.toHaveAttribute('controls', /.*/);
    await expect(visor.getByTestId('contador-video')).toHaveText(`00:00 / 00:0${DURACION_VIDEO}`);

    await visor.getByRole('button', { name: '▶ Reproducir' }).click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 5_000 }).toBeGreaterThan(0.5);

    // Intento de adelantar: bloqueado, vuelve a lo ya visto.
    const despues = await video.evaluate(async (v: HTMLVideoElement) => {
      v.currentTime = 3.8;
      await new Promise((ok) => setTimeout(ok, 300));
      return v.currentTime;
    });
    expect(despues).toBeLessThan(2.5);
    await expect(visor.getByTestId('estado-revision')).not.toContainText('Completado');

    // Velocidad fija en 1×.
    expect(await video.evaluate(async (v: HTMLVideoElement) => {
      v.playbackRate = 2;
      await new Promise((ok) => setTimeout(ok, 100));
      return v.playbackRate;
    })).toBe(1);

    await expect(visor.getByTestId('contador-video')).toHaveText(/^00:0[1-3] \/ 00:04$/);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/10-visor-video-contador.png` });

    await expect(visor.getByTestId('estado-revision')).toContainText('Completado', { timeout: 15_000 });
    await expect(visor.getByTestId('contador-video')).toHaveText('00:04 / 00:04');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/13-visor-video-completado.png` });
  });

  test('curso al 100 %: "Completado" a la derecha de la barra', async ({ page }) => {
    await simular(page, { puedeMarcarManual: false, completados: [1, 2, 3] });
    await abrirCurso(page);
    await expect(page.locator('.portal-th__progreso-fila').getByTestId('insignia-completado')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/4-curso-completado.png`, fullPage: true });
  });

  test('administrador/formador: casillas editables a mano', async ({ page }) => {
    await simular(page, { puedeMarcarManual: true, completados: [1] });
    await abrirCurso(page);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    const boton = page.getByRole('button', { name: 'Marcar Reglamento interno como completado' });
    await expect(boton).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Marcar Bienvenida Farmalogica como pendiente' })).toBeEnabled();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/5-formador-casillas-editables.png`, fullPage: true });
  });
});

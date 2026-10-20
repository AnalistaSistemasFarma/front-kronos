import { expect, test, type Locator, type Page } from '@playwright/test';
import reporte from '../../lib/portal/formularios/sst-reporte-actos-condiciones.json';
import salud from '../../lib/portal/formularios/sst-condiciones-salud-osteomuscular.json';

/**
 * Portal TH · FORMULARIOS SST (Cristian Baldión, 2026-10-19), etapa 2: los dos formularios con sus preguntas y la pantalla que dibuja
 * la escala 0 a 10, la imagen dentro de una pregunta y la selección múltiple con «Otras». Las definiciones son las REALES (los JSON
 * del repositorio); la API se simula con `page.route`. Por ahora se abren como material de un curso de prueba: los botones de la
 * página principal y el guardado en SharePoint son las etapas 3 y 4. Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const curso = { id: 2, titulo: 'FORMULARIOS SST (prueba)', descripcion: 'Prueba', activo: true, creadoPor: 'th@gsslatam.com' };

interface Pregunta { id: string; tipo: string; prellenar?: string }
interface Definicion { titulo: string; preguntas: Pregunta[] }

async function simular(page: Page, definicion: unknown) {
  const envios: Record<string, unknown>[] = [];
  await page.route('**/api/portal/courses', (r) => r.fulfill({ json: { esFormador: false, cursos: [{ ...curso, totalMateriales: 1, totalInscritos: 1, inscrito: true, porcentaje: 0, certificado: null }] } }));
  await page.route('**/api/portal/courses/2', (r) =>
    r.fulfill({ json: { curso, esFormador: false, puedeMarcarManual: false, porcentaje: 0, materiales: [{ id: 4, tipo: 'FORM', formularioId: 9, titulo: 'FORMULARIO', orden: 0, url: null, nombreArchivo: null, mime: null, obligatorio: true, completadoEl: null }], certificado: null } })
  );
  await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
  await page.route('**/api/portal/materials/4/formulario', async (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ json: { material: { id: 4, titulo: 'FORMULARIO' }, formulario: { versionId: 20, version: 1, definicion }, prellenado: { correo: 'laura@gsslatam.com', nombre: 'Laura Gómez' }, enviadaEl: null } });
    }
    envios.push(r.request().postDataJSON() as Record<string, unknown>);
    return r.fulfill({ json: { ok: true, completado: true, enviadaEl: '2026-10-19T20:00:00Z' } });
  });
  return envios;
}

async function abrir(page: Page) {
  await page.goto('/portal/formacion');
  await page.getByRole('button', { name: /FORMULARIOS SST \(prueba\)/ }).click();
  await page.getByTestId('abrir-formulario-4').click();
  const f = page.getByTestId('formulario-propio');
  await expect(f).toBeVisible();
  return f;
}

/** Contesta TODAS las preguntas con la primera opción (o texto de prueba), salvo las que ya vienen de la sesión. */
async function llenar(f: Locator, definicion: Definicion, salvo: string[] = []) {
  for (const p of definicion.preguntas) {
    if (salvo.includes(p.id) || p.prellenar) continue;
    const caja = f.locator(`#fp-${p.id}`);
    if (p.tipo === 'texto') await caja.locator('input').fill('Dato de prueba');
    else if (p.tipo === 'texto_largo') await caja.locator('textarea').fill('Descripción de prueba del lugar y de lo ocurrido');
    else if (p.tipo === 'seleccion_multiple') await caja.getByRole('checkbox').first().check();
    else await caja.getByRole('radio').first().check();
  }
}

test.describe('Portal TH · formularios SST (etapa 2)', () => {
  test('B2: autorización, imagen del cuerpo, escala 0 a 10 y «Otras» se dibujan y se pueden contestar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const envios = await simular(page, salud);
    const f = await abrir(page);

    await expect(f).toContainText('CONDICIONES DE SALUD Y SINTOMATOLOGÍA OSTEOMUSCULAR');
    // Autorización de datos (Ley 1581): texto, aviso de que falta validarlo y casilla obligatoria.
    await expect(f.locator('#fp-autorizacion')).toContainText('totalmente confidencial');
    await expect(f.getByTestId('autorizacion-pendiente')).toBeVisible();
    // 26 preguntas, numeradas como en Forms (la 4 del original es la autorización).
    await expect(f.locator('[id^="fp-o"]')).toHaveCount(26);

    // Pregunta 10: imagen del cuerpo (carga de verdad), 12 zonas y «Otras».
    const p10 = f.locator('#fp-o10');
    const imagen = f.getByTestId('imagen-o10');
    await imagen.scrollIntoViewIfNeeded();
    await expect(imagen).toBeVisible();
    await expect(imagen).toHaveAttribute('src', '/portal-th/cuerpo-dolor.png');
    await expect(imagen).toHaveAttribute('alt', /Figura humana/);
    await expect.poll(() => imagen.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(p10.getByRole('checkbox')).toHaveCount(13); // 12 zonas + «Otras»
    await expect(f.getByTestId('otras-texto-o10')).toBeDisabled();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/150-sst-pregunta10.png` });

    // Pregunta 11: escala de 0 a 10 con sus dos rótulos.
    const p11 = f.locator('#fp-o11');
    await expect(p11.getByRole('radio')).toHaveCount(11);
    await expect(p11).toContainText('Muy poco dolor');
    await expect(p11).toContainText('Mucho dolor');

    // Sin autorizar ni contestar: no se envía, y se avisa ARRIBA en rojo.
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toContainText('No se pudo enviar');
    await expect(f.locator('#fp-autorizacion')).toContainText('Debe leer y aceptar la autorización');
    expect(envios).toHaveLength(0);

    // Llena todo; en la 10 marca una zona y escribe «Otras»; en la 11 elige el 7.
    await llenar(f, salud as Definicion, ['o10', 'o11']);
    await p10.getByRole('checkbox', { name: 'Cabeza' }).check();
    await f.getByTestId('otras-marca-o10').check();
    await expect(f.getByTestId('otras-texto-o10')).toBeEnabled();
    await f.getByTestId('otras-texto-o10').fill('Ojo izquierdo');
    await p11.getByRole('radio', { name: '7', exact: true }).check();
    await f.getByRole('checkbox', { name: /Autorizo el tratamiento/ }).check();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/151-sst-llenado.png` });

    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Respuestas enviadas');
    expect(envios).toHaveLength(1);
    const cuerpo = envios[0] as { autorizaDatos: boolean; respuestas: Record<string, unknown> };
    expect(cuerpo.autorizaDatos).toBe(true);
    expect(cuerpo.respuestas.o10).toEqual(['Cabeza', 'Otras: Ojo izquierdo']);
    expect(cuerpo.respuestas.o11).toBe('7');
    expect(cuerpo.respuestas.o01).toBe('Laura Gómez'); // el nombre sale de la sesión
  });

  test('«Otras» desmarcada borra el texto escrito; la escala admite el 0; marcar «Otras» sin texto no estorba', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const envios = await simular(page, salud);
    const f = await abrir(page);
    await llenar(f, salud as Definicion, ['o07', 'o11']);
    await f.locator('#fp-o11').getByRole('radio', { name: '0', exact: true }).check();
    await f.getByRole('checkbox', { name: /Autorizo el tratamiento/ }).check();

    // Pregunta 7 (síntomas): una opción + «Otras» con texto, y luego se desmarca «Otras».
    const p7 = f.locator('#fp-o07');
    await p7.getByRole('checkbox', { name: 'Dolor de garganta' }).check();
    await f.getByTestId('otras-marca-o07').check();
    await f.getByTestId('otras-texto-o07').fill('Mareo');
    await f.getByTestId('otras-marca-o07').uncheck();
    await expect(f.getByTestId('otras-texto-o07')).toBeDisabled();
    await expect(f.getByTestId('otras-texto-o07')).toHaveValue('');
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toBeVisible();
    const r = (envios[0] as { respuestas: Record<string, unknown> }).respuestas;
    expect(r.o07).toEqual(['Dolor de garganta']); // sin el «Otras: Mareo» que se borró
    expect(r.o11).toBe('0');
  });

  test('B2: la pregunta obligatoria que falta se señala y la lleva a ella', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, salud);
    const f = await abrir(page);
    await llenar(f, salud as Definicion, ['o10']);
    await f.getByRole('checkbox', { name: /Autorizo el tratamiento/ }).check();
    await f.getByTestId('enviar-formulario').click();
    await expect(f.locator('#fp-o10')).toContainText('Esta pregunta es obligatoria.');
    await expect(page.getByTestId('aviso-formulario')).toContainText('revise 1 pregunta');
  });

  test('B1: se contesta completo, con el nombre de la sesión y el número para enviar la imagen', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const envios = await simular(page, reporte);
    const f = await abrir(page);
    await expect(f).toContainText('REPORTE DE ACTOS Y CONDICIONES INSEGURAS SST');
    await expect(f).toContainText('310 2480499');
    await expect(f.locator('#fp-autorizacion')).toHaveCount(0); // no es de datos sensibles
    await expect(f.locator('#fp-r04').getByRole('radio')).toHaveCount(13);
    await expect(f.locator('[id^="fp-r"]')).toHaveCount(6);

    await llenar(f, reporte as Definicion);
    await f.locator('#fp-r05').getByRole('radio').nth(1).check();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/152-sst-reporte.png`, fullPage: true });
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Respuestas enviadas');
    const r = (envios[0] as { respuestas: Record<string, string> }).respuestas;
    expect(r.r01).toBe('Laura Gómez');
    expect(r.r03).toBe('Planta');
    expect(r.r05).toMatch(/^Condición Insegura/);
    expect(r.r06).toContain('Descripción de prueba');
  });

  test('celular: la imagen del cuerpo cabe en la pantalla y no hay desplazamiento lateral', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page, salud);
    const f = await abrir(page);
    const imagen = f.getByTestId('imagen-o10');
    await imagen.scrollIntoViewIfNeeded();
    const caja = (await imagen.boundingBox())!;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/153-sst-celular.png` });
  });
});

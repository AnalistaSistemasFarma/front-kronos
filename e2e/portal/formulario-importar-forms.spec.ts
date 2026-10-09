import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { normalizarImportacion } from '../../lib/portal/importar-forms';

/**
 * Portal TH · Formación · IMPORTAR DESDE MICROSOFT FORMS (Cristian Baldión, 2026-10-09).
 *
 * Sin sesión real ni servicio importador: las APIs del portal se simulan con `page.route`. El Forms
 * "importado" es el REAL de la Evaluación de Inducción (fixture capturado con el servicio). Con
 * `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const CRUDO = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'lib', 'portal', '__tests__', 'fixtures', 'forms-evaluacion-induccion-crudo.json'), 'utf8'));
const IMPORTADO = normalizarImportacion(CRUDO);
const ID = '3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const FORMS = 'https://forms.cloud.microsoft/pages/responsepage.aspx?id=abc&route=shorturl';
const curso = { id: 2, titulo: 'INDUCCIÓN ORGANIZACIONAL - SST', descripcion: 'Inducción de Seguridad y Salud en el Trabajo', activo: true, creadoPor: 'th@gsslatam.com' };

async function preparar(page: Page, opciones: { terminar: 'listo' | 'error' }) {
  const estado = { sondeos: 0, enlaceEnviado: null as string | null, creado: null as Record<string, unknown> | null };
  await page.route('**/api/portal/courses', (r) =>
    r.fulfill({ json: { esFormador: true, cursos: [{ ...curso, totalMateriales: 0, totalInscritos: 0, inscrito: true, porcentaje: 0, certificado: null }] } })
  );
  await page.route('**/api/portal/courses/2', (r) => r.fulfill({ json: { curso, esFormador: true, puedeMarcarManual: true, porcentaje: 0, materiales: [], certificado: null } }));
  await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
  await page.route('**/api/portal/formularios', async (r) => {
    if (r.request().method() === 'POST') {
      estado.creado = r.request().postDataJSON() as Record<string, unknown>;
      return r.fulfill({ json: { ok: true, formulario: { id: 9, codigo: estado.creado.codigo, titulo: estado.creado.titulo, version: 1 } } });
    }
    return r.fulfill({ json: { formularios: [] } });
  });
  await page.route('**/api/portal/formularios/importar-forms', async (r) => {
    estado.enlaceEnviado = (r.request().postDataJSON() as { url: string }).url;
    return r.fulfill({ status: 202, json: { id: ID } });
  });
  await page.route('**/api/portal/formularios/importar-forms/' + ID, async (r) => {
    estado.sondeos += 1;
    if (estado.sondeos === 1) return r.fulfill({ json: { estado: 'en_curso', progreso: 15, etapa: 'Abriendo Microsoft Forms' } });
    if (estado.sondeos === 2) return r.fulfill({ json: { estado: 'en_curso', progreso: 55, etapa: 'Leyendo las preguntas' } });
    await new Promise((x) => setTimeout(x, 1500)); // deja ver la barra a medio camino
    if (opciones.terminar === 'error') {
      return r.fulfill({ json: { estado: 'error', progreso: 55, etapa: 'Error', error: 'El formulario no es público: Microsoft pide iniciar sesión. En Forms, en «Compartir», elija «Cualquier persona con el vínculo puede responder» y copie ese enlace.' } });
    }
    return r.fulfill({ json: { estado: 'listo', progreso: 100, etapa: 'Listo', resultado: { ...IMPORTADO, advertencias: ['Pregunta 13 «Marque varias»: es de tipo selección múltiple y no se puede importar; agréguela a mano si la necesita.'] } } });
  });
  return estado;
}

async function abrirConstructor(page: Page, tipo: 'encuesta' | 'evaluacion') {
  await page.goto('/portal/formacion');
  await page.getByRole('button', { name: 'Vista formador' }).click();
  await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
  await page.getByRole('button', { name: 'Formulario', exact: true }).click();
  await page.getByTestId(tipo === 'evaluacion' ? 'crear-evaluacion' : 'crear-encuesta').click();
  const c = page.getByTestId('constructor-formulario');
  await expect(c).toBeVisible();
  return c;
}

test.describe('Portal TH · Formación · importar desde Microsoft Forms', () => {
  test('evaluación: barra de progreso 0-100 %, preguntas cargadas, puntos automáticos y borrador', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const estado = await preparar(page, { terminar: 'listo' });
    const c = await abrirConstructor(page, 'evaluacion');
    const imp = c.getByTestId('importar-forms');
    await expect(imp).toContainText('Importar desde Microsoft Forms');
    await expect(imp.getByTestId('importar-forms-boton')).toBeDisabled(); // sin enlace
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/40-importar-bloque.png` });

    await imp.getByTestId('enlace-forms').fill(FORMS);
    await imp.getByTestId('importar-forms-boton').click();

    // Progreso REAL y visible: 15 % → 55 %.
    await expect(imp.getByTestId('importar-porcentaje')).toHaveText('15 %');
    await expect(imp.getByTestId('importar-porcentaje')).toHaveText('55 %');
    await expect(imp.getByTestId('importar-etapa')).toHaveText('Leyendo las preguntas');
    await expect(imp.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '55');
    await imp.getByTestId('importar-progreso').scrollIntoViewIfNeeded();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/41-importar-progreso.png` });

    // Listo: aviso verde ARRIBA y a la vista; advertencias en amarillo.
    await expect(imp.getByTestId('importar-listo')).toContainText('Se importaron 12 preguntas de «Evaluación Inducción Organizacional y SST Farmalógica SA 2025» (nombre y cédula quedaron en «Datos que se piden»)');
    await expect(imp.getByTestId('importar-listo')).toContainText('Todavía no se guardó nada');
    await expect(imp.getByTestId('importar-advertencias')).toContainText('selección múltiple');
    await page.waitForTimeout(900);
    await expect(imp.getByTestId('importar-listo')).toBeInViewport();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/42-importar-listo-aviso.png` });
    expect(estado.enlaceEnviado).toBe(FORMS);

    // Cargado en el constructor: título, 10 preguntas, 10 puntos cada una (100 ÷ 10), borrador (Forms no da las correctas).
    await expect(c.getByTestId('titulo-formulario')).toHaveValue('Evaluación Inducción Organizacional y SST Farmalógica SA 2025');
    for (let i = 1; i <= 10; i++) await expect(c.getByTestId('pregunta-' + i)).toBeVisible();
    await expect(c.getByTestId('pregunta-11')).toHaveCount(0);
    await expect(c.getByTestId('pregunta-1').getByLabel('Enunciado de la pregunta')).toHaveValue(/^Según el reglamento/);
    await expect(c.getByTestId('pregunta-4').getByPlaceholder('Opción 4')).toHaveValue(/^Reportarlo inmediatamente/);
    await expect(c.getByTestId('pregunta-1').getByLabel('Puntos')).toHaveValue('10');
    await expect(c.getByTestId('suma-puntos')).toContainText('100 / 100');
    await expect(c.getByTestId('borrador')).toBeChecked();
    await expect(c.getByRole('checkbox', { name: 'Nombre completo' })).toBeChecked();
    await expect(c.getByRole('checkbox', { name: 'Número de cédula' })).toBeChecked();
    await page.getByTestId('pregunta-1').scrollIntoViewIfNeeded();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/45-importar-preguntas-cargadas.png` });

    // Editable: se cambia un enunciado y se guarda como borrador.
    await c.getByTestId('pregunta-2').getByLabel('Enunciado de la pregunta').fill('¿Cuáles son las prohibiciones de la política de alcohol y drogas?');
    await c.getByTestId('guardar-formulario').click();
    await expect(page.getByTestId('selector-formulario').getByRole('alert').filter({ hasText: 'Evaluación creada' })).toContainText('Quedó en borrador');
    const d = estado.creado as unknown as { tipo: string; borrador: boolean; preguntas: { id: string; texto: string; puntos?: number; correcta?: number }[] };
    expect(d).toMatchObject({ tipo: 'evaluacion', borrador: true });
    expect(d.preguntas.slice(0, 2).map((p) => p.id)).toEqual(['dato_nombre', 'dato_cedula']);
    expect(d.preguntas.filter((p) => p.puntos === 10)).toHaveLength(10);
    expect(d.preguntas.find((p) => p.id === 'q2')!.texto).toBe('¿Cuáles son las prohibiciones de la política de alcohol y drogas?');
    expect(d.preguntas.every((p) => p.correcta === undefined)).toBe(true);
  });

  test('si el formulario no es público, el aviso rojo va arriba y no se carga nada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await preparar(page, { terminar: 'error' });
    const c = await abrirConstructor(page, 'evaluacion');
    const imp = c.getByTestId('importar-forms');
    await imp.getByTestId('enlace-forms').fill(FORMS);
    await imp.getByTestId('importar-forms-boton').click();
    await expect(imp.getByTestId('importar-error')).toContainText('El formulario no es público');
    await expect(imp.getByTestId('importar-progreso')).toHaveCount(0);
    await page.waitForTimeout(900);
    await expect(imp.getByTestId('importar-error')).toBeInViewport();
    await expect(c.getByTestId('titulo-formulario')).toHaveValue('');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/43-importar-error.png` });
  });

  test('un enlace que no es de Microsoft Forms se rechaza sin llamar al servidor', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const estado = await preparar(page, { terminar: 'listo' });
    const c = await abrirConstructor(page, 'encuesta');
    const imp = c.getByTestId('importar-forms');
    await imp.getByTestId('enlace-forms').fill('https://example.com/formulario');
    await imp.getByTestId('importar-forms-boton').click();
    await expect(imp.getByTestId('importar-error')).toContainText('forms.cloud.microsoft');
    expect(estado.enlaceEnviado).toBeNull();
  });

  test('encuesta: se importa sin puntos ni borrador y queda editable; el editor de un formulario existente no ofrece importar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const estado = await preparar(page, { terminar: 'listo' });
    const c = await abrirConstructor(page, 'encuesta');
    const imp = c.getByTestId('importar-forms');
    await imp.getByTestId('enlace-forms').fill(FORMS);
    await imp.getByTestId('enlace-forms').press('Enter');
    await expect(imp.getByTestId('importar-listo')).toBeVisible();
    expect(await c.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/44-importar-celular.png` });
    await expect(c.getByTestId('borrador')).toHaveCount(0); // solo las evaluaciones tienen borrador
    await expect(c.getByTestId('suma-puntos')).toHaveCount(0);
    await c.getByTestId('guardar-formulario').click();
    await expect(estado.creado).not.toBeNull();
    const d = estado.creado as unknown as { tipo?: string; borrador?: boolean };
    expect(d.tipo).toBeUndefined();
    expect(d.borrador).toBeUndefined();
  });
});

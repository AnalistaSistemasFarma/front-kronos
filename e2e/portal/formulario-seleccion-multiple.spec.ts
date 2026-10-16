import { expect, test, type Page } from '@playwright/test';
import { normalizarImportacion } from '../../lib/portal/importar-forms';

/**
 * Portal TH · Formación · SELECCIÓN MÚLTIPLE y LISTA DESPLEGABLE (Cristian Baldión, 2026-10-14).
 * Sin sesión real: las APIs del portal se simulan con `page.route`. Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const curso = { id: 2, titulo: 'INDUCCIÓN ORGANIZACIONAL - SST', descripcion: 'Inducción', activo: true, creadoPor: 'th@gsslatam.com' };
const ID = '3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const FORMS = 'https://forms.cloud.microsoft/pages/responsepage.aspx?id=abc&route=shorturl';

/** Definición que recibe el ESTUDIANTE (sin correctas). */
const DEFINICION = {
  formato: 1,
  codigo: 'EVA-PTEE',
  titulo: 'Evaluación PTEE 2025',
  tipo: 'evaluacion',
  notaMinima: 80,
  preguntas: [
    { id: 'dato_nombre', texto: 'Nombre completo', tipo: 'texto', obligatoria: true, prellenar: 'nombre' },
    { id: 'q1', texto: 'Seleccione 3 elementos de un PTEE', tipo: 'seleccion_multiple', obligatoria: true, opciones: ['Riesgos', 'Política', 'Cafetería', 'Capacitación', 'Parqueadero'], puntos: 40 },
    { id: 'q2', texto: 'Elija la política vigente', tipo: 'seleccion', presentacion: 'lista', obligatoria: true, opciones: ['Política A', 'Política B', 'Política C'], puntos: 30 },
    { id: 'q3', texto: '¿Es obligatorio reportar?', tipo: 'seleccion', obligatoria: true, opciones: ['Sí', 'No'], puntos: 30 },
  ],
};
const CORRECTAS: Record<string, string[]> = { q1: ['Riesgos', 'Política', 'Capacitación'], q2: ['Política B'], q3: ['Sí'] };

async function simularEstudiante(page: Page) {
  const estado = { cuerpos: [] as Record<string, unknown>[] };
  const detalle = {
    curso,
    esFormador: false,
    puedeMarcarManual: false,
    porcentaje: 0,
    materiales: [{ id: 4, tipo: 'FORM', formularioId: 9, titulo: 'EVALUACIÓN PTEE', orden: 0, url: null, nombreArchivo: null, mime: null, obligatorio: true, completadoEl: null }],
    certificado: null,
  };
  await page.route('**/api/portal/courses', (r) => r.fulfill({ json: { esFormador: false, cursos: [{ ...curso, totalMateriales: 1, totalInscritos: 1, inscrito: true, porcentaje: 0, certificado: null }] } }));
  await page.route('**/api/portal/courses/2', (r) => r.fulfill({ json: detalle }));
  await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
  await page.route('**/api/portal/materials/4/formulario', async (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ json: { material: { id: 4, titulo: 'EVALUACIÓN PTEE' }, formulario: { versionId: 20, version: 1, definicion: DEFINICION }, prellenado: { correo: 'laura@gsslatam.com', nombre: 'Laura Gómez' }, enviadaEl: null, intentos: { usados: 0, ultimo: null } } });
    }
    const { respuestas } = r.request().postDataJSON() as { respuestas: Record<string, unknown> };
    estado.cuerpos.push(respuestas);
    // Imita al servidor: todo o nada en la múltiple.
    let puntos = 0;
    for (const p of DEFINICION.preguntas.filter((q) => q.puntos)) {
      const v = respuestas[p.id];
      const esperadas = CORRECTAS[p.id];
      const lista = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
      if (lista.length === esperadas.length && lista.every((x) => esperadas.includes(x))) puntos += p.puntos!;
    }
    const aprobado = puntos >= 80;
    return r.fulfill({ json: { ok: true, completado: aprobado, enviadaEl: aprobado ? '2026-10-14T20:00:00Z' : undefined, evaluacion: { porcentaje: puntos, notaMinima: 80, aprobado, puntaje: puntos, puntajeMax: 100, intentos: 1 } } });
  });
  return estado;
}

async function abrirVisor(page: Page) {
  await page.goto('/portal/formacion');
  await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
  await page.getByTestId('abrir-formulario-4').click();
  const f = page.getByTestId('formulario-propio');
  await expect(f).toBeVisible();
  return f;
}

test.describe('Portal TH · selección múltiple y lista desplegable', () => {
  test('estudiante: marca varias opciones, usa la lista desplegable y el servidor califica todo o nada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const estado = await simularEstudiante(page);
    const f = await abrirVisor(page);

    // La múltiple son casillas (varias a la vez); la lista es un desplegable; la última, botones de opción.
    const multiple = f.locator('#fp-q1');
    await expect(multiple).toContainText('Puede marcar varias opciones.');
    await expect(multiple.getByRole('checkbox')).toHaveCount(5);
    await expect(f.locator('#fp-q2 select')).toHaveCount(1);
    await expect(f.locator('#fp-q2').getByRole('radio')).toHaveCount(0);
    await expect(f.locator('#fp-q3').getByRole('radio')).toHaveCount(2);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/70-estudiante-multiple-y-lista.png`, fullPage: true });

    // Sin responder: error en la múltiple (obligatoria), arriba y a la vista.
    await f.getByTestId('enviar-formulario').click();
    await expect(f.locator('#fp-q1')).toContainText('Esta pregunta es obligatoria.');

    // Primer intento: dos de las tres correctas (una de menos) → esa pregunta no suma.
    await multiple.getByRole('checkbox', { name: 'Riesgos' }).check();
    await multiple.getByRole('checkbox', { name: 'Política' }).check();
    await f.locator('#fp-q2 select').selectOption('Política B');
    await f.locator('#fp-q3').getByRole('radio', { name: 'Sí' }).check();
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toContainText('obtuvo 60 %');
    expect(estado.cuerpos[0].q1).toEqual(['Riesgos', 'Política']);
    expect(estado.cuerpos[0].q2).toBe('Política B');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/71-estudiante-multiple-incompleta.png` });

    // Segundo intento: exactamente las tres correctas → aprueba. Se puede desmarcar una equivocada.
    await multiple.getByRole('checkbox', { name: 'Cafetería' }).check();
    await multiple.getByRole('checkbox', { name: 'Cafetería' }).uncheck();
    for (const o of ['Riesgos', 'Política', 'Capacitación']) await multiple.getByRole('checkbox', { name: o }).check();
    await f.locator('#fp-q2 select').selectOption('Política B');
    await f.locator('#fp-q3').getByRole('radio', { name: 'Sí' }).check();
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Evaluación aprobada');
    expect(new Set(estado.cuerpos[1].q1 as string[])).toEqual(new Set(['Riesgos', 'Política', 'Capacitación']));
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/72-estudiante-multiple-aprobada.png` });
  });

  test('celular: las casillas y la lista caben en la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simularEstudiante(page);
    const f = await abrirVisor(page);
    expect(await f.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await f.locator('#fp-q1').scrollIntoViewIfNeeded();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/73-celular-multiple-y-lista.png` });
  });

  test('formador: arma una selección múltiple (varias correctas) y una lista desplegable', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    let creada: Record<string, unknown> | null = null;
    await page.route('**/api/portal/courses', (r) => r.fulfill({ json: { esFormador: true, cursos: [{ ...curso, totalMateriales: 0, totalInscritos: 0, inscrito: true, porcentaje: 0, certificado: null }] } }));
    await page.route('**/api/portal/courses/2', (r) => r.fulfill({ json: { curso, esFormador: true, puedeMarcarManual: true, porcentaje: 0, materiales: [], certificado: null } }));
    await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
    await page.route('**/api/portal/formularios', async (r) => {
      if (r.request().method() === 'POST') {
        creada = r.request().postDataJSON() as Record<string, unknown>;
        return r.fulfill({ json: { ok: true, formulario: { id: 9, codigo: creada.codigo, titulo: creada.titulo, version: 1 } } });
      }
      return r.fulfill({ json: { formularios: [] } });
    });
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: 'Vista formador' }).click();
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await page.getByTestId('alternar-edicion').click();
    await page.getByRole('button', { name: 'Formulario', exact: true }).click();
    await page.getByTestId('crear-evaluacion').click();
    const c = page.getByTestId('constructor-formulario');
    await c.getByTestId('titulo-formulario').fill('Evaluación PTEE');

    // Pregunta 1: selección múltiple con 3 correctas.
    const q1 = c.getByTestId('pregunta-1');
    await q1.getByLabel('Enunciado de la pregunta').fill('Seleccione 3 elementos de un PTEE');
    await q1.getByLabel('Tipo de pregunta').selectOption('seleccion_multiple');
    for (let i = 1; i <= 5; i++) {
      if (i > 2) await q1.getByRole('button', { name: 'Agregar opción' }).click();
      await q1.getByPlaceholder(`Opción ${i}`).fill(['Riesgos', 'Política', 'Cafetería', 'Capacitación', 'Parqueadero'][i - 1]);
    }
    await expect(q1.getByText('marque TODAS las respuestas correctas')).toBeVisible();
    for (const n of [1, 2, 4]) await q1.getByRole('checkbox', { name: `Marcar la opción ${n} como correcta` }).check();

    // Pregunta 2: lista desplegable con una correcta.
    await c.getByTestId('agregar-pregunta').click();
    const q2 = c.getByTestId('pregunta-2');
    await q2.getByLabel('Enunciado de la pregunta').fill('Elija la política vigente');
    await q2.getByLabel('Tipo de pregunta').selectOption('lista');
    await q2.getByPlaceholder('Opción 1').fill('Política A');
    await q2.getByPlaceholder('Opción 2').fill('Política B');
    await q2.getByRole('radio', { name: 'Marcar la opción 2 como correcta' }).check();
    await expect(c.getByTestId('suma-puntos')).toContainText('100 / 100');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/74-formador-constructor-multiple-y-lista.png`, fullPage: true });

    // Cambiar de múltiple a única conserva una correcta; una pregunta sin correcta marcada avisa.
    await c.getByTestId('guardar-formulario').click();
    await expect(page.getByTestId('selector-formulario').getByRole('alert').filter({ hasText: 'Evaluación creada' })).toBeVisible();
    const preguntas = (creada as unknown as { preguntas: Record<string, unknown>[] }).preguntas.filter((p) => p.puntos !== undefined);
    expect(preguntas[0]).toMatchObject({ tipo: 'seleccion_multiple', correctas: [0, 1, 3], puntos: 50 });
    expect(preguntas[0].correcta).toBeUndefined();
    expect(preguntas[1]).toMatchObject({ tipo: 'seleccion', presentacion: 'lista', correcta: 1, puntos: 50 });
  });

  test('importar de Forms: las preguntas de selección múltiple y las listas ya se traen', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const crudo = {
      titulo: 'Evaluación PTEE 2025',
      descripcion: '',
      preguntas: [
        { titulo: 'Correo', tipo: 'texto', obligatoria: true, opciones: [] },
        { titulo: 'Defina el PTEE', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b', 'c'] },
        { titulo: 'Seleccione 3 elementos de un PTEE', tipo: 'multiple', obligatoria: true, opciones: ['e1', 'e2', 'e3', 'e4', 'e5'] },
        { titulo: 'Elija una política', tipo: 'seleccion', lista: true, obligatoria: true, opciones: ['p1', 'p2'] },
        { titulo: 'Seleccione 3 políticas del PTEE', tipo: 'multiple', obligatoria: true, opciones: ['x1', 'x2', 'x3', 'x4'] },
        { titulo: 'Califique del 1 al 5', tipo: 'otro', obligatoria: false, opciones: [] },
      ],
    };
    await page.route('**/api/portal/courses', (r) => r.fulfill({ json: { esFormador: true, cursos: [{ ...curso, totalMateriales: 0, totalInscritos: 0, inscrito: true, porcentaje: 0, certificado: null }] } }));
    await page.route('**/api/portal/courses/2', (r) => r.fulfill({ json: { curso, esFormador: true, puedeMarcarManual: true, porcentaje: 0, materiales: [], certificado: null } }));
    await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
    await page.route('**/api/portal/formularios', (r) => r.fulfill({ json: { formularios: [] } }));
    await page.route('**/api/portal/formularios/importar-forms', (r) => r.fulfill({ status: 202, json: { id: ID } }));
    await page.route('**/api/portal/formularios/importar-forms/' + ID, (r) => r.fulfill({ json: { estado: 'listo', progreso: 100, etapa: 'Listo', resultado: normalizarImportacion(crudo) } }));
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: 'Vista formador' }).click();
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await page.getByTestId('alternar-edicion').click();
    await page.getByRole('button', { name: 'Formulario', exact: true }).click();
    await page.getByTestId('crear-evaluacion').click();
    const c = page.getByTestId('constructor-formulario');
    const imp = c.getByTestId('importar-forms');
    await imp.getByTestId('enlace-forms').fill(FORMS);
    await imp.getByTestId('importar-forms-boton').click();

    await expect(imp.getByTestId('importar-listo')).toContainText('Se importaron');
    // Solo la escala (no soportada) queda como advertencia; ya no se pierden las selecciones múltiples.
    const adv = imp.getByTestId('importar-advertencias');
    await expect(adv).toContainText('Califique del 1 al 5');
    await expect(adv).not.toContainText('Seleccione 3');
    await expect(adv).not.toContainText('selección múltiple');
    await expect(c.getByTestId('pregunta-4')).toBeVisible();
    await expect(c.getByTestId('pregunta-5')).toHaveCount(0);
    // «Correo» pasó a «Datos que se piden»; quedan 4 preguntas: única, múltiple, lista y múltiple.
    await expect(c.getByTestId('pregunta-1').getByLabel('Tipo de pregunta')).toHaveValue('seleccion');
    await expect(c.getByTestId('pregunta-2').getByLabel('Tipo de pregunta')).toHaveValue('seleccion_multiple');
    await expect(c.getByTestId('pregunta-2').getByLabel('Enunciado de la pregunta')).toHaveValue('Seleccione 3 elementos de un PTEE');
    await expect(c.getByTestId('pregunta-3').getByLabel('Tipo de pregunta')).toHaveValue('lista');
    await expect(c.getByTestId('pregunta-4').getByLabel('Tipo de pregunta')).toHaveValue('seleccion_multiple');
    await expect(c.getByTestId('pregunta-4').getByPlaceholder('Opción 4')).toHaveValue('x4');
    // 100 ÷ 4 preguntas con puntos, y borrador porque Forms no publica las correctas.
    await expect(c.getByTestId('pregunta-3').getByLabel('Puntos')).toHaveValue('25');
    await expect(c.getByTestId('borrador')).toBeChecked();
    await c.getByTestId('pregunta-3').scrollIntoViewIfNeeded();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/75-importar-multiple-y-lista.png` });
    await imp.scrollIntoViewIfNeeded();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/76-importar-avisos.png` });
  });
});

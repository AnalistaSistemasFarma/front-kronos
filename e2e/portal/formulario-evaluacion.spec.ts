import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · Formación · EVALUACIÓN y constructor manual de formularios
 * (Cristian Baldión, 2026-10-09).
 *
 * Sin sesión real: las APIs del portal se simulan con `page.route` (como en
 * formulario-propio.spec.ts). El "servidor" simulado califica con las
 * respuestas correctas que solo él conoce, igual que el real. Con
 * `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 *
 * (Que el estudiante nunca recibe `correcta` lo comprueban las pruebas de la ruta:
 * app/api/portal/materials/__tests__/formulario-evaluacion.routes.test.ts.)
 *
 * Las preguntas son las de "Evaluación Inducción Organizacional y SST
 * Farmalógica SA 2025"; las respuestas correctas de este archivo son DE
 * PRUEBA (las reales las define quien crea el curso).
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const EVA = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'evaluacion-induccion-sst.json'), 'utf8')) as {
  titulo: string;
  instrucciones: string;
  preguntas: { n: number; enunciado: string; opciones: string[] }[];
};
const CORRECTAS: Record<string, number> = { q1: 0, q2: 2, q3: 1, q4: 3, q5: 1, q6: 1, q7: 1, q8: 0, q9: 1, q10: 2 };
const ESTUDIANTE = 'laura.gomez@gsslatam.com';
const curso = { id: 2, titulo: 'INDUCCIÓN ORGANIZACIONAL - SST', descripcion: 'Inducción de Seguridad y Salud en el Trabajo', activo: true, creadoPor: 'th@gsslatam.com' };

const AUTORIZACION = {
  version: 'AUT-DATOS-FORMULARIOS-2026-10-09-BORRADOR',
  pendienteValidacion: true,
  titulo: 'Aviso de privacidad y autorización de tratamiento de datos personales',
  texto: ['En cumplimiento de la Ley 1581 de 2012 y del Decreto 1377 de 2013, le informamos que sus datos se usarán para gestionar su formación.'],
  casilla: 'He leído el aviso y autorizo el tratamiento de mis datos personales.',
};

/** La definición que recibe el ESTUDIANTE: con puntos y sin `correcta`. */
const DEFINICION_PUBLICA = {
  formato: 1,
  codigo: 'EVA-INDUCCION-SST',
  titulo: EVA.titulo,
  descripcion: EVA.instrucciones,
  tipo: 'evaluacion',
  notaMinima: 80,
  datosSensibles: true,
  autorizacion: AUTORIZACION,
  preguntas: [
    { id: 'dato_nombre', texto: 'Nombre completo', tipo: 'texto', obligatoria: true, prellenar: 'nombre' },
    { id: 'dato_cedula', texto: 'Número de cédula', tipo: 'texto', obligatoria: true },
    ...EVA.preguntas.map((p) => ({ id: 'q' + p.n, texto: p.enunciado, tipo: 'seleccion', obligatoria: true, opciones: p.opciones, puntos: 10 })),
  ],
};

async function simularEstudiante(page: Page) {
  const estado = { intentos: 0, aprobado: false, cuerpos: [] as Record<string, unknown>[] };
  const detalle = () => ({
    curso,
    esFormador: false,
    puedeMarcarManual: false,
    porcentaje: estado.aprobado ? 100 : 0,
    materiales: [
      { id: 4, tipo: 'FORM', formularioId: 9, titulo: 'EVALUACIÓN INDUCCIÓN ORGANIZACIONAL Y SST', orden: 0, url: null, nombreArchivo: null, mime: null, obligatorio: true, completadoEl: estado.aprobado ? '2026-10-09T21:00:00Z' : null },
    ],
    certificado: null,
  });
  await page.route('**/api/portal/courses', (r) =>
    r.fulfill({ json: { esFormador: false, cursos: [{ ...curso, totalMateriales: 1, totalInscritos: 12, inscrito: true, porcentaje: detalle().porcentaje, certificado: null }] } })
  );
  await page.route('**/api/portal/courses/2', (r) => r.fulfill({ json: detalle() }));
  await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
  await page.route('**/api/portal/materials/4/vista', (r) => r.fulfill({ status: 409, json: { error: 'Es un formulario.' } }));
  await page.route('**/api/portal/materials/4/formulario', async (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill({
        json: {
          material: { id: 4, titulo: 'EVALUACIÓN INDUCCIÓN ORGANIZACIONAL Y SST' },
          formulario: { versionId: 20, version: 1, definicion: DEFINICION_PUBLICA },
          prellenado: { correo: ESTUDIANTE, nombre: 'Laura Gómez' },
          enviadaEl: estado.aprobado ? '2026-10-09T21:00:00Z' : null,
          intentos: { usados: estado.intentos, ultimo: null },
        },
      });
    }
    const cuerpo = r.request().postDataJSON() as { autorizaDatos: boolean; respuestas: Record<string, string> };
    estado.cuerpos.push(cuerpo.respuestas);
    // Imita al servidor: califica con las correctas que solo él conoce.
    let puntos = 0;
    for (const p of EVA.preguntas) if (cuerpo.respuestas['q' + p.n] === p.opciones[CORRECTAS['q' + p.n]]) puntos += 10;
    estado.intentos += 1;
    const aprobado = puntos >= 80;
    const evaluacion = { porcentaje: puntos, notaMinima: 80, aprobado, puntaje: puntos, puntajeMax: 100, intentos: estado.intentos };
    if (!aprobado) return r.fulfill({ json: { ok: true, completado: false, evaluacion } });
    estado.aprobado = true;
    return r.fulfill({ json: { ok: true, completado: true, enviadaEl: '2026-10-09T21:00:00Z', evaluacion, porcentaje: 100, certificado: null } });
  });
  return estado;
}

/** Responde la evaluación dejando `malas` preguntas incorrectas (las primeras). */
async function responder(page: Page, malas: number) {
  const f = page.getByTestId('formulario-propio');
  await f.locator('#fp-dato_cedula input').fill('1020304050');
  for (const p of EVA.preguntas) {
    const bien = CORRECTAS['q' + p.n];
    const idx = p.n <= malas ? (bien + 1) % p.opciones.length : bien;
    await f.locator('#fp-q' + p.n).getByRole('radio').nth(idx).check();
  }
}

test.describe('Portal TH · Formación · evaluación', () => {
  test('estudiante: reprueba, ve su nota sin las correctas, reintenta y aprueba', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const estado = await simularEstudiante(page);
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await page.getByTestId('abrir-formulario-4').click();
    const f = page.getByTestId('formulario-propio');
    await expect(f).toBeVisible();

    // Aviso de evaluación, nota mínima y puntos por pregunta; los datos de la persona, prellenados.
    await expect(page.getByTestId('info-evaluacion')).toContainText('necesita al menos 80 %');
    await expect(f.locator('#fp-dato_nombre input')).toHaveValue('Laura Gómez');
    await expect(f.locator('#fp-q1')).toContainText('(10 puntos)');
    await expect(f.locator('.portal-th__formulario-pregunta')).toHaveCount(12);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/20-estudiante-evaluacion-inicio.png` });

    // Primer intento: 3 malas = 70 % → no aprueba, el aviso va ARRIBA y con color, y puede reintentar.
    await f.getByRole('checkbox').check();
    await responder(page, 3);
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toContainText('No aprobó la evaluación: obtuvo 70 % y la nota mínima es 80 %');
    await expect(page.getByTestId('aviso-formulario')).toContainText('intentos: 1');
    await expect(page.getByTestId('formulario-enviado')).toHaveCount(0);
    await page.waitForTimeout(800); // fin del desplazamiento suave
    // El aviso va ARRIBA y a la vista, sin tener que desplazarse.
    await expect(page.getByTestId('aviso-formulario')).toBeInViewport();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/21-estudiante-no-aprobo.png` });
    // Las respuestas calificadas se limpian; los datos de la persona se conservan.
    await expect(f.locator('#fp-dato_cedula input')).toHaveValue('1020304050');
    await expect(f.locator('#fp-q1').getByRole('radio', { checked: true })).toHaveCount(0);

    // Segundo intento: todas bien → aprobada, con la nota.
    await responder(page, 0);
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Evaluación aprobada');
    await expect(page.getByTestId('nota-obtenida')).toHaveText('Su nota: 100 %');
    expect(estado.intentos).toBe(2);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/22-estudiante-aprobo.png` });

    await page.getByRole('button', { name: 'Volver al curso' }).click();
    await page.getByTestId('abrir-formulario-4').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Ya aprobó esta evaluación');
  });

  test('celular: la evaluación se responde sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simularEstudiante(page);
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await page.getByTestId('abrir-formulario-4').click();
    const f = page.getByTestId('formulario-propio');
    expect(await f.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/23-celular-evaluacion-inicio.png` });
    await f.getByRole('checkbox').check();
    await responder(page, 5);
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toContainText('No aprobó la evaluación');
    await page.waitForTimeout(800);
    await expect(page.getByTestId('aviso-formulario')).toBeInViewport();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/24-celular-no-aprobo.png` });
  });

  test('formador: crea una evaluación a mano (puntos que suman 100, respuesta correcta marcada)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    let creada: Record<string, unknown> | null = null;
    await page.route('**/api/portal/courses', (r) =>
      r.fulfill({ json: { esFormador: true, cursos: [{ ...curso, totalMateriales: 0, totalInscritos: 0, inscrito: true, porcentaje: 0, certificado: null }] } })
    );
    await page.route('**/api/portal/courses/2', (r) =>
      r.fulfill({ json: { curso, esFormador: true, puedeMarcarManual: true, porcentaje: 0, materiales: [], certificado: null } })
    );
    await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
    await page.route('**/api/portal/formularios', async (r) => {
      if (r.request().method() === 'POST') {
        creada = r.request().postDataJSON() as Record<string, unknown>;
        return r.fulfill({ json: { ok: true, formulario: { id: 9, codigo: creada.codigo, titulo: creada.titulo, version: 1 } } });
      }
      return r.fulfill({ json: { formularios: creada ? [{ id: 9, codigo: creada.codigo, titulo: creada.titulo, version: 1, materiales: 0 }] : [] } });
    });

    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: 'Vista formador' }).click();
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await page.getByRole('button', { name: 'Formulario', exact: true }).click();
    const selector = page.getByTestId('selector-formulario');
    await expect(selector.getByTestId('crear-encuesta')).toBeVisible();
    await expect(selector.getByTestId('crear-evaluacion')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/30-formador-boton-formulario.png` });

    await selector.getByTestId('crear-evaluacion').click();
    const c = page.getByTestId('constructor-formulario');
    await expect(c).toBeVisible();
    // Reparto automático desde el inicio: 1 pregunta = 100 puntos.
    await expect(c.getByTestId('puntos-auto')).toBeChecked();
    await expect(c.getByTestId('suma-puntos')).toContainText('100 / 100');

    await c.getByTestId('titulo-formulario').fill('Evaluación Inducción Organizacional y SST');
    await c.getByLabel('Enunciado', { exact: true }).fill('Seleccione la opción correcta. Puntaje mínimo para aprobar: 80 %.');
    const q1 = c.getByTestId('pregunta-1');
    await q1.getByLabel('Enunciado de la pregunta').fill('¿Cuál es el procedimiento correcto para reportar un accidente de trabajo?');
    await q1.getByPlaceholder('Opción 1').fill('Esperar a que el trabajador se recupere');
    await q1.getByPlaceholder('Opción 2').fill('Reportarlo de inmediato al jefe directo y a la ARL');
    await q1.getByRole('radio', { name: 'Marcar la opción 2 como correcta' }).check();

    await c.getByTestId('agregar-pregunta').click();
    const q2 = c.getByTestId('pregunta-2');
    await q2.getByLabel('Enunciado de la pregunta').fill('¿Cuál de los siguientes valores no es corporativo?');
    await q2.getByPlaceholder('Opción 1').fill('Respeto');
    await q2.getByPlaceholder('Opción 2').fill('Tolerancia');
    await q2.getByRole('radio', { name: 'Marcar la opción 2 como correcta' }).check();
    // Con 2 preguntas, 100 ÷ 2 = 50 puntos cada una, sin escribir nada.
    await expect(q1.getByLabel('Puntos')).toHaveValue('50');
    await expect(q2.getByLabel('Puntos')).toHaveValue('50');
    await expect(c.getByTestId('suma-puntos')).toContainText('100 / 100');
    await c.scrollIntoViewIfNeeded();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/31-formador-constructor-evaluacion.png`, fullPage: true });

    // Reparto manual con puntos que no suman 100: el aviso va ARRIBA, en rojo, y no se guarda nada.
    await c.getByText('Repartir los 100 puntos por igual entre las preguntas').click(); // interruptor de Mantine: se alterna por su etiqueta
    await expect(c.getByTestId('puntos-auto')).not.toBeChecked();
    await q1.getByLabel('Puntos').fill('60');
    await q2.getByLabel('Puntos').fill('30');
    await expect(c.getByTestId('suma-puntos')).toContainText('90 / 100');
    await c.getByTestId('guardar-formulario').click();
    await expect(c.getByTestId('errores-constructor')).toContainText('Los puntos deben sumar exactamente 100: hoy suman 90.');
    expect(creada).toBeNull();
    await page.waitForTimeout(800);
    await expect(c.getByTestId('errores-constructor')).toBeInViewport();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/32-formador-puntos-no-suman-100.png` });

    // Volver al reparto automático: 50 + 50 y guardar.
    await c.getByText('Repartir los 100 puntos por igual entre las preguntas').click();
    await expect(c.getByTestId('puntos-auto')).toBeChecked();
    await expect(c.getByTestId('suma-puntos')).toContainText('100 / 100');
    await c.getByTestId('guardar-formulario').click();
    await expect(selector.getByRole('alert').filter({ hasText: 'Evaluación creada' })).toContainText('Evaluación creada: Evaluación Inducción Organizacional y SST');
    expect(creada).toMatchObject({ tipo: 'evaluacion', notaMinima: 80, datosSensibles: true });
    const preguntas = (creada as unknown as { preguntas: { id: string; puntos?: number; correcta?: number }[] }).preguntas;
    expect(preguntas.find((p) => p.id === 'q1')).toMatchObject({ puntos: 50, correcta: 1 });
    expect(preguntas.find((p) => p.id === 'q2')).toMatchObject({ puntos: 50, correcta: 1 });
    expect(preguntas.map((p) => p.id).slice(0, 2)).toEqual(['dato_nombre', 'dato_cedula']);
    await page.waitForTimeout(800);
    await expect(selector.getByRole('alert').filter({ hasText: 'Evaluación creada' })).toBeInViewport();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/33-formador-evaluacion-creada.png` });
  });

  test('formador: crea una encuesta a mano y la vista previa califica en el navegador', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.route('**/api/portal/courses', (r) =>
      r.fulfill({ json: { esFormador: true, cursos: [{ ...curso, totalMateriales: 0, totalInscritos: 0, inscrito: true, porcentaje: 0, certificado: null }] } })
    );
    await page.route('**/api/portal/courses/2', (r) =>
      r.fulfill({ json: { curso, esFormador: true, puedeMarcarManual: true, porcentaje: 0, materiales: [], certificado: null } })
    );
    await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
    await page.route('**/api/portal/formularios', (r) => r.fulfill({ json: { formularios: [] } }));
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: 'Vista formador' }).click();
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await page.getByRole('button', { name: 'Formulario', exact: true }).click();

    const selector = page.getByTestId('selector-formulario');
    await selector.getByTestId('crear-encuesta').click();
    const c = page.getByTestId('constructor-formulario');
    await c.getByTestId('titulo-formulario').fill('Encuesta de satisfacción');
    await c.getByTestId('pregunta-1').getByLabel('Enunciado de la pregunta').fill('¿Qué le pareció el curso?');
    await c.getByTestId('pregunta-1').getByLabel('Tipo de pregunta').selectOption('texto_largo');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/34-formador-constructor-encuesta.png`, fullPage: true });
    await c.getByRole('button', { name: 'Vista previa' }).click();
    await expect(page.getByTestId('visor-formulario')).toBeVisible();
    await expect(page.getByTestId('formulario-propio')).toContainText('Encuesta de satisfacción');
  });
});

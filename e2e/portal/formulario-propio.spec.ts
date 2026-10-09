import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · Formación · FORMULARIO PROPIO (Cristian Baldión, 2026-10-08):
 * "SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST" respondido DENTRO del portal.
 *
 * Comportamiento confirmado por Cristian:
 *   - un solo botón "Enviar" al final;
 *   - si faltan obligatorias, mensaje visible y desplazamiento a la primera;
 *   - al enviar con éxito, "Respuestas enviadas", volver al curso, y la
 *     casilla y el "Completado" actualizados de inmediato en la lista.
 *
 * Sin sesión real: las APIs del portal se simulan con `page.route` (como en
 * formacion-completado.spec.ts). Además, que las rutas reales exijan sesión.
 * Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const SST = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'lib', 'portal', 'formularios', 'sst-01-fr-001.json'), 'utf8')) as {
  preguntas: { id: string; texto: string; tipo: string; obligatoria: boolean; opciones?: string[]; prellenar?: string }[];
};
const ESTUDIANTE = 'laura.gomez@gsslatam.com';
const curso = { id: 2, titulo: 'INDUCCIÓN ORGANIZACIONAL - SST', descripcion: 'Inducción de Seguridad y Salud en el Trabajo', activo: true, creadoPor: 'th@gsslatam.com' };

async function simular(page: Page, opciones: { puedeMarcarManual?: boolean; esFormador?: boolean } = {}) {
  const estado = { enviado: false, cuerpo: null as null | { respuestas: Record<string, unknown> } };
  const detalle = () => ({
    curso,
    esFormador: !!opciones.esFormador,
    puedeMarcarManual: !!opciones.puedeMarcarManual,
    porcentaje: estado.enviado ? 50 : 0,
    materiales: [
      {
        id: 4,
        tipo: 'FORM',
        formularioId: 1,
        titulo: 'PERFIL SOCIODEMOGRÁFICO SST',
        orden: 0,
        url: null,
        nombreArchivo: null,
        mime: null,
        obligatorio: true,
        completadoEl: estado.enviado ? '2026-10-08T21:00:00Z' : null,
      },
      { id: 5, tipo: 'LINK', titulo: 'Política de SST', orden: 1, url: 'https://example.com', nombreArchivo: null, mime: null, obligatorio: true, completadoEl: null },
    ],
    certificado: null,
  });
  await page.route('**/api/portal/courses', (r) =>
    r.fulfill({
      json: {
        esFormador: !!opciones.esFormador,
        cursos: [{ ...curso, totalMateriales: 2, totalInscritos: 12, inscrito: true, porcentaje: detalle().porcentaje, certificado: null }],
      },
    })
  );
  await page.route('**/api/portal/courses/2', (r) => r.fulfill({ json: detalle() }));
  await page.route('**/api/portal/courses/2/roster', (r) => r.fulfill({ json: { estudiantes: [] } }));
  await page.route('**/api/portal/materials/4/formulario', async (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill({
        json: {
          material: { id: 4, titulo: 'PERFIL SOCIODEMOGRÁFICO SST' },
          formulario: { versionId: 10, version: 1, definicion: SST },
          prellenado: { correo: ESTUDIANTE, nombre: 'Laura Gómez' },
          enviadaEl: estado.enviado ? '2026-10-08T21:00:00Z' : null,
        },
      });
    }
    // Imita al servidor: autorización y obligatorias.
    const cuerpo = r.request().postDataJSON() as { autorizaDatos: boolean; respuestas: Record<string, unknown> };
    const faltan = SST.preguntas.filter((p) => p.obligatoria && !cuerpo.respuestas[p.id]).map((p) => ({ id: p.id, mensaje: 'Esta pregunta es obligatoria.' }));
    if (!cuerpo.autorizaDatos || faltan.length) return r.fulfill({ status: 422, json: { error: 'Faltan respuestas.', errores: faltan } });
    estado.enviado = true;
    estado.cuerpo = cuerpo;
    return r.fulfill({ json: { ok: true, completado: true, enviadaEl: '2026-10-08T21:00:00Z', porcentaje: 50, certificado: null } });
  });
  await page.route('**/api/portal/materials/4/vista', (r) => r.fulfill({ status: 409, json: { error: 'Es un formulario.' } }));
  return estado;
}

async function abrirFormulario(page: Page) {
  await page.goto('/portal/formacion');
  await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
  await page.getByTestId('abrir-formulario-4').click();
  await expect(page.getByTestId('formulario-propio')).toBeVisible();
}

/** Llena TODAS las obligatorias (la 6 con "Otra respuesta"). */
async function llenarObligatorias(page: Page) {
  const f = page.getByTestId('formulario-propio');
  for (const p of SST.preguntas) {
    if (!p.obligatoria || p.prellenar) continue;
    const bloque = f.locator(`#fp-${p.id}`);
    if (p.id === 'p06') {
      await bloque.getByPlaceholder('Otras').fill('Prefiero describirlo');
    } else if (p.tipo === 'seleccion' || p.tipo === 'si_no') {
      await bloque.getByRole('radio').first().check();
    } else if (p.tipo === 'fecha') {
      await bloque.locator('input[type="date"]').fill('1990-05-17');
    } else {
      await bloque.locator('input').fill(p.id === 'p19' ? 'O+' : p.id === 'p04' ? '36' : 'Respuesta de prueba');
    }
  }
}

test.describe('Portal TH · Formación · formulario propio', () => {
  test('las rutas reales del formulario y de respuestas exigen sesión', async ({ request }) => {
    expect((await request.get('/api/portal/materials/4/formulario')).status()).toBe(401);
    expect((await request.post('/api/portal/materials/4/formulario', { data: { versionId: 1 } })).status()).toBe(401);
    expect((await request.get('/api/portal/materials/4/respuestas')).status()).toBe(401);
    expect((await request.get('/api/portal/materials/4/respuestas/excel')).status()).toBe(401);
    expect((await request.post('/api/portal/formularios', { data: {} })).status()).toBe(401);
  });

  test('escritorio: autorización, obligatorias con desplazamiento a la primera, Enviar → completado', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const estado = await simular(page);
    await abrirFormulario(page);
    const f = page.getByTestId('formulario-propio');

    // Un solo botón "Enviar", al final; 40 preguntas; correo y nombre prellenados.
    await expect(f.getByRole('button', { name: 'Enviar' })).toHaveCount(1);
    await expect(f.locator('.portal-th__formulario-pregunta')).toHaveCount(40);
    await expect(f.locator('#fp-p01 input')).toHaveValue(ESTUDIANTE);
    await expect(f.locator('#fp-p01 input')).toHaveAttribute('readonly', '');
    await expect(f.locator('#fp-p02 input')).toHaveValue('Laura Gómez');
    await expect(page.getByTestId('autorizacion-pendiente')).toHaveText('Texto pendiente de validación por Talento Humano o Jurídica');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/01-escritorio-formulario-inicio.png` });

    // Enviar vacío: aviso visible y desplazamiento a la PRIMERA que falta (la autorización).
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toBeVisible();
    await expect(page.getByTestId('aviso-formulario')).toContainText('acepte la autorización');
    await expect(f.locator('#fp-autorizacion')).toBeInViewport();

    // Con la autorización pero sin la pregunta 3: lleva a la 3.
    await f.getByRole('checkbox').check();
    await llenarObligatorias(page);
    await f.locator('#fp-p03 input').fill('');
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toContainText('revise 1 pregunta');
    await expect(f.locator('#fp-p03')).toHaveClass(/portal-th__formulario-pregunta--error/);
    await expect(f.locator('#fp-p03')).toBeInViewport();
    await expect(f.locator('#fp-p03 input')).toBeFocused();
    await page.waitForTimeout(500); // fin del desplazamiento suave
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/02-escritorio-obligatoria-faltante.png` });

    // Completo: Enviar → "Respuestas enviadas".
    await f.locator('#fp-p03 input').fill('1020304050');
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Respuestas enviadas');
    expect(estado.cuerpo?.respuestas.p06).toEqual({ otra: 'Prefiero describirlo' });
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/03-escritorio-respuestas-enviadas.png` });

    // Volver: la casilla y "Completado" ya están actualizados en la lista.
    await page.getByRole('button', { name: 'Volver al curso' }).click();
    await expect(page.getByTestId('visor-formulario')).toHaveCount(0);
    const fila = page.locator('.portal-th__material-item', { hasText: 'PERFIL SOCIODEMOGRÁFICO SST' });
    await expect(fila.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await expect(fila.getByTestId('insignia-completado')).toHaveText('✓ Completado');
    await expect(page.getByText('Respuestas enviadas: "PERFIL SOCIODEMOGRÁFICO SST" quedó completado.')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/04-escritorio-lista-completado.png`, fullPage: true });

    // Reabrirlo: ya enviado, no se puede volver a enviar.
    await page.getByTestId('abrir-formulario-4').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Ya envió este formulario');
    await expect(page.getByTestId('enviar-formulario')).toHaveCount(0);
  });

  test('celular: el formulario ocupa la pantalla y se responde completo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await abrirFormulario(page);
    const f = page.getByTestId('formulario-propio');
    // Sin desplazamiento horizontal.
    expect(await f.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/05-celular-formulario-inicio.png` });

    await f.getByRole('checkbox').check();
    await llenarObligatorias(page);
    await f.locator('#fp-p06').scrollIntoViewIfNeeded();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/06-celular-pregunta-otra-respuesta.png` });
    await f.locator('#fp-p19 input').fill('');
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toBeVisible();
    await expect(f.locator('#fp-p19')).toBeInViewport();
    await page.waitForTimeout(500);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/07-celular-obligatoria-faltante.png` });

    await f.locator('#fp-p19 input').fill('O+');
    await f.getByTestId('enviar-formulario').scrollIntoViewIfNeeded();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/08-celular-boton-enviar.png` });
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Respuestas enviadas');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/09-celular-respuestas-enviadas.png` });
    await page.getByRole('button', { name: 'Volver al curso' }).click();
    await expect(page.locator('.portal-th__material-item', { hasText: 'PERFIL SOCIODEMOGRÁFICO SST' }).getByTestId('insignia-completado')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/10-celular-lista-completado.png`, fullPage: true });
  });

  test('administrador/formador del Excel: tabla de respuestas y exportación a Excel', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await simular(page, { puedeMarcarManual: true, esFormador: true });
    const filas = [
      { correo: 'laura.gomez@gsslatam.com', nombre: 'GÓMEZ RUIZ LAURA', cc: '1020304050', edad: '36', sexo: 'FEMENINO', rh: 'O+', otra: null },
      { correo: 'carlos.mora@farmalogica.com', nombre: 'MORA PEÑA CARLOS', cc: '79876543', edad: '41', sexo: 'MASCULINO', rh: 'A+', otra: 'Prefiero describirlo' },
      { correo: 'diana.rios@onelatampharma.com', nombre: 'RÍOS DÍAZ DIANA', cc: '52123456', edad: '29', sexo: 'FEMENINO', rh: 'B-', otra: null },
    ];
    let pedidoExcel = false;
    await page.route('**/api/portal/materials/4/respuestas', (r) =>
      r.fulfill({
        json: {
          curso: { id: 2, titulo: curso.titulo },
          material: { id: 4, titulo: 'PERFIL SOCIODEMOGRÁFICO SST' },
          formulario: { codigo: 'SST-01-FR-001', titulo: 'SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST', version: 1 },
          columnas: SST.preguntas.map((p) => ({ id: p.id, texto: p.texto })),
          filas: filas.map((x, i) => ({
            id: i + 1,
            correo: x.correo,
            enviadaEl: `2026-10-08T2${i}:00:00Z`,
            version: 1,
            autorizacionVersion: 'AUT-DATOS-SST-2026-10-08-BORRADOR',
            respuestas: { p01: x.correo, p02: x.nombre, p03: x.cc, p04: x.edad, p05: x.sexo, p06: x.otra ? { otra: x.otra } : x.sexo === 'FEMENINO' ? 'MUJER' : 'HOMBRE', p07: '1990-05-17', p08: 'BOGOTÁ', p09: 'SOLTERO(A)', p10: 'NO', p19: x.rh },
          })),
        },
      })
    );
    await page.route('**/api/portal/materials/4/respuestas/excel', (r) => {
      pedidoExcel = true;
      return r.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from('PK'), headers: { 'Content-Disposition': 'attachment; filename="SST-01-FR-001-respuestas-curso-2.xlsx"' } });
    });
    await page.goto('/portal/formacion');
    // Las respuestas se ven en la «Vista formador», no en la de estudiante (Cristian, 2026-10-09).
    await page.getByRole('button', { name: 'Vista formador' }).click();
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await page.getByRole('button', { name: 'Respuestas', exact: true }).first().click();
    const panel = page.getByTestId('panel-respuestas');
    await expect(panel.getByTestId('conteo-respuestas')).toHaveText(`3 respuesta(s) · ${curso.titulo}`);
    await expect(panel.getByTestId('tabla-respuestas').locator('tbody tr')).toHaveCount(3);
    await expect(panel.getByText('Otra: Prefiero describirlo')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/11-escritorio-tabla-respuestas.png` });

    const descarga = page.waitForEvent('download');
    await panel.getByTestId('exportar-excel').click();
    expect((await descarga).suggestedFilename()).toBe('SST-01-FR-001-respuestas-curso-2.xlsx');
    expect(pedidoExcel).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/12-celular-tabla-respuestas.png` });
  });

  test('un administrador/formador en «Vista estudiante» NO ve «Ver respuestas» (solo en «Vista formador»)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await simular(page, { puedeMarcarManual: true, esFormador: true });
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: 'Vista estudiante' }).click();
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await expect(page.getByTestId('abrir-formulario-4')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver respuestas' })).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/15-vista-estudiante-sin-ver-respuestas.png` });
    await page.getByRole('button', { name: 'Vista formador' }).click();
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await expect(page.getByRole('button', { name: 'Respuestas', exact: true }).first()).toBeVisible();
  });

  test('estudiante sin permiso: no ve "Ver respuestas"', async ({ page }) => {
    await simular(page, { puedeMarcarManual: false });
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await expect(page.getByTestId('abrir-formulario-4')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver respuestas' })).toHaveCount(0);
  });

  test('formador: material tipo "Formulario" con selector y vista previa', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await simular(page, { esFormador: true, puedeMarcarManual: true });
    await page.route('**/api/portal/formularios', (r) =>
      r.fulfill({ json: { formularios: [{ id: 1, codigo: 'SST-01-FR-001', titulo: 'SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST', version: 1, materiales: 1 }] } })
    );
    await page.route('**/api/portal/formularios/1', (r) => r.fulfill({ json: { formulario: { id: 1, versionId: 10, version: 1, definicion: SST } } }));
    await page.goto('/portal/formacion');
    await page.getByRole('button', { name: 'Vista formador' }).click();
    await page.getByRole('button', { name: /INDUCCIÓN ORGANIZACIONAL - SST/ }).click();
    await page.getByRole('button', { name: 'Formulario', exact: true }).click();
    const selector = page.getByTestId('selector-formulario');
    await expect(selector.getByRole('combobox', { name: 'Formulario' })).toHaveValue('1');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/13-formador-agregar-formulario.png`, fullPage: true });
    await selector.getByRole('button', { name: 'Vista previa' }).click();
    const previa = page.getByTestId('formulario-propio');
    await expect(previa.locator('.portal-th__formulario-pregunta')).toHaveCount(40);
    await expect(previa.getByText('Vista previa del formador')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/14-formador-vista-previa.png` });
  });
});

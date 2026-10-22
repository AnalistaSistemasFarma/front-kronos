import { expect, test, type Locator, type Page } from '@playwright/test';
import reporte from '../../lib/portal/formularios/sst-reporte-actos-condiciones.json';
import salud from '../../lib/portal/formularios/sst-condiciones-salud-osteomuscular.json';

/**
 * Portal TH · FORMULARIOS SST (Cristian Baldión, 2026-10-20), etapa 3: la página `/portal/formularios-sst` donde se abren y se envían los
 * dos formularios (con las definiciones REALES) y donde el administrador y los lectores SST ven las respuestas y las exportan a Excel.
 * Sin sesión real ni SharePoint: la API se simula con `page.route`; las personas son INVENTADAS. Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const LISTA = [
  { codigo: 'SST-REPORTE-ACTOS', titulo: reporte.titulo, descripcion: reporte.descripcion, datosSensibles: false },
  { codigo: 'SST-SALUD-OSTEOMUSCULAR', titulo: salud.titulo, descripcion: salud.descripcion, datosSensibles: true },
];
const DEFINICIONES: Record<string, unknown> = { 'SST-REPORTE-ACTOS': reporte, 'SST-SALUD-OSTEOMUSCULAR': salud };
interface Pregunta { id: string; tipo: string; prellenar?: string }
interface Definicion { preguntas: Pregunta[] }

const TABLA = {
  formulario: { codigo: 'SST-REPORTE-ACTOS', titulo: reporte.titulo },
  columnas: reporte.preguntas.map((p) => ({ id: p.id, texto: p.texto })),
  filas: [
    { id: 'a.json', correo: 'laura.gomez@gsslatam.com', enviadaEl: '2026-10-20T15:00:00.000Z', autorizacionVersion: null, respuestas: { r01: 'Laura Gómez', r02: '1010101010', r03: 'Planta', r04: 'MANTENIMIENTO', r05: 'Condición Insegura: Es toda condición…', r06: 'Piso mojado frente al taller' } },
    { id: 'b.json', correo: 'carlos.ruiz@gsslatam.com', enviadaEl: '2026-10-19T14:00:00.000Z', autorizacionVersion: null, respuestas: { r01: 'Carlos Ruiz', r02: '2020202020', r03: 'Sede administrativa', r04: 'TECNOLOGIA', r05: 'Acto Inseguro: Todas las acciones…', r06: 'Cable suelto en el piso 2' } },
  ],
  total: 2,
  truncado: false,
};

interface Opciones {
  puedeVer?: boolean;
  sinSesion?: boolean;
  falloLista?: boolean;
  tabla?: unknown;
  falloTabla?: { status: number; error: string };
  falloEnvio?: { status: number; error: string };
}

async function simular(page: Page, o: Opciones = {}) {
  const envios: { codigo: string; cuerpo: Record<string, unknown> }[] = [];
  await page.route('**/api/portal/formularios-sst', (r) => {
    if (o.sinSesion) return r.fulfill({ status: 401, json: { error: 'Sesión no válida.' } });
    if (o.falloLista) return r.fulfill({ status: 502, json: { error: 'No se pudieron cargar los formularios.' } });
    return r.fulfill({ json: { formularios: LISTA, puedeVerRespuestas: o.puedeVer === true } });
  });
  await page.route(/\/api\/portal\/formularios-sst\/[A-Z-]+$/, async (r) => {
    const codigo = new URL(r.request().url()).pathname.split('/').pop()!;
    if (r.request().method() === 'POST') {
      if (o.falloEnvio) return r.fulfill({ status: o.falloEnvio.status, json: { error: o.falloEnvio.error } });
      envios.push({ codigo, cuerpo: r.request().postDataJSON() as Record<string, unknown> });
      return r.fulfill({ status: 201, json: { ok: true, completado: true, enviadaEl: '2026-10-20T15:00:00.000Z' } });
    }
    return r.fulfill({ json: { material: { id: 0, titulo: codigo }, formulario: { versionId: 1, version: 1, definicion: DEFINICIONES[codigo] }, prellenado: { correo: 'laura.gomez@gsslatam.com', nombre: 'Laura Gómez' }, enviadaEl: null } });
  });
  await page.route('**/api/portal/formularios-sst/*/respuestas', (r) =>
    o.falloTabla ? r.fulfill({ status: o.falloTabla.status, json: { error: o.falloTabla.error } }) : r.fulfill({ json: o.tabla ?? TABLA })
  );
  return envios;
}

async function llenar(f: Locator, definicion: Definicion) {
  for (const p of definicion.preguntas) {
    if (p.prellenar) continue;
    const caja = f.locator(`#fp-${p.id}`);
    if (p.tipo === 'texto') await caja.locator('input').fill('Dato de prueba');
    else if (p.tipo === 'texto_largo') await caja.locator('textarea').fill('Descripción de prueba del lugar y de lo ocurrido');
    else if (p.tipo === 'seleccion_multiple') await caja.getByRole('checkbox').first().check();
    else await caja.getByRole('radio').first().check();
  }
}

const tarjeta = (page: Page, codigo: string) => page.getByTestId(`formulario-sst-${codigo}`);

test.describe('Portal TH · formularios SST (etapa 3)', () => {
  test('la API exige sesión', async ({ request }) => {
    for (const ruta of ['', '/SST-REPORTE-ACTOS', '/SST-REPORTE-ACTOS/respuestas', '/SST-REPORTE-ACTOS/respuestas/excel']) {
      expect((await request.get(`/api/portal/formularios-sst${ruta}`)).status(), ruta).toBe(401);
    }
    expect((await request.post('/api/portal/formularios-sst/SST-REPORTE-ACTOS', { data: {} })).status()).toBe(401);
  });

  test('la página lista los dos formularios; quien no es lector NO ve «Ver respuestas» ni Excel', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal/formularios-sst');
    await expect(page.getByRole('heading', { name: 'Formularios SST', level: 1 })).toBeVisible();
    await expect(page.getByTestId('formularios-sst').locator('[data-testid^="formulario-sst-"]')).toHaveCount(2);
    await expect(tarjeta(page, 'SST-REPORTE-ACTOS')).toContainText('REPORTE DE ACTOS Y CONDICIONES INSEGURAS SST');
    await expect(tarjeta(page, 'SST-SALUD-OSTEOMUSCULAR')).toContainText('CONDICIONES DE SALUD Y SINTOMATOLOGÍA OSTEOMUSCULAR');
    await expect(tarjeta(page, 'SST-SALUD-OSTEOMUSCULAR')).toContainText('autorización');
    await expect(tarjeta(page, 'SST-REPORTE-ACTOS')).not.toContainText('autorización');
    await expect(page.getByRole('button', { name: 'Abrir formulario' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Ver respuestas' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Exportar a Excel' })).toHaveCount(0);
    await page.waitForTimeout(200);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/170-sst-pagina.png` });
  });

  test('B1: se abre, se contesta completo y se envía; se puede enviar otro (cada reporte es nuevo)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const envios = await simular(page);
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('abrir-sst-SST-REPORTE-ACTOS').click();
    const f = page.getByTestId('formulario-propio');
    await expect(f).toBeVisible();
    await expect(f).toContainText('310 2480499');
    await expect(f.locator('#fp-r01 input')).toHaveValue('Laura Gómez'); // el nombre sale de la sesión
    await llenar(f, reporte as Definicion);
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toContainText('Respuestas enviadas');
    await expect(page.getByTestId('formulario-enviado')).toContainText('Seguridad y Salud en el Trabajo');
    await expect(page.getByTestId('formulario-enviado')).not.toContainText('material');
    await expect(page.getByTestId('formulario-enviado')).not.toContainText('curso');
    expect(envios).toHaveLength(1);
    expect(envios[0].codigo).toBe('SST-REPORTE-ACTOS');
    expect((envios[0].cuerpo.respuestas as Record<string, string>).r03).toBe('Planta');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/171-sst-enviado.png` });

    await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
    await expect(page.getByTestId('visor-formulario')).toBeHidden();
    // Otro envío: vuelve a abrir en blanco y se puede enviar otra vez.
    await page.getByTestId('abrir-sst-SST-REPORTE-ACTOS').click();
    await expect(page.getByTestId('formulario-propio')).toBeVisible();
    await llenar(page.getByTestId('formulario-propio'), reporte as Definicion);
    await page.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toBeVisible();
    expect(envios).toHaveLength(2);
  });

  test('B2: sin la autorización de datos no se envía; con ella sí, con «Otras» y la escala', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const envios = await simular(page);
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('abrir-sst-SST-SALUD-OSTEOMUSCULAR').click();
    const f = page.getByTestId('formulario-propio');
    await expect(f.locator('#fp-autorizacion')).toContainText('totalmente confidencial');
    await llenar(f, salud as Definicion);
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toContainText('acepte la autorización');
    expect(envios).toHaveLength(0);
    await f.getByRole('checkbox', { name: /Autorizo el tratamiento/ }).check();
    await f.getByTestId('otras-marca-o10').check();
    await f.getByTestId('otras-texto-o10').fill('Ojo izquierdo');
    await f.locator('#fp-o11').getByRole('radio', { name: '0', exact: true }).check();
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('formulario-enviado')).toBeVisible();
    expect(envios).toHaveLength(1);
    expect(envios[0].cuerpo.autorizaDatos).toBe(true);
    const r = envios[0].cuerpo.respuestas as Record<string, unknown>;
    expect(r.o10).toContain('Otras: Ojo izquierdo');
    expect(r.o11).toBe('0');
  });

  test('si el servidor rechaza el envío (tope diario, sin permiso en SharePoint…) el aviso rojo va ARRIBA y lo escrito se conserva', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { falloEnvio: { status: 429, error: 'Ya envió este formulario 20 veces hoy.' } });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('abrir-sst-SST-REPORTE-ACTOS').click();
    const f = page.getByTestId('formulario-propio');
    await llenar(f, reporte as Definicion);
    await f.getByTestId('enviar-formulario').click();
    await expect(page.getByTestId('aviso-formulario')).toContainText('Ya envió este formulario 20 veces hoy.');
    await expect(f.locator('#fp-r06 textarea')).toHaveValue('Descripción de prueba del lugar y de lo ocurrido');
    await expect(page.getByTestId('formulario-enviado')).toHaveCount(0);
  });

  test('un lector SST ve «Ver respuestas» y el Excel; la tabla trae los envíos con sus columnas y el buscador filtra', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page, { puedeVer: true });
    await page.goto('/portal/formularios-sst');
    const t = tarjeta(page, 'SST-REPORTE-ACTOS');
    await expect(t.getByRole('link', { name: 'Exportar a Excel' })).toHaveAttribute('href', '/api/portal/formularios-sst/SST-REPORTE-ACTOS/respuestas/excel');
    await t.getByTestId('ver-respuestas-sst-SST-REPORTE-ACTOS').click();
    const panel = page.getByTestId('panel-respuestas-sst');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('conteo-respuestas-sst')).toHaveText('2 respuesta(s)');
    await expect(panel.getByTestId('fila-respuesta-sst')).toHaveCount(2);
    await expect(panel.getByRole('columnheader')).toHaveCount(8); // correo, enviado y las 6 preguntas
    await expect(panel).toContainText('Piso mojado frente al taller');
    await expect(panel).toContainText('Datos personales sensibles');
    await expect(panel.getByTestId('exportar-excel-sst')).toHaveAttribute('href', '/api/portal/formularios-sst/SST-REPORTE-ACTOS/respuestas/excel');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/172-sst-respuestas.png` });
    await panel.getByRole('searchbox').fill('cable suelto');
    await expect(panel.getByTestId('fila-respuesta-sst')).toHaveCount(1);
    await expect(panel).toContainText('carlos.ruiz@gsslatam.com');
    await panel.getByRole('searchbox').fill('carlos.ruiz');
    await expect(panel.getByTestId('fila-respuesta-sst')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('tabla vacía y tabla con más envíos de los que se muestran: lo dicen', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { puedeVer: true, tabla: { ...TABLA, filas: [], total: 0 } });
    await page.goto('/portal/formularios-sst');
    await tarjeta(page, 'SST-REPORTE-ACTOS').getByTestId('ver-respuestas-sst-SST-REPORTE-ACTOS').click();
    await expect(page.getByTestId('respuestas-sst-vacio')).toHaveText('Todavía nadie ha enviado este formulario.');

    const otra = await page.context().newPage();
    await otra.setViewportSize({ width: 1366, height: 900 });
    await simular(otra, { puedeVer: true, tabla: { ...TABLA, total: 731, truncado: true } });
    await otra.goto('/portal/formularios-sst');
    await tarjeta(otra, 'SST-REPORTE-ACTOS').getByTestId('ver-respuestas-sst-SST-REPORTE-ACTOS').click();
    await expect(otra.getByTestId('conteo-respuestas-sst')).toHaveText('731 respuesta(s) · se muestran las 2 más recientes; el Excel trae más');
  });

  test('si no se pueden leer las respuestas, el aviso rojo va ARRIBA en la ventana', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { puedeVer: true, falloTabla: { status: 502, error: 'El portal no tiene permiso para leer FORMULARIOS SST en SharePoint. Avise a Tecnología.' } });
    await page.goto('/portal/formularios-sst');
    await tarjeta(page, 'SST-REPORTE-ACTOS').getByTestId('ver-respuestas-sst-SST-REPORTE-ACTOS').click();
    await expect(page.getByTestId('respuestas-sst-error')).toContainText('El portal no tiene permiso para leer FORMULARIOS SST en SharePoint. Avise a Tecnología.');
  });

  test('sin sesión: pide ingresar al portal; si la lista falla, aviso rojo con «Reintentar»', async ({ page }) => {
    await simular(page, { sinSesion: true });
    await page.goto('/portal/formularios-sst');
    await expect(page.getByRole('heading', { name: 'Ingrese primero al portal' })).toBeVisible();
    await expect(page.getByTestId('ingresar-sst')).toHaveAttribute('href', '/portal');

    const otra = await page.context().newPage();
    await simular(otra, { falloLista: true });
    await otra.goto('/portal/formularios-sst');
    await expect(otra.getByTestId('formularios-sst-error')).toContainText('No se pudieron cargar los formularios.');
    await expect(otra.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });

  test('celular: la lista y el formulario caben en la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page, { puedeVer: true });
    await page.goto('/portal/formularios-sst');
    await expect(page.getByRole('button', { name: 'Abrir formulario' })).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.getByTestId('abrir-sst-SST-REPORTE-ACTOS').click();
    await expect(page.getByTestId('formulario-propio')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.waitForTimeout(200);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/173-sst-celular.png` });
  });
});

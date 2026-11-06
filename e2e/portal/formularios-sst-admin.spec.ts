import { expect, test, type Page } from '@playwright/test';
import { FORMULARIOS_SST } from '../../lib/portal/formularios-sst';

/**
 * Portal TH · FORMULARIOS SST (Cristian Baldión, 2026-10-20), etapa 5: el administrador crea, edita y retira formularios con el MISMO
 * constructor visual de Formación. Sin sesión real ni SharePoint: la API se simula con `page.route`; las definiciones de B1 y B2 son las
 * REALES. Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const [REPORTE, SALUD] = FORMULARIOS_SST;

interface ItemLista {
  codigo: string;
  titulo: string;
  descripcion: string | null;
  datosSensibles: boolean;
  origen: 'base' | 'personalizado';
}
/** Lo que la pantalla envía al guardar: una definición de formulario. */
interface DefinicionEnviada {
  codigo: string;
  titulo: string;
  descripcion?: string;
  datosSensibles?: boolean;
  tipo?: string;
  autorizacion?: { version?: string; pendienteValidacion?: boolean };
  preguntas: { id: string; imagen?: unknown }[];
}

const BASE: ItemLista[] = FORMULARIOS_SST.map((f) => ({ codigo: f.codigo, titulo: f.titulo, descripcion: f.descripcion, datosSensibles: f.datosSensibles, origen: 'base' }));
const PROPIO = {
  codigo: 'SST-INSPECCION',
  titulo: 'Inspección de puestos de trabajo',
  descripcion: 'Formulario propio',
  datosSensibles: false,
  origen: 'personalizado' as const,
  definicion: { formato: 1, codigo: 'SST-INSPECCION', titulo: 'Inspección de puestos de trabajo', descripcion: 'Formulario propio', preguntas: [{ id: 'q1', texto: '¿Qué observó?', tipo: 'texto_largo', obligatoria: true }] },
};

interface Opciones {
  admin?: boolean;
  conPropio?: boolean;
  errorAlGuardar?: { status: number; cuerpo: Record<string, unknown> };
  errorAlListarDefiniciones?: boolean;
}

async function simular(page: Page, o: Opciones = {}) {
  const lista: ItemLista[] = [...BASE, ...(o.conPropio ? [{ codigo: PROPIO.codigo, titulo: PROPIO.titulo, descripcion: PROPIO.descripcion, datosSensibles: false, origen: 'personalizado' as const }] : [])];
  const guardados: { nuevo: boolean; definicion: DefinicionEnviada }[] = [];
  const retirados: string[] = [];
  let pidioDefiniciones = 0;
  await page.route((u) => u.pathname === '/api/portal/formularios-sst', (r) => r.fulfill({ json: { formularios: lista, puedeVerRespuestas: o.admin === true, puedeAdministrar: o.admin === true } }));
  await page.route((u) => u.pathname === '/api/portal/formularios-sst/definiciones', async (r) => {
    const metodo = r.request().method();
    if (metodo === 'GET') {
      pidioDefiniciones += 1;
      if (o.errorAlListarDefiniciones) return r.fulfill({ status: 502, json: { error: 'El portal no tiene permiso para guardar en la carpeta FORMULARIOS SST de SharePoint. Avise a Tecnología.' } });
      const defs = [REPORTE, SALUD].map((f) => ({ codigo: f.codigo, titulo: f.titulo, origen: 'base', editado: false, guardadoEl: null, definicion: f.definicion }));
      return r.fulfill({ json: { formularios: [...defs, ...(o.conPropio ? [{ ...PROPIO, editado: false, guardadoEl: null }] : [])] } });
    }
    if (metodo === 'POST') {
      if (o.errorAlGuardar) return r.fulfill({ status: o.errorAlGuardar.status, json: o.errorAlGuardar.cuerpo });
      const cuerpo = r.request().postDataJSON() as { nuevo: boolean; definicion: DefinicionEnviada };
      guardados.push(cuerpo);
      if (cuerpo.nuevo) lista.push({ codigo: cuerpo.definicion.codigo, titulo: cuerpo.definicion.titulo, descripcion: cuerpo.definicion.descripcion ?? null, datosSensibles: cuerpo.definicion.datosSensibles === true, origen: 'personalizado' });
      return r.fulfill({ status: cuerpo.nuevo ? 201 : 200, json: { formulario: { codigo: cuerpo.definicion.codigo, titulo: cuerpo.definicion.titulo, origen: 'personalizado', guardadoEl: '2026-10-20T15:00:00.000Z' } } });
    }
    const codigo = new URL(r.request().url()).searchParams.get('codigo') ?? '';
    retirados.push(codigo);
    const i = lista.findIndex((f) => f.codigo === codigo);
    if (i >= 0) lista.splice(i, 1);
    return r.fulfill({ json: { ok: true } });
  });
  return { guardados, retirados, definicionesPedidas: () => pidioDefiniciones };
}

const constructor = (page: Page) => page.getByTestId('constructor-formulario');
const tarjeta = (page: Page, codigo: string) => page.getByTestId(`formulario-sst-${codigo}`);

test.describe('Portal TH · formularios SST (etapa 5: administrar)', () => {
  test('quien NO es administrador no ve «Crear formulario», «Editar» ni «Retirar», y ni siquiera pide las definiciones', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const s = await simular(page, { admin: false, conPropio: true });
    await page.goto('/portal/formularios-sst');
    await expect(tarjeta(page, 'SST-REPORTE-ACTOS')).toBeVisible();
    await expect(page.getByTestId('crear-formulario-sst')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retirar' })).toHaveCount(0);
    expect(s.definicionesPedidas()).toBe(0);
  });

  test('el administrador ve «Crear formulario», «Editar» en cada uno y «Retirar» solo en los propios', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { admin: true, conPropio: true });
    await page.goto('/portal/formularios-sst');
    await expect(page.getByTestId('crear-formulario-sst')).toBeVisible();
    for (const f of [...BASE.map((b) => b.codigo), PROPIO.codigo]) await expect(page.getByTestId(`editar-sst-${f}`)).toBeEnabled();
    await expect(page.getByTestId('retirar-sst-SST-INSPECCION')).toBeVisible();
    await expect(page.getByTestId('retirar-sst-SST-REPORTE-ACTOS')).toHaveCount(0); // B1 y B2 no se retiran
    await expect(page.getByTestId('retirar-sst-SST-SALUD-OSTEOMUSCULAR')).toHaveCount(0);
    await page.waitForTimeout(200);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/190-sst-admin-lista.png` });
  });

  test('crear: el constructor es de encuesta (sin elegir entre encuesta y evaluación), se guarda como formulario nuevo y el aviso sale arriba', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    const s = await simular(page, { admin: true });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('crear-formulario-sst').click();
    await expect(constructor(page)).toBeVisible();
    await expect(page.getByTestId('tipo-formulario')).toHaveCount(0);
    await expect(constructor(page).getByLabel('Código del formulario')).toHaveValue(/^SST-ENC-[0-9]{8}-[0-9]{6}$/);
    await expect(page.getByTestId('crear-formulario-sst')).toHaveCount(0); // mientras se edita, no se ofrece otro
    await page.getByTestId('titulo-formulario').fill('Reporte de ergonomía');
    await constructor(page).getByLabel('Enunciado de la pregunta').first().fill('¿Qué molestia siente?');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/191-sst-constructor.png` });
    await page.getByTestId('guardar-formulario').click();
    await expect(page.getByTestId('formularios-sst-aviso')).toHaveText('Formulario creado: Reporte de ergonomía.');
    await expect(constructor(page)).toHaveCount(0);
    expect(s.guardados).toHaveLength(1);
    expect(s.guardados[0].nuevo).toBe(true);
    expect(s.guardados[0].definicion).toMatchObject({ titulo: 'Reporte de ergonomía', preguntas: [{ texto: '¿Qué molestia siente?', tipo: 'texto', obligatoria: true }] });
    expect(s.guardados[0].definicion.codigo).toMatch(/^SST-ENC-/);
    expect(s.guardados[0].definicion.tipo).toBeUndefined(); // encuesta
    // la lista se recarga y el formulario nuevo aparece, con su botón de retirar
    await expect(page.getByText('Reporte de ergonomía').first()).toBeVisible();
  });

  test('un formulario que pide datos de salud lleva la autorización de Seguridad y Salud en el Trabajo (pendiente de validar)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    const s = await simular(page, { admin: true });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('crear-formulario-sst').click();
    await page.getByTestId('titulo-formulario').fill('Seguimiento de salud');
    await constructor(page).getByLabel('Enunciado de la pregunta').first().fill('¿Cómo se siente?');
    await constructor(page).getByText(/Pide datos de salud u otros datos sensibles/).click(); // el interruptor de Mantine es invisible: se pulsa su etiqueta
    await expect(page.getByTestId('datos-sensibles')).toBeChecked();
    await expect(constructor(page)).toContainText('aviso de tratamiento de datos de Seguridad y Salud en el Trabajo');
    await page.getByTestId('guardar-formulario').click();
    await expect(page.getByTestId('formularios-sst-aviso')).toBeVisible();
    const d = s.guardados[0].definicion;
    expect(d.datosSensibles).toBe(true);
    expect(d.autorizacion).toMatchObject({ pendienteValidacion: true, version: expect.stringContaining('AUT-DATOS-SST') });
    expect(JSON.stringify(d.autorizacion)).toContain('Seguridad y Salud en el Trabajo');
  });

  test('editar el de salud: se abre con todo lo suyo (escala, imagen, «Otras») y guardar SIN tocar nada envía exactamente la misma definición', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    const s = await simular(page, { admin: true });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('editar-sst-SST-SALUD-OSTEOMUSCULAR').click();
    await expect(constructor(page)).toBeVisible();
    await expect(page.getByTestId('titulo-formulario')).toHaveValue(SALUD.titulo);
    await expect(constructor(page).getByLabel('Código del formulario')).toBeDisabled();
    await expect(constructor(page)).toContainText('Editar formulario');
    await expect(page.getByTestId('escala-10').getByLabel('Valor máximo')).toHaveValue('10');
    await expect(page.getByTestId('escala-10').getByLabel('Rótulo del mínimo (opcional)')).toHaveValue('Muy poco dolor');
    await expect(page.getByTestId('imagen-pregunta-9')).toContainText('/portal-th/cuerpo-dolor.png');
    await expect(page.getByTestId('datos-sensibles')).toBeChecked();
    await page.getByTestId('guardar-formulario').click();
    await expect(page.getByTestId('formularios-sst-aviso')).toContainText('Versión nueva guardada');
    expect(s.guardados).toHaveLength(1);
    expect(s.guardados[0].nuevo).toBe(false);
    expect(s.guardados[0].definicion).toEqual(JSON.parse(JSON.stringify(SALUD.definicion)));
  });

  test('editar el de reporte: un cambio de título viaja y lo demás queda igual; se puede quitar la imagen de una pregunta', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    const s = await simular(page, { admin: true });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('editar-sst-SST-REPORTE-ACTOS').click();
    await page.getByTestId('titulo-formulario').fill('REPORTE DE ACTOS (corregido)');
    await page.getByTestId('guardar-formulario').click();
    await expect(page.getByTestId('formularios-sst-aviso')).toBeVisible();
    const esperado = JSON.parse(JSON.stringify(REPORTE.definicion));
    esperado.titulo = 'REPORTE DE ACTOS (corregido)';
    expect(s.guardados[0].definicion).toEqual(esperado);

    await page.getByTestId('editar-sst-SST-SALUD-OSTEOMUSCULAR').click();
    await page.getByTestId('imagen-pregunta-9').getByRole('button', { name: 'Quitar imagen' }).click();
    await expect(page.getByTestId('imagen-pregunta-9')).toHaveCount(0);
    await page.getByTestId('guardar-formulario').click();
    await expect(page.getByTestId('formularios-sst-aviso')).toContainText('Versión nueva guardada');
    const p10 = s.guardados[1].definicion.preguntas.find((p) => p.id === 'o10');
    expect(p10).toBeDefined();
    expect(p10?.imagen).toBeUndefined();
  });

  test('vista previa desde el constructor y cancelar sin guardar nada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    const s = await simular(page, { admin: true });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('crear-formulario-sst').click();
    await page.getByTestId('titulo-formulario').fill('Prueba de vista previa');
    await constructor(page).getByLabel('Enunciado de la pregunta').first().fill('¿Cómo está?');
    await constructor(page).getByRole('button', { name: 'Vista previa' }).click();
    await expect(page.getByText('Vista previa · Prueba de vista previa')).toBeVisible();
    await expect(page.getByText('¿Cómo está?').last()).toBeVisible();
    await page.keyboard.press('Escape');
    await constructor(page).getByRole('button', { name: 'Cancelar' }).click();
    await expect(constructor(page)).toHaveCount(0);
    await expect(page.getByTestId('crear-formulario-sst')).toBeVisible();
    expect(s.guardados).toHaveLength(0);
  });

  test('si el servidor rechaza el formulario, los problemas salen ARRIBA en rojo, el constructor sigue abierto y lo escrito se conserva', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    await simular(page, { admin: true, errorAlGuardar: { status: 409, cuerpo: { error: 'Ya existe un formulario con ese código (puede estar retirado). Cambie el código.' } } });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('crear-formulario-sst').click();
    await page.getByTestId('titulo-formulario').fill('Repetido');
    await constructor(page).getByLabel('Enunciado de la pregunta').first().fill('¿Algo?');
    await page.getByTestId('guardar-formulario').click();
    await expect(page.getByTestId('errores-constructor')).toContainText('Ya existe un formulario con ese código');
    await expect(constructor(page)).toBeVisible();
    await expect(page.getByTestId('titulo-formulario')).toHaveValue('Repetido');
    await expect(page.getByTestId('formularios-sst-aviso')).toHaveCount(0);
  });

  test('retirar uno propio pide confirmación; «No» no hace nada; confirmar lo retira y la lista se actualiza', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const s = await simular(page, { admin: true, conPropio: true });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('retirar-sst-SST-INSPECCION').click();
    await page.getByRole('button', { name: 'No' }).click();
    expect(s.retirados).toEqual([]);
    await page.getByTestId('retirar-sst-SST-INSPECCION').click();
    await page.getByTestId('confirmar-retirar-sst-SST-INSPECCION').click();
    await expect(page.getByTestId('formularios-sst-aviso')).toContainText('Formulario retirado: Inspección de puestos de trabajo.');
    await expect(tarjeta(page, 'SST-INSPECCION')).toHaveCount(0);
    expect(s.retirados).toEqual(['SST-INSPECCION']);
  });

  test('si no se pueden leer los formularios para editar, el aviso rojo va ARRIBA y la lista sigue funcionando', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { admin: true, errorAlListarDefiniciones: true });
    await page.goto('/portal/formularios-sst');
    await expect(page.getByTestId('formularios-sst-error')).toContainText('no tiene permiso para guardar en la carpeta FORMULARIOS SST');
    await expect(tarjeta(page, 'SST-REPORTE-ACTOS')).toBeVisible();
    await expect(page.getByTestId('editar-sst-SST-REPORTE-ACTOS')).toBeDisabled(); // sin la definición vigente no se edita (no se parte de una copia vieja)
  });

  test('celular: el constructor cabe en la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page, { admin: true });
    await page.goto('/portal/formularios-sst');
    await page.getByTestId('crear-formulario-sst').click();
    await expect(constructor(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.waitForTimeout(200);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/192-sst-constructor-celular.png` });
  });
});

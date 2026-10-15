import { expect, test, type Page } from '@playwright/test';
import { MODELO } from '../../lib/portal/organigrama';

/**
 * Portal TH · Organigrama digital e interactivo (Cristian Baldión, 2026-10-15).
 *
 * Sin sesión real ni SharePoint: las APIs del portal se simulan con `page.route`. Las PERSONAS son inventadas (no hay datos
 * reales en las pruebas). Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const nodo = (texto: string) => {
  const n = MODELO.nodos.find((x) => x.texto === texto);
  if (!n) throw new Error('no hay un cuadro «' + texto + '»');
  return n;
};
const GERENTE_CALIDAD = nodo('Gerente de Calidad');
const JEFE_VALIDACIONES = MODELO.nodos.find((x) => /^Jefe de\s+Validaciones$/.test(x.texto))!;
const SIN_PERSONAS = nodo('Mensajero');
const SOLO_OTRAS = nodo('Analista de Mercadeo');

const personas = {
  [GERENTE_CALIDAD.id]: [
    { empresa: 'GSS', nombre: 'PEREZ GOMEZ ANA MARIA', area: 'CALIDAD', cargo: 'GERENTE DE CALIDAD', correo: 'ana.perez@gsslatam.com' },
    { empresa: 'Farmalógica', nombre: 'RUIZ SOTO LUIS', area: 'CALIDAD', cargo: 'GERENTE DE CALIDAD', correo: 'luis.ruiz@farmalogica.com' },
  ],
  [JEFE_VALIDACIONES.id]: [{ empresa: 'GSS', nombre: 'LOPEZ DIAZ MARTA', area: 'VALIDACIONES', cargo: 'JEFE DE VALIDACIONES', correo: 'No Aplica' }],
  [SOLO_OTRAS.id]: [{ empresa: 'Ryan', nombre: 'MORA PINTO JUAN', area: 'MERCADEO', cargo: 'ANALISTA DE MERCADEO', correo: 'juan.mora@ryanlab.com' }],
};

async function simular(page: Page, opciones: { falla?: boolean } = {}) {
  await page.route('**/api/portal/content', (r) =>
    r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } })
  );
  await page.route('**/api/portal/organigrama', (r) =>
    opciones.falla
      ? r.fulfill({ status: 502, json: { error: 'No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.' } })
      : r.fulfill({ json: { personas, total: 3 } })
  );
}

async function abrir(page: Page) {
  await page.goto('/portal');
  await page.getByRole('navigation', { name: 'Secciones del portal' }).getByRole('button', { name: 'Contactos' }).click();
  await page.getByTestId('abrir-organigrama').click();
  const visor = page.getByTestId('organigrama-visor');
  await expect(visor).toBeVisible();
  return visor;
}

test.describe('Portal TH · Organigrama', () => {
  test('la API exige sesión', async ({ request }) => {
    expect((await request.get('/api/portal/organigrama')).status()).toBe(401);
  });

  test('el botón «Organigrama» queda ENCIMA de «Correos Corporativos» en la ventana Contactos', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await page.getByRole('navigation', { name: 'Secciones del portal' }).getByRole('button', { name: 'Contactos' }).click();
    const nombres = await page.locator('.portal-th__contactos-boton').allInnerTexts();
    expect(nombres).toEqual(['Organigrama', 'Correos Corporativos', 'Extensiones Corporativas']);
    const org = (await page.getByRole('button', { name: 'Organigrama' }).boundingBox())!;
    const correos = (await page.getByRole('button', { name: 'Correos Corporativos' }).boundingBox())!;
    expect(org.y).toBeLessThan(correos.y);
    expect(Math.abs(org.x - correos.x)).toBeLessThan(2);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/100-organigrama-boton.png` });
  });

  test('dibuja los 122 cuadros del organigrama, con sus franjas, y se ve completo con «Ver todo»', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('[data-nodo]')).toHaveCount(122);
    await expect(visor.getByText('ESTRATÉGICO')).toBeVisible();
    await expect(visor.getByText('TÁCTICO')).toBeVisible();
    await expect(visor.getByText('OPERATIVO')).toBeVisible();
    await expect(visor.getByText('DIRECTOR GENERAL', { exact: false }).first()).toBeAttached();
    // con personas de GSS = borde azul; solo de otras empresas = punteado; el resto, gris
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    await expect(visor.locator('.portal-th__org-nodo--otras')).toHaveCount(1);
    await visor.getByTestId('zoom-ajustar').click();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/101-organigrama-completo.png` });
    await visor.getByTestId('zoom-mas').click();
    await visor.getByTestId('zoom-mas').click();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/102-organigrama-zoom.png` });
  });

  test('al pulsar un cargo se abre la ventanita con sus personas (solo GSS) y se pueden incluir otras empresas', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2); // ya cargaron las personas
    await visor.locator(`[data-nodo="${GERENTE_CALIDAD.id}"]`).scrollIntoViewIfNeeded();
    await visor.locator(`[data-nodo="${GERENTE_CALIDAD.id}"]`).click();

    const ventana = page.getByTestId('organigrama-personas');
    await expect(ventana).toBeVisible();
    await expect(ventana).toContainText('Gerente de Calidad');
    // Los 5 datos pedidos, de la persona de GSS
    const persona = ventana.getByTestId('organigrama-persona');
    await expect(persona).toHaveCount(1);
    for (const etiqueta of ['Empresa', 'Apellidos y Nombres', 'Área / Dependencia', 'Cargo', 'Correo corporativo']) await expect(persona).toContainText(etiqueta);
    await expect(persona).toContainText('PEREZ GOMEZ ANA MARIA');
    await expect(persona.getByRole('link', { name: 'ana.perez@gsslatam.com' })).toHaveAttribute('href', 'mailto:ana.perez@gsslatam.com');
    await expect(persona).not.toContainText('RUIZ SOTO');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/103-organigrama-personas.png` });

    // Otras empresas con el mismo cargo: opcional.
    await ventana.getByText('Incluir 1 persona de otras empresas con este cargo').click();
    await expect(ventana.getByTestId('organigrama-persona')).toHaveCount(2);
    await expect(ventana).toContainText('RUIZ SOTO LUIS');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/104-organigrama-otras-empresas.png` });

    // «No Aplica» se muestra tal cual, sin enlace.
    await visor.locator(`[data-nodo="${JEFE_VALIDACIONES.id}"]`).click();
    await expect(ventana).toContainText('No Aplica');
    await expect(ventana.getByRole('link')).toHaveCount(0);
    // Otro cargo no arrastra el interruptor del anterior.
    await expect(ventana.getByTestId('organigrama-otras')).toHaveCount(0);

    // Un cargo con personas SOLO de otras empresas: lo dice y permite verlas.
    await visor.locator(`[data-nodo="${SOLO_OTRAS.id}"]`).click();
    await expect(page.getByTestId('organigrama-sin-personas')).toHaveText('No hay personas de GSS con este cargo.');
    await ventana.getByText('Incluir 1 persona de otras empresas con este cargo').click();
    await expect(ventana).toContainText('MORA PINTO JUAN');
  });

  test('un cargo sin personas lo dice; Escape cierra primero la ventanita y luego el organigrama, y se vuelve a Contactos', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    await visor.locator(`[data-nodo="${SIN_PERSONAS.id}"]`).click();
    await expect(page.getByTestId('organigrama-sin-personas')).toHaveText('No hay personas registradas con este cargo en BASE PERSONAL.');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('organigrama-personas')).toHaveCount(0);
    await expect(visor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(visor).toBeHidden();
    // Volvió a la ventana Contactos
    await expect(page.getByRole('dialog', { name: 'Contactos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Organigrama' })).toBeVisible();
  });

  test('el teclado también abre un cargo (Enter) y la búsqueda marca los cuadros y lleva la vista hasta ellos', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    await visor.getByTestId('organigrama-buscar').fill('validaciones');
    await expect(visor.getByTestId('organigrama-coincidencias')).toContainText('cargos');
    expect(await visor.locator('.portal-th__org-nodo--busqueda').count()).toBeGreaterThan(1);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/105-organigrama-busqueda.png` });
    // por nombre de persona
    await visor.getByTestId('organigrama-buscar').fill('perez gomez');
    await expect(visor.locator('.portal-th__org-nodo--busqueda')).toHaveCount(1);
    await visor.getByTestId('organigrama-buscar').fill('zzzz');
    await expect(visor.getByTestId('organigrama-coincidencias')).toHaveText('Sin coincidencias');
    // Enter abre el cargo enfocado
    await visor.locator(`[data-nodo="${GERENTE_CALIDAD.id}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('organigrama-personas')).toBeVisible();
  });

  test('si no se pueden cargar las personas, el aviso rojo va arriba y el organigrama se ve igual', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page, { falla: true });
    const visor = await abrir(page);
    await expect(visor.getByTestId('organigrama-error')).toContainText('No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.');
    await expect(visor.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    await expect(visor.locator('[data-nodo]')).toHaveCount(122);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/106-organigrama-error.png` });
  });

  test('celular: cabe en la pantalla (el gráfico se desplaza dentro de su caja) y la ventanita ocupa el ancho', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await visor.locator(`[data-nodo="${GERENTE_CALIDAD.id}"]`).dispatchEvent('click');
    await expect(page.getByTestId('organigrama-personas')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/107-organigrama-celular.png` });
  });
});

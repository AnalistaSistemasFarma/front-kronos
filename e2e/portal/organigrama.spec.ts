import { expect, test, type Page } from '@playwright/test';
import semilla from '../../prisma/seeds/organigrama-gss.json';

/**
 * Portal TH · Organigrama de GSS, digital e interactivo (Cristian Baldión, 2026-10-15).
 *
 * Sin sesión real, base ni SharePoint: la API del portal se simula con `page.route`, con el MISMO árbol de 118 cargos que carga el
 * script (`prisma/seeds/organigrama-gss.json`). Las PERSONAS son inventadas (no hay datos reales en las pruebas). Con
 * `FORMACION_CAPTURAS=<carpeta>` guarda capturas para la revisión.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
interface Cargo { nombre: string; nivel: string; padre: string | null }
const CARGOS = (semilla as unknown as { cargos: Cargo[] }).cargos;
const ID = new Map(CARGOS.map((c, i) => [c.nombre, i + 1]));
const NODOS = CARGOS.map((c) => ({ id: ID.get(c.nombre)!, nombre: c.nombre, nivel: c.nivel, padre: c.padre ? ID.get(c.padre)! : null }));
const id = (nombre: string) => ID.get(nombre)!;

const GERENTE_CALIDAD = id('GERENTE DE CALIDAD');
const JEFE_VALIDACIONES = id('JEFE DE VALIDACIONES');
const SIN_PERSONAS = id('MENSAJERO');
const SOLO_OTRAS = id('ANALISTA DE MERCADEO');

const PERSONAS = {
  [GERENTE_CALIDAD]: [
    { empresa: 'GSS', nombre: 'PEREZ GOMEZ ANA MARIA', area: 'CALIDAD', cargo: 'GERENTE DE CALIDAD', correo: 'ana.perez@gsslatam.com' },
    { empresa: 'Farmalógica', nombre: 'RUIZ SOTO LUIS', area: 'CALIDAD', cargo: 'GERENTE DE CALIDAD', correo: 'luis.ruiz@farmalogica.com' },
  ],
  [JEFE_VALIDACIONES]: [{ empresa: 'GSS', nombre: 'LOPEZ DIAZ MARTA', area: 'VALIDACIONES', cargo: 'JEFE DE VALIDACIONES', correo: 'No Aplica' }],
  [SOLO_OTRAS]: [{ empresa: 'Ryan', nombre: 'MORA PINTO JUAN', area: 'MERCADEO', cargo: 'ANALISTA DE MERCADEO', correo: 'juan.mora@ryanlab.com' }],
};

async function simular(page: Page, opciones: { falla?: boolean; vacio?: boolean; avisoPersonas?: string } = {}) {
  await page.route('**/api/portal/content', (r) =>
    r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } })
  );
  await page.route('**/api/portal/organigrama', (r) =>
    opciones.falla
      ? r.fulfill({ status: 500, json: { error: 'No se pudo cargar el organigrama. Intente en un momento.' } })
      : r.fulfill({
          json: {
            empresa: 'GSS',
            nodos: opciones.vacio ? [] : NODOS,
            personas: opciones.avisoPersonas || opciones.vacio ? {} : PERSONAS,
            total: 3,
            ...(opciones.avisoPersonas ? { avisoPersonas: opciones.avisoPersonas } : {}),
          },
        })
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
const nodoDe = (visor: ReturnType<Page['getByTestId']>, idCargo: number) => visor.locator(`[data-nodo="${idCargo}"]`);

test.describe('Portal TH · Organigrama de GSS', () => {
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

  test('dibuja los 118 cargos que lee de SynerLink, con el color de su nivel, y se ve completo con «Ver todo»', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('[data-nodo]')).toHaveCount(118);
    await expect(visor.getByText('Organigrama GSS')).toBeVisible();
    await expect(visor.getByTestId('organigrama-svg').getByText('Director General', { exact: true })).toBeAttached();
    await expect(visor.locator('.portal-th__org-nodo--estrategico').first()).toBeAttached();
    await expect(visor.locator('.portal-th__org-nodo--tactico').first()).toBeAttached();
    await expect(visor.locator('.portal-th__org-nodo--operativo').first()).toBeAttached();
    // con personas de GSS = borde azul; solo de otras empresas = punteado
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    await expect(visor.locator('.portal-th__org-nodo--otras')).toHaveCount(1);
    await visor.getByTestId('zoom-ajustar').click();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/101-organigrama-completo.png` });
    for (let i = 0; i < 4; i++) await visor.getByTestId('zoom-mas').click();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/102-organigrama-zoom.png` });
  });

  test('al pulsar un cargo se abre la ventanita con sus personas (solo GSS) y se pueden incluir otras empresas', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    for (let i = 0; i < 4; i++) await visor.getByTestId('zoom-mas').click();
    const cargo = nodoDe(visor, GERENTE_CALIDAD);
    await cargo.scrollIntoViewIfNeeded();
    await cargo.dispatchEvent('click');

    const ventana = page.getByTestId('organigrama-personas');
    await expect(ventana).toBeVisible();
    await expect(ventana).toContainText('Gerente de Calidad');
    const persona = ventana.getByTestId('organigrama-persona');
    await expect(persona).toHaveCount(1);
    for (const etiqueta of ['Empresa', 'Apellidos y Nombres', 'Área / Dependencia', 'Cargo', 'Correo corporativo']) await expect(persona).toContainText(etiqueta);
    await expect(persona).toContainText('PEREZ GOMEZ ANA MARIA');
    await expect(persona.getByRole('link', { name: 'ana.perez@gsslatam.com' })).toHaveAttribute('href', 'mailto:ana.perez@gsslatam.com');
    await expect(persona).not.toContainText('RUIZ SOTO');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/103-organigrama-personas.png` });

    await ventana.getByText('Incluir 1 persona de otras empresas con este cargo').click();
    await expect(ventana.getByTestId('organigrama-persona')).toHaveCount(2);
    await expect(ventana).toContainText('RUIZ SOTO LUIS');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/104-organigrama-otras-empresas.png` });

    // «No Aplica» se muestra tal cual, sin enlace; otro cargo no arrastra el interruptor.
    await nodoDe(visor, JEFE_VALIDACIONES).dispatchEvent('click');
    await expect(ventana).toContainText('No Aplica');
    await expect(ventana.getByRole('link')).toHaveCount(0);
    await expect(ventana.getByTestId('organigrama-otras')).toHaveCount(0);

    // Un cargo con personas SOLO de otras empresas: lo dice y permite verlas.
    await nodoDe(visor, SOLO_OTRAS).dispatchEvent('click');
    await expect(page.getByTestId('organigrama-sin-personas')).toHaveText('No hay personas de GSS con este cargo.');
    await ventana.getByText('Incluir 1 persona de otras empresas con este cargo').click();
    await expect(ventana).toContainText('MORA PINTO JUAN');
  });

  test('un cargo sin personas lo dice; Escape cierra primero la ventanita y luego el organigrama, y se vuelve a Contactos', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    await nodoDe(visor, SIN_PERSONAS).dispatchEvent('click');
    await expect(page.getByTestId('organigrama-sin-personas')).toHaveText('No hay personas registradas con este cargo en BASE PERSONAL.');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('organigrama-personas')).toHaveCount(0);
    await expect(visor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(visor).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Contactos' })).toBeVisible();
  });

  test('el teclado abre un cargo (Enter) y la búsqueda marca los cuadros y lleva la vista hasta ellos', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    await visor.getByTestId('organigrama-buscar').fill('validaciones');
    await expect(visor.getByTestId('organigrama-coincidencias')).toContainText('cargos');
    expect(await visor.locator('.portal-th__org-nodo--busqueda').count()).toBeGreaterThan(1);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/105-organigrama-busqueda.png` });
    await visor.getByTestId('organigrama-buscar').fill('perez gomez');
    await expect(visor.locator('.portal-th__org-nodo--busqueda')).toHaveCount(1);
    await visor.getByTestId('organigrama-buscar').fill('zzzz');
    await expect(visor.getByTestId('organigrama-coincidencias')).toHaveText('Sin coincidencias');
    await nodoDe(visor, GERENTE_CALIDAD).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('organigrama-personas')).toBeVisible();
  });

  test('si no se puede cargar el organigrama, el aviso rojo va arriba con «Reintentar»; si faltan las personas, el árbol se ve igual', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await simular(page, { falla: true });
    const visor = await abrir(page);
    await expect(visor.getByTestId('organigrama-error')).toContainText('No se pudo cargar el organigrama. Intente en un momento.');
    await expect(visor.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/106-organigrama-error.png` });

    const otra = await page.context().newPage();
    await simular(otra, { avisoPersonas: 'No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.' });
    const v2 = await abrir(otra);
    await expect(v2.getByTestId('organigrama-aviso-personas')).toContainText('No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.');
    await expect(v2.locator('[data-nodo]')).toHaveCount(118);

    const tercera = await page.context().newPage();
    await simular(tercera, { vacio: true });
    const v3 = await abrir(tercera);
    await expect(v3.getByTestId('organigrama-vacio')).toHaveText('El organigrama de GSS todavía no está cargado.');
  });

  test('celular: cabe en la pantalla (el gráfico se desplaza dentro de su caja) y la ventanita ocupa el ancho', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    const visor = await abrir(page);
    await expect(visor.locator('.portal-th__org-nodo--con')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await nodoDe(visor, GERENTE_CALIDAD).dispatchEvent('click');
    await expect(page.getByTestId('organigrama-personas')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/107-organigrama-celular.png` });
  });
});

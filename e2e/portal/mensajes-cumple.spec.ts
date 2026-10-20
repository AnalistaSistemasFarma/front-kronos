import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · MENSAJES DE CUMPLEAÑOS (Cristian Baldión, 2026-10-20): en el recuadro de eventos del calendario, el nombre de quien cumple
 * años abre «Deja tu mensaje» (texto, emojis y «Enviar»). Sin sesión real ni SharePoint: las APIs se simulan con `page.route`; las
 * personas son INVENTADAS y el RELOJ es controlado (hoy = 19 de octubre de 2026). Quién puede LEER los mensajes lo decide el servidor
 * y se prueba en `lib/portal/__tests__/mensajes-cumple-servidor.test.ts`; aquí se prueba lo que muestra la pantalla.
 * Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const HOY = '2026-10-19';
const VIEJO = '2026-10-05'; // 14 días atrás: fuera de la ventana de mensajes
const ANA = { nombre: 'PEREZ GOMEZ ANA MARIA', empresa: 'GROUP SHARED SERVICES SAS', cargo: 'ANALISTA CONTABLE' };
const LUIS = { nombre: 'RUIZ SOTO LUIS', empresa: 'LABORATORIO RYAN', cargo: 'AUXILIAR DE PRODUCCION' };

interface Opciones {
  mensajes?: { mensajes: unknown[]; puedeModerar: boolean };
  errorAlEnviar?: { status: number; error: string };
}

async function simular(page: Page, opciones: Opciones = {}) {
  const enviados: Record<string, unknown>[] = [];
  const borrados: string[] = [];
  let respuesta = opciones.mensajes ?? { mensajes: [], puedeModerar: false };
  // La ventana «Hoy» tapa la página los días con evento: se deja marcada como vista para esta fecha (solo vale en el navegador de pruebas).
  await page.addInitScript((clave) => window.localStorage.setItem(clave, '1'), `portal-th-ventana-hoy-${HOY}`);
  await page.clock.install({ time: new Date(`${HOY}T09:00:00-05:00`) });
  await page.route('**/api/portal/content', (r) => r.fulfill({ json: { email: 'carlos@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } }));
  await page.route('**/api/portal/eventos?**', (r) => r.fulfill({ json: { eventos: [], puedeEditar: false } }));
  await page.route('**/api/portal/cumpleanos?**', (r) =>
    r.fulfill({
      json: {
        cumpleanos: [
          { fecha: HOY, personas: [ANA, LUIS] },
          { fecha: VIEJO, personas: [ANA] },
        ],
      },
    })
  );
  await page.route(/\/api\/portal\/mensajes-cumple(\?|$)/, async (r) => {
    const metodo = r.request().method();
    if (metodo === 'POST') {
      if (opciones.errorAlEnviar) return r.fulfill({ status: opciones.errorAlEnviar.status, json: { error: opciones.errorAlEnviar.error } });
      enviados.push(r.request().postDataJSON() as Record<string, unknown>);
      return r.fulfill({ status: 201, json: { ok: true } });
    }
    if (metodo === 'DELETE') {
      borrados.push(new URL(r.request().url()).searchParams.get('id') ?? '');
      respuesta = { ...respuesta, mensajes: [] };
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: respuesta });
  });
  return { enviados, borrados };
}

const celda = (page: Page, fecha: string) => page.getByTestId('portal-calendario').locator(`[data-fecha="${fecha}"]`);
const eventos = (page: Page) => page.getByTestId('calendario-eventos');
async function irAlDia(page: Page, fecha: string) {
  await page.goto('/portal');
  await celda(page, fecha).click();
  await expect(eventos(page).getByTestId('evento-item').filter({ hasText: 'CUMPLEAÑOS' })).toBeVisible();
}

test.describe('Portal TH · mensajes de cumpleaños', () => {
  test('la API exige sesión', async ({ request }) => {
    expect((await request.get(`/api/portal/mensajes-cumple?fecha=${HOY}`)).status()).toBe(401);
    expect((await request.post('/api/portal/mensajes-cumple', { data: { fecha: HOY } })).status()).toBe(401);
    expect((await request.delete(`/api/portal/mensajes-cumple?fecha=${HOY}&id=x.json`)).status()).toBe(401);
  });

  test('el nombre de quien cumple años es un botón: abre «Deja tu mensaje» para esa persona', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await irAlDia(page, HOY);
    await expect(eventos(page).getByText('Pulse un nombre para dejarle un mensaje.')).toBeVisible();
    const botones = eventos(page).getByTestId('cumple-persona-mensaje');
    await expect(botones).toHaveCount(2);
    await botones.first().click();
    const ventana = page.getByTestId('ventana-mensaje');
    await expect(ventana).toBeVisible();
    await expect(ventana.getByRole('heading', { name: 'Deja tu mensaje' }).or(ventana.getByText('Deja tu mensaje', { exact: true }))).toBeVisible();
    await expect(page.getByTestId('mensaje-para')).toHaveText(`Para ${ANA.nombre}`);
    await expect(page.getByTestId('mensaje-texto')).toBeFocused();
    await expect(page.getByTestId('mensaje-enviar')).toBeDisabled(); // sin texto no se envía
    await page.waitForTimeout(200);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/160-mensaje-ventana.png` });
  });

  test('escribe, agrega emojis de la paleta donde está el cursor, ve el contador y envía; el aviso de éxito sale arriba y con color', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const { enviados } = await simular(page);
    await irAlDia(page, HOY);
    await eventos(page).getByTestId('cumple-persona-mensaje').first().click();
    const texto = page.getByTestId('mensaje-texto');
    await texto.fill('Feliz cumpleaños Ana');
    await expect(page.getByTestId('mensaje-contador')).toHaveText('20 / 500');
    // el emoji se inserta al final (cursor al final tras fill) y el contador cuenta UN carácter por emoji
    await page.getByTestId('mensaje-emojis').getByRole('button', { name: 'Agregar 🎉' }).click();
    await expect(texto).toHaveValue('Feliz cumpleaños Ana🎉');
    await expect(page.getByTestId('mensaje-contador')).toHaveText('21 / 500');
    await expect(page.getByTestId('mensaje-emojis').getByRole('button')).toHaveCount(32);
    await page.getByTestId('mensaje-enviar').click();
    await expect(page.getByTestId('mensaje-enviado')).toContainText('¡Mensaje enviado!');
    expect(enviados).toEqual([{ fecha: HOY, nombre: ANA.nombre, empresa: ANA.empresa, texto: 'Feliz cumpleaños Ana🎉' }]);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/161-mensaje-enviado.png` });
    await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
    await expect(page.getByTestId('ventana-mensaje')).toBeHidden();
  });

  test('el tope es de 500 caracteres: lo que se pega de más se corta', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await irAlDia(page, HOY);
    await eventos(page).getByTestId('cumple-persona-mensaje').first().click();
    await page.getByTestId('mensaje-texto').fill('a'.repeat(650));
    await expect(page.getByTestId('mensaje-contador')).toHaveText('500 / 500');
    await expect(page.getByTestId('mensaje-texto')).toHaveValue('a'.repeat(500));
  });

  test('si el servidor rechaza el envío, el aviso rojo va ARRIBA, el texto escrito se conserva y se puede reintentar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { errorAlEnviar: { status: 429, error: 'Ya dejó 3 mensajes a esta persona hoy. Gracias por su cariño.' } });
    await irAlDia(page, HOY);
    await eventos(page).getByTestId('cumple-persona-mensaje').first().click();
    await page.getByTestId('mensaje-texto').fill('Otro mensaje');
    await page.getByTestId('mensaje-enviar').click();
    await expect(page.getByTestId('mensaje-aviso')).toHaveText('Ya dejó 3 mensajes a esta persona hoy. Gracias por su cariño.');
    await expect(page.getByTestId('mensaje-texto')).toHaveValue('Otro mensaje');
    await expect(page.getByTestId('mensaje-enviar')).toBeEnabled();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/162-mensaje-error.png` });
  });

  test('se cierra con ✕, con Cancelar, con Escape y haciendo clic afuera', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await irAlDia(page, HOY);
    const abrir = () => eventos(page).getByTestId('cumple-persona-mensaje').first().click();
    const ventana = page.getByTestId('ventana-mensaje');
    await abrir();
    await page.getByTestId('mensaje-cerrar').click();
    await expect(ventana).toBeHidden();
    await abrir();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(ventana).toBeHidden();
    await abrir();
    await page.keyboard.press('Escape');
    await expect(ventana).toBeHidden();
    await abrir();
    await page.mouse.click(4, 4);
    await expect(ventana).toBeHidden();
  });

  test('un cumpleaños de hace más de 7 días ya no admite mensajes: el nombre es solo texto', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    await page.goto('/portal');
    await celda(page, VIEJO).click();
    await expect(eventos(page).getByTestId('cumple-persona')).toHaveCount(1);
    await expect(eventos(page).getByTestId('cumple-persona-mensaje')).toHaveCount(0);
    await expect(eventos(page).getByText('Pulse un nombre para dejarle un mensaje.')).toHaveCount(0);
  });

  test('quien recibe mensajes los ve, con el nombre de quien los escribió y SIN datos de más; sin mensajes no se pinta nada', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, {
      mensajes: { puedeModerar: false, mensajes: [{ id: 'a.json', paraNombre: ANA.nombre, paraEmpresa: ANA.empresa, deNombre: 'Carlos Ruiz', texto: 'Feliz cumpleaños 🎉\nQue la pase muy bien', enviadoEl: '2026-10-19T15:00:00Z' }] },
    });
    await irAlDia(page, HOY);
    const caja = page.getByTestId('mensajes-recibidos');
    await expect(caja).toContainText('Mensajes que le dejaron');
    await expect(caja.getByTestId('mensaje-item')).toHaveCount(1);
    await expect(caja).toContainText('Feliz cumpleaños 🎉');
    await expect(caja).toContainText('De Carlos Ruiz');
    await expect(caja).not.toContainText('@');
    await expect(caja.getByTestId('mensaje-borrar')).toHaveCount(0); // quien recibe NO modera
    await expect(caja.getByTestId('mensaje-sin-correo')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/163-mensajes-recibidos.png` });
  });

  test('el texto se muestra como TEXTO: un mensaje con HTML no se interpreta', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, {
      mensajes: { puedeModerar: false, mensajes: [{ id: 'a.json', paraNombre: ANA.nombre, paraEmpresa: ANA.empresa, deNombre: 'X', texto: '<img src=x onerror=alert(1)><b>hola</b>', enviadoEl: '2026-10-19T15:00:00Z' }] },
    });
    await irAlDia(page, HOY);
    await expect(page.getByTestId('mensaje-item')).toContainText('<img src=x onerror=alert(1)><b>hola</b>');
    await expect(page.getByTestId('mensajes-recibidos').locator('img, b')).toHaveCount(0);
  });

  test('el administrador ve todos, con el correo de quien escribió, el aviso «sin correo» y puede borrar con confirmación', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const { borrados } = await simular(page, {
      mensajes: {
        puedeModerar: true,
        mensajes: [{ id: 'b.json', paraNombre: LUIS.nombre, paraEmpresa: LUIS.empresa, deNombre: 'Carlos Ruiz', deCorreo: 'carlos@gsslatam.com', sinCorreo: true, texto: 'Feliz día Luis', enviadoEl: '2026-10-19T15:00:00Z' }],
      },
    });
    await irAlDia(page, HOY);
    const caja = page.getByTestId('mensajes-recibidos');
    await expect(caja).toContainText('administrador');
    await expect(caja).toContainText(`Para ${LUIS.nombre}`);
    await expect(caja).toContainText('carlos@gsslatam.com');
    await expect(caja.getByTestId('mensaje-sin-correo')).toContainText('Sin correo corporativo');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/164-mensajes-administrador.png` });
    await caja.getByTestId('mensaje-borrar').click();
    await expect(caja.getByTestId('mensaje-confirmar-borrar')).toBeVisible();
    await caja.getByRole('button', { name: 'No' }).click();
    expect(borrados).toEqual([]); // «No» no borra nada
    await caja.getByTestId('mensaje-borrar').click();
    await caja.getByTestId('mensaje-confirmar-borrar').click();
    await expect(page.getByTestId('mensajes-recibidos')).toHaveCount(0); // ya no quedan mensajes: no se pinta la caja
    expect(borrados).toEqual(['b.json']);
  });

  test('celular: la ventana cabe en la pantalla y la paleta de emojis no la desborda', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/portal');
    await page.getByTestId('calendario-alternar').click();
    await celda(page, HOY).click();
    await eventos(page).getByTestId('cumple-persona-mensaje').first().click();
    const caja = (await page.getByTestId('mensaje-caja').boundingBox())!;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    expect(caja.y + caja.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.waitForTimeout(200);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/165-mensaje-celular.png` });
  });
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · ventana emergente «Hoy» (Cristian Baldión, 2026-10-15): al entrar se abre con los eventos del día (los del calendario);
 * con cumpleaños lleva una imagen; se cierra sola a los 15 s o antes si la persona la cierra. Sin sesión real ni SharePoint: las APIs
 * se simulan con `page.route`, las personas son INVENTADAS y el RELOJ es controlado (así «hoy» es siempre el mismo día y los 15
 * segundos se comprueban sin esperar). El proyecto «publico» deja una marca que APAGA la ventana (para que no tape las demás
 * pruebas); estas pruebas la quitan. En producción esa marca no existe y la ventana sale en cada carga.
 * Con `FORMACION_CAPTURAS=<carpeta>` guarda capturas.
 */

const CAPTURAS = process.env.FORMACION_CAPTURAS;
const HOY = '2026-10-15'; // jueves, sin festivo ni fecha importante
const NAVIDAD = '2026-12-25'; // festivo
const CLAVE = (f: string) => `portal-th-ventana-hoy-${f}`;

async function preparar(page: Page, fecha: string, opciones: { empresa?: unknown[]; cumples?: unknown[]; fallaCumples?: boolean; marcada?: boolean } = {}) {
  // Quita la marca «ya vista» que deja el proyecto (salvo que la prueba pida lo contrario) y fija la fecha.
  await page.addInitScript(
    ([clave, marcada]) => {
      // Solo en la PRIMERA carga de la pestaña: una recarga debe encontrar lo que dejó la ventana.
      if (window.sessionStorage.getItem('__e2e_preparado')) return;
      window.sessionStorage.setItem('__e2e_preparado', '1');
      if (marcada) window.localStorage.setItem(clave as string, '1');
      else window.localStorage.removeItem(clave as string);
    },
    [CLAVE(fecha), !!opciones.marcada]
  );
  await page.clock.install({ time: new Date(`${fecha}T09:00:00-05:00`) });
  await page.route('**/api/portal/content', (r) => r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } }));
  await page.route('**/api/portal/eventos?**', (r) => r.fulfill({ json: { eventos: opciones.empresa ?? [], puedeEditar: false } }));
  await page.route('**/api/portal/cumpleanos?**', (r) =>
    opciones.fallaCumples ? r.fulfill({ status: 502, json: { error: 'x' } }) : r.fulfill({ json: { cumpleanos: opciones.cumples ?? [] } })
  );
}

const cumpleHoy = [{ fecha: HOY, personas: [{ nombre: 'ACOSTA RUIZ LUIS FERNANDO', empresa: 'GROUP SHARED SERVICES SAS', cargo: 'ANALISTA CONTABLE' }, { nombre: 'PEREZ GOMEZ ANA MARIA', empresa: 'ABAMIA LABS SAS', cargo: 'GERENTE COMERCIAL' }] }];
const eventoEmpresa = [{ id: 7, fecha: HOY, titulo: 'Capacitación en seguridad', descripcion: 'Auditorio, 10:00', tipo: 'empresa' }];
const ventana = (page: Page) => page.getByTestId('ventana-hoy');

test.describe('Portal TH · ventana emergente «Hoy»', () => {
  test('una marca VIEJA de la versión de una vez por día NO impide que salga en un navegador real (caso de Cristian, 2026-10-19)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    // El navegador de una persona: sin `navigator.webdriver` y con la marca que dejó la versión anterior.
    await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
    await preparar(page, HOY, { empresa: eventoEmpresa, marcada: true });
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    expect(await page.evaluate((c) => window.localStorage.getItem(c), CLAVE(HOY))).toBe('1'); // la marca sigue ahí y no estorba
    await page.getByTestId('ventana-hoy-cerrar').click();
    await page.reload();
    await expect(ventana(page)).toBeVisible(); // y al actualizar, otra vez
  });

  test('al entrar se abre sola con los eventos del día, la fecha larga y la barra de tiempo', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await preparar(page, HOY, { empresa: eventoEmpresa });
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    await expect(page.getByTestId('ventana-hoy-fecha')).toHaveText('jueves, 15 de octubre de 2026');
    const eventos = ventana(page).getByTestId('ventana-hoy-evento');
    await expect(eventos).toHaveCount(1);
    await expect(eventos.first()).toContainText('Capacitación en seguridad');
    await expect(eventos.first()).toContainText('Evento de la empresa · Auditorio, 10:00');
    await expect(page.getByTestId('ventana-hoy-imagen')).toHaveCount(0); // sin cumpleaños no hay imagen
    await expect(page.getByTestId('ventana-hoy-barra')).toHaveCSS('animation-duration', '15s');
    if (CAPTURAS) {
      await page.waitForTimeout(500); // termina la animación de entrada
      await page.screenshot({ path: `${CAPTURAS}/130-hoy-evento.png` });
    }
  });

  test('con cumpleaños: la imagen de cumpleaños y, debajo del título, el nombre, la empresa y el cargo de cada persona', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await preparar(page, HOY, { cumples: cumpleHoy });
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    const imagen = page.getByTestId('ventana-hoy-imagen');
    await expect(imagen).toBeVisible();
    await expect(imagen).toHaveAttribute('src', '/portal-th/cumpleanos.svg');
    expect(await imagen.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true); // la imagen carga de verdad
    await expect(ventana(page).getByTestId('ventana-hoy-evento').first()).toContainText('CUMPLEAÑOS');
    const personas = ventana(page).getByTestId('ventana-hoy-personas').locator('li');
    await expect(personas).toHaveCount(2);
    await expect(personas.nth(0)).toContainText('ACOSTA RUIZ LUIS FERNANDO');
    await expect(personas.nth(0)).toContainText('GROUP SHARED SERVICES SAS · ANALISTA CONTABLE');
    await expect(personas.nth(0)).not.toContainText('CONTABILIDAD');
    await expect(personas.nth(1)).toContainText('PEREZ GOMEZ ANA MARIA');
    if (CAPTURAS) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${CAPTURAS}/131-hoy-cumpleanos.png` });
    }
  });

  test('un festivo sale aunque no haya nada más (viene del mismo cálculo del calendario)', async ({ page }) => {
    await preparar(page, NAVIDAD);
    await page.goto('/portal');
    await expect(ventana(page).getByTestId('ventana-hoy-evento')).toHaveCount(1);
    await expect(ventana(page)).toContainText('Navidad');
    await expect(ventana(page)).toContainText('Festivo');
  });

  test('se cierra SOLA a los 15 segundos (no antes)', async ({ page }) => {
    await preparar(page, HOY, { empresa: eventoEmpresa });
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    await page.clock.runFor(14_000);
    await expect(ventana(page)).toBeVisible();
    await page.clock.runFor(1_500);
    await expect(ventana(page)).toBeHidden();
  });

  test('se puede cerrar antes: con ✕, con Escape y haciendo clic afuera; y CADA recarga de la página la vuelve a abrir', async ({ page }) => {
    await preparar(page, HOY, { empresa: eventoEmpresa });
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    await expect(page.getByTestId('ventana-hoy-cerrar')).toBeFocused();
    await page.getByTestId('ventana-hoy-cerrar').click();
    await expect(ventana(page)).toBeHidden();

    // Pedido de Cristian (2026-10-16): cada vez que se actualiza la página, la ventana vuelve a salir (nadie guarda «ya vista»).
    await page.reload();
    await expect(ventana(page)).toBeVisible();
    expect(await page.evaluate((c) => window.localStorage.getItem(c), CLAVE(HOY))).toBeNull();

    // Escape
    await page.keyboard.press('Escape');
    await expect(ventana(page)).toBeHidden();
    await page.reload();
    await expect(ventana(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ventana(page)).toBeHidden();

    // clic afuera
    await page.reload();
    await expect(ventana(page)).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(ventana(page)).toBeHidden();
    // y el portal responde: no queda nada tapando
    await page.getByRole('navigation', { name: 'Secciones del portal' }).getByRole('button', { name: 'Contactos' }).click();
    await expect(page.getByRole('dialog', { name: 'Contactos' })).toBeVisible();
  });

  test('un día SIN NADA también sale (Cristian, 2026-10-21: «que salga siempre»): «Hoy no hay eventos ni cumpleaños» y los próximos', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    // La ventana pide cada fuente con el rango hoy → hoy + 30 días (el calendario pide aparte el mes visible).
    const pedidos: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (/^\/api\/portal\/(eventos|cumpleanos)$/.test(u.pathname)) pedidos.push(`${u.pathname}${u.search}`);
    });
    await preparar(page, HOY, {
      empresa: [{ id: 9, fecha: '2026-10-20', titulo: 'Pausa activa', descripcion: 'Sala 2', tipo: 'empresa' }],
      cumples: [{ fecha: '2026-10-18', personas: [{ nombre: 'ACOSTA RUIZ LUIS FERNANDO', empresa: 'GROUP SHARED SERVICES SAS', cargo: 'ANALISTA CONTABLE' }] }],
    });
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    await expect(page.getByTestId('ventana-hoy-vacio')).toHaveText('Hoy no hay eventos ni cumpleaños.');
    await expect(ventana(page).getByTestId('ventana-hoy-evento')).toHaveCount(0);
    const proximos = ventana(page).getByTestId('ventana-hoy-proximo');
    await expect(proximos).toHaveCount(3); // cumpleaños 18, evento 20 y festivo 2 de noviembre (el 16 ya pasa de 30 días)
    await expect(proximos.nth(0)).toContainText('CUMPLEAÑOS');
    await expect(proximos.nth(0)).toContainText('domingo, 18 de octubre · Fecha importante');
    await expect(proximos.nth(0)).toContainText('ACOSTA RUIZ LUIS FERNANDO');
    await expect(proximos.nth(1)).toContainText('Pausa activa');
    await expect(proximos.nth(1)).toContainText('martes, 20 de octubre · Evento de la empresa · Sala 2');
    await expect(proximos.nth(2)).toContainText('Día de Todos los Santos');
    await expect(proximos.nth(2)).toContainText('Festivo');
    await expect(page.getByTestId('ventana-hoy-imagen')).toHaveCount(0); // la imagen es solo para cumpleaños de HOY
    expect(pedidos).toEqual(expect.arrayContaining([`/api/portal/eventos?desde=${HOY}&hasta=2026-11-14`, `/api/portal/cumpleanos?desde=${HOY}&hasta=2026-11-14`]));
    if (CAPTURAS) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${CAPTURAS}/134-hoy-vacio-proximos.png` });
    }
    // Se cierra igual que siempre, y al recargar vuelve a salir.
    await page.getByTestId('ventana-hoy-cerrar').click();
    await expect(ventana(page)).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('ventana-hoy-vacio')).toBeVisible();
  });

  test('día sin nada en celular: el aviso y los próximos caben en la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparar(page, HOY);
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    await expect(page.getByTestId('ventana-hoy-vacio')).toHaveText('Hoy no hay eventos ni cumpleaños.');
    await expect(ventana(page).getByTestId('ventana-hoy-proximo').first()).toContainText('Día de Todos los Santos'); // aunque no haya datos de la empresa
    const caja = (await ventana(page).locator('.portal-th__hoy-caja').boundingBox())!;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    expect(caja.y + caja.height).toBeLessThanOrEqual(844);
    if (CAPTURAS) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${CAPTURAS}/135-hoy-vacio-celular.png` });
    }
  });

  test('la marca de las pruebas automáticas la sigue apagando (solo en navegador automatizado)', async ({ page }) => {
    await preparar(page, NAVIDAD, { marcada: true });
    await page.goto('/portal');
    await expect(page.getByRole('navigation', { name: 'Secciones del portal' })).toBeVisible();
    await expect(ventana(page)).toHaveCount(0);
  });

  test('si falla la lectura de cumpleaños, igual muestra lo demás y sin errores en pantalla', async ({ page }) => {
    await preparar(page, HOY, { empresa: eventoEmpresa, fallaCumples: true });
    await page.goto('/portal');
    await expect(ventana(page).getByTestId('ventana-hoy-evento')).toHaveCount(1);
    await expect(ventana(page).getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('ventana-hoy-imagen')).toHaveCount(0);
  });

  test('al INICIAR SESIÓN con el código sale, aunque la marca de pruebas estuviera puesta (se reinicia); también al recargar y al volver a entrar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    // «marcada»: hoy ya la vio (no sale al abrir). Con sesión cerrada no hay contenido; al validar el código, sí.
    await preparar(page, HOY, { empresa: eventoEmpresa, marcada: true });
    let dentro = false;
    await page.route('**/api/portal/content', (r) =>
      dentro
        ? r.fulfill({ json: { email: 'e2e@gsslatam.com', via: 'codigo', documentos: [], banners: [], puedeEditar: false } })
        : r.fulfill({ status: 401, json: { error: 'Sesión no válida.' } })
    );
    await page.route('**/api/portal/login', (r) => r.fulfill({ json: { ok: true, mensaje: 'Si su correo está autorizado, le llegará un código.' } }));
    await page.route('**/api/portal/verify', (r) => {
      dentro = true;
      return r.fulfill({ json: { ok: true } });
    });
    await page.route('**/api/portal/logout', (r) => {
      dentro = false;
      return r.fulfill({ json: { ok: true } });
    });
    const iniciarSesion = async () => {
      await page.getByPlaceholder('nombre.apellido@empresa.com').fill('nueva.persona@gsslatam.com');
      await page.getByRole('button', { name: 'Enviarme el código' }).click();
      await page.getByPlaceholder('000000').fill('123456');
      await page.getByRole('button', { name: 'Entrar' }).click();
    };

    await page.goto('/portal');
    await iniciarSesion();
    // Aunque la marca de hoy estaba puesta, al iniciar sesión se reinició y la ventana sale.
    await expect(ventana(page)).toBeVisible();
    await expect(ventana(page).getByTestId('ventana-hoy-evento')).toHaveCount(1);
    await page.getByTestId('ventana-hoy-cerrar').click();
    await expect(ventana(page)).toBeHidden();

    // Recargar la página: también sale otra vez (pedido de Cristian, 2026-10-16: en cada actualización).
    await page.reload();
    await expect(ventana(page)).toBeVisible();
    await page.getByTestId('ventana-hoy-cerrar').click();
    await expect(ventana(page)).toBeHidden();

    // Cerrar sesión y volver a entrar: sale otra vez.
    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page.getByPlaceholder('nombre.apellido@empresa.com')).toBeVisible();
    expect(await page.evaluate((c) => window.localStorage.getItem(c), CLAVE(HOY))).toBeNull();
    await iniciarSesion();
    await expect(ventana(page)).toBeVisible();
    if (CAPTURAS) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${CAPTURAS}/133-hoy-tras-iniciar-sesion.png` });
    }
  });

  test('celular: cabe en la pantalla y se cierra', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparar(page, HOY, { cumples: cumpleHoy, empresa: eventoEmpresa });
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    const caja = (await ventana(page).locator('.portal-th__hoy-caja').boundingBox())!;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    expect(caja.y + caja.height).toBeLessThanOrEqual(844);
    if (CAPTURAS) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${CAPTURAS}/132-hoy-celular.png` });
    }
    await page.getByTestId('ventana-hoy-cerrar').click();
    await expect(ventana(page)).toBeHidden();
  });
});

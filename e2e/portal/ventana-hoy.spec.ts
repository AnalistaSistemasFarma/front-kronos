import { expect, test, type Page } from '@playwright/test';

/**
 * Portal TH · ventana emergente «Hoy» (Cristian Baldión, 2026-10-15): al entrar se abre con los eventos del día (los del calendario);
 * con cumpleaños lleva una imagen; se cierra sola a los 15 s o antes si la persona la cierra. Sin sesión real ni SharePoint: las APIs
 * se simulan con `page.route`, las personas son INVENTADAS y el RELOJ es controlado (así «hoy» es siempre el mismo día y los 15
 * segundos se comprueban sin esperar). El proyecto «publico» deja la ventana de hoy marcada como vista; estas pruebas quitan esa marca.
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

  test('se puede cerrar antes: con ✕, con Escape y haciendo clic afuera; y ya no vuelve a salir solo', async ({ page }) => {
    await preparar(page, HOY, { empresa: eventoEmpresa });
    await page.goto('/portal');
    await expect(ventana(page)).toBeVisible();
    await expect(page.getByTestId('ventana-hoy-cerrar')).toBeFocused();
    await page.getByTestId('ventana-hoy-cerrar').click();
    await expect(ventana(page)).toBeHidden();

    // mismo día: recargar no la reabre
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Secciones del portal' })).toBeVisible();
    await expect(ventana(page)).toHaveCount(0);

    // Escape
    await page.evaluate((c) => window.localStorage.removeItem(c), CLAVE(HOY));
    await page.reload();
    await expect(ventana(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ventana(page)).toBeHidden();

    // clic afuera
    await page.evaluate((c) => window.localStorage.removeItem(c), CLAVE(HOY));
    await page.reload();
    await expect(ventana(page)).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(ventana(page)).toBeHidden();
    // y el portal responde: no queda nada tapando
    await page.getByRole('navigation', { name: 'Secciones del portal' }).getByRole('button', { name: 'Contactos' }).click();
    await expect(page.getByRole('dialog', { name: 'Contactos' })).toBeVisible();
  });

  test('un día sin nada que mostrar NO se abre; ya vista hoy, tampoco', async ({ page }) => {
    await preparar(page, HOY);
    await page.goto('/portal');
    await expect(page.getByRole('navigation', { name: 'Secciones del portal' })).toBeVisible();
    await expect(ventana(page)).toHaveCount(0);

    const otra = await page.context().newPage();
    await preparar(otra, NAVIDAD, { marcada: true });
    await otra.goto('/portal');
    await expect(otra.getByRole('navigation', { name: 'Secciones del portal' })).toBeVisible();
    await expect(otra.getByTestId('ventana-hoy')).toHaveCount(0);
  });

  test('si falla la lectura de cumpleaños, igual muestra lo demás y sin errores en pantalla', async ({ page }) => {
    await preparar(page, HOY, { empresa: eventoEmpresa, fallaCumples: true });
    await page.goto('/portal');
    await expect(ventana(page).getByTestId('ventana-hoy-evento')).toHaveCount(1);
    await expect(ventana(page).getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('ventana-hoy-imagen')).toHaveCount(0);
  });

  test('cada vez que se INICIA SESIÓN con el código vuelve a salir, aunque ya la hubiera visto hoy; y al cerrar sesión se reinicia', async ({ page }) => {
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

    // Recargar SIN volver a iniciar sesión: no se reabre.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Secciones del portal' })).toBeVisible();
    await expect(ventana(page)).toHaveCount(0);

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

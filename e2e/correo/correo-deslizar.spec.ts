import { expect, test, type BrowserContext, type CDPSession, type Locator, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Módulo Correo · deslizar para eliminar (2026-10-18), con las APIs simuladas (`page.route`) como correo.spec.ts.
 *
 * - Celular (390×844, con toque): el gesto se simula con eventos TÁCTILES reales de Chromium (CDP
 *   Input.dispatchTouchEvent), los mismos que producen los Pointer Events del dedo. Un deslizamiento corto vuelve,
 *   uno largo elimina con «Deshacer», uno vertical desplaza la lista sin eliminar y a la derecha marca leído.
 * - Escritorio: arrastre con el mouse, botón «Eliminar» al pasar el mouse y «Eliminar» en la barra de selección.
 * - Hilo vinculado: confirmación antes de eliminar. Papelera: no se ofrece eliminar (nunca se borra).
 * Con `CORREO_CAPTURAS=<carpeta>` guarda las capturas para la revisión de lineamientos.
 */

const CAPTURAS = process.env.CORREO_CAPTURAS;
const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);

type Msg = {
  id: string;
  conversationId: string;
  internetMessageId: string;
  asunto: string;
  de: { nombre: string; correo: string };
  fecha: string;
  leido: boolean;
  conAdjuntos: boolean;
  extracto: string;
  categorias: string[];
  solicitud: number | null;
  proyectos: string[];
};

function semilla(n = 3): Msg[] {
  const base: Msg[] = [
    { id: 'MSG-0001AAAA', conversationId: 'CONV-01AAAA', internetMessageId: '<1@x>', asunto: 'Revisión de contrato de arrendamiento', de: { nombre: 'Usuario Uno', correo: 'uno@gsslatam.com' }, fecha: '2026-10-15T14:00:00Z', leido: false, conAdjuntos: true, extracto: 'Adjunto el contrato para revisión', categorias: [], solicitud: null, proyectos: [] },
    { id: 'MSG-0002AAAA', conversationId: 'CONV-02AAAA', internetMessageId: '<2@x>', asunto: 'Solicitud de poder', de: { nombre: 'Usuario Dos', correo: 'dos@onelatampharma.com' }, fecha: '2026-10-14T15:00:00Z', leido: true, conAdjuntos: false, extracto: 'Requerimos un poder especial', categorias: [], solicitud: null, proyectos: [] },
    { id: 'MSG-0003AAAA', conversationId: 'CONV-03AAAA', internetMessageId: '<3@x>', asunto: 'Otrosí mantenimiento', de: { nombre: 'Usuario Uno', correo: 'uno@gsslatam.com' }, fecha: '2026-10-10T12:00:00Z', leido: true, conAdjuntos: false, extracto: 'Ampliar el plazo', categorias: ['SynerLink #321'], solicitud: 321, proyectos: ['Contratos 2026'] },
  ];
  for (let i = 4; i <= n; i++) {
    base.push({ ...base[1], id: `MSG-${String(i).padStart(4, '0')}AAAA`, conversationId: `CONV-${i}AAAA`, internetMessageId: `<${i}@x>`, asunto: `Correo de relleno ${i}`, fecha: `2026-10-0${(i % 9) + 1}T10:00:00Z` });
  }
  return base;
}

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'laura@gsslatam.com', name: 'Laura', sub: 'u-op', kronosUserId: 'u-op', role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

/** Servidor simulado con estado: la bandeja, la papelera, lo que se pidió eliminar, deshacer y marcar. */
async function simular(page: Page, opciones: { filas?: number } = {}) {
  const estado = { bandeja: semilla(opciones.filas), papelera: [] as Msg[], comprobantes: new Map<string, Array<{ enPapelera: string; original: Msg }>>() };
  const eliminaciones: Array<{ mensajesIds: string[]; confirmarVinculados: boolean }> = [];
  const deshechos: string[] = [];
  const marcados: Array<{ mensajesIds: string[]; leido: boolean }> = [];
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-op', role: 'user' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/correo', (r) =>
    r.fulfill({
      json: {
        usuario: { id: 'u-op', nombre: 'Laura', email: 'laura@gsslatam.com' },
        empresas: [{ idCompany: 1, companyName: 'GROUP SHARED SERVICES' }],
        conexion: { modo: 'graph', disponible: true, correo: 'laura@gsslatam.com', envioHabilitado: true, etiquetarHabilitado: true, eliminarHabilitado: true, sincronizacionAutomatica: false },
      },
    })
  );
  await page.route('**/api/correo/carpetas', (r) =>
    r.fulfill({
      json: {
        carpetas: [
          { id: 'FOLDER-INBOXAAAA', nombre: 'Bandeja de entrada', total: estado.bandeja.length, noLeidos: estado.bandeja.filter((m) => !m.leido).length },
          { id: 'FOLDER-SENTAAAA', nombre: 'Elementos enviados', total: 0, noLeidos: 0 },
          { id: 'FOLDER-DELETEDAAAA', nombre: 'Elementos eliminados', total: estado.papelera.length, noLeidos: 0 },
        ],
      },
    })
  );
  await page.route('**/api/correo/mensajes**', (r) => {
    const carpeta = new URL(r.request().url()).searchParams.get('carpeta');
    const lista = carpeta === 'FOLDER-DELETEDAAAA' ? estado.papelera : carpeta ? [] : estado.bandeja;
    return r.fulfill({ json: { mensajes: lista, siguiente: null } });
  });
  await page.route('**/api/correo/leido', (r) => {
    const b = r.request().postDataJSON();
    marcados.push(b);
    for (const m of estado.bandeja) if (b.mensajesIds.includes(m.id)) m.leido = b.leido;
    return r.fulfill({ json: { cambiados: b.mensajesIds.length, fallidos: 0 } });
  });
  await page.route('**/api/correo/eliminar', (r) => {
    const b = r.request().postDataJSON();
    eliminaciones.push(b);
    const filas = estado.bandeja.filter((m) => b.mensajesIds.includes(m.id));
    const vinculadas = filas.filter((m) => m.solicitud || m.proyectos.length);
    if (vinculadas.length && !b.confirmarVinculados) {
      return r.fulfill({ status: 409, json: { error: 'Vinculado', code: 'VINCULADO', vinculos: vinculadas.map((m) => ({ mensajeId: m.id, conversationId: m.conversationId, idRequest: m.solicitud, proyectos: m.proyectos })) } });
    }
    const token = `COMPROBANTE-${eliminaciones.length}`;
    const items = filas.map((original) => ({ enPapelera: `${original.id}-ELIM`, original }));
    estado.comprobantes.set(token, items);
    estado.bandeja = estado.bandeja.filter((m) => !b.mensajesIds.includes(m.id));
    estado.papelera.push(...items.map((x) => ({ ...x.original, id: x.enPapelera })));
    return r.fulfill({ json: { eliminados: items.map((x) => ({ id: x.original.id, nuevoId: x.enPapelera })), yaEnEliminados: [], fallidos: [], deshacer: token, venceEn: '2099-01-01T00:00:00Z' } });
  });
  await page.route('**/api/correo/eliminar/deshacer', (r) => {
    const { deshacer } = r.request().postDataJSON();
    deshechos.push(deshacer);
    const items = estado.comprobantes.get(deshacer) ?? [];
    estado.papelera = estado.papelera.filter((m) => !items.some((x) => x.enPapelera === m.id));
    // Graph le da otro id al volver a moverlo.
    const restaurados = items.map((x) => ({ id: x.enPapelera, nuevoId: `${x.original.id}-R` }));
    estado.bandeja.push(...items.map((x) => ({ ...x.original, id: `${x.original.id}-R` })));
    return r.fulfill({ json: { restaurados, fallidos: [] } });
  });
  return { estado, eliminaciones, deshechos, marcados };
}

/** Deslizamiento con el DEDO (eventos táctiles de Chromium): de 80 % (o 20 %) del ancho de la fila, `dx` px. */
async function deslizarConDedo(page: Page, fila: Locator, dx: number, opciones: { dy?: number; pasos?: number; soltar?: boolean } = {}): Promise<{ cdp: CDPSession; soltar: () => Promise<void> }> {
  const { dy = 0, pasos = 12, soltar = true } = opciones;
  const caja = (await fila.boundingBox())!;
  const x0 = caja.x + caja.width * (dx < 0 ? 0.8 : 0.3);
  const y0 = caja.y + caja.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= pasos; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / pasos, y: y0 + (dy * i) / pasos }] });
    await page.waitForTimeout(16);
  }
  const fin = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).then(() => undefined);
  if (soltar) await fin();
  return { cdp, soltar: fin };
}

const captura = async (page: Page, nombre: string) => {
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
};

test.describe('Correo · deslizar para eliminar (celular, con toque)', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('corto vuelve sin eliminar; largo elimina con «Deshacer», que lo devuelve a la bandeja', async ({ page }) => {
    const api = await simular(page);
    await page.goto('/process/correo');
    const filas = page.getByTestId('correo-fila');
    await expect(filas).toHaveCount(3);
    const primera = filas.first();

    // Mientras se desliza: fondo rojo con «Eliminar» detrás de la fila.
    const gesto = await deslizarConDedo(page, primera, -90, { soltar: false });
    const fondo = page.getByTestId('correo-deslizar-fondo');
    await expect(fondo).toBeVisible();
    await expect(fondo).toContainText('Eliminar');
    await expect(fondo).toHaveAttribute('data-armado', '0');
    await captura(page, '20-movil-deslizando');
    await gesto.soltar();
    // No pasó el umbral: vuelve a su sitio, no abre el hilo y no se llamó al servidor.
    await expect(fondo).toHaveCount(0);
    await expect(filas).toHaveCount(3);
    await expect(page.getByTestId('correo-hilo')).toHaveCount(0);
    expect(api.eliminaciones).toHaveLength(0);

    // Pasado el umbral: el ícono «se arma» y al soltar la fila sale.
    const largo = await deslizarConDedo(page, primera, -260, { soltar: false });
    await expect(fondo).toHaveAttribute('data-armado', '1');
    await captura(page, '21-movil-umbral');
    await largo.soltar();
    await expect(filas).toHaveCount(2);
    expect(api.eliminaciones).toEqual([{ mensajesIds: ['MSG-0001AAAA'], confirmarVinculados: false }]);
    const aviso = page.getByTestId('correo-aviso-eliminado');
    await expect(aviso).toContainText('Correo movido a la Papelera.');
    await captura(page, '22-movil-aviso-deshacer');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

    await aviso.getByTestId('correo-deshacer').click();
    await expect(filas).toHaveCount(3);
    expect(api.deshechos).toEqual(['COMPROBANTE-1']);
    // Vuelve en su posición, con el id nuevo que le dio Microsoft.
    await expect(filas.first()).toContainText('Revisión de contrato de arrendamiento');
    await expect(page.getByText('Correo restaurado')).toBeVisible();
    await captura(page, '23-movil-restaurado');
  });

  test('un gesto vertical desplaza la lista y no elimina; deslizar a la derecha marca leído / no leído', async ({ page }) => {
    const api = await simular(page, { filas: 18 });
    await page.goto('/process/correo');
    const filas = page.getByTestId('correo-fila');
    await expect(filas).toHaveCount(18);
    const scroll = page.getByTestId('correo-lista-scroll');
    expect(await scroll.evaluate((el) => el.scrollTop)).toBe(0);
    // Mayormente vertical (con algo de horizontal): es desplazamiento.
    await deslizarConDedo(page, filas.nth(4), -40, { dy: -260, pasos: 14 });
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
    await expect(filas).toHaveCount(18);
    expect(api.eliminaciones).toHaveLength(0);
    await scroll.evaluate((el) => el.scrollTo(0, 0));

    // A la derecha: «Leído» en azul y la fila queda leída (se pinta ya), sin salir de la lista.
    const primera = filas.first();
    await expect(primera).toHaveAttribute('data-leido', '0');
    const gesto = await deslizarConDedo(page, primera, 220, { soltar: false });
    await expect(page.getByTestId('correo-deslizar-fondo')).toHaveAttribute('data-color', 'azul');
    await expect(page.getByTestId('correo-deslizar-fondo')).toContainText('Leído');
    await captura(page, '24-movil-deslizar-leido');
    await gesto.soltar();
    await expect(primera).toHaveAttribute('data-leido', '1');
    expect(api.marcados).toEqual([{ mensajesIds: ['MSG-0001AAAA'], leido: true }]);
    await expect(filas).toHaveCount(18);
  });

  test('hilo vinculado a una solicitud y a un proyecto: confirma antes de eliminar', async ({ page }) => {
    const api = await simular(page);
    await page.goto('/process/correo');
    const filas = page.getByTestId('correo-fila');
    await expect(filas).toHaveCount(3);
    await deslizarConDedo(page, filas.nth(2), -260);
    // La fila vuelve y se pide confirmación, sin llamar al servidor todavía.
    const modal = page.getByTestId('correo-confirmar-eliminar');
    await expect(modal.getByTestId('correo-confirmar-eliminar-si')).toBeVisible();
    await expect(modal.getByTestId('correo-confirmar-eliminar-vinculos')).toContainText('Solicitud #321 · Proyecto «Contratos 2026»');
    await expect(filas).toHaveCount(3);
    expect(api.eliminaciones).toHaveLength(0);
    // La fila regresó a su sitio (sin desplazamiento) detrás de la confirmación.
    await expect.poll(() => filas.nth(2).evaluate((el) => (el.parentElement as HTMLElement).style.transform)).toBe('');
    if (CAPTURAS) await page.waitForTimeout(400);
    await captura(page, '25-movil-confirmar-vinculado');
    await modal.getByTestId('correo-confirmar-eliminar-si').click();
    await expect(filas).toHaveCount(2);
    expect(api.eliminaciones).toEqual([{ mensajesIds: ['MSG-0003AAAA'], confirmarVinculados: true }]);
    await expect(page.getByTestId('correo-aviso-eliminado')).toBeVisible();
  });

  test('con «reducir movimiento» elimina sin animación y la selección también ofrece «Eliminar»', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const api = await simular(page);
    await page.goto('/process/correo');
    const filas = page.getByTestId('correo-fila');
    await expect(filas).toHaveCount(3);
    await deslizarConDedo(page, filas.first(), -260);
    await expect(filas).toHaveCount(2);
    // Selección (tocar el avatar) → «Eliminar» en la barra.
    await page.getByTestId('correo-seleccionar').first().click();
    await expect(page.getByTestId('correo-sel-eliminar')).toBeVisible();
    await captura(page, '26-movil-seleccion-eliminar');
    await page.getByTestId('correo-sel-eliminar').click();
    await expect(filas).toHaveCount(1);
    expect(api.eliminaciones.map((e) => e.mensajesIds)).toEqual([['MSG-0001AAAA'], ['MSG-0002AAAA']]);
  });
});

test.describe('Correo · eliminar en el escritorio', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('botón «Eliminar» al pasar el mouse, arrastre con el mouse y eliminación masiva con «Deshacer»', async ({ page }) => {
    const api = await simular(page);
    await page.goto('/process/correo');
    const filas = page.getByTestId('correo-fila');
    await expect(filas).toHaveCount(3);

    // Botón al pasar el mouse.
    await filas.nth(1).hover();
    await expect(filas.nth(1).getByTestId('correo-fila-eliminar')).toBeVisible();
    await captura(page, '27-escritorio-boton-eliminar');
    await filas.nth(1).getByTestId('correo-fila-eliminar').click();
    await expect(filas).toHaveCount(2);
    expect(api.eliminaciones.at(-1)).toEqual({ mensajesIds: ['MSG-0002AAAA'], confirmarVinculados: false });
    await page.getByTestId('correo-aviso-eliminado').getByTestId('correo-deshacer').click();
    await expect(filas).toHaveCount(3);
    await expect(filas.nth(1)).toContainText('Solicitud de poder');

    // Arrastre con el mouse (o el trackpad) hacia la izquierda.
    const caja = (await filas.first().boundingBox())!;
    await page.mouse.move(caja.x + caja.width * 0.7, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width * 0.7 - 120, caja.y + caja.height / 2 + 4, { steps: 8 });
    await expect(page.getByTestId('correo-deslizar-fondo')).toBeVisible();
    await captura(page, '28-escritorio-arrastre');
    await page.mouse.move(caja.x + caja.width * 0.7 - 400, caja.y + caja.height / 2 + 4, { steps: 8 });
    await page.mouse.up();
    await expect(filas).toHaveCount(2);
    // El arrastre no abrió el hilo.
    await expect(page.getByTestId('correo-hilo')).toHaveCount(0);

    // Selección masiva: «Eliminar» en la barra y «Deshacer» devuelve los dos.
    await filas.nth(0).getByTestId('correo-seleccionar').check();
    await filas.nth(1).getByTestId('correo-seleccionar').check();
    await page.getByTestId('correo-sel-eliminar').click();
    // Uno está vinculado (#321): confirmación con el detalle.
    await expect(page.getByTestId('correo-confirmar-eliminar-si')).toBeVisible();
    await captura(page, '29-escritorio-confirmar-masivo');
    await page.getByTestId('correo-confirmar-eliminar-si').click();
    await expect(filas).toHaveCount(0);
    await expect(page.getByTestId('correo-aviso-eliminado').last()).toContainText('2 correos movidos a la Papelera.');
    await captura(page, '30-escritorio-aviso-masivo');
    await page.getByTestId('correo-aviso-eliminado').last().getByTestId('correo-deshacer').click();
    await expect(filas).toHaveCount(2);
  });

  test('en la Papelera no se ofrece eliminar (el módulo nunca borra de forma permanente); Supr elimina en la bandeja', async ({ page }) => {
    const api = await simular(page);
    await page.goto('/process/correo');
    const filas = page.getByTestId('correo-fila');
    await expect(filas).toHaveCount(3);
    await filas.first().focus();
    await page.keyboard.press('Delete');
    await expect(filas).toHaveCount(2);
    expect(api.eliminaciones).toHaveLength(1);
    await page.getByTestId('correo-carpeta').filter({ hasText: 'Papelera' }).click();
    await expect(filas).toHaveCount(1);
    await filas.first().hover();
    await expect(page.getByTestId('correo-fila-eliminar')).toHaveCount(0);
    await filas.first().getByTestId('correo-seleccionar').check();
    await expect(page.getByTestId('correo-sel-eliminar')).toHaveCount(0);
  });
});

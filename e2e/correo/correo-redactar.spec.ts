import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Módulo Correo · Redactar (2026-10-19), con las APIs simuladas (`page.route`) como correo-deslizar.spec.ts:
 * nada sale a Microsoft ni se envía un correo real.
 *
 * - Escritorio: «Redactar» arriba de las carpetas abre la ventana flotante abajo a la derecha; autocompletado
 *   (recientes y directorio), CC y CCO, tabla pegada desde Excel, minimizar, aviso verde arriba al enviar.
 * - Celular: botón flotante «Redactar» y pantalla completa.
 * - Errores visibles en rojo dentro de la ventana; bandera apagada: botón deshabilitado y sin botón flotante.
 * Con `CORREO_CAPTURAS=<carpeta>` guarda las capturas para la revisión de lineamientos.
 */

const CAPTURAS = process.env.CORREO_CAPTURAS;
const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);

const MENSAJES = [
  { id: 'MSG-0001AAAA', conversationId: 'CONV-01AAAA', internetMessageId: '<1@x>', asunto: 'Revisión de contrato de arrendamiento', de: { nombre: 'Usuario Uno', correo: 'uno@gsslatam.com' }, fecha: '2026-10-15T14:00:00Z', leido: false, conAdjuntos: true, extracto: 'Adjunto el contrato para revisión', categorias: [], solicitud: null, proyectos: [] },
  { id: 'MSG-0002AAAA', conversationId: 'CONV-02AAAA', internetMessageId: '<2@x>', asunto: 'Solicitud de poder', de: { nombre: 'Usuario Dos', correo: 'dos@onelatampharma.com' }, fecha: '2026-10-14T15:00:00Z', leido: true, conAdjuntos: false, extracto: 'Requerimos un poder especial', categorias: [], solicitud: null, proyectos: [] },
];

const SUGERENCIAS = [
  { nombre: 'Usuario de Prueba Uno', correo: 'prueba.uno@gsslatam.com', origen: 'reciente' },
  { nombre: 'Persona de Calidad', correo: 'calidad.pruebas@gsslatam.com', origen: 'directorio' },
  { nombre: 'Persona de Jurídica', correo: 'juridica.pruebas@gsslatam.com', origen: 'directorio' },
];

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'laura@gsslatam.com', name: 'Laura', sub: 'u-op', kronosUserId: 'u-op', role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

type Envio = { para: string[]; cc: string[]; cco: string[]; asunto: string; texto: string; archivos: string[]; campos: string[] };

/** Lee el multipart que manda el navegador (sin depender de un parser externo). */
function leerMultipart(cuerpo: Buffer, tipo: string): Envio {
  const limite = /boundary=(.+)$/.exec(tipo)?.[1] ?? '';
  const partes = cuerpo.toString('latin1').split(`--${limite}`).slice(1, -1);
  const env: Envio = { para: [], cc: [], cco: [], asunto: '', texto: '', archivos: [], campos: [] };
  for (const p of partes) {
    const [cab, ...resto] = p.split('\r\n\r\n');
    const valor = Buffer.from(resto.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1').toString('utf8');
    const nombre = /name="([^"]+)"/.exec(cab)?.[1] ?? '';
    const archivo = /filename="([^"]*)"/.exec(cab)?.[1];
    env.campos.push(nombre);
    if (archivo !== undefined) env.archivos.push(archivo);
    else if (nombre === 'para' || nombre === 'cc' || nombre === 'cco') env[nombre] = JSON.parse(valor);
    else if (nombre === 'asunto' || nombre === 'texto') env[nombre] = valor;
  }
  return env;
}

async function simular(page: Page, opciones: { envioHabilitado?: boolean; fallarEnvio?: string } = {}) {
  const envios: Envio[] = [];
  const busquedas: string[] = [];
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-op', role: 'user' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/correo', (r) =>
    r.fulfill({
      json: {
        usuario: { id: 'u-op', nombre: 'Laura', email: 'laura@gsslatam.com' },
        empresas: [{ idCompany: 1, companyName: 'GROUP SHARED SERVICES' }],
        conexion: { modo: 'graph', disponible: true, correo: 'laura@gsslatam.com', envioHabilitado: opciones.envioHabilitado ?? true, etiquetarHabilitado: true, eliminarHabilitado: true, sincronizacionAutomatica: false },
        dominiosGrupo: ['gsslatam.com', 'onelatampharma.com'],
      },
    })
  );
  await page.route('**/api/correo/carpetas', (r) =>
    r.fulfill({
      json: {
        carpetas: [
          { id: 'FOLDER-INBOXAAAA', nombre: 'Bandeja de entrada', total: 2, noLeidos: 1 },
          { id: 'FOLDER-SENTAAAA', nombre: 'Elementos enviados', total: envios.length, noLeidos: 0 },
          { id: 'FOLDER-DELETEDAAAA', nombre: 'Elementos eliminados', total: 0, noLeidos: 0 },
        ],
      },
    })
  );
  await page.route('**/api/correo/mensajes**', (r) => r.fulfill({ json: { mensajes: MENSAJES, siguiente: null } }));
  await page.route('**/api/correo/no-leidos**', (r) => r.fulfill({ json: { noLeidos: 1 } }));
  await page.route('**/api/correo/destinatarios**', (r) => {
    const q = (new URL(r.request().url()).searchParams.get('q') ?? '').toLowerCase();
    busquedas.push(q);
    const lista = SUGERENCIAS.filter((s) => !q || s.correo.startsWith(q) || s.nombre.toLowerCase().split(' ').some((p) => p.startsWith(q)));
    return r.fulfill({ json: { destinatarios: q ? lista : lista.filter((s) => s.origen === 'reciente') } });
  });
  await page.route('**/api/correo/redactar', async (r) => {
    const req = r.request();
    envios.push(leerMultipart(req.postDataBuffer() ?? Buffer.alloc(0), req.headers()['content-type'] ?? ''));
    if (opciones.fallarEnvio) return r.fulfill({ status: 400, json: { error: opciones.fallarEnvio, code: 'DESTINATARIOS' } });
    const e = envios[envios.length - 1];
    return r.fulfill({ json: { ok: true, destinatarios: e.para.length + e.cc.length + e.cco.length } });
  });
  return { envios, busquedas };
}

const captura = async (page: Page, nombre: string) => {
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
};

/** Pega en el editor una tabla como la que deja Excel en el portapapeles (texto con tabuladores). */
async function pegarTablaExcel(page: Page) {
  await page.getByTestId('correo-redactar-texto').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Ítem\tCantidad\tValor\r\nContrato bodega\t1\t$ 4.500.000\r\nOtrosí mantenimiento\t2\t$ 1.200.000\r\n');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
}

test.describe('Correo · Redactar (escritorio)', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('ventana flotante: autocompletado, CC y CCO, tabla pegada, envío y aviso verde arriba', async ({ page }) => {
    const api = await simular(page);
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-fila')).toHaveCount(2);
    await captura(page, '01-escritorio-boton-redactar');

    await page.getByTestId('correo-redactar-btn').click();
    const ventana = page.getByTestId('correo-redactar');
    await expect(ventana).toBeVisible();
    await expect(ventana.getByTestId('correo-redactar-de')).toContainText('laura@gsslatam.com');
    // Abajo a la derecha.
    const caja = (await ventana.boundingBox())!;
    expect(caja.x + caja.width).toBeGreaterThan(1440 - 60);
    expect(caja.y + caja.height).toBeGreaterThan(900 - 4);

    // Para: escribir «cal» sugiere del directorio; se elige con el mouse.
    const para = page.getByTestId('correo-redactar-para-input');
    await para.fill('cal');
    const sugerencia = page.getByTestId('correo-sugerencia').filter({ hasText: 'Persona de Calidad' });
    await expect(sugerencia).toBeVisible();
    await expect(sugerencia).toContainText('Directorio');
    await captura(page, '02-escritorio-autocompletado');
    await sugerencia.click();
    // Un externo y uno inválido escritos a mano.
    await para.fill('asesor@externo-ejemplo.com');
    await para.press('Enter');
    await para.fill('no-es-correo');
    await para.press('Enter');
    await expect(page.getByTestId('correo-redactar-para-error')).toContainText('no-es-correo');
    await expect(page.getByTestId('correo-redactar-aviso-externos')).toContainText('fuera del grupo');
    await para.fill('');

    await page.getByTestId('correo-redactar-ver-cc').click();
    await page.getByTestId('correo-redactar-cc-input').fill('juridica.pruebas@gsslatam.com');
    await page.getByTestId('correo-redactar-cc-input').press('Enter');
    await page.getByTestId('correo-redactar-ver-cco').click();
    await page.getByTestId('correo-redactar-cco-input').fill('archivo@gsslatam.com,');

    await page.getByTestId('correo-redactar-asunto').fill('Contratos pendientes de octubre');
    const editor = page.getByTestId('correo-redactar-texto');
    await editor.fill('Buen día,\n\nLes comparto el **resumen**:\n\n');
    await pegarTablaExcel(page);
    await expect(editor).toHaveValue(/\| Ítem \| Cantidad \| Valor \|\n\| --- \| --- \| --- \|\n\| Contrato bodega \| 1 \| \$ 4\.500\.000 \|/);
    await editor.press('End');
    await editor.pressSequentially('Quedamos atentos.');
    await captura(page, '03-escritorio-ventana-completa');

    await page.getByTestId('correo-md-tab-previa').click();
    const previa = page.getByTestId('correo-md-previa').frameLocator('iframe');
    await expect(previa.locator('table td').first()).toHaveText('Contrato bodega');
    await captura(page, '04-escritorio-vista-previa-tabla');
    await page.getByTestId('correo-md-tab-escribir').click();

    // Minimizar deja ver la bandeja; restaurar vuelve con lo escrito.
    await page.getByTestId('correo-redactar-minimizar').click();
    await expect(page.getByTestId('correo-redactar-asunto')).toHaveCount(0);
    await expect(page.getByTestId('correo-redactar-titulo')).toHaveText('Contratos pendientes de octubre');
    await captura(page, '05-escritorio-minimizado');
    await page.getByTestId('correo-redactar-minimizar').click();
    await expect(page.getByTestId('correo-redactar-asunto')).toHaveValue('Contratos pendientes de octubre');

    await page.getByTestId('correo-redactar-enviar').click();
    await expect(page.getByTestId('correo-redactar')).toHaveCount(0);
    const aviso = page.getByTestId('correo-aviso-enviado');
    await expect(aviso).toContainText('«Contratos pendientes de octubre» enviado desde su buzón a 4 destinatarios');
    // El aviso queda ARRIBA de la bandeja.
    expect((await aviso.boundingBox())!.y).toBeLessThan((await page.getByTestId('correo-bandeja').boundingBox())!.y);
    await captura(page, '06-escritorio-aviso-enviado');

    expect(api.envios).toHaveLength(1);
    const e = api.envios[0];
    expect(e.para).toEqual(['calidad.pruebas@gsslatam.com', 'asesor@externo-ejemplo.com']);
    expect(e.cc).toEqual(['juridica.pruebas@gsslatam.com']);
    expect(e.cco).toEqual(['archivo@gsslatam.com']);
    expect(e.asunto).toBe('Contratos pendientes de octubre');
    expect(e.texto).toContain('| Contrato bodega | 1 | $ 4.500.000 |');
    // El navegador nunca manda remitente ni buzón: el servidor usa el de la sesión.
    expect(e.campos.sort()).toEqual(['asunto', 'cc', 'cco', 'para', 'texto']);
    expect(api.busquedas).toContain('cal');
  });

  test('errores en rojo dentro de la ventana sin perder lo escrito; sin asunto pide confirmación; descartar pide confirmación', async ({ page }) => {
    const api = await simular(page, { fallarEnvio: 'Máximo 50 destinatarios por correo (entre Para, CC y CCO); hay 51.' });
    await page.goto('/process/correo');
    await page.getByTestId('correo-redactar-btn').click();
    await page.getByTestId('correo-redactar-enviar').click();
    await expect(page.getByTestId('correo-redactar-error')).toContainText('Agregue al menos un destinatario');
    expect(api.envios).toHaveLength(0);

    await page.getByTestId('correo-redactar-para-input').fill('prueba.uno@gsslatam.com');
    await page.getByTestId('correo-redactar-para-input').press('Enter');
    await page.getByTestId('correo-redactar-texto').fill('Hola');
    await page.getByTestId('correo-redactar-enviar').click();
    await expect(page.getByTestId('correo-redactar-sin-asunto')).toBeVisible();
    await captura(page, '07-escritorio-sin-asunto');
    await page.getByTestId('correo-redactar-enviar-sin-asunto').click();
    await expect(page.getByTestId('correo-redactar-error')).toContainText('Máximo 50 destinatarios');
    await expect(page.getByTestId('correo-redactar-texto')).toHaveValue('Hola');
    await captura(page, '08-escritorio-error-servidor');

    await page.getByTestId('correo-redactar-cerrar').click();
    await expect(page.getByTestId('correo-redactar-confirmar-descarte')).toBeVisible();
    await page.getByTestId('correo-redactar-descartar-si').click();
    await expect(page.getByTestId('correo-redactar')).toHaveCount(0);
  });

  test('bandera de envío apagada: «Redactar» deshabilitado', async ({ page }) => {
    await simular(page, { envioHabilitado: false });
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-redactar-btn')).toBeDisabled();
  });
});

test.describe('Correo · Redactar (celular)', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('botón flotante y pantalla completa; al enviar, aviso verde arriba', async ({ page }) => {
    const api = await simular(page);
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-fila')).toHaveCount(2);
    const fab = page.getByTestId('correo-redactar-fab');
    await expect(fab).toBeVisible();
    const caja = (await fab.boundingBox())!;
    expect(caja.x + caja.width).toBeGreaterThan(390 - 40);
    expect(caja.y + caja.height).toBeGreaterThan(844 - 60);
    await captura(page, '10-movil-boton-flotante');

    await fab.click();
    // El data-testid del Modal queda en su raíz (sin caja propia): se verifica el contenido.
    await expect(page.getByTestId('correo-redactar-asunto')).toBeVisible();
    await expect(fab).toHaveCount(0);
    // Pantalla completa.
    const contenido = (await page.locator('.mantine-Modal-content').boundingBox())!;
    expect(contenido.width).toBeGreaterThanOrEqual(389);
    expect(contenido.height).toBeGreaterThanOrEqual(843);

    const para = page.getByTestId('correo-redactar-para-input');
    await para.fill('prueba');
    await expect(page.getByTestId('correo-sugerencia').first()).toBeVisible();
    await captura(page, '11-movil-autocompletado');
    await page.getByTestId('correo-sugerencia').first().click();
    await page.getByTestId('correo-redactar-asunto').fill('Poder especial INVIMA');
    await page.getByTestId('correo-redactar-texto').fill('Buen día,\n\n- Radicado\n- Pendiente la firma\n\nQuedamos atentos.');
    await captura(page, '12-movil-pantalla-completa');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

    await page.getByTestId('correo-redactar-enviar').click();
    await expect(page.getByTestId('correo-aviso-enviado')).toContainText('enviado desde su buzón a 1 destinatario');
    await expect(fab).toBeVisible();
    await captura(page, '13-movil-aviso-enviado');
    expect(api.envios[0].para).toEqual(['prueba.uno@gsslatam.com']);
  });
});

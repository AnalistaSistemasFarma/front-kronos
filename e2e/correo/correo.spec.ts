import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Módulo Correo · extremo a extremo con Microsoft Graph SIMULADO.
 *
 * - Sin sesión: todas las rutas /api/correo/** responden 401 y la página manda al login.
 * - Con sesión: se firma un JWT de NextAuth con NEXTAUTH_SECRET (el de la CI, sin
 *   usuario real ni base) y las APIs del módulo se simulan con `page.route`, como
 *   las pruebas del Portal TH. Recorre: bandeja → hilo (HTML seguro) → responder →
 *   selección → simulación editable → crear con avance y resumen; y el celular.
 * Con `CORREO_CAPTURAS=<carpeta>` guarda capturas para la revisión de lineamientos.
 */

const CAPTURAS = process.env.CORREO_CAPTURAS;
const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);

const mensajes = [
  { id: 'MSG-0001AAAA', conversationId: 'CONV-01AAAA', internetMessageId: '<1@x>', asunto: 'Revisión de contrato de arrendamiento', de: { nombre: 'Usuario Uno', correo: 'uno@gsslatam.com' }, fecha: '2026-10-15T14:00:00Z', leido: false, conAdjuntos: true, extracto: 'Adjunto el contrato para revisión', categorias: [], solicitud: null },
  { id: 'MSG-0002AAAA', conversationId: 'CONV-02AAAA', internetMessageId: '<2@x>', asunto: 'Solicitud de poder', de: { nombre: 'Usuario Dos', correo: 'dos@onelatampharma.com' }, fecha: '2026-10-14T15:00:00Z', leido: true, conAdjuntos: false, extracto: 'Requerimos un poder especial', categorias: [], solicitud: null },
  { id: 'MSG-0003AAAA', conversationId: 'CONV-03AAAA', internetMessageId: '<3@x>', asunto: 'Otrosí mantenimiento', de: { nombre: 'Usuario Uno', correo: 'uno@gsslatam.com' }, fecha: '2026-10-10T12:00:00Z', leido: true, conAdjuntos: false, extracto: 'Ampliar el plazo', categorias: ['SynerLink #321'], solicitud: 321 },
];

const hilo = {
  conversationId: 'CONV-01AAAA',
  asunto: 'Revisión de contrato de arrendamiento',
  vinculo: null,
  pendientes: 0,
  mensajes: [
    {
      id: 'MSG-0001AAAA', internetMessageId: '<1@x>', asunto: 'Revisión de contrato de arrendamiento', de: mensajes[0].de, para: [{ nombre: 'Laura', correo: 'laura@gsslatam.com' }], cc: [],
      fecha: '2026-10-15T14:00:00Z', leido: false, enCaso: false, remotasBloqueadas: 1,
      // Ya viene saneado del servidor; igual se muestra en un iframe sin scripts.
      html: '<p id="cuerpo">Adjunto el contrato de <b>arrendamiento</b>.</p><a href="https://www.invima.gov.co" target="_blank" rel="noopener noreferrer nofollow">Portal</a>',
      adjuntos: [{ id: 'ADJ-1AAAA', nombre: 'contrato.pdf', tipo: 'application/pdf', tamano: 20480, enLinea: false }],
    },
  ],
};

const filas = [
  { conversationId: 'CONV-01AAAA', mensajeId: 'MSG-0001AAAA', internetMessageId: '<1@x>', mensajesIds: ['MSG-0001AAAA'], idCompany: 1, idProcess: 10, procesoSugeridoPor: 'palabra-clave', remitente: mensajes[0].de, idSolicitante: 'u1', solicitanteNombre: 'Usuario Uno', titulo: 'Revisión de contrato de arrendamiento', descripcion: 'Correo de Usuario Uno <uno@gsslatam.com> del 2026-10-15.\n\nAdjunto el contrato', adjuntos: hilo.mensajes[0].adjuntos, duplicadoDe: null, alertas: [], incluir: true },
  { conversationId: 'CONV-02AAAA', mensajeId: 'MSG-0002AAAA', internetMessageId: '<2@x>', mensajesIds: ['MSG-0002AAAA'], idCompany: 1, idProcess: null, procesoSugeridoPor: null, remitente: mensajes[1].de, idSolicitante: null, solicitanteNombre: null, titulo: 'Solicitud de poder', descripcion: 'Requerimos un poder', adjuntos: [], duplicadoDe: null, alertas: ['SIN_USUARIO', 'SIN_PROCESO'], incluir: false },
  { conversationId: 'CONV-03AAAA', mensajeId: 'MSG-0003AAAA', internetMessageId: '<3@x>', mensajesIds: ['MSG-0003AAAA'], idCompany: 1, idProcess: 10, procesoSugeridoPor: 'palabra-clave', remitente: mensajes[0].de, idSolicitante: 'u1', solicitanteNombre: 'Usuario Uno', titulo: 'Otrosí mantenimiento', descripcion: 'Ampliar', adjuntos: [], duplicadoDe: 321, alertas: ['DUPLICADO'], incluir: false },
];

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'laura@gsslatam.com', name: 'Laura', sub: 'u-op', kronosUserId: 'u-op', role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

async function simular(page: Page, opciones: { disponible?: boolean } = {}) {
  const creadas: unknown[] = [];
  const respuestas: string[] = [];
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'laura@gsslatam.com', name: 'Laura', id: 'u-op', role: 'user' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/correo', (r) =>
    r.fulfill({
      json: {
        usuario: { id: 'u-op', nombre: 'Laura', email: 'laura@gsslatam.com' },
        empresas: [{ idCompany: 1, companyName: 'GROUP SHARED SERVICES' }],
        conexion: { modo: 'graph', disponible: opciones.disponible !== false, correo: 'laura@gsslatam.com', envioHabilitado: true, etiquetarHabilitado: true, sincronizacionAutomatica: false },
      },
    })
  );
  await page.route('**/api/correo/carpetas', (r) =>
    r.fulfill({
      json: {
        carpetas: [
          { id: 'FOLDER-SENTAAAA', nombre: 'Elementos enviados', total: 12, noLeidos: 0 },
          { id: 'FOLDER-INBOXAAAA', nombre: 'Bandeja de entrada', total: 3, noLeidos: 1 },
          { id: 'FOLDER-DRAFTSAAAA', nombre: 'Borradores', total: 2, noLeidos: 0 },
          { id: 'FOLDER-OUTBOXAAAA', nombre: 'Bandeja de salida', total: 0, noLeidos: 0 },
        ],
      },
    })
  );
  const consultas: URLSearchParams[] = [];
  await page.route('**/api/correo/mensajes**', (r) => {
    consultas.push(new URL(r.request().url()).searchParams);
    return r.fulfill({ json: { mensajes, siguiente: null } });
  });
  await page.route('**/api/correo/hilo?**', (r) => r.fulfill({ json: { hilo } }));
  // Leído / no leído (al abrir un hilo se marca solo, como Gmail). Va DESPUÉS de «hilo?**», cuyo «?» también calza con «/».
  const leidos: unknown[] = [];
  await page.route('**/api/correo/hilo/leido', (r) => {
    leidos.push(r.request().postDataJSON());
    return r.fulfill({ json: { cambiados: 1 } });
  });
  await page.route('**/api/correo/responder', (r) => {
    respuestas.push(r.request().postData() ?? '');
    return r.fulfill({ json: { ok: true, notaEnSolicitud: null } });
  });
  await page.route('**/api/correo/simular', (r) =>
    r.fulfill({
      json: {
        filas,
        categorias: [
          { id: 5, categoria: 'Jurídica' },
          { id: 6, categoria: 'Tesorería' },
        ],
        procesos: [
          { id: 10, nombre: 'Elaboración y revisión de contratos', idCategoria: 5, categoria: 'Jurídica', responsables: ['María Camila'] },
          { id: 20, nombre: 'Solicitud de poderes', idCategoria: 5, categoria: 'Jurídica' },
          { id: 30, nombre: 'Solicitud de Pago', idCategoria: 6, categoria: 'Tesorería' },
        ],
      },
    })
  );
  await page.route('**/api/correo/usuarios**', (r) => r.fulfill({ json: { usuarios: [{ id: 'u2', nombre: 'Usuario Dos', correo: 'dos@onelatampharma.com' }] } }));
  await page.route('**/api/correo/crear', async (r) => {
    const body = r.request().postDataJSON();
    creadas.push(body);
    await new Promise((x) => setTimeout(x, 150));
    return r.fulfill({ status: 201, json: { conversationId: body.conversationId, ok: true, idRequest: 700 + creadas.length, adjuntosSubidos: body.adjuntosIds.length, adjuntosFallidos: [], etiquetado: true } });
  });
  return { creadas, respuestas, consultas, leidos };
}

test.describe('Correo · sin sesión', () => {
  test('todas las APIs del módulo responden 401', async ({ request }) => {
    for (const ruta of ['/api/correo', '/api/correo/carpetas', '/api/correo/mensajes', '/api/correo/hilo?id=CONV-01AAAA', '/api/correo/adjunto?mensaje=a&adjunto=b', '/api/correo/usuarios?empresa=1', '/api/correo/vinculos?solicitud=1', '/api/correo/procesos?empresa=1']) {
      expect((await request.get(ruta, { maxRedirects: 0 })).status(), ruta).toBe(401);
    }
    for (const ruta of ['/api/correo/simular', '/api/correo/crear', '/api/correo/hilo/notas', '/api/correo/hilo/vincular', '/api/correo/responder', '/api/correo/acuse']) {
      expect((await request.post(ruta, { data: {} })).status(), ruta).toBe(401);
    }
  });

  test('la página exige iniciar sesión', async ({ page }) => {
    await page.goto('/process/correo');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Correo · con sesión y Graph simulado', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('empresa sin app habilitada: «Correo disponible próximamente para su empresa»', async ({ page }) => {
    await simular(page, { disponible: false });
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-no-disponible')).toContainText('Correo disponible próximamente para su empresa');
    await expect(page.getByTestId('correo-fila')).toHaveCount(0);
  });

  test('escritorio: bandeja → hilo seguro → responder → simulación → crear con resumen', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const { creadas, respuestas, leidos } = await simular(page);
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-titulo')).toBeVisible();
    await expect(page.getByTestId('correo-buzon')).toHaveText('laura@gsslatam.com');
    await expect(page.getByTestId('correo-aviso-privacidad')).toContainText('Ley 1581 de 2012');
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    await expect(page.getByTestId('correo-badge-solicitud')).toHaveText('#321');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/01-bandeja.png` });

    // Hilo: cuerpo en iframe aislado, sin scripts; adjuntos; responder.
    await page.getByTestId('correo-fila').first().click();
    const drawer = page.getByTestId('correo-hilo');
    await expect(drawer.getByTestId('correo-hilo-mensaje')).toHaveCount(1);
    const iframe = drawer.getByTestId('correo-cuerpo');
    await expect(iframe).toHaveAttribute('sandbox', /allow-same-origin/);
    expect(await iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
    await expect(page.frameLocator('[data-testid="correo-cuerpo"]').locator('#cuerpo')).toContainText('arrendamiento');
    await expect(drawer.getByTestId('correo-imagenes-bloqueadas')).toBeVisible();
    await expect(drawer.getByTestId('correo-adjunto')).toContainText('contrato.pdf');
    // Como Gmail: el hilo ocupa el lugar de la lista (sin panel lateral), con ← y las acciones arriba.
    await expect(page).toHaveURL(/[?&]hilo=CONV-01AAAA/);
    await expect(page.getByTestId('correo-bandeja')).toBeHidden();
    await expect(page.getByTestId('correo-carpetas')).toBeVisible();
    await expect(page.locator('.mantine-Drawer-root')).toHaveCount(0);
    const barraHilo = drawer.getByTestId('correo-hilo-barra');
    await expect(barraHilo.getByTestId('correo-hilo-volver')).toBeVisible();
    await expect(barraHilo.getByTestId('correo-hilo-crear')).toBeVisible();
    await expect(barraHilo.getByTestId('correo-hilo-vincular-btn')).toBeVisible();
    // Al abrirlo, el hilo sin leer queda leído (como Gmail).
    await expect(barraHilo.getByTestId('correo-hilo-leido')).toHaveAttribute('aria-label', 'Marcar como no leído');
    await expect(drawer.getByTestId('correo-hilo-carpeta')).toHaveText('Recibidos');
    // El hilo usa todo el ancho del área de contenido (no un panel de 1000 px).
    const anchoHilo = (await drawer.boundingBox())!.width;
    expect(anchoHilo).toBeGreaterThan(1366 - 232 - 80);
    expect(leidos).toEqual([{ conversationId: 'CONV-01AAAA', leido: true }]);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/02-hilo.png` });
    // Responder como en Gmail: el botón abre el editor en el mismo hilo, con formato Markdown.
    await expect(drawer.getByTestId('correo-responder')).toHaveCount(0);
    await drawer.getByTestId('correo-responder-btn').click();
    await expect(drawer.getByTestId('correo-responder-para')).toContainText('Responder a Usuario Uno');
    const editor = drawer.getByTestId('correo-respuesta-texto');
    await editor.fill('lo reviso hoy');
    await editor.selectText();
    await drawer.getByTestId('correo-md-b').click();
    await expect(editor).toHaveValue('**lo reviso hoy**');
    // El texto queda seleccionado (dentro de las marcas), como en un editor; se lleva el cursor al final.
    await expect.poll(() => editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd].join('-'))).toBe('2-15');
    await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
    await editor.pressSequentially('\n- contrato\n- anexos');
    await drawer.getByTestId('correo-md-tab-previa').click();
    const previa = drawer.getByTestId('correo-md-previa').locator('iframe').contentFrame();
    await expect(previa.locator('strong')).toHaveText('lo reviso hoy');
    await expect(previa.locator('li')).toHaveCount(2);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/02b-responder-markdown.png` });
    await drawer.getByTestId('correo-respuesta-enviar').click();
    await expect(drawer.getByTestId('correo-hilo-resultado')).toContainText('Respuesta enviada desde su buzón');
    expect(respuestas[0]).toContain('**lo reviso hoy**');
    // ← vuelve a la lista (y quita ?hilo= de la dirección).
    await drawer.getByTestId('correo-hilo-volver').click();
    await expect(page.getByTestId('correo-hilo')).toHaveCount(0);
    await expect(page).not.toHaveURL(/hilo=/);
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);

    // Selección masiva → simulación (nada se crea todavía).
    for (const c of await page.getByTestId('correo-seleccionar').all()) await c.check();
    await expect(page.getByTestId('correo-barra-seleccion')).toContainText('3 correo(s)');
    await page.getByTestId('correo-simular').click();
    const modal = page.getByTestId('correo-simulacion');
    await expect(modal.getByTestId('correo-sim-fila')).toHaveCount(3);
    await expect(modal.getByTestId('correo-sim-resumen')).toContainText('1 listo(s) para crear');
    await expect(modal.getByText('Ya es la #321')).toBeVisible();
    await expect(modal.getByText('Se asigna a: María Camila').first()).toBeVisible();
    expect(creadas).toHaveLength(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/03-simulacion.png` });

    // La sugerencia por palabra clave fija categoría y proceso de la fila 1 (editable).
    await expect(modal.getByTestId('correo-sim-categoria').first()).toHaveValue('Jurídica');
    // Completar la fila 2: categoría → proceso (cascada, como «Nueva solicitud») y solicitante; incluirla.
    const fila2 = modal.getByTestId('correo-sim-fila').nth(1);
    await expect(fila2.getByTestId('correo-sim-proceso')).toBeDisabled();
    await fila2.getByTestId('correo-sim-categoria').click();
    await expect(page.getByRole('option', { name: 'Tesorería' })).toBeVisible();
    await page.getByRole('option', { name: 'Jurídica' }).click();
    await fila2.getByTestId('correo-sim-proceso').click();
    await expect(page.getByRole('option', { name: /Solicitud de Pago/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Solicitud de poderes/ }).click();
    await fila2.getByTestId('correo-sim-solicitante').fill('Usuario');
    await page.getByRole('option', { name: /Usuario Dos/ }).click();
    await fila2.getByTestId('correo-sim-incluir').check();
    await expect(modal.getByTestId('correo-sim-crear')).toHaveText(/Crear 2 solicitudes/);
    await modal.getByTestId('correo-sim-titulo').first().fill('Contrato arrendamiento bodega');
    await modal.getByTestId('correo-sim-crear').click();
    await expect(modal.getByTestId('correo-sim-resultado')).toContainText('Se crearon 2 de 2 solicitudes');
    await expect(modal.getByRole('link', { name: 'Solicitud #701' })).toHaveAttribute('href', /view-request\?id=701/);
    expect(creadas).toHaveLength(2);
    expect(creadas[0]).toMatchObject({ titulo: 'Contrato arrendamiento bodega', idProcess: 10, idSolicitante: 'u1', adjuntosIds: ['ADJ-1AAAA'], etiquetar: true });
    expect(creadas[1]).toMatchObject({ idProcess: 20, idSolicitante: 'u2' });
    expect(JSON.stringify(creadas)).not.toMatch(/"idUser"|"mailbox"/);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/04-resultado.png` });
  });

  test('acuse en el hilo: casilla global «a todos», vista previa, externos incluidos y «Reintentar respuesta»', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    // Fila 2 de un remitente EXTERNO ya completa (sin solicitante sería excluida de todos modos).
    const filasAcuse = [
      filas[0],
      { ...filas[1], remitente: { nombre: 'Asesor', correo: 'asesor@externo-ejemplo.com' }, idProcess: 20, idSolicitante: 'u2', solicitanteNombre: 'Usuario Dos', alertas: ['EXTERNO'], incluir: true },
    ];
    await page.route('**/api/correo/simular', (r) => {
      return r.fulfill({ json: { filas: filasAcuse, categorias: [{ id: 5, categoria: 'Jurídica' }], procesos: [{ id: 10, nombre: 'Elaboración y revisión de contratos', idCategoria: 5, categoria: 'Jurídica' }, { id: 20, nombre: 'Solicitud de poderes', idCategoria: 5, categoria: 'Jurídica' }] } });
    });
    const creadas: Array<Record<string, unknown>> = [];
    await page.route('**/api/correo/crear', (r) => {
      const body = r.request().postDataJSON();
      creadas.push(body);
      const id = 800 + creadas.length;
      const acuse = creadas.length === 1 ? { estado: 'ERROR', idRequest: id, mensaje: 'Graph 503' } : { estado: 'ENVIADO', idRequest: id, para: ['asesor@externo-ejemplo.com'] };
      return r.fulfill({ status: 201, json: { conversationId: body.conversationId, ok: true, idRequest: id, adjuntosSubidos: 0, adjuntosFallidos: [], etiquetado: true, acuse } });
    });
    const reintentos: Array<Record<string, unknown>> = [];
    await page.route('**/api/correo/acuse', (r) => {
      reintentos.push(r.request().postDataJSON());
      return r.fulfill({ json: { acuse: { estado: 'ENVIADO', idRequest: 801, para: ['uno@gsslatam.com'] } } });
    });

    await page.goto('/process/correo');
    await page.getByTestId('correo-seleccionar').first().check();
    await page.getByTestId('correo-simular').click();
    const modal = page.getByTestId('correo-simulacion');
    await expect(modal.getByTestId('correo-sim-fila')).toHaveCount(2);
    // «Informar en el hilo a todos los participantes»: encendida por defecto, en todas las filas.
    await expect(modal.getByTestId('correo-sim-acuse-global')).toBeChecked();
    const chk = modal.getByTestId('correo-sim-acuse-fila');
    await expect(chk.nth(0)).toBeChecked();
    await expect(chk.nth(1)).toBeChecked();
    // Vista previa del texto (global).
    await modal.getByTestId('correo-sim-acuse-ver-global').click();
    // Vista previa = la plantilla HTML del correo, en un iframe aislado (como el visor del hilo).
    const previa = modal.getByTestId('correo-sim-acuse-previa-global').locator('iframe').contentFrame().locator('body');
    await expect(previa).toContainText('Se creó una solicitud a partir de este correo');
    await expect(previa).toContainText('#(número)');
    await expect(previa).toContainText('Revisión de contrato de arrendamiento');
    await expect(previa).toContainText('Jurídica · Elaboración y revisión de contratos');
    await expect(previa).toContainText('GROUP SHARED SERVICES');
    await expect(previa.getByRole('link', { name: 'Ver solicitud en SynerLink' })).toHaveAttribute('href', /\/process\/request-general\/view-request\?id=N/);
    await expect(previa).toContainText('respondan a este mismo correo y quedará como nota de la solicitud');
    await expect(previa).toContainText('Laura');
    await expect(previa).toContainText('Group Shared Services Latinoamérica');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/07-acuse-previa.png` });
    // Apagar la global apaga todas; encenderla las vuelve a encender.
    const global = modal.getByText('Informar en el hilo a todos los participantes', { exact: true });
    await global.click();
    await expect(modal.getByTestId('correo-sim-acuse-global')).not.toBeChecked();
    await expect(chk.nth(0)).not.toBeChecked();
    await global.click();
    await expect(chk.nth(0)).toBeChecked();
    await expect(chk.nth(1)).toBeChecked();
    await modal.getByTestId('correo-sim-crear').click();
    await expect(modal.getByTestId('correo-sim-resultado')).toContainText('Se crearon 2 de 2 solicitudes');
    // Siempre «Responder a todos» (con externos incluidos).
    expect(creadas[0].acuse).toEqual({ enviar: true, todos: true, confirmarExterno: true });
    expect(creadas[1].acuse).toEqual({ enviar: true, todos: true, confirmarExterno: true });
    // Falló el envío de la 801: la solicitud existe, aviso + «Reintentar respuesta».
    await expect(modal.getByTestId('correo-sim-acuse-aviso')).toContainText('La solicitud quedó creada');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/08-acuse-aviso.png` });
    await modal.getByTestId('correo-sim-reintentar-acuse').click();
    await expect(modal.getByTestId('correo-sim-acuse-aviso')).toHaveCount(0);
    await expect(modal.getByText('informado en el hilo a todos')).toHaveCount(2);
    expect(reintentos).toEqual([{ conversationId: 'CONV-01AAAA', todos: true, confirmarExterno: true }]);
  });

  test('«Informar en el hilo» en una solicitud ya creada: vista previa, envío a todos y luego «Informado el …»', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page);
    let enviado: string | null = null;
    const vinculo = { id: 9, conversationId: 'CONV-01AAAA', idRequest: 321, asunto: 'Revisión de contrato de arrendamiento', creadoEn: '2026-10-10T12:00:00Z', origen: 'CREADA' };
    await page.route('**/api/correo/hilo?**', (r) => r.fulfill({ json: { hilo: { ...hilo, vinculo: { ...vinculo, lastSyncedAt: null, acuseEnviadoEn: enviado } } } }));
    const informes: Array<Record<string, unknown>> = [];
    await page.route('**/api/correo/acuse', (r) => {
      informes.push(r.request().postDataJSON());
      enviado = '2026-10-15T19:40:00Z';
      return r.fulfill({ json: { acuse: { estado: 'ENVIADO', idRequest: 321, para: ['uno@gsslatam.com'] } } });
    });
    await page.goto('/process/correo');
    await page.getByTestId('correo-fila').first().click();
    const drawer = page.getByTestId('correo-hilo');
    await expect(drawer.getByTestId('correo-hilo-vinculo')).toBeVisible();
    await drawer.getByTestId('correo-hilo-informar').click();
    const previa = drawer.getByTestId('correo-hilo-informar-previa').locator('iframe').contentFrame().locator('body');
    await expect(previa).toContainText('Se creó una solicitud a partir de este correo');
    await expect(previa).toContainText('#321');
    await expect(previa).toContainText('Revisión de contrato de arrendamiento');
    await expect(previa.getByRole('link', { name: 'Ver solicitud en SynerLink' })).toHaveAttribute('href', /view-request\?id=321/);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/09-informar-hilo.png` });
    await drawer.getByTestId('correo-hilo-informar-enviar').click();
    await expect(drawer.getByTestId('correo-hilo-resultado')).toContainText('Se informó en el hilo a todos los participantes');
    expect(informes).toEqual([{ conversationId: 'CONV-01AAAA', todos: true, confirmarExterno: true }]);
    await expect(drawer.getByTestId('correo-hilo-informado')).toBeDisabled();
    await expect(drawer.getByTestId('correo-hilo-informado')).toContainText('Informado el');
    await expect(drawer.getByTestId('correo-hilo-informar')).toHaveCount(0);
  });

  test('acuse: sin CORREO_ENVIO_HABILITADO no se ofrece ni se pide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { creadas } = await simular(page);
    await page.route('**/api/correo', (r) =>
      r.fulfill({
        json: {
          usuario: { id: 'u-op', nombre: 'Laura', email: 'laura@gsslatam.com' },
          empresas: [{ idCompany: 1, companyName: 'GROUP SHARED SERVICES' }],
          conexion: { modo: 'graph', disponible: true, correo: 'laura@gsslatam.com', envioHabilitado: false, etiquetarHabilitado: true, sincronizacionAutomatica: false },
        },
      })
    );
    await page.goto('/process/correo');
    await page.getByTestId('correo-seleccionar').first().check();
    await page.getByTestId('correo-simular').click();
    const modal = page.getByTestId('correo-simulacion');
    await expect(modal.getByTestId('correo-sim-acuse-deshabilitado')).toBeVisible();
    await expect(modal.getByTestId('correo-sim-acuse-fila')).toHaveCount(0);
    await modal.getByTestId('correo-sim-crear').click();
    await expect(modal.getByTestId('correo-sim-resultado')).toBeVisible();
    expect((creadas[0] as { acuse: { enviar: boolean } }).acuse.enviar).toBe(false);
  });

  test('celular: lista primero, carpetas en panel, hilo a pantalla completa y simulación en tarjetas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    await expect(page.locator('table[data-testid="correo-lista"]')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/05-movil-bandeja.png` });
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(390 + 1);
    // Carpetas en un panel lateral.
    await page.getByTestId('correo-menu-carpetas').click();
    const panel = page.getByTestId('correo-carpetas-drawer');
    await expect(panel.getByTestId('correo-carpeta')).toHaveText([/Recibidos\s*1/, /Enviados/, /Borradores\s*2/]);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/05b-movil-carpetas.png` });
    await page.keyboard.press('Escape');
    await expect(panel.getByTestId('correo-carpeta')).toHaveCount(0);
    // Hilo a pantalla completa con ← arriba y Responder abajo (sin buscador encima).
    await page.getByTestId('correo-fila').first().click();
    const hiloMovil = page.getByTestId('correo-hilo');
    await expect(hiloMovil.getByTestId('correo-responder-btn')).toBeVisible();
    await expect(hiloMovil.getByTestId('correo-hilo-volver')).toBeVisible();
    await expect(page.getByTestId('correo-buscar')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390 + 1);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/05c-movil-hilo.png` });
    // El «atrás» del navegador (o del celular) vuelve a la lista.
    await page.goBack();
    await expect(page.getByTestId('correo-hilo')).toHaveCount(0);
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    // Tocar el avatar selecciona (como en la app de Gmail).
    await page.getByTestId('correo-seleccionar').first().check();
    await page.getByTestId('correo-simular').click();
    await expect(page.getByTestId('correo-sim-tarjetas')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/06-movil-simulacion.png` });
  });

  test('estilo Gmail: carpetas con no leídos, buscador, chips de filtro y acciones al pasar el mouse', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { consultas } = await simular(page);
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    // Carpetas: Recibidos primero (activa, con 1 no leído), Enviados, Borradores (total); la de salida se oculta.
    const carpetas = page.getByTestId('correo-carpeta');
    await expect(carpetas).toHaveText([/Recibidos\s*1/, /Enviados/, /Borradores\s*2/]);
    await expect(carpetas.first()).toHaveAttribute('data-activa', '1');
    // Fila densa: no leído en negrita, asunto + extracto en una línea, clip y fecha a la derecha.
    const primera = page.getByTestId('correo-fila').first();
    await expect(primera).toHaveAttribute('data-leido', '0');
    await expect(primera).toContainText('Revisión de contrato de arrendamiento — Adjunto el contrato para revisión');
    await expect(primera.getByLabel('Con adjuntos')).toBeVisible();
    // Al pasar el mouse aparecen «Abrir» y «Convertir en solicitud».
    await expect(primera.getByTestId('correo-fila-crear')).toBeHidden();
    await primera.hover();
    await expect(primera.getByTestId('correo-fila-crear')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/10-bandeja-hover.png` });
    // Chips: «No leídos» filtra de una vez.
    await page.getByTestId('correo-chips').getByText('No leídos').click();
    await expect.poll(() => consultas.at(-1)?.get('noLeidos')).toBe('1');
    // Buscador: Enter aplica y deja un chip quitable.
    await page.getByTestId('correo-buscar').fill('contrato');
    await page.getByTestId('correo-buscar').press('Enter');
    await expect.poll(() => consultas.at(-1)?.get('buscar')).toBe('contrato');
    await expect(page.getByTestId('correo-chip-activo')).toContainText('«contrato»');
    // Opciones de búsqueda (De / fechas) en el desplegable del buscador.
    await page.getByTestId('correo-mas-filtros').click();
    await page.getByTestId('correo-filtros').getByLabel('De', { exact: true }).fill('uno@gsslatam.com');
    await page.getByTestId('correo-aplicar').click();
    await expect.poll(() => consultas.at(-1)?.get('de')).toBe('uno@gsslatam.com');
    // Carpeta Enviados.
    await carpetas.nth(1).click();
    await expect.poll(() => consultas.at(-1)?.get('carpeta')).toBe('FOLDER-SENTAAAA');
    await expect(carpetas.nth(1)).toHaveAttribute('data-activa', '1');
    // Selección → barra con «Simular / Crear solicitudes»; la acción de la fila abre la simulación de ese correo.
    await page.getByTestId('correo-seleccionar').nth(1).check();
    await expect(page.getByTestId('correo-barra-seleccion')).toContainText('1 correo(s)');
    await expect(page.getByTestId('correo-simular')).toHaveText('Simular / Crear solicitudes');
    if (CAPTURAS) {
      await page.screenshot({ path: `${CAPTURAS}/11-bandeja-seleccion.png` });
      // Misma pantalla en modo oscuro (tokens de Mantine, sin colores en duro).
      await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${CAPTURAS}/13-bandeja-oscuro.png` });
      await page.getByRole('button', { name: 'Activar modo claro' }).click();
    }
    await page.getByTestId('correo-seleccionar').nth(1).uncheck();
    await primera.hover();
    await primera.getByTestId('correo-fila-crear').click();
    await expect(page.getByTestId('correo-simulacion').getByTestId('correo-sim-fila')).toHaveCount(3);
  });

  test('hilo estilo Gmail: anteriores plegados en una línea, el último desplegado, detalles y adjuntos en fichas', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simular(page);
    const largo = {
      ...hilo,
      mensajes: [
        { ...hilo.mensajes[0], id: 'MSG-0010AAAA', leido: true, adjuntos: [], remotasBloqueadas: 0, html: '<p>Primer mensaje del hilo con el contexto.</p>', fecha: '2026-10-13T14:00:00Z' },
        { ...hilo.mensajes[0], id: 'MSG-0011AAAA', leido: true, adjuntos: [], remotasBloqueadas: 0, de: { nombre: 'Laura', correo: 'laura@gsslatam.com' }, para: [mensajes[0].de], html: '<p>Respuesta intermedia de <b>Laura</b>.</p>', fecha: '2026-10-14T14:00:00Z' },
        { ...hilo.mensajes[0], cc: [{ nombre: 'Usuario Dos', correo: 'dos@onelatampharma.com' }], leido: true },
      ],
    };
    await page.route('**/api/correo/hilo?**', (r) => r.fulfill({ json: { hilo: largo } }));
    await page.goto('/process/correo');
    await page.getByTestId('correo-fila').first().click();
    const drawer = page.getByTestId('correo-hilo');
    await expect(drawer.getByTestId('correo-hilo-asunto')).toHaveText('Revisión de contrato de arrendamiento');
    const msgs = drawer.getByTestId('correo-hilo-mensaje');
    await expect(msgs).toHaveCount(3);
    await expect(msgs.nth(0)).toHaveAttribute('data-abierto', '0');
    await expect(msgs.nth(0).getByTestId('correo-hilo-extracto')).toHaveText('Primer mensaje del hilo con el contexto.');
    await expect(msgs.nth(2)).toHaveAttribute('data-abierto', '1');
    await expect(drawer.getByTestId('correo-cuerpo')).toHaveCount(1);
    await expect(msgs.nth(2)).toContainText('para mí, cc Usuario Dos');
    await msgs.nth(2).getByTestId('correo-hilo-detalles').click();
    await expect(msgs.nth(2).getByTestId('correo-hilo-detalles-panel')).toContainText('dos@onelatampharma.com');
    await expect(msgs.nth(2).getByTestId('correo-adjunto')).toContainText('contrato.pdf');
    // Desplegar uno anterior.
    await msgs.nth(0).getByTestId('correo-hilo-mensaje-cabecera').click();
    await expect(msgs.nth(0)).toHaveAttribute('data-abierto', '1');
    await expect(drawer.getByTestId('correo-cuerpo')).toHaveCount(2);
    // Varios destinatarios: «Responder a todos» abre el editor en modo a todos.
    await drawer.getByTestId('correo-responder-todos-btn').click();
    await expect(drawer.getByTestId('correo-responder-para')).toHaveText('Responder a todos');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/12-hilo-plegado.png` });
    await drawer.getByTestId('correo-respuesta-descartar').click();
    await expect(drawer.getByTestId('correo-responder')).toHaveCount(0);
  });

  test('hilo en el lugar de la lista: enlace ?hilo= compartible, leído/no leído, Abrir en Outlook y vincular desde la barra', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simular(page);
    const marcas: unknown[] = [];
    const vinculos: unknown[] = [];
    let leidoActual = false;
    const enlaceOutlook = 'https://outlook.office365.com/owa/?ItemID=MSG-0001AAAA&exvsurl=1&viewmodel=ReadMessageItem';
    await page.route('**/api/correo/hilo?**', (r) => r.fulfill({ json: { hilo: { ...hilo, mensajes: [{ ...hilo.mensajes[0], leido: leidoActual, enlaceOutlook }] } } }));
    await page.route('**/api/correo/hilo/leido', (r) => {
      const body = r.request().postDataJSON();
      marcas.push(body);
      leidoActual = body.leido;
      return r.fulfill({ json: { cambiados: 1 } });
    });
    await page.route('**/api/correo/hilo/vincular', (r) => {
      vinculos.push(r.request().postDataJSON());
      return r.fulfill({ status: 201, json: { vinculo: { id: 1, conversationId: 'CONV-01AAAA', idRequest: 55, asunto: hilo.asunto, creadoEn: '2026-10-16T14:00:00Z', origen: 'VINCULADA' } } });
    });
    // Enlace directo (p. ej. desde una solicitud): abre el hilo sin pasar por la lista.
    await page.goto('/process/correo?hilo=CONV-01AAAA');
    const vista = page.getByTestId('correo-hilo');
    await expect(vista.getByTestId('correo-hilo-asunto')).toHaveText('Revisión de contrato de arrendamiento');
    await expect(vista.getByTestId('correo-hilo-outlook')).toHaveAttribute('href', /^https:\/\/outlook\.office365\.com\//);
    await expect(vista.getByTestId('correo-hilo-outlook')).toHaveAttribute('target', '_blank');
    // Al abrir el hilo sin leer se marca como leído solo (como Gmail): el botón ya ofrece «no leído».
    await expect(vista.getByTestId('correo-hilo-leido')).toHaveAttribute('aria-label', 'Marcar como no leído');
    await expect.poll(() => marcas).toEqual([{ conversationId: 'CONV-01AAAA', leido: true }]);
    // Vincular desde la barra (ícono de enlace → número).
    await vista.getByTestId('correo-hilo-vincular-btn').click();
    await page.getByTestId('correo-hilo-vincular-panel').getByLabel('Número de la solicitud existente').fill('55');
    await page.getByTestId('correo-hilo-vincular').click();
    await expect(vista.getByTestId('correo-hilo-resultado')).toContainText('Hilo vinculado a la solicitud #55');
    expect(vinculos).toHaveLength(1);
    // «No leído» deja el último sin leer y vuelve a la lista, como Gmail.
    await vista.getByTestId('correo-hilo-leido').click();
    expect(marcas.at(-1)).toEqual({ conversationId: 'CONV-01AAAA', leido: false });
    await expect(page.getByTestId('correo-hilo')).toHaveCount(0);
    await expect(page).not.toHaveURL(/hilo=/);
    await expect(page.getByTestId('correo-fila').first()).toHaveAttribute('data-leido', '0');
    // Pantalla completa: la página no se desplaza; la lista lo hace por dentro.
    const desborde = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(desborde).toBeLessThanOrEqual(1);
  });

  test('leído masivo: selección, «Seleccionar los N de esta carpeta», «Marcar todo» por lotes con avance, contadores optimistas y reversión', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simular(page);
    // Buzón simulado con estado: la carpeta y el icono de la cabecera reflejan lo que se marca.
    const bandeja = { total: 600, noLeidos: 450 };
    await page.route('**/api/correo/no-leidos', (r) => r.fulfill({ json: { noLeidos: bandeja.noLeidos } }));
    await page.route('**/api/correo/carpetas', (r) =>
      r.fulfill({ json: { carpetas: [{ id: 'FOLDER-INBOXAAAA', nombre: 'Bandeja de entrada', ...bandeja }, { id: 'FOLDER-SENTAAAA', nombre: 'Elementos enviados', total: 12, noLeidos: 0 }] } })
    );
    await page.route('**/api/correo/mensajes**', (r) => r.fulfill({ json: { mensajes, siguiente: 'PAG2' } }));
    const seleccionados: Array<{ mensajesIds: string[]; leido: boolean }> = [];
    let fallar = false;
    await page.route('**/api/correo/leido', async (r) => {
      const b = r.request().postDataJSON();
      seleccionados.push(b);
      await new Promise((x) => setTimeout(x, 300));
      if (fallar) return r.fulfill({ status: 502, json: { error: 'Microsoft respondió con un error (503).' } });
      bandeja.noLeidos -= b.leido ? 1 : -1;
      return r.fulfill({ json: { cambiados: b.mensajesIds.length, fallidos: 0 } });
    });
    const lotes: unknown[] = [];
    await page.route('**/api/correo/leido/carpeta', async (r) => {
      lotes.push(r.request().postDataJSON());
      await new Promise((x) => setTimeout(x, 400));
      const n = Math.min(200, bandeja.noLeidos);
      bandeja.noLeidos -= n;
      return r.fulfill({ json: { cambiados: n, fallidos: 0, restantes: bandeja.noLeidos } });
    });
    await page.goto('/process/correo');
    const filas = page.getByTestId('correo-fila');
    await expect(filas).toHaveCount(3);
    const recibidos = page.getByTestId('correo-carpeta').first();
    await expect(recibidos).toHaveText(/Recibidos\s*450/);
    const icono = page.getByTestId('header-correo');
    await expect(icono).toHaveAttribute('aria-label', 'Correo: 450 sin leer');

    // 1) Dos seleccionados → «Marcar como leído»: negrita y contadores cambian YA (antes de que responda Graph).
    await page.getByTestId('correo-seleccionar').nth(0).check();
    await page.getByTestId('correo-seleccionar').nth(1).check();
    await page.getByTestId('correo-sel-leido').click();
    await expect(filas.nth(0)).toHaveAttribute('data-leido', '1');
    await expect(recibidos).toHaveText(/Recibidos\s*449/);
    await expect(icono).toHaveAttribute('aria-label', 'Correo: 449 sin leer');
    await expect.poll(() => seleccionados.at(-1)).toEqual({ mensajesIds: ['MSG-0001AAAA', 'MSG-0002AAAA'], leido: true });
    await expect(page.getByTestId('correo-barra-seleccion')).toHaveCount(0);

    // 2) Si Microsoft falla, se revierte: la fila vuelve a estar leída y el contador a 449.
    fallar = true;
    await page.getByTestId('correo-seleccionar').nth(1).check();
    await page.getByTestId('correo-sel-no-leido').click();
    await expect(filas.nth(1)).toHaveAttribute('data-leido', '0');
    await expect(recibidos).toHaveText(/Recibidos\s*450/);
    await expect(filas.nth(1)).toHaveAttribute('data-leido', '1');
    await expect(recibidos).toHaveText(/Recibidos\s*449/);
    await expect(icono).toHaveAttribute('aria-label', 'Correo: 449 sin leer');
    fallar = false;
    await page.getByTestId('correo-seleccionar').nth(1).uncheck();

    // 3) «Seleccionar todo» de la página → aviso de Gmail → toda la carpeta → «Marcar como leído» por lotes con avance.
    await page.getByTestId('correo-seleccionar-todos').check();
    const aviso = page.getByTestId('correo-aviso-seleccion');
    await expect(aviso).toContainText('Se seleccionaron los 3 correos de esta página.');
    await aviso.getByTestId('correo-seleccionar-carpeta').click();
    await expect(aviso).toContainText('Se seleccionaron los 600 correos de Recibidos.');
    await expect(page.getByTestId('correo-seleccion-texto')).toHaveText('Todos los 600 correos de Recibidos');
    await expect(page.getByTestId('correo-simular')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/17-seleccion-carpeta.png` });
    await page.getByTestId('correo-sel-leido').click();
    const progreso = page.getByTestId('correo-marcado-progreso');
    await expect(progreso).toContainText('de 449');
    await expect(progreso).toContainText('200 de 449');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/18-marcando-carpeta.png` });
    await expect(progreso).toHaveCount(0, { timeout: 10_000 });
    expect(lotes).toEqual([
      { carpeta: null, leido: true },
      { carpeta: null, leido: true },
      { carpeta: null, leido: true },
    ]);
    await expect(recibidos).toHaveText(/^Recibidos$/);
    await expect(icono).toHaveAttribute('aria-label', 'Correo');
    for (const f of await filas.all()) await expect(f).toHaveAttribute('data-leido', '1');

    // 4) «Marcar todo como leído» en una carpeta grande pide confirmación (y cancelar no marca nada).
    bandeja.noLeidos = 900;
    await page.getByTestId('correo-actualizar').click();
    await expect(recibidos).toHaveText(/Recibidos\s*900/);
    await page.getByTestId('correo-marcar-todo').click();
    const confirmar = page.getByTestId('correo-confirmar-marcado');
    await expect(confirmar).toContainText('Va a marcar 900 correos de Recibidos como leídos');
    await confirmar.getByRole('button', { name: 'Cancelar' }).click();
    expect(lotes).toHaveLength(3);
  });

  test('carga: al cambiar de carpeta salen esqueletos al instante, sin filas viejas, y gana la última respuesta', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simular(page);
    const enviados = [{ ...mensajes[1], id: 'MSG-SENT1AAAA', conversationId: 'CONV-S1AAAA', asunto: 'Respuesta enviada a proveedor', leido: true }];
    const borradores = [{ ...mensajes[1], id: 'MSG-DRAFT1AAAA', conversationId: 'CONV-D1AAAA', asunto: 'Borrador de acta', leido: true }];
    const retraso = (ms: number) => new Promise((x) => setTimeout(x, ms));
    // Graph simulado con respuestas LENTAS: Enviados tarda 1,5 s; Borradores 300 ms; «Cargar más» 1 s.
    await page.route('**/api/correo/mensajes**', async (r) => {
      const q = new URL(r.request().url()).searchParams;
      const carpeta = q.get('carpeta');
      if (carpeta === 'FOLDER-SENTAAAA') {
        await retraso(1500);
        return r.fulfill({ json: { mensajes: enviados, siguiente: null } }).catch(() => undefined);
      }
      if (carpeta === 'FOLDER-DRAFTSAAAA') {
        await retraso(300);
        return r.fulfill({ json: { mensajes: borradores, siguiente: null } }).catch(() => undefined);
      }
      if (q.get('cursor')) {
        await retraso(1000);
        return r.fulfill({ json: { mensajes: [{ ...mensajes[2], id: 'MSG-0004AAAA', asunto: 'Correo de la página 2' }], siguiente: null } });
      }
      return r.fulfill({ json: { mensajes, siguiente: 'PAG2' } });
    });
    // Carpetas lentas: mientras tanto, la forma de la lista de carpetas (no un «Recibidos» suelto).
    await page.route('**/api/correo/carpetas', async (r) => {
      await retraso(800);
      return r.fulfill({
        json: {
          carpetas: [
            { id: 'FOLDER-INBOXAAAA', nombre: 'Bandeja de entrada', total: 3, noLeidos: 1 },
            { id: 'FOLDER-SENTAAAA', nombre: 'Elementos enviados', total: 12, noLeidos: 0 },
            { id: 'FOLDER-DRAFTSAAAA', nombre: 'Borradores', total: 2, noLeidos: 0 },
          ],
        },
      });
    });
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-carpetas-esqueleto')).toBeVisible();
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    const carpetas = page.getByTestId('correo-carpeta');
    await expect(carpetas).toHaveText([/Recibidos\s*1/, /Enviados/, /Borradores\s*2/]);
    await expect(page.getByTestId('correo-carpetas-esqueleto')).toHaveCount(0);

    // Recibidos → Enviados: en el mismo instante, Enviados marcada, esqueletos y NINGUNA fila de Recibidos.
    await carpetas.nth(1).click();
    await expect(carpetas.nth(1)).toHaveAttribute('data-activa', '1');
    await expect(carpetas.nth(0)).toHaveAttribute('data-activa', '0');
    const esqueleto = page.getByTestId('correo-esqueleto');
    await expect(esqueleto).toBeVisible();
    await expect(esqueleto.locator('.mantine-Skeleton-root')).not.toHaveCount(0);
    await expect(page.getByTestId('correo-fila')).toHaveCount(0);
    await expect(page.getByText('Revisión de contrato de arrendamiento')).toHaveCount(0);
    await expect(page.getByTestId('correo-vacio')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/14-esqueleto-carpeta.png` });

    // Carrera: antes de que llegue Enviados (1,5 s) se elige Borradores (300 ms). Gana Borradores y se queda.
    await carpetas.nth(2).click();
    await expect(page.getByTestId('correo-fila')).toHaveText([/Borrador de acta/]);
    await expect(esqueleto).toHaveCount(0);
    await page.waitForTimeout(1600);
    await expect(page.getByTestId('correo-fila')).toHaveText([/Borrador de acta/]);
    await expect(page.getByText('Respuesta enviada a proveedor')).toHaveCount(0);
    await expect(carpetas.nth(2)).toHaveAttribute('data-activa', '1');

    // «Cargar más»: las filas se quedan y los esqueletos salen al final.
    await carpetas.nth(0).click();
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    await page.getByTestId('correo-cargar-mas').click();
    await expect(page.getByTestId('correo-esqueleto')).toBeVisible();
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    await expect(page.getByTestId('correo-fila')).toHaveCount(4);

    // Abrir un hilo lento: esqueleto del hilo en el panel hasta que llega.
    await page.route('**/api/correo/hilo?**', async (r) => {
      await retraso(800);
      return r.fulfill({ json: { hilo } });
    });
    await page.getByTestId('correo-fila').first().click();
    const drawer = page.getByTestId('correo-hilo');
    await expect(drawer.getByTestId('correo-hilo-esqueleto')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/15-esqueleto-hilo.png` });
    await expect(drawer.getByTestId('correo-hilo-mensaje')).toHaveCount(1);
    await expect(drawer.getByTestId('correo-hilo-esqueleto')).toHaveCount(0);
  });

  test('carga en el celular: esqueletos en forma de tarjeta y sin brillo con «reducir movimiento»', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await simular(page);
    await page.route('**/api/correo/mensajes**', async (r) => {
      const carpeta = new URL(r.request().url()).searchParams.get('carpeta');
      if (carpeta === 'FOLDER-SENTAAAA') await new Promise((x) => setTimeout(x, 1500));
      return r.fulfill({ json: { mensajes: carpeta ? [] : mensajes, siguiente: null } });
    });
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    await page.getByTestId('correo-menu-carpetas').click();
    await page.getByTestId('correo-carpetas-drawer').getByTestId('correo-carpeta').nth(1).click();
    const esqueleto = page.getByTestId('correo-esqueleto');
    await expect(esqueleto).toBeVisible();
    await expect(page.getByTestId('correo-fila')).toHaveCount(0);
    // Tarjeta de celular: avatar redondo + tres renglones.
    await expect(esqueleto.locator('.mantine-Skeleton-root[data-animate]')).toHaveCount(0);
    await expect(esqueleto.locator('.mantine-Skeleton-root')).not.toHaveCount(0);
    if (CAPTURAS) {
      await expect(page.getByTestId('correo-carpetas-drawer').getByTestId('correo-carpeta')).toHaveCount(0);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${CAPTURAS}/16-esqueleto-movil.png` });
    }
    await expect(page.getByTestId('correo-vacio')).toBeVisible();
  });
});

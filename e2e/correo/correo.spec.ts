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
  await page.route('**/api/correo/carpetas', (r) => r.fulfill({ json: { carpetas: [{ id: 'FOLDER-INBOXAAAA', nombre: 'Bandeja de entrada', total: 3, noLeidos: 1 }] } }));
  await page.route('**/api/correo/mensajes**', (r) => r.fulfill({ json: { mensajes, siguiente: null } }));
  await page.route('**/api/correo/hilo?**', (r) => r.fulfill({ json: { hilo } }));
  await page.route('**/api/correo/responder', (r) => {
    respuestas.push(r.request().postData() ?? '');
    return r.fulfill({ json: { ok: true, notaEnSolicitud: null } });
  });
  await page.route('**/api/correo/simular', (r) => r.fulfill({ json: { filas, procesos: [{ id: 10, nombre: 'Elaboración y revisión de contratos', categoria: 'Jurídica', responsables: ['María Camila'] }, { id: 20, nombre: 'Solicitud de poderes', categoria: 'Jurídica' }] } }));
  await page.route('**/api/correo/usuarios**', (r) => r.fulfill({ json: { usuarios: [{ id: 'u2', nombre: 'Usuario Dos', correo: 'dos@onelatampharma.com' }] } }));
  await page.route('**/api/correo/crear', async (r) => {
    const body = r.request().postDataJSON();
    creadas.push(body);
    await new Promise((x) => setTimeout(x, 150));
    return r.fulfill({ status: 201, json: { conversationId: body.conversationId, ok: true, idRequest: 700 + creadas.length, adjuntosSubidos: body.adjuntosIds.length, adjuntosFallidos: [], etiquetado: true } });
  });
  return { creadas, respuestas };
}

test.describe('Correo · sin sesión', () => {
  test('todas las APIs del módulo responden 401', async ({ request }) => {
    for (const ruta of ['/api/correo', '/api/correo/carpetas', '/api/correo/mensajes', '/api/correo/hilo?id=CONV-01AAAA', '/api/correo/adjunto?mensaje=a&adjunto=b', '/api/correo/usuarios?empresa=1', '/api/correo/vinculos?solicitud=1', '/api/correo/procesos?empresa=1']) {
      expect((await request.get(ruta, { maxRedirects: 0 })).status(), ruta).toBe(401);
    }
    for (const ruta of ['/api/correo/simular', '/api/correo/crear', '/api/correo/hilo/notas', '/api/correo/hilo/vincular', '/api/correo/responder']) {
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
    const { creadas, respuestas } = await simular(page);
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
    await expect(drawer.getByTestId('correo-hilo-sin-vinculo')).toBeVisible();
    await drawer.getByTestId('correo-respuesta-texto').fill('Recibido, lo reviso hoy.');
    await drawer.getByTestId('correo-respuesta-enviar').click();
    await expect(drawer.getByTestId('correo-hilo-resultado')).toContainText('Respuesta enviada desde su buzón');
    expect(respuestas[0]).toContain('Recibido, lo reviso hoy.');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/02-hilo.png` });
    await page.keyboard.press('Escape');

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

    // Completar la fila 2: proceso y solicitante; incluirla.
    const fila2 = modal.getByTestId('correo-sim-fila').nth(1);
    await fila2.getByTestId('correo-sim-proceso').click();
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

  test('celular: bandeja en tarjetas, hilo a pantalla completa y simulación en tarjetas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/process/correo');
    await expect(page.getByTestId('correo-fila')).toHaveCount(3);
    await expect(page.locator('table[data-testid="correo-lista"]')).toHaveCount(0);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/05-movil-bandeja.png` });
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(390 + 1);
    await page.getByTestId('correo-seleccionar').first().check();
    await page.getByTestId('correo-simular').click();
    await expect(page.getByTestId('correo-sim-tarjetas')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/06-movil-simulacion.png` });
  });
});

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Hoja de vida completa del agente (incremento 1, 2026-10-20).
 *
 * - Sin sesión: el API de la ficha responde 401.
 * - Con sesión (JWT firmado con el NEXTAUTH_SECRET de la CI) y el API SIMULADO
 *   con `page.route`: se ven identificación ampliada (director, caso de Gobierno
 *   IA, credencial por huella, arranque), calidad de respuesta, gobierno vigente
 *   con el texto del bloque, casos vinculados con sus tareas y hallazgos de
 *   Gobierno IA. Con el permiso de configurar se edita el gobierno y el aviso
 *   sale ARRIBA y con color; un error se queda dentro del formulario.
 * - En el celular no hay desborde horizontal.
 * - Con CAPTURAS_DIR deja las capturas de escritorio y celular (evidencia del PR).
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const CAPTURAS = process.env.CAPTURAS_DIR;

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({
    secret: SECRET!,
    token: { email: 'auditor.pruebas@gsslatam.com', name: 'Auditor de Pruebas', sub: 'u-qa', kronosUserId: 'u-qa', role: 'user' },
  });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

const dia = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

function ficha(puedeConfigurar: boolean) {
  const totales = {
    mensajesRecibidos: 46,
    mensajesEnviados: 52,
    conversaciones: 9,
    turnos: 0,
    tokensTotal: 0,
    tokensEntrada: 0,
    tokensSalida: 0,
    tokensCacheCreacion: 0,
    tokensCacheLectura: 0,
    diasActivos: 7,
    usuariosActivos: 2,
  };
  return {
    puedeConfigurar,
    agente: {
      idAgent: 38,
      code: 'galileo',
      displayName: 'Galileo',
      handle: null,
      description: 'Asistente de consulta de One Latam Pharma.',
      activo: true,
      creadoEl: '2026-09-30T15:00:00.000Z',
      permiso: 'Asistente Galileo',
      empresas: [{ nombre: 'ONE LATAM PHARMA', principal: true }],
      avatar: null,
    },
    perfil: {
      purpose: 'Responder consultas de su área y radicar solicitudes de conectores cuando le piden algo que no puede hacer.',
      ownerName: 'Dueña de Prueba',
      ownerEmail: 'duena.prueba@onelatampharma.com',
      updatedBy: 'auditor.pruebas@gsslatam.com',
      updatedAt: '2026-10-20T12:00:00.000Z',
    },
    usuarios: [
      { id: 'u1', nombre: 'Usuaria de Prueba', email: 'usuaria.prueba@onelatampharma.com', activo: true, empresas: ['ONE LATAM PHARMA'], asignado: true, mensajes: 40, mensajes30: 31, ultimoMensaje: '2026-10-19T20:00:00.000Z' },
    ],
    inventario: {
      scannedAt: '2026-10-20T07:30:08.000Z',
      kind: 'openclaw',
      host: 'Mac mini de Cosmo',
      location: '~/.openclaw · agente galileo',
      model: 'anthropic/claude-sonnet-5-5',
      serviceStatus: 'activo',
      execMode: 'restringido',
      execRequiresApproval: true,
      tools: { allow: ['read', 'write', 'web_fetch', 'synerlink-solicitud-galileo__kronos_request_ia_access'], deny: ['exec', 'browser', 'group:messaging'] },
      skills: ['procesos-olp'],
      channels: [{ type: 'synerlink', policy: 'lista-blanca', allowed: null, detail: 'Puente SynerLink ⇄ openclaw' }],
      scanError: null,
      mcps: [{ name: 'synerlink-solicitud-galileo', target: 'http://192.168.10.5:3020/mcp', transport: 'http', company: 'OneLATAM Pharma', access: 'escritura', auth: 'requerida', writeTools: 'kronos_request_ia_access' }],
    },
    metricas: {
      calculadoEl: '2026-10-20T08:00:05.000Z',
      desde30: dia(29),
      hasta: dia(0),
      ultimos30: totales,
      historico: { ...totales, primerDia: '2026-09-30' },
      dias: Array.from({ length: 30 }, (_, i) => ({ dia: dia(29 - i), recibidos: i % 4 === 0 ? 5 : i % 3, enviados: i % 4 === 0 ? 6 : i % 3, tokens: 0, usuarios: i % 3 ? 1 : 0 })),
    },
    historial: [
      { id: 3, occurredAt: '2026-10-19T17:00:00.000Z', kind: 'gobierno', title: 'Se aplicó el bloque de gobierno GOBIERNO-IA-MINPRIV (caso #6212)', detail: 'Lo agregó horus en AGENTS.md', createdBy: null },
      { id: 2, occurredAt: '2026-10-08T03:39:24.000Z', kind: 'reinicio', title: 'Arranque del agente en ejecución', detail: null, createdBy: null },
      { id: 1, occurredAt: '2026-09-30T15:00:00.000Z', kind: 'alta', title: 'Alta en SynerLink', detail: 'Galileo quedó registrado como agente del chat.', createdBy: null },
    ],
    hallazgos: {
      abiertos: [{ id: 9, severity: 'bajo', title: 'MCP «synerlink-solicitud-galileo» tiene herramientas de escritura', detail: null, firstSeenAt: '2026-10-02T07:30:00.000Z', resolvedAt: null }],
      cerrados: [{ id: 8, severity: 'alto', title: 'Ejecuta comandos del sistema sin pedir aprobación', detail: null, firstSeenAt: '2026-10-02T07:30:00.000Z', resolvedAt: '2026-10-20T07:30:00.000Z' }],
    },
    resumenes: [
      { semana: '2026-10-12', texto: 'Durante la semana del 12 al 18 de octubre de 2026, Galileo atendió consultas de una persona y su uso creció frente a la semana anterior. Desde el 19 de octubre opera con la plantilla A de mínimo privilegio, sin ejecución de comandos.', modelo: 'sonnet', generadoEl: '2026-10-19T09:01:00.000Z' },
    ],
    completa: {
      ejecucion: {
        vistoEl: '2026-10-20T07:30:08.000Z',
        authMode: 'perfil-openclaw',
        authDetail: 'perfil anthropic:default',
        tokenFingerprint: '902bec6b65aa',
        compartidaCon: ['Atlas', 'Kepler', 'Mercurio', 'Orion', 'Sirio', 'Vega'],
        processStartedAt: '2026-10-08T03:39:24.000Z',
        lastRotationAt: null,
        lastRotationStatus: null,
        lastRotationDetail: null,
        personaFingerprint: '11e0e860d16d',
        personaFiles: ['AGENTS.md', 'SOUL.md', 'IDENTITY.md'],
        governance: [
          {
            marker: 'GOBIERNO-IA-MINPRIV',
            addedOn: '2026-10-19',
            author: 'horus',
            caseRef: 6212,
            file: 'AGENTS.md',
            text: '## Herramientas y límites (Gobierno IA, caso #6212)\n- Puede: buscar en internet, leer y escribir archivos de su espacio de trabajo y radicar en SynerLink una «Solicitud de conectores para agentes IA».\n- Usted NO ejecuta comandos, NO tiene acceso a SAP, SharePoint, correo ni Teams.',
          },
        ],
        usageHook: null,
      },
      gobierno: {
        directorName: null,
        directorEmail: null,
        privilegeTemplate: 'Plantilla A — sin SAP',
        privilegeAppliedOn: '2026-10-19',
        notes: 'Solo radica «Solicitud de conectores para agentes IA». Cron permitido.',
        updatedBy: 'seed 2026-10-20 (actas Gobierno IA)',
        updatedAt: '2026-10-20T12:00:00.000Z',
      },
      casos: [
        {
          idRequest: 6212,
          relation: 'gobierno-ia',
          enEstaBase: true,
          asunto: 'Conectores para el agente Galileo',
          proceso: 'Solicitud de conectores para agentes IA',
          empresa: 'ONE LATAM PHARMA',
          estado: 'Abierto',
          creadoEl: '2026-10-16T21:00:00.000Z',
          resueltoEl: null,
          vinculadoPor: 'seed 2026-10-20 (actas Gobierno IA)',
          vinculadoEl: '2026-10-20T12:00:00.000Z',
          tareas: [
            { id: 7380, tarea: 'Autorización del conector', estado: 'Resuelto', responsable: 'Directora de Prueba', inicio: null, resueltaEl: '2026-10-19T14:47:00.000Z' },
            { id: 7390, tarea: 'Instalación de conector', estado: 'Resuelto', responsable: 'Administrador de Prueba', inicio: null, resueltaEl: '2026-10-19T21:10:00.000Z' },
            { id: 7398, tarea: 'Auditoria de seguridad', estado: 'Sin Empezar', responsable: 'Auditor de Seguridad', inicio: null, resueltaEl: null },
          ],
        },
      ],
      eventosCasos: [
        { occurredAt: '2026-10-19T21:10:00.000Z', kind: 'caso', title: 'Caso #6212: se resolvió «Instalación de conector»', detail: 'Responsable: Administrador de Prueba' },
        { occurredAt: '2026-10-16T21:00:00.000Z', kind: 'caso', title: 'Se radicó el caso #6212', detail: 'Solicitud de conectores para agentes IA' },
      ],
      hallazgosExternos: [],
      calidad30: { preguntas: 38, respondidas: 37, sinRespuesta: 1, enEspera: 0, medianaSeg: 48, p90Seg: 210, tardias: 0, pendientes: 0, reportaConsumo: null },
    },
  };
}

async function simular(page: Page, opts: { puedeConfigurar: boolean; errorAlGuardar?: boolean }) {
  let datos = ficha(opts.puedeConfigurar);
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: { email: 'auditor.pruebas@gsslatam.com', name: 'Auditor de Pruebas', id: 'u-qa', role: 'user' }, expires: '2099-01-01T00:00:00Z' } })
  );
  await page.route('**/api/correo/no-leidos', (r) => r.fulfill({ status: 403, json: { error: 'sin correo' } }));
  await page.route('**/api/proyectos/no-leidos**', (r) => r.fulfill({ status: 403, json: { error: 'sin proyectos' } }));
  await page.route('**/api/processes', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/chat/pulse**', async (r) => {
    await new Promise((res) => setTimeout(res, 400));
    return r.fulfill({ json: { cursor: 1, events: [] } });
  });
  await page.route('**/api/chat/auditoria/hoja-de-vida/galileo/gobierno', async (r) => {
    if (opts.errorAlGuardar) return r.fulfill({ status: 400, json: { error: 'Correo del director: no tiene formato de correo.' } });
    const body = JSON.parse(r.request().postData() ?? '{}');
    datos = { ...datos, completa: { ...datos.completa, gobierno: { ...datos.completa.gobierno, directorName: body.directorName, directorEmail: body.directorEmail } } };
    return r.fulfill({ json: { ok: true, cambios: [`Director: ${body.directorName} · ${body.directorEmail}.`] } });
  });
  await page.route('**/api/chat/auditoria/hoja-de-vida/galileo/perfil', (r) =>
    r.fulfill({ json: { ok: true, cambios: ['Se actualizó el propósito.'] } })
  );
  await page.route('**/api/chat/auditoria/hoja-de-vida/galileo', (r) => r.fulfill({ json: datos }));
}

test.describe('Hoja de vida del agente · sin sesión', () => {
  test('el API de la ficha responde 401', async ({ request }) => {
    expect((await request.get('/api/chat/auditoria/hoja-de-vida/galileo', { maxRedirects: 0 })).status()).toBe(401);
  });
});

test.describe('Hoja de vida del agente · con sesión y API simulado', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('muestra todas las secciones nuevas sin texto de conversaciones', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await simular(page, { puedeConfigurar: false });
    await page.goto('/process/chat/auditoria/inventario/galileo');
    await expect(page.getByRole('heading', { name: 'Hoja de vida de Galileo' })).toBeVisible();

    const id = page.getByTestId('hv-identificacion-ampliada');
    await expect(id.getByText('Sin director registrado')).toBeVisible();
    await expect(id.getByText('#6212 · Abierto')).toBeVisible();
    await expect(id.getByText('Perfil de openclaw · huella 902bec6b65aa')).toBeVisible();
    await expect(id.getByText(/Compartida con Atlas, Kepler/)).toBeVisible();

    const q = page.getByTestId('hv-calidad');
    await expect(q.getByText('48 s')).toBeVisible();
    await expect(q.getByText('37 de 38 preguntas respondidas')).toBeVisible();

    const g = page.getByTestId('hv-gobierno');
    await expect(g.getByText('Plantilla A — sin SAP')).toBeVisible();
    await expect(g.getByText('GOBIERNO-IA-MINPRIV')).toBeVisible();
    await g.getByRole('button', { name: 'Ver texto' }).click();
    await expect(g.getByText(/Usted NO ejecuta comandos/)).toBeVisible();

    const casos = page.getByTestId('hv-casos');
    await expect(casos.getByText('Casos de SynerLink vinculados (1)')).toBeVisible();
    await expect(casos.getByRole('link', { name: '#6212' })).toHaveAttribute('href', /view-request\?id=6212/);
    await expect(casos.getByText('Auditoria de seguridad')).toBeVisible();

    const ext = page.getByTestId('hv-hallazgos-externos');
    await expect(ext.getByText(/Auditoría de seguridad del caso #6212: Sin Empezar/)).toBeVisible();
    await expect(ext.getByRole('button', { name: 'Registrar hallazgo' })).toHaveCount(0);

    // La línea de tiempo suma los hechos del caso.
    await expect(page.getByText('Se radicó el caso #6212')).toBeVisible();
    // Sin el permiso de configurar no hay botones de edición.
    await expect(page.getByRole('button', { name: 'Editar gobierno' })).toHaveCount(0);

    await page.waitForTimeout(300);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-hoja-de-vida.png`, fullPage: true });
  });

  test('con el permiso de configurar: editar gobierno deja el aviso verde arriba', async ({ page }) => {
    await simular(page, { puedeConfigurar: true });
    await page.goto('/process/chat/auditoria/inventario/galileo');
    await page.getByRole('button', { name: 'Editar gobierno' }).click();
    const modal = page.getByRole('dialog', { name: 'Editar gobierno del agente' });
    await modal.getByLabel('Director del área').fill('Directora de Prueba');
    await modal.getByLabel('Correo del director').fill('directora.prueba@onelatampharma.com');
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-editar-gobierno.png` });
    await modal.getByRole('button', { name: 'Guardar' }).click();
    const aviso = page.getByRole('alert').filter({ hasText: 'Gobierno actualizado' });
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeInViewport();
    await expect(page.getByTestId('hv-identificacion-ampliada').getByText('Directora de Prueba · directora.prueba@onelatampharma.com')).toBeVisible();
  });

  test('editar propósito y dueño (modal existente) sigue funcionando al escribir en varios campos', async ({ page }) => {
    await simular(page, { puedeConfigurar: true });
    await page.goto('/process/chat/auditoria/inventario/galileo');
    await page.getByRole('button', { name: 'Editar propósito y dueño' }).click();
    const modal = page.getByRole('dialog', { name: 'Editar propósito y dueño' });
    await modal.getByLabel('Propósito').fill('Atender consultas del área.');
    await modal.getByLabel('Dueño', { exact: true }).fill('Dueña de Prueba');
    await modal.getByLabel('Correo del dueño').fill('duena.prueba@onelatampharma.com');
    await modal.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Hoja de vida actualizada' })).toBeVisible();
  });

  test('un error al guardar se queda en el formulario, en rojo', async ({ page }) => {
    await simular(page, { puedeConfigurar: true, errorAlGuardar: true });
    await page.goto('/process/chat/auditoria/inventario/galileo');
    await page.getByRole('button', { name: 'Editar gobierno' }).click();
    const modal = page.getByRole('dialog', { name: 'Editar gobierno del agente' });
    await modal.getByRole('button', { name: 'Guardar' }).click();
    await expect(modal.getByText('Correo del director: no tiene formato de correo.')).toBeVisible();
    await expect(modal).toBeVisible();
  });

  test('celular: sin desborde horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page, { puedeConfigurar: true });
    await page.goto('/process/chat/auditoria/inventario/galileo');
    await expect(page.getByTestId('hv-gobierno')).toBeVisible();
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(390 + 1);
    await page.waitForTimeout(300);
    if (CAPTURAS) {
      await page.screenshot({ path: `${CAPTURAS}/celular-hoja-de-vida-arriba.png` });
      await page.getByTestId('hv-gobierno').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${CAPTURAS}/celular-gobierno.png` });
      await page.getByTestId('hv-casos').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${CAPTURAS}/celular-casos.png` });
    }
  });
});

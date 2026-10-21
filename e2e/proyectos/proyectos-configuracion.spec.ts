import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Configuración del módulo «Proyectos» (2026-10-20, Nicolás Rivera: los permisos y la
 * configuración de Proyectos se manejan desde la interfaz de SynerLink y no por detrás).
 *
 * Con sesión (JWT firmado con el NEXTAUTH_SECRET de la CI) y el API SIMULADO con `page.route`:
 *   - el botón «Configuración» de la lista de Proyectos solo aparece a quien puede configurar;
 *   - la pantalla tiene el marco de la Configuración del SGC (migas, título, empresa, pestañas,
 *     tabla, modal con «Motivo del cambio»);
 *   - empresa sin configurar: aviso de que manda el servidor (CHAT_PROJECTS_AGENTS);
 *   - un agente sin puente sale «Sin puente activo» y en solo lectura;
 *   - marcar la casilla abre el modal; sin motivo no se guarda; al guardar va el POST correcto,
 *     el aviso verde sale ARRIBA y el registro de cambios muestra la copia inicial y el cambio;
 *   - sin permiso: aviso «Solo administradores del módulo»;
 *   - celular (390 px) sin desbordar la pantalla.
 * Con CAPTURAS_DIR deja las capturas de escritorio y celular (evidencia del PR).
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const CAPTURAS = process.env.CAPTURAS_DIR;

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', sub: 'u-nr', kronosUserId: 'u-nr', role: 'admin' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

const hace = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const GSS = { idCompany: 8, companyName: 'GROUP SHARED SERVICES' };
const OLP = { idCompany: 3, companyName: 'ONE LATAM PHARMA' };

const agente = (over: Record<string, unknown>) => ({
  handle: null,
  avatarUrl: null,
  avatarVersion: null,
  habilitado: false,
  perfiles: [] as string[],
  perfilesEnv: [] as string[],
  puente: true,
  configurado: false,
  ultimoCambio: null,
  ...over,
});

function vista(guardado: boolean) {
  return {
    idCompany: GSS.idCompany,
    origen: guardado ? 'tabla' : 'env',
    tablaLista: true,
    agentes: [
      agente({
        idAgent: 7,
        code: 'horus',
        displayName: 'Orus',
        habilitado: true,
        perfiles: ['gss'],
        perfilesEnv: ['gss'],
        configurado: guardado,
        ultimoCambio: guardado ? { motivo: 'Copia inicial', por: 'Nicolás Rivera', fecha: hace(5) } : null,
      }),
      agente({
        idAgent: 9,
        code: 'silvia',
        displayName: 'Play',
        habilitado: guardado,
        perfiles: guardado ? ['gss', 'comex-latam'] : [],
        configurado: guardado,
        ultimoCambio: guardado ? { motivo: 'Comex trabaja proyectos de GSS', por: 'Nicolás Rivera', fecha: hace(5) } : null,
      }),
      agente({ idAgent: 12, code: 'lunaris', displayName: 'Lunaris', puente: false }),
    ],
    registro: guardado
      ? [
          {
            id: 2,
            agente: 'Play',
            accion: 'cambio',
            habilitadoAntes: false,
            habilitadoDespues: true,
            perfilesAntes: [],
            perfilesDespues: ['gss', 'comex-latam'],
            motivo: 'Comex trabaja proyectos de GSS',
            por: 'Nicolás Rivera',
            fecha: hace(5),
          },
          {
            id: 1,
            agente: 'Orus',
            accion: 'copia_env',
            habilitadoAntes: true,
            habilitadoDespues: true,
            perfilesAntes: ['gss'],
            perfilesDespues: ['gss'],
            motivo: 'Copia inicial de CHAT_PROJECTS_AGENTS: la empresa pasa a configurarse desde SynerLink.',
            por: 'Nicolás Rivera',
            fecha: hace(5),
          },
        ]
      : [],
  };
}

/** API simulado. Devuelve los POST que recibió. */
async function simular(page: Page, opciones: { puede: boolean } = { puede: true }) {
  let guardado = false;
  const posts: unknown[] = [];
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', id: 'u-nr', role: 'admin' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/correo/no-leidos', (r) => r.fulfill({ status: 403, json: { error: 'sin correo' } }));
  await page.route(/\/api\/proyectos\/no-leidos/, (r) => r.fulfill({ json: { noLeidos: 0, mensajes: 0, items: [], trabajando: [] } }));
  await page.route('**/api/chat/pulse**', (r) => r.fulfill({ json: { cursor: 1, events: [], statusCursor: hace(1), statuses: [] } }));
  const cu = (id: number) => [{ id_subprocess_user_company: id, companyUser: { id_company_user: id, company: { id_company: 8, company: 'GROUP SHARED SERVICES' } } }];
  await page.route('**/api/processes', (r) =>
    r.fulfill({ json: [{ id_process: 1, process: 'Solicitudes', subprocesses: [{ id_subprocess: 112, subprocess: 'Proyectos', subprocess_url: '/process/proyectos', subprocessUserCompanies: cu(1) }] }] })
  );
  await page.route((u) => u.pathname === '/api/proyectos', (r) =>
    r.fulfill({
      json: {
        companies: [GSS],
        designables: { '8': [] },
        profiles: [],
        projects: [
          {
            idProject: 4,
            name: 'Farmalógica — Orus (piloto)',
            description: 'Piloto del módulo Proyectos con Orus.',
            company: GSS,
            profile: { key: 'gss', label: 'GSS' },
            myRole: 'owner',
            archived: false,
            agents: [{ idAgent: 7, code: 'horus', displayName: 'Orus', handle: null, avatarUrl: null, avatarVersion: null }],
            memberCount: 1,
            conversationCount: 2,
            linkCount: 0,
            fileCount: 0,
            taskCount: 0,
            updatedAt: hace(3600),
            trabajando: [],
          },
        ],
      },
    })
  );
  await page.route((u) => u.pathname === '/api/proyectos/configuracion', async (r) => {
    const req = r.request();
    if (req.method() === 'POST') {
      posts.push(req.postDataJSON());
      guardado = true;
      return r.fulfill({ json: { ok: true, copiados: 1 } });
    }
    if (!opciones.puede) {
      const company = new URL(req.url()).searchParams.get('company');
      return company ? r.fulfill({ status: 403, json: { error: 'No tiene permiso para configurar Proyectos en esta empresa.' } }) : r.fulfill({ json: { admin: false, companies: [] } });
    }
    const company = new URL(req.url()).searchParams.get('company');
    if (!company) return r.fulfill({ json: { admin: true, companies: [GSS, OLP] } });
    return r.fulfill({ json: vista(guardado) });
  });
  return { posts };
}

test.describe('Proyectos · configuración del módulo', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('escritorio: desde la lista, habilitar a Play con motivo y ver el registro', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page);

    await page.goto('/process/proyectos');
    const boton = page.getByTestId('proyectos-configuracion');
    await expect(boton).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-lista-boton-configuracion.png` });
    await boton.click();

    await expect(page).toHaveURL(/\/process\/proyectos\/configuracion/);
    await expect(page.getByTestId('proyectos-config-titulo')).toHaveText('Configuración');
    await expect(page.getByRole('link', { name: 'Proyectos' })).toBeVisible();
    await expect(page.getByTestId('proyectos-config-origen-env')).toBeVisible();

    const fila = (code: string) => page.locator(`[data-testid="proyectos-config-fila"][data-agente="${code}"]`);
    await expect(fila('horus').getByText('Habilitado')).toBeVisible();
    await expect(fila('lunaris').getByTestId('proyectos-config-sin-puente')).toBeVisible();
    await expect(fila('lunaris').getByTestId('proyectos-config-casilla')).toBeDisabled();
    await expect(fila('lunaris').getByRole('button', { name: 'Editar' })).toBeDisabled();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-configuracion-asistentes.png` });

    await fila('silvia').getByTestId('proyectos-config-casilla').click();
    const guardar = page.getByTestId('proyectos-config-modal-guardar');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('proyectos-config-modal-habilitado')).toBeChecked();
    // Sin perfil ni motivo no se guarda.
    await expect(guardar).toBeDisabled();
    // El campo visible del MultiSelect (el data-testid queda en el input interno).
    const perfiles = page.getByRole('dialog').locator('.mantine-MultiSelect-input');
    await expect(perfiles).toBeVisible();
    const opcion = (nombre: string) => page.getByRole('option', { name: nombre, exact: true });
    await expect(async () => {
      if (!(await opcion('GSS').isVisible())) await perfiles.click();
      await expect(opcion('GSS')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await opcion('GSS').click();
    await opcion('Comex Latam').click();
    await page.keyboard.press('Escape');
    await expect(guardar).toBeDisabled();
    await page.getByTestId('proyectos-config-modal-motivo').fill('Comex trabaja proyectos de GSS');
    await expect(guardar).toBeEnabled();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-configuracion-modal.png` });
    await guardar.click();

    await expect(page.getByTestId('proyectos-config-feedback')).toContainText('Cambio guardado y registrado en la auditoría.');
    expect(api.posts).toEqual([{ company: 8, idAgent: 9, enabled: true, profiles: ['gss', 'comex-latam'], reason: 'Comex trabaja proyectos de GSS' }]);
    await expect(fila('silvia').getByText('Habilitado')).toBeVisible();
    await expect(page.getByTestId('proyectos-config-origen-env')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Registro de cambios' }).click();
    const registro = page.getByTestId('proyectos-config-registro');
    await expect(registro.getByText('Copiado del servidor')).toBeVisible();
    await expect(registro.getByText('Comex trabaja proyectos de GSS')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-configuracion-registro.png` });
  });

  test('sin permiso: no hay botón en la lista y la pantalla lo explica', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simular(page, { puede: false });
    await page.goto('/process/proyectos');
    await expect(page.getByTestId('proyecto-tarjeta').first()).toBeVisible();
    await expect(page.getByTestId('proyectos-configuracion')).toHaveCount(0);
    await page.goto('/process/proyectos/configuracion');
    await expect(page.getByTestId('proyectos-config-sin-permiso')).toBeVisible();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-configuracion-sin-permiso.png` });
  });

  test('celular: la pantalla cabe sin desbordar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page);
    await page.goto('/process/proyectos/configuracion');
    await expect(page.getByTestId('proyectos-config-tabla')).toBeVisible();
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(390);
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/celular-configuracion.png`, fullPage: true });
  });
});

/**
 * Administración → Usuarios → «Asignar subprocesos»: el permiso del módulo («Proyectos»,
 * /process/proyectos) y el de configurarlo («Configuración de Proyectos») se ven y se marcan
 * por empresa, con su distintivo. API simulado.
 */
test.describe('Administración de usuarios · permisos de Proyectos', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('el modal muestra «Proyectos» y «Configuración de Proyectos» y guarda los dos para la empresa', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const guardados: unknown[] = [];
    await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', id: 'u-nr', role: 'admin' }, expires: '2099-01-01T00:00:00Z' } }));
    await page.route('**/api/correo/no-leidos', (r) => r.fulfill({ status: 403, json: { error: 'sin correo' } }));
    await page.route(/\/api\/proyectos\/no-leidos/, (r) => r.fulfill({ json: { noLeidos: 0, mensajes: 0, items: [], trabajando: [] } }));
    await page.route('**/api/chat/pulse**', (r) => r.fulfill({ json: { cursor: 1, events: [], statusCursor: hace(1), statuses: [] } }));
    await page.route('**/api/processes', (r) => r.fulfill({ json: [] }));
    await page.route('**/api/users/login-audit/access', (r) => r.fulfill({ json: { allowed: false } }));
    await page.route('**/api/help-desk/departments', (r) => r.fulfill({ json: [] }));
    await page.route((u) => u.pathname === '/api/users', (r) =>
      r.fulfill({
        json: {
          users: [{ id: 'u-sq', name: 'Silvia Quintana', email: 'silvia.quintana@onelatampharma.com', role: 'user', isActive: true, createdAt: hace(90 * 86400) }],
          pagination: { total: 1, pages: 1 },
        },
      })
    );
    await page.route('**/api/subprocesses', (r) =>
      r.fulfill({
        json: {
          subprocesses: [
            { id_subprocess: 112, subprocess: 'Proyectos', subprocess_url: '/process/proyectos', id_process: 2, process: { id_process: 2, process: 'Solicitudes' } },
            { id_subprocess: 140, subprocess: 'Configuración de Proyectos', subprocess_url: '/process/proyectos/configuracion', id_process: 2, process: { id_process: 2, process: 'Solicitudes' } },
            { id_subprocess: 13, subprocess: 'Mis Solicitudes', subprocess_url: '/process/request-general', id_process: 2, process: { id_process: 2, process: 'Solicitudes' } },
          ],
        },
      })
    );
    await page.route('**/api/companies', (r) => r.fulfill({ json: [{ id: 3, name: 'ONE LATAM PHARMA' }, { id: 8, name: 'GROUP SHARED SERVICES' }] }));
    await page.route('**/api/authorization-types', (r) => r.fulfill({ json: [] }));
    await page.route('**/api/users/u-sq/authorization-types', (r) => r.fulfill({ json: { typeIds: [] } }));
    await page.route('**/api/users/u-sq/departments', (r) => r.fulfill({ json: { departments: [] } }));
    await page.route('**/api/users/u-sq/subprocesses', (r) => {
      if (r.request().method() !== 'GET') {
        guardados.push(r.request().postDataJSON());
        return r.fulfill({ json: { added: 2, removed: 0 } });
      }
      return r.fulfill({
        json: {
          assignedSubprocesses: [
            {
              companyId: 3,
              companyName: 'ONE LATAM PHARMA',
              companyUserId: 31,
              subprocesses: [{ id: 1, subprocessId: 13, subprocessName: 'Mis Solicitudes', subprocessUrl: '/process/request-general', processId: 2, processName: 'Solicitudes' }],
            },
          ],
        },
      });
    });

    await page.goto('/process/administration/users');
    await page.getByRole('button', { name: 'Asignar subprocesos' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Asignar Subprocesos - Silvia Quintana')).toBeVisible();
    await modal.getByLabel('Buscar subprocesos').fill('Proyectos');
    await expect(modal.getByText('URL: /process/proyectos', { exact: true })).toBeVisible();
    await expect(modal.getByText('Permiso: configurar qué asistentes trabajan en Proyectos (en la empresa seleccionada)')).toBeVisible();
    await modal.getByText('Proyectos', { exact: true }).click();
    if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/escritorio-admin-usuarios-asignar-proyectos.png` });
    await modal.getByRole('button', { name: 'Guardar Cambios' }).click();
    await expect.poll(() => guardados.length).toBeGreaterThan(0);
    expect(JSON.stringify(guardados[0])).toContain('112');
  });
});

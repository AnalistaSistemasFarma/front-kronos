import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Permisos de los agentes en Proyectos (2026-10-20, Nicolás Rivera: «va a tocar que cuando creemos
 * el proyecto podamos elegir qué permisos tienen, porque así está difícil»).
 *
 * Con sesión (JWT firmado con el NEXTAUTH_SECRET de la CI) y el API SIMULADO con `page.route`:
 *   - sección «Permisos» del proyecto: el dueño SIN el permiso la ve en solo lectura;
 *   - con el permiso: «Cambiar permisos» → nivel, repos, autorizadores (por defecto Nicolás y
 *     Cristian) y motivo obligatorio; el PATCH lleva lo escogido y el aviso verde sale ARRIBA;
 *   - «Nuevo proyecto»: valor seguro «Ninguno»; con permiso en la empresa se escoge y viaja en el POST;
 *     sin permiso queda en solo lectura y el POST no lleva permisos;
 *   - catálogo de repositorios (solo la administración): desactivar exige motivo;
 *   - celular (390 px) sin desbordar la pantalla.
 * Con CAPTURAS_DIR deja las capturas de escritorio y celular (evidencia del PR).
 */

const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);
const CAPTURAS = process.env.CAPTURAS_DIR;

async function sesion(context: BrowserContext, baseURL: string) {
  const token = await encode({ secret: SECRET!, token: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', sub: 'u-nr', kronosUserId: 'u-nr', role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

const hace = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const ORUS = { idAgent: 7, code: 'horus', displayName: 'Orus', handle: 'horus_gss_bot', avatarUrl: null, avatarVersion: null, esDesarrollo: true };
// Agente de NEGOCIO (2026-10-27): no se le ofrecen nivel de código ni repos.
const PLAY = { idAgent: 16, code: 'play', displayName: 'Play', handle: 'silvia_gss_bot', avatarUrl: null, avatarVersion: null, esDesarrollo: false };
const GSS = { idCompany: 8, companyName: 'GSS' };
const FARMA = { idCompany: 3, companyName: 'FARMALOGICA' };
const OPERADORES = [
  { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera' },
  { email: 'cristian.baldion@gsslatam.com', name: 'Cristian Baldión' },
];
const repo = (slug: string, active = true) => ({
  idRepo: slug === 'sapsend' ? 2 : 1,
  slug,
  name: slug === 'sapsend' ? 'SAPSEND' : 'SynerLink (front-kronos)',
  github: slug === 'sapsend' ? 'gsslatam/sapsend' : 'AnalistaSistemasFarma/front-kronos',
  branchTesting: 'testing',
  branchProduction: slug === 'sapsend' ? 'production' : 'main',
  description: null,
  active,
  projectCount: slug === 'sapsend' ? 1 : 0,
  updatedAt: hace(3600),
});
const CATALOGO = [repo('front-kronos'), repo('sapsend')];

function detalle() {
  return {
    idProject: 4,
    name: 'Ajustes SAPSEND — tesorería',
    description: 'Cambios de tesorería en SAPSEND con Orus.',
    instructions: null,
    company: GSS,
    profile: { key: 'gss', label: 'GSS' },
    myRole: 'owner',
    archived: false,
    capabilities: { write: true, contribute: true, removeAny: true, edit: true, manageAgents: true, manageMembers: true, archive: true, leave: false },
    createdAt: hace(3 * 86400),
    updatedAt: hace(3600),
    agents: [{ ...ORUS, disponible: true, puedoEscribir: true, motivo: null }],
    members: [{ id: 'u-nr', name: 'Nicolás Rivera', email: 'nicolas.rivera@gsslatam.com', avatarUrl: null, role: 'owner' }],
    files: [],
    conversations: [],
    links: { emails: [], requests: [] },
    memberCount: 1,
    conversationCount: 0,
    linkCount: 0,
    fileCount: 0,
    taskCount: 0,
    teamCount: 0,
  };
}

type Politica = { codeLevel: string; repos: ReturnType<typeof repo>[]; deployApprovers: typeof OPERADORES; configurada: boolean; reason: string | null; updatedAt: string | null; updatedBy: string | null };
const NINGUNA: Politica = { codeLevel: 'ninguno', repos: [], deployApprovers: [], configurada: false, reason: null, updatedAt: null, updatedBy: null };

/** API simulado. Devuelve las peticiones de escritura para revisarlas. */
async function simular(page: Page, opciones: { canEdit: boolean; editables?: number[]; catalogAdmin?: boolean; soloPlay?: boolean }) {
  let politica: Politica = NINGUNA;
  let log: unknown[] = [];
  let catalogo = CATALOGO.map((r) => ({ ...r }));
  const escrituras: { url: string; method: string; body: unknown }[] = [];
  const guardar = (r: Request) => escrituras.push({ url: r.url(), method: r.method(), body: r.postDataJSON() });

  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera', id: 'u-nr', role: 'user' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/correo/no-leidos', (r) => r.fulfill({ status: 403, json: { error: 'sin correo' } }));
  const cu = (id: number) => [{ id_subprocess_user_company: id, companyUser: { id_company_user: id, company: { id_company: 8, company: 'GSS' } } }];
  await page.route('**/api/processes', (r) =>
    r.fulfill({ json: [{ id_process: 1, process: 'Tecnología', subprocesses: [{ id_subprocess: 112, subprocess: 'Proyectos', subprocess_url: '/process/proyectos', subprocessUserCompanies: cu(1) }] }] })
  );
  await page.route(/\/api\/proyectos\/no-leidos/, (r) => r.fulfill({ json: { noLeidos: 0, mensajes: 0, items: [], trabajando: [] } }));
  await page.route('**/api/chat/pulse**', async (r) => {
    await new Promise((res) => setTimeout(res, 400));
    return r.fulfill({ json: { cursor: 900, events: [], statusCursor: hace(5), statuses: [] } });
  });
  await page.route(/\/api\/proyectos\/4\/permisos/, async (r) => {
    if (r.request().method() === 'PATCH') {
      guardar(r.request());
      const b = r.request().postDataJSON() as { codeLevel: string; repos: string[]; deployApprovers: string[]; reason: string };
      const antes = politica;
      politica = {
        codeLevel: b.codeLevel,
        repos: CATALOGO.filter((x) => b.repos.includes(x.slug)),
        deployApprovers: OPERADORES.filter((o) => b.deployApprovers.includes(o.email)),
        configurada: true,
        reason: b.reason,
        updatedAt: new Date().toISOString(),
        updatedBy: 'Nicolás Rivera',
      };
      log = [
        {
          id: 1,
          action: antes.configurada ? 'cambiar' : 'crear',
          antes: antes.configurada ? 'Ninguno' : null,
          despues: `Desarrollo + pases · ${b.repos.join(', ')} · pases: ${b.deployApprovers.join(', ')}`,
          reason: b.reason,
          changedBy: 'Nicolás Rivera',
          changedAt: new Date().toISOString(),
        },
        ...log,
      ];
      return r.fulfill({ json: { updated: true } });
    }
    return r.fulfill({ json: { policy: politica, canEdit: opciones.canEdit, catalog: opciones.canEdit ? CATALOGO : [], operators: OPERADORES, log } });
  });
  await page.route(/\/api\/proyectos\/4\/equipo/, (r) => r.fulfill({ json: { team: null } }));
  await page.route((u) => u.pathname === '/api/proyectos/4', (r) => r.fulfill({ json: { project: detalle() } }));
  await page.route(/\/api\/proyectos\/permisos-agentes/, (r) =>
    r.fulfill({ json: { editableCompanies: opciones.editables ?? [], catalogAdmin: opciones.catalogAdmin ?? false, catalog: CATALOGO, operators: OPERADORES } })
  );
  await page.route((u) => u.pathname.startsWith('/api/proyectos/repositorios'), (r) => {
    if (r.request().method() !== 'GET') {
      guardar(r.request());
      const b = r.request().postDataJSON() as { active?: boolean };
      const id = Number(r.request().url().split('/').pop());
      catalogo = catalogo.map((x) => (x.idRepo === id && typeof b.active === 'boolean' ? { ...x, active: b.active } : x));
      return r.fulfill({ json: { repo: catalogo.find((x) => x.idRepo === id) } });
    }
    return r.fulfill({ json: { repos: catalogo } });
  });
  await page.route((u) => u.pathname === '/api/proyectos', (r) => {
    if (r.request().method() === 'POST') {
      guardar(r.request());
      return r.fulfill({ status: 201, json: { idProject: 4, teamRequested: false } });
    }
    return r.fulfill({
      json: {
        companies: [FARMA, GSS],
        designables: { '3': [{ ...ORUS, profiles: ['farmalogica'] }], '8': [{ ...(opciones.soloPlay ? PLAY : ORUS), profiles: ['gss'] }] },
        profiles: [
          { key: 'farmalogica', label: 'Farmalógica', description: 'SAP de Farmalógica (solo lectura).' },
          { key: 'gss', label: 'GSS', description: 'SAP de GSS (solo lectura).' },
        ],
        projects: [
          {
            idProject: 4,
            name: 'Ajustes SAPSEND — tesorería',
            description: 'Cambios de tesorería en SAPSEND con Orus.',
            company: GSS,
            profile: { key: 'gss', label: 'GSS' },
            myRole: 'owner',
            archived: false,
            agents: [ORUS],
            memberCount: 1,
            conversationCount: 0,
            linkCount: 0,
            fileCount: 0,
            taskCount: 0,
            updatedAt: hace(3600),
            trabajando: [],
          },
        ],
      },
    });
  });
  return { escrituras };
}

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
}

test.describe('Proyectos · permisos de los agentes', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test.beforeEach(async ({ context, baseURL }) => {
    await sesion(context, baseURL!);
  });

  test('el dueño sin el permiso ve los permisos en solo lectura', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simular(page, { canEdit: false });
    await page.goto('/process/proyectos/4?seccion=permisos');
    const seccion = page.getByTestId('permisos-seccion');
    await expect(seccion).toBeVisible();
    await expect(seccion.getByTestId('permisos-badge-nivel')).toHaveText('Ninguno');
    await expect(seccion.getByText('Sin definir: vale el valor seguro por defecto.')).toBeVisible();
    await expect(page.getByTestId('permisos-solo-lectura')).toContainText('Permisos de agentes en Proyectos');
    await expect(page.getByTestId('permisos-editar')).toHaveCount(0);
    await capturar(page, 'escritorio-permisos-solo-lectura');
  });

  test('con el permiso: cambia a «Desarrollo + pases» con motivo, aviso verde arriba y registro', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page, { canEdit: true });
    await page.goto('/process/proyectos/4?seccion=permisos');
    await page.getByTestId('permisos-editar').click();
    const modal = page.getByRole('dialog', { name: 'Permisos de los agentes' });
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('permisos-nivel-ninguno')).toHaveAttribute('data-checked', 'true');
    await modal.getByTestId('permisos-nivel-desarrollo_pases').click();
    // Sin repos ni motivo no se puede guardar.
    await expect(modal.getByTestId('permisos-guardar')).toBeDisabled();
    await modal.getByTestId('permisos-repo-sapsend').click();
    // Autorizadores por defecto: los operadores autorizados.
    await expect(modal.getByTestId('permisos-autorizador-nicolas.rivera@gsslatam.com')).toHaveAttribute('data-checked', 'true');
    await expect(modal.getByTestId('permisos-autorizador-cristian.baldion@gsslatam.com')).toHaveAttribute('data-checked', 'true');
    await expect(modal.getByTestId('permisos-aviso-alcance')).toContainText('Nunca usa SSH');
    await expect(modal.getByTestId('permisos-guardar')).toBeDisabled();
    await modal.getByTestId('permisos-motivo').fill('Nicolás aprobó que Orus abra PR y pase SAPSEND por orden suya.');
    await capturar(page, 'escritorio-permisos-modal');
    await modal.getByTestId('permisos-guardar').click();
    await expect(modal).toBeHidden();
    const aviso = page.getByTestId('proyectos-aviso');
    await expect(aviso).toContainText('Permisos guardados');
    expect(api.escrituras[0]).toMatchObject({
      method: 'PATCH',
      body: {
        codeLevel: 'desarrollo_pases',
        repos: ['sapsend'],
        deployApprovers: ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'],
        reason: 'Nicolás aprobó que Orus abra PR y pase SAPSEND por orden suya.',
      },
    });
    const seccion = page.getByTestId('permisos-seccion');
    await expect(seccion.getByTestId('permisos-badge-nivel').first()).toHaveText('Desarrollo + pases');
    await expect(seccion.getByTestId('permisos-repo-vinculado-sapsend')).toBeVisible();
    await expect(seccion.getByText('Cristian Baldión')).toBeVisible();
    await expect(page.getByTestId('permisos-registro')).toContainText('Motivo: Nicolás aprobó');
    await capturar(page, 'escritorio-permisos-guardados');
  });

  test('«Nuevo proyecto»: con permiso en la empresa se escogen; sin él, «Ninguno» en solo lectura', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page, { canEdit: true, editables: [8] });
    await page.goto('/process/proyectos?nuevo=1');
    const modal = page.getByRole('dialog', { name: 'Nuevo proyecto' });
    await expect(modal).toBeVisible();
    // La primera empresa (Farmalógica) NO es editable: solo lectura.
    await expect(modal.getByTestId('proyectos-permisos-solo-lectura')).toBeVisible();
    await expect(modal.getByTestId('permisos-formulario')).toHaveCount(0);
    await modal.getByLabel('Nombre').fill('Ajustes SAPSEND — tesorería');
    await modal.getByRole('textbox', { name: 'Empresa' }).click();
    await page.getByRole('option', { name: 'GSS' }).click();
    const form = modal.getByTestId('permisos-formulario');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('permisos-nivel-ninguno')).toHaveAttribute('data-checked', 'true');
    await form.getByTestId('permisos-nivel-lectura').click();
    await expect(page.getByTestId('proyectos-crear')).toBeDisabled();
    await form.getByTestId('permisos-repo-front-kronos').click();
    await modal.getByTestId('proyectos-permisos-motivo').fill('Orus revisa el código de SynerLink para el análisis.');
    await modal.getByTestId('proyectos-permisos-agentes').scrollIntoViewIfNeeded();
    await capturar(page, 'escritorio-nuevo-proyecto-permisos');
    await page.getByTestId('proyectos-crear').click();
    await expect.poll(() => api.escrituras.length).toBe(1);
    expect(api.escrituras[0].body).toMatchObject({
      idCompany: 8,
      agentPolicy: { codeLevel: 'lectura', repos: ['front-kronos'], deployApprovers: [], reason: 'Orus revisa el código de SynerLink para el análisis.' },
    });
  });

  test('«Nuevo proyecto» con Play (agente de negocio): ni nivel ni repos; el POST no lleva permisos', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page, { canEdit: true, editables: [8], soloPlay: true });
    await page.goto('/process/proyectos?nuevo=1');
    const modal = page.getByRole('dialog', { name: 'Nuevo proyecto' });
    await expect(modal).toBeVisible();
    await modal.getByLabel('Nombre').fill('Comercio Exterior LATAM');
    await modal.getByRole('textbox', { name: 'Empresa' }).click();
    await page.getByRole('option', { name: 'GSS' }).click();
    await expect(modal.getByTestId('permisos-solo-desarrollo')).toContainText('Play no es agente de desarrollo');
    await expect(modal.getByTestId('permisos-formulario')).toHaveCount(0);
    await expect(modal.getByTestId('permisos-nivel-lectura')).toHaveCount(0);
    await expect(modal.getByTestId('permisos-repo-front-kronos')).toHaveCount(0);
    await capturar(page, 'escritorio-nuevo-proyecto-agente-negocio');
    await page.getByTestId('proyectos-crear').click();
    await expect.poll(() => api.escrituras.length).toBe(1);
    expect(api.escrituras[0].body).toMatchObject({ idCompany: 8, agentCodes: ['play'] });
    expect(api.escrituras[0].body).not.toHaveProperty('agentPolicy');
  });

  test('«Nuevo proyecto» sin permiso: el POST no lleva permisos (queda en «Ninguno»)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page, { canEdit: false, editables: [] });
    await page.goto('/process/proyectos?nuevo=1');
    const modal = page.getByRole('dialog', { name: 'Nuevo proyecto' });
    await expect(modal.getByTestId('proyectos-permisos-solo-lectura')).toBeVisible();
    await modal.getByLabel('Nombre').fill('Cartera Farmalógica');
    await page.getByTestId('proyectos-crear').click();
    await expect.poll(() => api.escrituras.length).toBe(1);
    expect(api.escrituras[0].body).not.toHaveProperty('agentPolicy');
  });

  test('catálogo de repositorios: solo la administración; desactivar exige motivo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await simular(page, { canEdit: true, catalogAdmin: true });
    await page.goto('/process/proyectos');
    await page.getByTestId('proyectos-repositorios').click();
    const modal = page.getByRole('dialog', { name: 'Repositorios permitidos' });
    await expect(modal.getByTestId('catalogo-repo-sapsend')).toContainText('gsslatam/sapsend');
    await expect(modal.getByTestId('catalogo-repo-sapsend')).toContainText('1 proyecto');
    await capturar(page, 'escritorio-catalogo-repositorios');
    await modal.getByRole('switch', { name: 'Desactivar SynerLink (front-kronos)' }).dispatchEvent('click');
    await expect(modal.getByTestId('catalogo-guardar')).toBeDisabled();
    await modal.getByTestId('catalogo-motivo').fill('SynerLink no se trabaja desde Proyectos por ahora.');
    await modal.getByTestId('catalogo-guardar').click();
    await expect(modal.getByTestId('catalogo-ok')).toContainText('quedó desactivado');
    expect(api.escrituras[0]).toMatchObject({ method: 'PATCH', body: { active: false, reason: 'SynerLink no se trabaja desde Proyectos por ahora.' } });
    await expect(modal.getByTestId('catalogo-repo-front-kronos')).toContainText('Desactivado');
  });

  test('sin ser administración no aparece el botón del catálogo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await simular(page, { canEdit: false });
    await page.goto('/process/proyectos');
    await expect(page.getByTestId('proyecto-tarjeta')).toBeVisible();
    await expect(page.getByTestId('proyectos-repositorios')).toHaveCount(0);
  });

  test('celular: sección y modal sin desbordar la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await simular(page, { canEdit: true });
    await page.goto('/process/proyectos/4?seccion=permisos');
    await expect(page.getByTestId('permisos-seccion')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await capturar(page, 'celular-permisos-seccion');
    await page.getByTestId('permisos-editar').click();
    const modal = page.getByRole('dialog', { name: 'Permisos de los agentes' });
    await modal.getByTestId('permisos-nivel-desarrollo_pases').click();
    await modal.getByTestId('permisos-repo-sapsend').click();
    const caja = await modal.getByTestId('permisos-repo-sapsend').boundingBox();
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await capturar(page, 'celular-permisos-modal');
  });
});

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Bitácora de Proceso · extremo a extremo con la base y SAP SIMULADOS (2026-10-15, B1–B5/B8).
 *
 * - Sin sesión: las APIs del módulo responden 401 y la página manda al login.
 * - Con sesión: JWT de NextAuth firmado con NEXTAUTH_SECRET de la CI y las APIs del módulo
 *   simuladas con `page.route` (mismo patrón que Correo y el Portal TH). Recorre:
 *   abrir con OP de SAP PLANIFICADA escrita por número (auto-llenado), inspector y jefe
 *   distintos; cierre desde la cuenta compartida con PIN; visto bueno del jefe en su propia
 *   sesión SIN PIN; visto bueno del operario; informe con los CUATRO vistos buenos;
 *   importar operarios; y la tablet en celular (sin desplazamiento lateral).
 * Con `BITACORA_CAPTURAS=<carpeta>` guarda capturas para la revisión de lineamientos.
 */

const CAPTURAS = process.env.BITACORA_CAPTURAS;
const SECRET = process.env.NEXTAUTH_SECRET;
const REMOTO = Boolean(process.env.E2E_BASE_URL);

const EMPRESA = { idCompany: 1, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: true };
const OP_PLANIFICADA = {
  AbsoluteEntry: 14236, DocumentNumber: 14022, ItemNo: 'PTCF015501', ProductDescription: 'CEFTRIACOR (CEFTRIAXONA 1G) PERÚ', U_Cod_Lote: '1455326',
  U_FecVen_lote: '2028-09-30T00:00:00Z', PlannedQuantity: 20000, Warehouse: 'BQAPT', ProductionOrderStatus: 'boposPlanned',
};
const USUARIOS = [
  { id: 'u-sup', name: 'Sandra Supervisora', email: 'sup@farmalogica.com' },
  { id: 'u-ins', name: 'Iván Inspector', email: 'ins@farmalogica.com' },
  { id: 'u-jefe', name: 'Julia Jefe', email: 'jefe@farmalogica.com' },
];

type Rol = 'OPERARIO' | 'SUPERVISOR' | 'INSPECTOR' | 'JEFE_PROD';
const ROLES: Rol[] = ['OPERARIO', 'SUPERVISOR', 'INSPECTOR', 'JEFE_PROD'];

function firma(rol: Rol, nombre: string, metodo: string) {
  return { rol, significado: rol === 'SUPERVISOR' ? 'Cerró' : 'Visto bueno', nombre, email: 'x@farmalogica.com', firmadoEn: '2026-10-15T20:00:00.000Z', contentSha256: 'a'.repeat(64), metodo };
}

function detalle(opts: { estado: 'ABIERTA' | 'CERRADA'; dados: Partial<Record<Rol, ReturnType<typeof firma>>>; sesion: string }) {
  const requeridos = ROLES;
  const siguiente = requeridos.find((r) => !opts.dados[r]) ?? null;
  return {
    id: 11, idCompany: 1, consecutivo: 11, producto: OP_PLANIFICADA.ProductDescription, itemCode: 'PTCF015501', lote: '1455326', turno: 'MANANA', area: 'Envase y agrafado',
    sapOp: OP_PLANIFICADA, sapOpDocNum: 14022, estado: opts.estado, abiertaEn: '2026-10-15T11:00:00.000Z', abiertaPor: 'Sandra Supervisora',
    cerradaEn: opts.estado === 'CERRADA' ? '2026-10-15T19:00:00.000Z' : null, cerradaPor: opts.estado === 'CERRADA' ? 'Sandra Supervisora' : null, observacionCierre: null,
    operarios: [], operadores: [{ id: 7, nombre: 'Pepito Pérez', activo: true }, { id: 8, nombre: 'Ana Gómez', activo: true }],
    inspector: { id: 'u-ins', name: 'Iván Inspector' }, jefe: { id: 'u-jefe', name: 'Julia Jefe' },
    registros: [{ id: '1', actividad: 'Alimentación Tapón', operador: 'Pepito Pérez', usuario: 'Producción Planta', registradoEn: '2026-10-15T12:00:00.000Z', observacion: null }],
    firmas: ROLES.map((r) => opts.dados[r]).filter(Boolean),
    vistos: ROLES.map((rol) => ({ rol, estado: opts.dados[rol] ? 'dado' : 'pendiente', designado: rol === 'INSPECTOR' ? 'Iván Inspector' : rol === 'JEFE_PROD' ? 'Julia Jefe' : null, firma: opts.dados[rol] ?? null })),
    siguiente, completa: opts.estado === 'CERRADA' && siguiente === null, idUsuarioSesion: opts.sesion,
    puedeRegistrar: opts.estado === 'ABIERTA', puedeGestionar: true, puedeCerrar: opts.estado === 'ABIERTA', puedeVerificar: opts.estado === 'CERRADA' && siguiente !== null,
  };
}

async function sesion(context: BrowserContext, baseURL: string, id = 'u-planta', email = 'produccion@farmalogica.com') {
  const token = await encode({ secret: SECRET!, token: { email, name: 'Producción', sub: id, kronosUserId: id, role: 'user' } });
  const u = new URL(baseURL);
  await context.addCookies([{ name: 'next-auth.session-token', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

interface Estado {
  orden: ReturnType<typeof detalle>;
  enviados: Array<{ ruta: string; body: Record<string, unknown> }>;
}

async function simular(page: Page, estado: Estado) {
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: { email: 'produccion@farmalogica.com', name: 'Producción', id: 'u-planta', role: 'user' }, expires: '2099-01-01T00:00:00Z' } }));
  await page.route('**/api/bitacora-proceso**', async (r) => {
    const url = new URL(r.request().url());
    const ruta = url.pathname.replace('/api/bitacora-proceso', '') || '/';
    const metodo = r.request().method();
    if (metodo !== 'GET') {
      const body = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
      estado.enviados.push({ ruta, body });
      if (ruta === '/') return r.fulfill({ status: 201, json: { orden: { id: 11, consecutivo: 11 } } });
      if (ruta === '/11/confirmar') {
        const rol = body.rol as Rol;
        if (rol !== 'OPERARIO' && body.persona !== estado.orden.idUsuarioSesion && body.pin !== '4821') return r.fulfill({ status: 403, json: { error: 'PIN incorrecto: el visto bueno no se registró. Le quedan 4 intentos.' } });
        const nombre = rol === 'OPERARIO' ? 'Ana Gómez' : USUARIOS.find((u) => u.id === body.persona)?.name ?? '';
        const metodoConf = rol === 'OPERARIO' ? 'operario_tablet' : body.pin ? 'pin_tablet' : 'sesion_propia';
        const dados = Object.fromEntries(estado.orden.vistos.filter((v) => v.firma).map((v) => [v.rol, v.firma])) as Partial<Record<Rol, ReturnType<typeof firma>>>;
        dados[rol] = firma(rol, nombre, metodoConf);
        estado.orden = detalle({ estado: rol === 'SUPERVISOR' || estado.orden.estado === 'CERRADA' ? 'CERRADA' : 'ABIERTA', dados, sesion: estado.orden.idUsuarioSesion });
        return r.fulfill({ json: { ok: true, rol, firmante: nombre, siguiente: estado.orden.siguiente } });
      }
      if (ruta === '/operadores/importar') {
        return r.fulfill({ json: { simulado: body.simular !== false, crear: [{ linea: 2, nombre: 'Nuevo Operario', documento: '123' }], existentes: [{ linea: 3, nombre: 'Pepito Pérez', activo: true }], errores: [], creados: body.simular === false ? 1 : 0 } });
      }
      return r.fulfill({ json: { ok: true } });
    }
    if (ruta === '/' && url.searchParams.get('solo') === 'acceso') return r.fulfill({ json: { companies: [EMPRESA] } });
    if (ruta === '/') return r.fulfill({ json: { companies: [EMPRESA], company: EMPRESA, ordenes: [] } });
    if (ruta === '/11') return r.fulfill({ json: { orden: estado.orden } });
    if (ruta === '/usuarios') return r.fulfill({ json: { usuarios: USUARIOS } });
    if (ruta === '/supervisores') return r.fulfill({ json: { supervisores: [{ id: 'u-sup', name: 'Sandra Supervisora' }, { id: 'u-ins', name: 'Iván Inspector' }] } });
    if (ruta === '/operadores') return r.fulfill({ json: { operadores: [{ id_operador: 7, nombre: 'Pepito Pérez', documento: null, activo: true }, { id_operador: 8, nombre: 'Ana Gómez', documento: '55', activo: true }] } });
    if (ruta === '/areas') return r.fulfill({ json: { areas: [{ id_area: 3, nombre: 'Envase y agrafado', orden: 10, activo: true }] } });
    if (ruta === '/actividades') return r.fulfill({ json: { actividades: [{ id_actividad: 1, nombre: 'Alimentación Tapón', icono: 'pictograma-tapon', orden: 10, activo: true, exige_observacion: false }] } });
    if (ruta === '/pin') return r.fulfill({ json: { configurado: false, bloqueado: false, intentosFallidos: 0 } });
    if (ruta === '/pin/usuarios') return r.fulfill({ json: { usuarios: USUARIOS.map((u) => ({ ...u, configurado: u.id !== 'u-jefe', bloqueado: u.id === 'u-ins', intentosFallidos: 0, configuradoEn: null })) } });
    // SAP SIMULADO: OP planificada (B5); el filtro real pide planificadas y liberadas.
    if (ruta === '/sap-op') {
      const q = url.searchParams.get('q') ?? '';
      return r.fulfill({ json: { ops: q === '14022' || /CEFTRI/i.test(q) ? [OP_PLANIFICADA] : [] } });
    }
    return r.fulfill({ status: 404, json: { error: 'no simulado' } });
  });
}

async function captura(page: Page, nombre: string) {
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: true });
}

test.describe('Bitácora de Proceso · sin sesión', () => {
  test('las APIs del módulo responden 401', async ({ request }) => {
    for (const ruta of ['/api/bitacora-proceso', '/api/bitacora-proceso/11?company=1', '/api/bitacora-proceso/pin', '/api/bitacora-proceso/pin/usuarios?company=1', '/api/bitacora-proceso/sap-op?company=1&q=14022']) {
      expect((await request.get(ruta, { maxRedirects: 0 })).status(), ruta).toBe(401);
    }
    for (const ruta of ['/api/bitacora-proceso/11/confirmar?company=1', '/api/bitacora-proceso/pin', '/api/bitacora-proceso/pin/restablecer', '/api/bitacora-proceso/operadores/importar']) {
      expect((await request.post(ruta, { data: {} })).status(), ruta).toBe(401);
    }
  });

  test('la página exige iniciar sesión', async ({ page }) => {
    await page.goto('/process/bitacora-proceso');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Bitácora de Proceso · con sesión, base y SAP simulados', () => {
  test.skip(!SECRET || REMOTO, 'Requiere NEXTAUTH_SECRET del servidor local (CI) para firmar la sesión de prueba.');

  test('abrir: OP PLANIFICADA por número (auto-llena producto y lote), inspector y jefe distintos', async ({ page, context, baseURL }) => {
    await sesion(context, baseURL!, 'u-sup', 'sup@farmalogica.com');
    const estado: Estado = { orden: detalle({ estado: 'ABIERTA', dados: {}, sesion: 'u-sup' }), enviados: [] };
    await simular(page, estado);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/process/bitacora-proceso?empresa=1');
    await page.getByTestId('ot-nueva').click();
    await page.getByTestId('ot-op-buscar').fill('14022');
    await expect(page.getByTestId('ot-op-elegida')).toContainText('OP 14022');
    await expect(page.getByTestId('ot-op-elegida')).toContainText('Planificada');
    await expect(page.getByTestId('ot-producto')).toHaveValue(OP_PLANIFICADA.ProductDescription);
    await expect(page.getByTestId('ot-lote')).toHaveValue('1455326');
    await page.getByTestId('ot-turno').getByText('Mañana').click();
    await page.getByTestId('ot-operarios').getByText('Pepito Pérez').click();
    await page.getByTestId('ot-inspector').getByText('Iván Inspector').click();
    // El inspector elegido ya no aparece en la lista del jefe (son personas distintas).
    await expect(page.getByTestId('ot-jefe').getByText('Iván Inspector')).toHaveCount(0);
    await page.getByTestId('ot-jefe').getByText('Julia Jefe').click();
    await captura(page, '01-nueva-bitacora');
    await page.getByTestId('ot-abrir').click();
    await expect.poll(() => estado.enviados.find((e) => e.ruta === '/')?.body).toMatchObject({
      inspector: 'u-ins', jefeProduccion: 'u-jefe', lote: '1455326', itemCode: 'PTCF015501', operadores: [7], sapOp: { DocumentNumber: 14022, ProductionOrderStatus: 'boposPlanned' },
    });
  });

  test('tablet: visto bueno del operario y cierre del supervisor con PIN (cuenta compartida); PIN malo se rechaza', async ({ page, context, baseURL }) => {
    await sesion(context, baseURL!);
    const estado: Estado = { orden: detalle({ estado: 'ABIERTA', dados: {}, sesion: 'u-planta' }), enviados: [] };
    await simular(page, estado);
    await page.setViewportSize({ width: 1024, height: 1366 });
    await page.goto('/process/bitacora-proceso/11?empresa=1');
    await expect(page.getByTestId('ot-firmas')).toBeVisible();
    await expect(page.getByTestId('ot-firma-operario')).toHaveAttribute('data-estado', 'pendiente');

    // 1) Operario: toca su nombre y «Sí, confirmo» (sin PIN).
    await page.getByTestId('ot-visto-bueno').click();
    await page.getByTestId('ot-confirma-operador').filter({ hasText: 'Ana Gómez' }).click();
    await expect(page.getByTestId('ot-pin-bloque')).toHaveCount(0);
    await page.getByTestId('ot-confirmar').click();
    await expect(page.getByTestId('ot-aviso')).toContainText('Visto bueno del operario registrado');
    expect(estado.enviados.at(-1)?.body).toEqual({ rol: 'OPERARIO', confirmo: true, operador: 8 });

    // 2) Supervisor desde la cuenta compartida: elige su nombre y escribe SU PIN.
    await page.getByTestId('ot-cerrar').click();
    // El inspector de la bitácora no aparece entre quienes pueden cerrar (segregación).
    await expect(page.getByTestId('ot-confirmantes').getByText('Iván Inspector')).toHaveCount(0);
    await page.getByTestId('ot-confirmantes').getByText('Sandra Supervisora').click();
    await expect(page.getByTestId('ot-pin-bloque')).toBeVisible();
    await expect(page.getByTestId('ot-confirmar')).toBeDisabled();
    const pin = page.getByTestId('ot-pin').locator('input');
    await pin.first().click();
    await page.keyboard.type('1111');
    await page.getByTestId('ot-confirmar').click();
    await expect(page.getByTestId('ot-confirmacion-error')).toContainText('PIN incorrecto');
    await pin.first().click();
    await page.keyboard.type('4821');
    await captura(page, '02-cierre-con-pin');
    await page.getByTestId('ot-confirmar').click();
    await expect(page.getByTestId('ot-aviso')).toContainText('cerrada');
    expect(estado.enviados.at(-1)?.body).toEqual({ rol: 'SUPERVISOR', confirmo: true, persona: 'u-sup', pin: '4821' });
    await expect(page.getByTestId('ot-estado')).toContainText('Falta: inspector');
    await expect(page.getByTestId('ot-firma-supervisor')).toContainText('PIN en tablet');
  });

  test('jefe en SU PROPIA sesión: «Sí, confirmo» sin PIN; informe con los cuatro vistos buenos', async ({ page, context, baseURL }) => {
    await sesion(context, baseURL!, 'u-jefe', 'jefe@farmalogica.com');
    const dados = { OPERARIO: firma('OPERARIO', 'Ana Gómez', 'operario_tablet'), SUPERVISOR: firma('SUPERVISOR', 'Sandra Supervisora', 'pin_tablet'), INSPECTOR: firma('INSPECTOR', 'Iván Inspector', 'pin_tablet') };
    const estado: Estado = { orden: detalle({ estado: 'CERRADA', dados, sesion: 'u-jefe' }), enviados: [] };
    await simular(page, estado);
    await page.goto('/process/bitacora-proceso/11?empresa=1');
    await page.getByTestId('ot-visto-bueno').click();
    await expect(page.getByTestId('ot-sesion-propia')).toBeVisible();
    await expect(page.getByTestId('ot-pin-bloque')).toHaveCount(0);
    await page.getByTestId('ot-confirmar').click();
    await expect(page.getByTestId('ot-aviso')).toContainText('Ya tiene todos sus vistos buenos');
    expect(estado.enviados.at(-1)?.body).toEqual({ rol: 'JEFE_PROD', confirmo: true, persona: 'u-jefe' });
    await expect(page.getByTestId('ot-estado')).toHaveText('Completa');

    await page.goto('/process/bitacora-proceso/11/informe?empresa=1');
    const bloque = page.getByTestId('ot-informe-firmas');
    await expect(bloque).toContainText('Vistos buenos');
    for (const [rol, texto] of [['operario', 'Operario en tablet'], ['supervisor', 'PIN en tablet'], ['inspector', 'PIN en tablet'], ['jefe_prod', 'Sesión propia']]) {
      await expect(page.getByTestId(`ot-informe-visto-${rol}`)).toContainText(texto);
    }
    await expect(page.getByTestId('ot-informe-hoja')).toContainText('Iván Inspector');
    await expect(page.getByTestId('ot-informe-hoja')).toContainText('Julia Jefe');
    await captura(page, '03-informe-cuatro-vistos');
  });

  test('catálogo: importar operarios con vista previa; pestaña PIN con restablecer', async ({ page, context, baseURL }) => {
    await sesion(context, baseURL!, 'u-sup', 'sup@farmalogica.com');
    const estado: Estado = { orden: detalle({ estado: 'ABIERTA', dados: {}, sesion: 'u-sup' }), enviados: [] };
    await simular(page, estado);
    await page.goto('/process/bitacora-proceso/gestion?empresa=1');
    await page.getByTestId('ot-tab-operarios').click();
    await page.getByTestId('ot-operadores-importar').click();
    await page.getByTestId('ot-importar-texto').fill('Nombre; documento\nNuevo Operario; 123\nPepito Pérez');
    await page.getByTestId('ot-importar-previa-btn').click();
    await expect(page.getByTestId('ot-importar-previa')).toContainText('1 nuevos');
    await expect(page.getByTestId('ot-importar-previa')).toContainText('1 ya existen');
    await page.getByTestId('ot-importar-confirmar').click();
    await expect.poll(() => estado.enviados.filter((e) => e.ruta === '/operadores/importar').map((e) => e.body.simular)).toEqual([true, false]);

    await page.getByTestId('ot-tab-pin').click();
    await expect(page.getByTestId('ot-pins')).toContainText('Bloqueado');
    await page.getByTestId('ot-pin-restablecer').first().click();
    await expect(page.getByTestId('ot-pins-aviso')).toContainText('restablecido');
    expect(estado.enviados.at(-1)).toMatchObject({ ruta: '/pin/restablecer', body: { company: 1 } });
  });

  test('celular: la planta y el modal de PIN no desplazan de lado y los botones son grandes', async ({ page, context, baseURL }) => {
    await sesion(context, baseURL!);
    const estado: Estado = { orden: detalle({ estado: 'ABIERTA', dados: { OPERARIO: firma('OPERARIO', 'Ana Gómez', 'operario_tablet') }, sesion: 'u-planta' }), enviados: [] };
    await simular(page, estado);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/process/bitacora-proceso/11?empresa=1');
    await expect(page.getByTestId('ot-firmas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByTestId('ot-cerrar').click();
    await page.getByTestId('ot-confirmantes').getByText('Sandra Supervisora').click();
    await expect(page.getByTestId('ot-pin-bloque')).toBeVisible();
    const alto = await page.getByTestId('ot-confirmar').evaluate((b) => b.getBoundingClientRect().height);
    expect(alto).toBeGreaterThanOrEqual(56);
    await captura(page, '04-celular-pin');
  });
});

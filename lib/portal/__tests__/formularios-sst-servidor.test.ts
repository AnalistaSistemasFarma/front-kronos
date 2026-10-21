import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageError, FormacionStorageNoConfigurado, _reiniciarCacheToken } from '../formacion-storage';
import { FORMULARIOS_SST, MAX_ENVIOS_POR_DIA_SST, formularioSst } from '../formularios-sst';
import {
  CARPETA_FORMULARIOS_SST_POR_DEFECTO,
  ErrorEnvioSst,
  esNombreArchivoEnvio,
  guardarEnvioSst,
  huellaCorreoSst,
  huellaDefinicionSst,
  leerConfigFormulariosSst,
  listarEnviosSst,
  marcaBogota,
  nombreArchivoEnvio,
  type ConfigFormulariosSst,
} from '../formularios-sst-servidor';

// FORMULARIOS SST (Cristian Baldión, 2026-10-20). SharePoint SIMULADO con un almacén en memoria; las personas son inventadas.

const ENV = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: '***',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,1,2',
} as unknown as NodeJS.ProcessEnv;
const CFG: ConfigFormulariosSst = { tenantId: 't', clientId: 'c', clientSecret: '***', siteId: 'gsslatam.sharepoint.com,1,2', carpeta: 'FORMULARIOS SST' };
const [REPORTE, SALUD] = FORMULARIOS_SST;
const RESP = { r01: 'Laura Gómez', r02: '1010101010', r06: 'Piso mojado en el pasillo' };

/** Un SharePoint de mentira: guarda, lista (con carpetas), lee y borra archivos por ruta. */
function sharePointFalso() {
  const archivos = new Map<string, string>();
  const llamadas: { metodo: string; ruta: string; url: string }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: '***', expires_in: 3600 }), { status: 200 });
    const marca = 'drive/root:/';
    const inicio = u.indexOf(marca);
    if (inicio < 0) return new Response('{}', { status: 404 });
    const resto = u.slice(inicio + marca.length);
    const dosPuntos = resto.indexOf(':');
    const ruta = decodeURIComponent(resto.slice(0, dosPuntos));
    const sufijo = /^\/[a-z]+/.exec(resto.slice(dosPuntos + 1))?.[0];
    const metodo = (init?.method ?? 'GET').toUpperCase();
    llamadas.push({ metodo, ruta: `${ruta}${sufijo ?? ''}`, url: u });
    if (sufijo === '/children') {
      const hijos = new Map<string, boolean>();
      for (const k of archivos.keys()) {
        if (!k.startsWith(`${ruta}/`)) continue;
        const [primero, ...mas] = k.slice(ruta.length + 1).split('/');
        hijos.set(primero, hijos.get(primero) === true || mas.length > 0);
      }
      if (hijos.size === 0) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ value: [...hijos].map(([name, esCarpeta]) => ({ name, ...(esCarpeta ? { folder: {} } : {}) })) }), { status: 200 });
    }
    if (sufijo === '/content' && metodo === 'PUT') {
      if (u.includes('conflictBehavior=fail') && archivos.has(ruta)) return new Response('{}', { status: 409 });
      archivos.set(ruta, String(init?.body));
      return new Response('{}', { status: 201 });
    }
    if (sufijo === '/content') return archivos.has(ruta) ? new Response(archivos.get(ruta), { status: 200 }) : new Response('{}', { status: 404 });
    return new Response('{}', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, archivos, llamadas };
}

let sp: ReturnType<typeof sharePointFalso>;
const enviar = (correo: string, ahora: Date, extra: Partial<Parameters<typeof guardarEnvioSst>[0]> = {}, formulario = REPORTE) =>
  guardarEnvioSst({ formulario, correo, autorizaDatos: false, respuestas: RESP, ...extra }, { config: CFG, fetch: sp.f, ahora });
const listar = (limite = 500, formulario = REPORTE) => listarEnviosSst(formulario, limite, { config: CFG, fetch: sp.f });
/** 20 de octubre de 2026, 10:00 hora de Colombia (15:00 UTC). */
const T0 = new Date(Date.UTC(2026, 9, 20, 15, 0, 0));

beforeEach(() => {
  _reiniciarCacheToken();
  sp = sharePointFalso();
});

describe('registro de formularios', () => {
  it('son dos, con sus códigos y sus datos sensibles bien marcados', () => {
    expect(FORMULARIOS_SST.map((f) => f.codigo)).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
    expect(REPORTE.datosSensibles).toBe(false);
    expect(SALUD.datosSensibles).toBe(true);
  });
  it('se buscan por código; cualquier otra cosa no existe', () => {
    expect(formularioSst('SST-SALUD-OSTEOMUSCULAR')).toBe(SALUD);
    for (const malo of ['', 'sst-reporte-actos', '../x', 'SST-REPORTE-ACTOS/..', null, undefined, 3, {}]) expect(formularioSst(malo), String(malo)).toBeNull();
  });
});

describe('configuración', () => {
  it('por defecto la carpeta es «FORMULARIOS SST» con la misma app de Formación; la variable la cambia; lo peligroso se rechaza', () => {
    expect(CARPETA_FORMULARIOS_SST_POR_DEFECTO).toBe('FORMULARIOS SST');
    expect(leerConfigFormulariosSst(ENV).carpeta).toBe('FORMULARIOS SST');
    expect(leerConfigFormulariosSst({ ...ENV, PORTAL_TH_SP_FORMULARIOS_SST: 'OTRA' } as NodeJS.ProcessEnv).carpeta).toBe('OTRA');
    for (const mala of ['..', 'A/B', 'A:B', '/A']) {
      expect(() => leerConfigFormulariosSst({ ...ENV, PORTAL_TH_SP_FORMULARIOS_SST: mala } as NodeJS.ProcessEnv), mala).toThrow(FormacionStorageNoConfigurado);
    }
    expect(() => leerConfigFormulariosSst({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
  });
});

describe('hora de Colombia y nombres de archivo', () => {
  it('el mes, el día y la marca son de Colombia (UTC-5), también cerca de la medianoche y del cambio de mes', () => {
    expect(marcaBogota(T0)).toEqual({ mes: '2026-10', dia: '20261020', marca: '20261020100000' });
    expect(marcaBogota(new Date(Date.UTC(2026, 9, 21, 3, 30, 5)))).toEqual({ mes: '2026-10', dia: '20261020', marca: '20261020223005' }); // aún es el 20 en Bogotá
    expect(marcaBogota(new Date(Date.UTC(2026, 10, 1, 3, 0, 0)))).toMatchObject({ mes: '2026-10', dia: '20261031' }); // 31 de octubre, 22:00 en Bogotá
    expect(marcaBogota(new Date(Date.UTC(2026, 9, 20, 5, 0, 0))).marca).toBe('20261020000000'); // medianoche: «00», nunca «24»
  });
  it('la huella del correo es estable, ignora mayúsculas y espacios, y el nombre del archivo no trae datos personales', () => {
    expect(huellaCorreoSst(' Ana.Perez@GSSLATAM.com ')).toBe(huellaCorreoSst('ana.perez@gsslatam.com'));
    expect(huellaCorreoSst('a@x.com')).not.toBe(huellaCorreoSst('b@x.com'));
    const n = nombreArchivoEnvio('20261020100000', huellaCorreoSst('ana.perez@gsslatam.com'), 'abc123');
    expect(n).toMatch(/^[0-9]{14}-[0-9a-f]{8}-abc123\.json$/);
    expect(n).not.toMatch(/ana|perez|gsslatam/i);
  });
  it('el nombre de archivo tiene un formato fijo y no deja pasar rutas raras', () => {
    expect(esNombreArchivoEnvio('20261020100000-aaaaaaaa-abc123.json')).toBe(true);
    for (const mal of ['../x.json', 'a/b.json', '20261020100000-aaaaaaaa-abc123.txt', '20261020-aaaaaaaa-abc123.json', '', null, undefined, 7]) {
      expect(esNombreArchivoEnvio(mal), String(mal)).toBe(false);
    }
  });
  it('la huella de la definición cambia si el formulario cambia y no depende de nada más', () => {
    expect(huellaDefinicionSst(REPORTE)).toMatch(/^[0-9a-f]{12}$/);
    expect(huellaDefinicionSst(REPORTE)).toBe(huellaDefinicionSst(REPORTE));
    expect(huellaDefinicionSst(REPORTE)).not.toBe(huellaDefinicionSst(SALUD));
    expect(huellaDefinicionSst({ ...REPORTE, definicion: { ...REPORTE.definicion, titulo: 'otro' } })).not.toBe(huellaDefinicionSst(REPORTE));
  });
});

describe('guardarEnvioSst', () => {
  it('guarda UN archivo en FORMULARIOS SST/<código>/<AAAA-MM>/ con las respuestas y el correo de la sesión', async () => {
    const r = await enviar('Laura.Gomez@gsslatam.com', T0);
    expect(r.enviadoEl).toBe(T0.toISOString());
    expect(sp.archivos.size).toBe(1);
    const [ruta, contenido] = [...sp.archivos.entries()][0];
    expect(ruta).toMatch(/^FORMULARIOS SST\/SST-REPORTE-ACTOS\/2026-10\/20261020100000-[0-9a-f]{8}-[0-9a-f]{6}\.json$/);
    expect(ruta.slice('FORMULARIOS SST/SST-REPORTE-ACTOS/2026-10/'.length)).not.toMatch(/laura|gomez|gsslatam/i);
    expect(JSON.parse(contenido)).toEqual({
      v: 1,
      codigo: 'SST-REPORTE-ACTOS',
      definicion: huellaDefinicionSst(REPORTE),
      enviadoPor: 'laura.gomez@gsslatam.com',
      enviadoEl: T0.toISOString(),
      autorizacion: null,
      respuestas: RESP,
    });
  });
  it('en el formulario de salud guarda la prueba de la autorización: qué versión del texto y cuándo', async () => {
    await enviar('a@x.com', T0, { autorizaDatos: true }, SALUD);
    const e = JSON.parse([...sp.archivos.values()][0]);
    expect(e.autorizacion).toEqual({ version: SALUD.definicion.autorizacion!.version, aceptadoEl: T0.toISOString() });
    expect([...sp.archivos.keys()][0]).toContain('/SST-SALUD-OSTEOMUSCULAR/2026-10/');
  });
  it('sin autorizar, no queda constancia de autorización (el servidor ya habría rechazado el envío antes)', async () => {
    await enviar('a@x.com', T0, { autorizaDatos: false }, SALUD);
    expect(JSON.parse([...sp.archivos.values()][0]).autorizacion).toBeNull();
  });
  it('no pisa un archivo existente: pide a SharePoint que falle si el nombre ya está', async () => {
    await enviar('a@x.com', T0);
    const put = sp.llamadas.find((l) => l.metodo === 'PUT')!;
    expect(put.url).toContain('conflictBehavior=fail');
  });
  it('el tope diario es por persona y por formulario: la persona 21 del día recibe 429, otra persona y otro día sí pueden', async () => {
    for (let i = 0; i < MAX_ENVIOS_POR_DIA_SST; i++) await enviar('ana@gsslatam.com', new Date(T0.getTime() + i * 1000));
    await expect(enviar('ana@gsslatam.com', new Date(T0.getTime() + 60_000))).rejects.toMatchObject({ estado: 429 });
    await expect(enviar('ana@gsslatam.com', new Date(T0.getTime() + 60_000))).rejects.toBeInstanceOf(ErrorEnvioSst);
    await enviar('ANA@gsslatam.com'.replace('ANA', 'otra'), new Date(T0.getTime() + 61_000)); // otra persona
    await enviar('ana@gsslatam.com', new Date(T0.getTime() + 24 * 3600_000)); // otro día
    await enviar('ana@gsslatam.com', new Date(T0.getTime() + 62_000), {}, SALUD); // otro formulario
    expect(sp.archivos.size).toBe(MAX_ENVIOS_POR_DIA_SST + 3);
  });
  it('el correo con otras mayúsculas cuenta como la misma persona para el tope', async () => {
    for (let i = 0; i < MAX_ENVIOS_POR_DIA_SST; i++) await enviar(i % 2 ? 'ANA@gsslatam.com' : 'ana@gsslatam.com', new Date(T0.getTime() + i * 1000));
    await expect(enviar('Ana@Gsslatam.com', new Date(T0.getTime() + 60_000))).rejects.toMatchObject({ estado: 429 });
  });
  it('si SharePoint rechaza guardar, el error es de almacenamiento (nunca se disfraza de éxito) y no trae las respuestas', async () => {
    const roto = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: '***', expires_in: 3600 }), { status: 200 });
      return new Response('{}', { status: u.includes('/children') ? 404 : 403 });
    });
    const intento = guardarEnvioSst({ formulario: REPORTE, correo: 'a@x.com', autorizaDatos: false, respuestas: RESP }, { config: CFG, fetch: roto as unknown as typeof fetch, ahora: T0 });
    await expect(intento).rejects.toBeInstanceOf(FormacionStorageError);
    await expect(intento).rejects.toMatchObject({ status: 403 });
    await intento.catch((e: Error) => expect(e.message).not.toMatch(/Piso mojado|1010101010/));
  });
});

describe('listarEnviosSst', () => {
  it('un formulario sin envíos (la carpeta todavía no existe) es una tabla vacía, no un error', async () => {
    const t = await listar();
    expect(t).toMatchObject({ filas: [], total: 0, truncado: false, formulario: { codigo: 'SST-REPORTE-ACTOS' } });
    expect(t.columnas).toHaveLength(6);
    expect(t.columnas[0]).toEqual({ id: 'r01', texto: 'Nombres y Apellidos de quién reporta' });
  });
  it('devuelve los envíos del más reciente al más antiguo, también cruzando meses, con el correo de la sesión y sin datos de más', async () => {
    await enviar('a@x.com', new Date(Date.UTC(2026, 8, 15, 15, 0, 0)), { respuestas: { r06: 'de septiembre' } });
    await enviar('b@x.com', new Date(Date.UTC(2026, 9, 1, 15, 0, 0)), { respuestas: { r06: 'de octubre 1' } });
    await enviar('c@x.com', new Date(Date.UTC(2026, 9, 20, 15, 0, 0)), { respuestas: { r06: 'de octubre 20' } });
    const t = await listar();
    expect(t.total).toBe(3);
    expect(t.truncado).toBe(false);
    expect(t.filas.map((f) => f.respuestas.r06)).toEqual(['de octubre 20', 'de octubre 1', 'de septiembre']);
    expect(t.filas.map((f) => f.correo)).toEqual(['c@x.com', 'b@x.com', 'a@x.com']);
    expect(Object.keys(t.filas[0]).sort()).toEqual(['autorizacionVersion', 'correo', 'enviadaEl', 'id', 'respuestas']);
    expect(t.filas.every((f) => esNombreArchivoEnvio(f.id))).toBe(true);
  });
  it('cada formulario tiene sus propios envíos', async () => {
    await enviar('a@x.com', T0);
    await enviar('b@x.com', T0, {}, SALUD);
    expect((await listar(500, REPORTE)).filas.map((f) => f.correo)).toEqual(['a@x.com']);
    expect((await listar(500, SALUD)).filas.map((f) => f.correo)).toEqual(['b@x.com']);
  });
  it('con un límite lee solo los más recientes y avisa que quedaron envíos fuera, sin abrir los demás archivos', async () => {
    for (let i = 0; i < 5; i++) await enviar(`p${i}@x.com`, new Date(T0.getTime() + i * 1000), { respuestas: { r06: `n${i}` } });
    sp.llamadas.length = 0;
    const t = await listar(2);
    expect(t.total).toBe(5);
    expect(t.truncado).toBe(true);
    expect(t.filas.map((f) => f.respuestas.r06)).toEqual(['n4', 'n3']);
    expect(sp.llamadas.filter((l) => l.ruta.endsWith('/content'))).toHaveLength(2);
  });
  it('ignora lo que no es un envío: otros nombres, carpetas que no son meses, JSON roto o sin la forma esperada', async () => {
    await enviar('a@x.com', T0);
    sp.archivos.set('FORMULARIOS SST/SST-REPORTE-ACTOS/2026-10/notas.txt', 'hola');
    sp.archivos.set('FORMULARIOS SST/SST-REPORTE-ACTOS/otra-carpeta/20261020100000-aaaaaaaa-abc123.json', '{}');
    sp.archivos.set('FORMULARIOS SST/SST-REPORTE-ACTOS/2026-10/20261020100001-aaaaaaaa-aaaaaa.json', '{no es json');
    sp.archivos.set('FORMULARIOS SST/SST-REPORTE-ACTOS/2026-10/20261020100002-aaaaaaaa-bbbbbb.json', JSON.stringify({ v: 2 }));
    sp.archivos.set('FORMULARIOS SST/SST-REPORTE-ACTOS/2026-10/20261020100003-aaaaaaaa-cccccc.json', JSON.stringify({ v: 1, enviadoPor: 'x@x.com', enviadoEl: 'z', respuestas: [] }));
    const t = await listar();
    expect(t.filas.map((f) => f.correo)).toEqual(['a@x.com']);
  });
  it('si SharePoint no responde o no deja leer, el error es de almacenamiento', async () => {
    const roto = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith('https://login.microsoftonline.com/') ? new Response(JSON.stringify({ access_token: '***', expires_in: 3600 }), { status: 200 }) : new Response('{}', { status: 403 })
    );
    await expect(listarEnviosSst(REPORTE, 10, { config: CFG, fetch: roto as unknown as typeof fetch })).rejects.toMatchObject({ status: 403 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageError, FormacionStorageNoConfigurado, _reiniciarCacheToken } from '../formacion-storage';
import {
  BASE_PERSONAL_CACHE_MS,
  RUTA_BASE_PERSONAL_POR_DEFECTO,
  _reiniciarCacheBasePersonal,
  leerBasePersonal,
  leerConfigBasePersonal,
  personasDesdeHoja,
  ubicarColumnas,
  type ConfigBasePersonal,
} from '../base-personal';

// Lectura de BASE PERSONAL para el organigrama (Cristian Baldión, 2026-10-15). Graph SIMULADO; las personas son inventadas.

const ENV = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: '***',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,1,2',
} as unknown as NodeJS.ProcessEnv;
const CFG: ConfigBasePersonal = { tenantId: 't', clientId: 'c', clientSecret: '***', siteId: 'gsslatam.sharepoint.com,1,2', ruta: ['CONTACTOS', 'BASE PERSONAL.xlsx'] };
const ENCABEZADO = ['Empresa', 'Cédula', 'Apellidos y Nombres', 'Empresa contratante', 'Área / Dependencia', 'Cargo', 'Correo corporativo', 'Estado Activo SI/ NO'];
const HOJA = [
  ENCABEZADO,
  ['Farmalógica', '1010101010', 'PEREZ GOMEZ ANA', 'FARMALOGICA S.A.', 'CALIDAD', 'GERENTE DE CALIDAD', 'ana.perez@farmalogica.com', 'SI'],
  ['Ryan', '2020202020', 'RUIZ SOTO LUIS', 'RYAN', 'PRODUCCION', 'AUXILIAR DE PRODUCCION', 'No Aplica', 'SI'],
  ['Ryan', '3030303030', 'SIN ESTADO SI', 'RYAN', 'X', 'ANALISTA', '', 'NO'],
  ['Ryan', '4040404040', '', 'RYAN', 'X', 'ANALISTA', '', 'SI'],
  ['Ryan', '5050505050', 'SIN CARGO', 'RYAN', 'X', '', '', 'SI'],
];
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });

function graphFalso(valores: unknown[][] = HOJA, fallo?: (u: string) => Response | null) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return json(200, { access_token: '***', expires_in: 3600 });
    const f = fallo?.(u);
    if (f) return f;
    if (u.includes('/drive/root:/CONTACTOS/BASE%20PERSONAL.xlsx:?')) return json(200, { id: '01ABC' });
    if (u.includes('/workbook/worksheets?')) return json(200, { value: [{ name: 'Maestra unificada OCT 2026' }] });
    if (u.includes('/usedRange?')) return json(200, { values: valores });
    return json(404, {});
  });
}

beforeEach(() => {
  _reiniciarCacheToken();
  _reiniciarCacheBasePersonal();
});

describe('leerConfigBasePersonal', () => {
  it('por defecto lee CONTACTOS/BASE PERSONAL.xlsx con la misma app de Formación', () => {
    const c = leerConfigBasePersonal(ENV);
    expect(RUTA_BASE_PERSONAL_POR_DEFECTO).toBe('CONTACTOS/BASE PERSONAL.xlsx');
    expect(c.ruta).toEqual(['CONTACTOS', 'BASE PERSONAL.xlsx']);
    expect(c.clientId).toBe('c');
  });
  it('PORTAL_TH_SP_BASE_PERSONAL la cambia; rutas peligrosas se rechazan; sin variables de SharePoint, «no configurado»', () => {
    expect(leerConfigBasePersonal({ ...ENV, PORTAL_TH_SP_BASE_PERSONAL: 'OTRA/Base.xlsx' } as NodeJS.ProcessEnv).ruta).toEqual(['OTRA', 'Base.xlsx']);
    for (const mala of ['..', '../x.xlsx', 'A//B.xlsx', '/A.xlsx', 'A:B.xlsx', 'A/B/C/D/E.xlsx']) {
      expect(() => leerConfigBasePersonal({ ...ENV, PORTAL_TH_SP_BASE_PERSONAL: mala } as NodeJS.ProcessEnv), mala).toThrow(FormacionStorageNoConfigurado);
    }
    expect(() => leerConfigBasePersonal({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
  });
});

describe('personasDesdeHoja', () => {
  it('toma solo empresa, nombre, área, cargo y correo; la cédula no sale', () => {
    const p = personasDesdeHoja(HOJA);
    expect(p).toEqual([
      { empresa: 'Farmalógica', nombre: 'PEREZ GOMEZ ANA', area: 'CALIDAD', cargo: 'GERENTE DE CALIDAD', correo: 'ana.perez@farmalogica.com' },
      { empresa: 'Ryan', nombre: 'RUIZ SOTO LUIS', area: 'PRODUCCION', cargo: 'AUXILIAR DE PRODUCCION', correo: 'No Aplica' },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/\d{10}/);
  });
  it('descarta a quienes tienen estado NO, no tienen nombre o no tienen cargo', () => {
    expect(personasDesdeHoja(HOJA)).toHaveLength(2);
  });
  it('encuentra las columnas por su nombre aunque cambien de orden, tildes o mayúsculas', () => {
    const hoja = [['CARGO', 'correo corporativo', 'apellidos y nombres', 'Area / Dependencia', 'EMPRESA'], ['JEFE', 'a@x.com', 'ANA', 'AREA', 'Kelab']];
    expect(personasDesdeHoja(hoja)).toEqual([{ empresa: 'Kelab', nombre: 'ANA', area: 'AREA', cargo: 'JEFE', correo: 'a@x.com' }]);
  });
  it('sin la columna de estado, no descarta a nadie; sin otra necesaria, avisa cuál falta', () => {
    expect(personasDesdeHoja([['Empresa', 'Apellidos y Nombres', 'Área / Dependencia', 'Cargo', 'Correo corporativo'], ['Kelab', 'ANA', 'X', 'JEFE', '']])).toHaveLength(1);
    expect(() => ubicarColumnas(['Empresa', 'Apellidos y Nombres', 'Área / Dependencia', 'Correo corporativo'])).toThrow(/columna «CARGO»/);
  });
  it('una hoja vacía o solo con encabezado da una lista vacía', () => {
    expect(personasDesdeHoja([])).toEqual([]);
    expect(personasDesdeHoja([ENCABEZADO])).toEqual([]);
  });
  it('limpia espacios y saltos de línea; los números no revientan', () => {
    const p = personasDesdeHoja([ENCABEZADO, ['  Ryan ', 1, ' ANA  \n RUIZ ', '', 'ÁREA\u00a0X', 'JEFE   DE X', null, 'SI']]);
    expect(p[0]).toMatchObject({ empresa: 'Ryan', nombre: 'ANA RUIZ', cargo: 'JEFE DE X', correo: '' });
  });
});

describe('leerBasePersonal (Graph simulado)', () => {
  it('abre el archivo, la primera hoja y su rango usado, y devuelve las personas', async () => {
    const f = graphFalso();
    const p = await leerBasePersonal({ config: CFG, fetch: f as unknown as typeof fetch });
    expect(p).toHaveLength(2);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/usedRange?$select=values'))).toBe(true);
    // solo lectura: ninguna llamada que no sea GET (el token es un POST de login)
    for (const c of f.mock.calls) {
      const init = c[1] as RequestInit | undefined;
      if (!String(c[0]).startsWith('https://login.microsoftonline.com/')) expect(init?.method ?? 'GET').toBe('GET');
    }
  });
  it('la guarda en caché unos minutos y la vuelve a pedir pasado ese tiempo', async () => {
    const f = graphFalso();
    let t = 1_000_000;
    const ahora = () => t;
    await leerBasePersonal({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    const llamadas = f.mock.calls.length;
    await leerBasePersonal({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    expect(f.mock.calls.length).toBe(llamadas);
    t += BASE_PERSONAL_CACHE_MS + 1;
    await leerBasePersonal({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    expect(f.mock.calls.length).toBeGreaterThan(llamadas);
  });
  it('errores de Graph: archivo no encontrado (404), sin permiso (403), libro sin hojas y hoja sin datos', async () => {
    const e404 = graphFalso(HOJA, (u) => (u.includes('/drive/root:/') ? json(404, {}) : null));
    await expect(leerBasePersonal({ config: CFG, fetch: e404 as unknown as typeof fetch })).rejects.toMatchObject({ status: 404 });
    _reiniciarCacheBasePersonal();
    const e403 = graphFalso(HOJA, (u) => (u.includes('/usedRange?') ? json(403, {}) : null));
    await expect(leerBasePersonal({ config: CFG, fetch: e403 as unknown as typeof fetch })).rejects.toMatchObject({ status: 403 });
    _reiniciarCacheBasePersonal();
    const sinHojas = graphFalso(HOJA, (u) => (u.includes('/workbook/worksheets?') ? json(200, { value: [] }) : null));
    await expect(leerBasePersonal({ config: CFG, fetch: sinHojas as unknown as typeof fetch })).rejects.toBeInstanceOf(FormacionStorageError);
    _reiniciarCacheBasePersonal();
    const sinValores = graphFalso(HOJA, (u) => (u.includes('/usedRange?') ? json(200, {}) : null));
    await expect(leerBasePersonal({ config: CFG, fetch: sinValores as unknown as typeof fetch })).rejects.toBeInstanceOf(FormacionStorageError);
  });
});

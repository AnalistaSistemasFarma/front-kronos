import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageError, FormacionStorageNoConfigurado, _reiniciarCacheToken } from '../formacion-storage';
import {
  HEINSOHN_CACHE_MS,
  MAX_EMPRESAS,
  RUTA_HEINSOHN_POR_DEFECTO,
  _reiniciarCacheHeinsohn,
  empresasDesdeHoja,
  enlaceValido,
  leerConfigHeinsohn,
  leerEmpresasHeinsohn,
  ubicarColumnasHeinsohn,
  type ConfigHeinsohn,
} from '../heinsohn';

// HEINSOHN NÓMINA (Cristian Baldión, 2026-10-15). Graph SIMULADO.

const ENV = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: '***',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,1,2',
} as unknown as NodeJS.ProcessEnv;
const CFG: ConfigHeinsohn = { tenantId: 't', clientId: 'c', clientSecret: '***', siteId: 'gsslatam.sharepoint.com,1,2', ruta: ['HEINSOHN NOMINA', 'PORTAL NOMINA.xlsx'] };
const HOJA = [
  ['EMPRESA', 'LINK DE ACCESO'],
  ['LABORATORIO RYAN DE COLOMBIA S.A.S', 'https://portal.heinsohn.com.co?domain=ryanlab.com'],
  ['ONE LATAM PHARMA SAS ', 'https://portal.heinsohn.com.co?domain=olp.com'],
  ['FARMALOGICA SA', 'https://portal.heinsohn.com.co?domain=farmalogica.com.co'],
];
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });

function graphFalso(valores: unknown[][] = HOJA, fallo?: (u: string) => Response | null) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return json(200, { access_token: '***', expires_in: 3600 });
    const f = fallo?.(u);
    if (f) return f;
    if (u.includes('/drive/root:/HEINSOHN%20NOMINA/PORTAL%20NOMINA.xlsx:?')) return json(200, { id: '01XYZ' });
    if (u.includes('/workbook/worksheets?')) return json(200, { value: [{ name: 'Hoja1' }] });
    if (u.includes('/usedRange?')) return json(200, { values: valores });
    return json(404, {});
  });
}

beforeEach(() => {
  _reiniciarCacheToken();
  _reiniciarCacheHeinsohn();
});

describe('leerConfigHeinsohn', () => {
  it('por defecto lee HEINSOHN NOMINA/PORTAL NOMINA.xlsx con la misma app de Formación', () => {
    expect(RUTA_HEINSOHN_POR_DEFECTO).toBe('HEINSOHN NOMINA/PORTAL NOMINA.xlsx');
    const c = leerConfigHeinsohn(ENV);
    expect(c.ruta).toEqual(['HEINSOHN NOMINA', 'PORTAL NOMINA.xlsx']);
    expect(c.clientId).toBe('c');
  });
  it('PORTAL_TH_SP_HEINSOHN la cambia; rutas peligrosas se rechazan; sin variables de SharePoint, «no configurado»', () => {
    expect(leerConfigHeinsohn({ ...ENV, PORTAL_TH_SP_HEINSOHN: 'NOMINA/Otra.xlsx' } as NodeJS.ProcessEnv).ruta).toEqual(['NOMINA', 'Otra.xlsx']);
    for (const mala of ['..', '../x.xlsx', 'A//B.xlsx', '/A.xlsx', 'A:B.xlsx', 'A/B/C/D/E.xlsx']) {
      expect(() => leerConfigHeinsohn({ ...ENV, PORTAL_TH_SP_HEINSOHN: mala } as NodeJS.ProcessEnv), mala).toThrow(FormacionStorageNoConfigurado);
    }
    expect(() => leerConfigHeinsohn({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
  });
});

describe('enlaceValido', () => {
  it('acepta una dirección https y la normaliza', () => {
    expect(enlaceValido('https://portal.heinsohn.com.co?domain=ryanlab.com')).toBe('https://portal.heinsohn.com.co/?domain=ryanlab.com');
    expect(enlaceValido('  https://portal.heinsohn.com.co/a?x=1&y=2  ')).toBe('https://portal.heinsohn.com.co/a?x=1&y=2');
  });
  it('rechaza lo que no es https, lo que trae usuario o clave, y lo que no es una dirección', () => {
    for (const malo of ['http://portal.heinsohn.com.co', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://x.com', '//evil.com', 'https://usuario:clave@portal.heinsohn.com.co', 'https://usuario@portal.heinsohn.com.co', 'https://localhost', 'portal.heinsohn.com.co', '', '   ', null, undefined, 'https://' + 'a'.repeat(2100) + '.com']) {
      expect(enlaceValido(malo), String(malo).slice(0, 40)).toBeNull();
    }
  });
});

describe('empresasDesdeHoja', () => {
  it('toma empresa y enlace en el orden del Excel, limpiando los espacios', () => {
    const l = empresasDesdeHoja(HOJA);
    expect(l.empresas.map((e) => e.nombre)).toEqual(['LABORATORIO RYAN DE COLOMBIA S.A.S', 'ONE LATAM PHARMA SAS', 'FARMALOGICA SA']);
    expect(l.empresas[0].url).toBe('https://portal.heinsohn.com.co/?domain=ryanlab.com');
    expect(l.omitidas).toEqual([]);
  });
  it('una fila con enlace que no sirve no lleva botón y se avisa por su nombre; una fila vacía se ignora', () => {
    const l = empresasDesdeHoja([['EMPRESA', 'LINK DE ACCESO'], ['A SAS', 'javascript:alert(1)'], ['B SAS', ''], ['', ''], ['', 'https://x.com'], ['C SAS', 'https://c.com/ok']]);
    expect(l.empresas).toEqual([{ nombre: 'C SAS', url: 'https://c.com/ok' }]);
    expect(l.omitidas).toEqual(['A SAS', 'B SAS']);
  });
  it('no repite la misma empresa con el mismo enlace, y respeta el tope', () => {
    expect(empresasDesdeHoja([['EMPRESA', 'LINK DE ACCESO'], ['A SAS', 'https://a.com'], ['a sas', 'https://a.com']]).empresas).toHaveLength(1);
    const muchas = [['EMPRESA', 'LINK DE ACCESO'], ...Array.from({ length: MAX_EMPRESAS + 20 }, (_, i) => [`E${i}`, `https://e${i}.com`])];
    expect(empresasDesdeHoja(muchas).empresas).toHaveLength(MAX_EMPRESAS);
  });
  it('encuentra las columnas por su nombre aunque cambien de orden, tildes o mayúsculas', () => {
    expect(ubicarColumnasHeinsohn(['link de acceso', 'Empresa'])).toEqual({ empresa: 1, enlace: 0 });
    expect(ubicarColumnasHeinsohn(['Empresa', 'Enlace'])).toEqual({ empresa: 0, enlace: 1 });
    expect(() => ubicarColumnasHeinsohn(['X', 'LINK'])).toThrow(/«EMPRESA»/);
    expect(() => ubicarColumnasHeinsohn(['EMPRESA', 'X'])).toThrow(/«LINK DE ACCESO»/);
  });
  it('hoja vacía o solo con encabezado: lista vacía', () => {
    expect(empresasDesdeHoja([])).toEqual({ empresas: [], omitidas: [] });
    expect(empresasDesdeHoja([['EMPRESA', 'LINK DE ACCESO']])).toEqual({ empresas: [], omitidas: [] });
  });
});

describe('leerEmpresasHeinsohn (Graph simulado)', () => {
  it('abre el archivo, la primera hoja y su rango, y devuelve las empresas; solo hace lecturas', async () => {
    const f = graphFalso();
    const l = await leerEmpresasHeinsohn({ config: CFG, fetch: f as unknown as typeof fetch });
    expect(l.empresas).toHaveLength(3);
    for (const c of f.mock.calls as unknown as [string, RequestInit | undefined][]) {
      if (!String(c[0]).startsWith('https://login.microsoftonline.com/')) expect(c[1]?.method ?? 'GET').toBe('GET');
    }
  });
  it('la guarda en caché dos minutos y la vuelve a pedir pasado ese tiempo', async () => {
    const f = graphFalso();
    let t = 1_000_000;
    const ahora = () => t;
    await leerEmpresasHeinsohn({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    const llamadas = f.mock.calls.length;
    await leerEmpresasHeinsohn({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    expect(f.mock.calls.length).toBe(llamadas);
    t += HEINSOHN_CACHE_MS + 1;
    await leerEmpresasHeinsohn({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    expect(f.mock.calls.length).toBeGreaterThan(llamadas);
  });
  it('errores de Graph: archivo no encontrado, sin permiso, libro sin hojas y hoja sin datos', async () => {
    const e404 = graphFalso(HOJA, (u) => (u.includes('/drive/root:/') ? json(404, {}) : null));
    await expect(leerEmpresasHeinsohn({ config: CFG, fetch: e404 as unknown as typeof fetch })).rejects.toMatchObject({ status: 404 });
    _reiniciarCacheHeinsohn();
    const e403 = graphFalso(HOJA, (u) => (u.includes('/usedRange?') ? json(403, {}) : null));
    await expect(leerEmpresasHeinsohn({ config: CFG, fetch: e403 as unknown as typeof fetch })).rejects.toMatchObject({ status: 403 });
    _reiniciarCacheHeinsohn();
    const sinHojas = graphFalso(HOJA, (u) => (u.includes('/workbook/worksheets?') ? json(200, { value: [] }) : null));
    await expect(leerEmpresasHeinsohn({ config: CFG, fetch: sinHojas as unknown as typeof fetch })).rejects.toBeInstanceOf(FormacionStorageError);
    _reiniciarCacheHeinsohn();
    const sinValores = graphFalso(HOJA, (u) => (u.includes('/usedRange?') ? json(200, {}) : null));
    await expect(leerEmpresasHeinsohn({ config: CFG, fetch: sinValores as unknown as typeof fetch })).rejects.toBeInstanceOf(FormacionStorageError);
  });
});

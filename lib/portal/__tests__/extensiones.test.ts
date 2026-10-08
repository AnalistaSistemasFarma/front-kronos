import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  URL_EXTENSIONES_POR_DEFECTO,
  _reiniciarCacheExtensiones,
  extensionesDeRespaldo,
  leerExtensionesCorporativas,
  leerExtensionesDesdeSharePoint,
  urlExtensiones,
} from '../extensiones';
import { extensionesDeValores, filtrarExtensiones, limpiarCelda, normalizarBusqueda } from '../extensiones-datos';
import { _reiniciarCacheToken } from '../formacion-storage';

// Extensiones Corporativas del Portal TH (Cristian, 2026-10-08): Excel de
// Talento Humano en SharePoint, leído con Graph SIMULADO.

const config = { tenantId: 't', clientId: 'c', clientSecret: 's', siteId: 'sitio', carpetaBase: 'FORMACION' };

const NBSP = ' ';
const HOJA = [
  ['Nombre', 'Número de extensión'],
  ['SST PLANTA', `${NBSP} 1143`],
  ['SELECCIÓN Y DESARROLLO', `${NBSP} 2108`],
  ['  ALMACEN   FARMALOGICA ', `${NBSP} 1107`],
  ['', ''],
];

function graphSimulado(opciones: { shareStatus?: number; hojas?: Record<string, unknown[][]> } = {}) {
  const hojas = opciones.hojas ?? { Hoja1: HOJA };
  const llamadas: string[] = [];
  const f = vi.fn(async (url: string | URL) => {
    const u = String(url);
    llamadas.push(u);
    if (u.includes('login.microsoftonline.com')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (u.includes('/shares/')) {
      if (opciones.shareStatus) return new Response('{}', { status: opciones.shareStatus });
      return Response.json({ id: 'ITEM1', parentReference: { driveId: 'DRIVE1' } });
    }
    if (u.includes('/workbook/worksheets?')) return Response.json({ value: Object.keys(hojas).map((name) => ({ name })) });
    const hoja = /worksheets\('([^']+)'\)/.exec(u)?.[1];
    if (hoja && hojas[decodeURIComponent(hoja)]) return Response.json({ values: hojas[decodeURIComponent(hoja)] });
    return new Response('{}', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, llamadas };
}

beforeEach(() => {
  _reiniciarCacheExtensiones();
  _reiniciarCacheToken();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('limpieza de datos', () => {
  it('quita el espacio duro del inicio de la extensión y los espacios sobrantes', () => {
    expect(limpiarCelda(`${NBSP} 2145`)).toBe('2145');
    expect(limpiarCelda('  DRA   ANA LUCIA ')).toBe('DRA ANA LUCIA');
    expect(limpiarCelda(null)).toBe('');
    expect(limpiarCelda(1143)).toBe('1143');
  });

  it('usa los encabezados, descarta filas vacías y ordena alfabéticamente', () => {
    expect(extensionesDeValores(HOJA)).toEqual([
      { nombre: 'ALMACEN FARMALOGICA', extension: '1107' },
      { nombre: 'SELECCIÓN Y DESARROLLO', extension: '2108' },
      { nombre: 'SST PLANTA', extension: '1143' },
    ]);
  });

  it('encuentra las columnas aunque cambien de orden o se agregue otra', () => {
    expect(
      extensionesDeValores([
        ['Área', 'Número de extensión', 'Nombre'],
        ['Planta', 1143, 'SST PLANTA'],
      ])
    ).toEqual([{ nombre: 'SST PLANTA', extension: '1143' }]);
  });

  it('sin encabezado reconocible toma las dos primeras columnas sin perder la primera fila', () => {
    expect(extensionesDeValores([['SISTEMAS GSS', 1135]])).toEqual([{ nombre: 'SISTEMAS GSS', extension: '1135' }]);
    expect(extensionesDeValores([])).toEqual([]);
  });

  it('el respaldo empaquetado trae las 35 extensiones limpias y ordenadas', () => {
    const lista = extensionesDeRespaldo();
    expect(lista).toHaveLength(35);
    expect(lista.every((e) => /^\d+$/.test(e.extension))).toBe(true);
    expect(lista.some((e) => / /.test(e.nombre + e.extension))).toBe(false);
    const nombres = lista.map((e) => e.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })));
    expect(lista).toContainEqual({ nombre: 'SONIA CRISTANCHO', extension: '2145' });
  });
});

describe('buscador', () => {
  const lista = extensionesDeValores(HOJA);

  it('no distingue tildes ni mayúsculas', () => {
    expect(normalizarBusqueda('  SELECCIÓN ')).toBe('seleccion');
    expect(filtrarExtensiones(lista, 'seleccion').map((e) => e.extension)).toEqual(['2108']);
    expect(filtrarExtensiones(lista, 'sElEcCiÓn').map((e) => e.extension)).toEqual(['2108']);
  });

  it('filtra por número de extensión', () => {
    expect(filtrarExtensiones(lista, '1143').map((e) => e.nombre)).toEqual(['SST PLANTA']);
    expect(filtrarExtensiones(lista, '11').map((e) => e.extension)).toEqual(['1107', '1143']);
  });

  it('todas las palabras deben coincidir; vacío devuelve todo', () => {
    expect(filtrarExtensiones(lista, 'almacen farma').map((e) => e.extension)).toEqual(['1107']);
    expect(filtrarExtensiones(lista, 'almacen planta')).toEqual([]);
    expect(filtrarExtensiones(lista, '   ')).toEqual(lista);
  });
});

describe('lectura desde SharePoint', () => {
  it('por defecto usa el enlace que pasó Cristian; la variable lo reemplaza', () => {
    expect(urlExtensiones({} as NodeJS.ProcessEnv)).toBe(URL_EXTENSIONES_POR_DEFECTO);
    expect(urlExtensiones({ PORTAL_TH_EXTENSIONES_URL: ' https://otro ' } as unknown as NodeJS.ProcessEnv)).toBe('https://otro');
  });

  it('resuelve el enlace, toma la primera hoja y limpia las filas', async () => {
    const { f, llamadas } = graphSimulado();
    const lista = await leerExtensionesDesdeSharePoint({ config, fetch: f, url: 'https://x', hoja: null });
    expect(lista.map((e) => e.extension)).toEqual(['1107', '2108', '1143']);
    expect(llamadas.some((u) => u.includes('/shares/u!'))).toBe(true);
    expect(llamadas.some((u) => u.includes("/drives/DRIVE1/items/ITEM1/workbook/worksheets('Hoja1')/usedRange"))).toBe(true);
  });

  it('una hoja vacía es un error (no se reemplaza la lista por una tabla en blanco)', async () => {
    const { f } = graphSimulado({ hojas: { Hoja1: [['Nombre', 'Número de extensión']] } });
    await expect(leerExtensionesDesdeSharePoint({ config, fetch: f, url: 'https://x', hoja: null })).rejects.toThrow(/no trae/);
  });

  it('si Graph no resuelve el enlace, el error trae el estado', async () => {
    const { f } = graphSimulado({ shareStatus: 403 });
    await expect(leerExtensionesDesdeSharePoint({ config, fetch: f, url: 'https://x', hoja: null })).rejects.toThrow(/403/);
  });
});

describe('caché y respaldo', () => {
  const buena = [{ nombre: 'A', extension: '1' }];

  it('cachea 5 minutos', async () => {
    const leer = vi.fn(async () => buena);
    let t = 0;
    const ahora = () => t;
    await leerExtensionesCorporativas({ leer, ahora });
    t = 4 * 60_000;
    await leerExtensionesCorporativas({ leer, ahora });
    expect(leer).toHaveBeenCalledTimes(1);
    t = 6 * 60_000;
    await leerExtensionesCorporativas({ leer, ahora });
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it('si SharePoint falla conserva la última lista buena', async () => {
    let t = 0;
    const ahora = () => t;
    await leerExtensionesCorporativas({ leer: async () => buena, ahora });
    t = 10 * 60_000;
    const r = await leerExtensionesCorporativas({ leer: async () => Promise.reject(new Error('caído')), ahora });
    expect(r).toEqual({ extensiones: buena, origen: 'ultima-buena' });
  });

  it('si nunca se pudo leer, devuelve el respaldo empaquetado', async () => {
    const r = await leerExtensionesCorporativas({ leer: async () => Promise.reject(new Error('caído')) });
    expect(r.origen).toBe('respaldo');
    expect(r.extensiones).toHaveLength(35);
  });
});

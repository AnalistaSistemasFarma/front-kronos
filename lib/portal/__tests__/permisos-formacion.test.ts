import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOJAS_CON_PERMISO,
  URL_PERMISOS_POR_DEFECTO,
  _reiniciarCachePermisos,
  correosConMarcadoManual,
  correosDeValores,
  idDeEnlaceCompartido,
  leerPermisosDesdeSharePoint,
  urlPermisosFormacion,
} from '../permisos-formacion';
import { _reiniciarCacheToken } from '../formacion-storage';

// Lectura del Excel "ADMINISTRADORES - FORMADORES" (Cristian, 2026-10-08) con
// Graph SIMULADO: enlace compartido → driveItem → usedRange de cada hoja.

const config = { tenantId: 't', clientId: 'c', clientSecret: 's', siteId: 'sitio', carpetaBase: 'FORMACION' };

function graphSimulado(hojas: Record<string, unknown[][]>, opciones: { shareStatus?: number } = {}) {
  const llamadas: string[] = [];
  const f = vi.fn(async (url: string | URL) => {
    const u = String(url);
    llamadas.push(u);
    if (u.includes('login.microsoftonline.com')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (u.includes('/shares/')) {
      if (opciones.shareStatus) return new Response('{}', { status: opciones.shareStatus });
      return Response.json({ id: 'ITEM1', parentReference: { driveId: 'DRIVE1' } });
    }
    const hoja = /worksheets\('([^']+)'\)/.exec(u)?.[1];
    if (hoja && hojas[hoja]) return Response.json({ values: hojas[hoja] });
    return new Response('{}', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, llamadas };
}

beforeEach(() => {
  _reiniciarCachePermisos();
  _reiniciarCacheToken();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('correosDeValores', () => {
  it('toma la columna CORREO y descarta el encabezado y los vacíos', () => {
    expect(
      correosDeValores([
        ['USUARIO', 'CORREO'],
        ['Persona Uno', 'Uno@GssLatam.com '],
        ['Sin correo', ''],
        ['Persona Dos', 'dos@farmalogica.com'],
      ])
    ).toEqual(['uno@gsslatam.com', 'dos@farmalogica.com']);
  });

  it('sin encabezado de correo recoge cualquier celda que parezca correo', () => {
    expect(correosDeValores([['a@b.co', 'x'], ['nada', 'c@d.com']])).toEqual(['a@b.co', 'c@d.com']);
  });

  it('una hoja vacía o solo con encabezado no da permisos', () => {
    expect(correosDeValores([])).toEqual([]);
    expect(correosDeValores([['USUARIO', 'CORREO']])).toEqual([]);
  });
});

describe('enlace del archivo', () => {
  it('usa PORTAL_TH_PERMISOS_FORMACION_URL o el enlace por defecto', () => {
    expect(urlPermisosFormacion({} as NodeJS.ProcessEnv)).toBe(URL_PERMISOS_POR_DEFECTO);
    expect(urlPermisosFormacion({ PORTAL_TH_PERMISOS_FORMACION_URL: ' https://x/y ' } as unknown as NodeJS.ProcessEnv)).toBe('https://x/y');
  });

  it('codifica el enlace como u!base64url sin relleno', () => {
    const id = idDeEnlaceCompartido('https://a.b/c?d=e');
    expect(id.startsWith('u!')).toBe(true);
    expect(id).not.toMatch(/[=+/]/);
  });
});

describe('leerPermisosDesdeSharePoint (Graph simulado)', () => {
  it('une los correos de ADMINISTRADORES y FORMADORES', async () => {
    const { f, llamadas } = graphSimulado({
      ADMINISTRADORES: [['USUARIO', 'CORREO'], ['Admin', 'admin@gsslatam.com']],
      FORMADORES: [['USUARIO', 'CORREO'], ['Formadora', 'formadora@gsslatam.com']],
    });
    const correos = await leerPermisosDesdeSharePoint({ config, fetch: f, url: 'https://sp/enlace' });
    expect([...correos].sort()).toEqual(['admin@gsslatam.com', 'formadora@gsslatam.com']);
    expect(HOJAS_CON_PERMISO.every((h) => llamadas.some((u) => u.includes(`worksheets('${h}')/usedRange`)))).toBe(true);
    expect(llamadas.some((u) => u.includes('/drives/DRIVE1/items/ITEM1/workbook/'))).toBe(true);
  });

  it('si Graph no resuelve el enlace, lanza con el estado', async () => {
    const { f } = graphSimulado({}, { shareStatus: 403 });
    await expect(leerPermisosDesdeSharePoint({ config, fetch: f, url: 'https://sp/enlace' })).rejects.toThrow(/403/);
  });
});

describe('correosConMarcadoManual (caché y respaldo)', () => {
  it('cachea 5 minutos y luego vuelve a leer', async () => {
    let ahora = 0;
    const leer = vi.fn(async () => new Set(['a@gsslatam.com']));
    await correosConMarcadoManual({ leer, ahora: () => ahora });
    ahora = 4 * 60_000;
    await correosConMarcadoManual({ leer, ahora: () => ahora });
    expect(leer).toHaveBeenCalledTimes(1);
    ahora = 6 * 60_000;
    await correosConMarcadoManual({ leer, ahora: () => ahora });
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it('si SharePoint falla, conserva la última lista buena', async () => {
    let ahora = 0;
    await correosConMarcadoManual({ leer: async () => new Set(['a@gsslatam.com']), ahora: () => ahora });
    ahora = 10 * 60_000;
    const correos = await correosConMarcadoManual({
      leer: async () => {
        throw new Error('Graph caído');
      },
      ahora: () => ahora,
    });
    expect(correos.has('a@gsslatam.com')).toBe(true);
  });

  it('si nunca se pudo leer, nadie tiene permiso manual (falla cerrado)', async () => {
    const correos = await correosConMarcadoManual({
      leer: async () => {
        throw new Error('Graph caído');
      },
    });
    expect(correos.size).toBe(0);
  });
});

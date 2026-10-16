import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageNoConfigurado, _reiniciarCacheToken } from '../formacion-storage';
import {
  CARPETA_AYUDAS_POR_DEFECTO,
  _reiniciarCachePoliticas,
  leerConfigAyudas,
  listarPoliticas,
  urlVistaPreviaPolitica,
  type ConfigPoliticas,
} from '../politicas-storage';

// AYUDAS (Cristian Baldión, 2026-10-15): videos de FORMACION/AYUDAS leídos con la misma lectura de Políticas. SharePoint SIMULADO.

const ENV = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: 's',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,024c062f,12fcaddd',
} as unknown as NodeJS.ProcessEnv;
const POLITICAS: ConfigPoliticas = { tenantId: 't', clientId: 'c', clientSecret: 's', siteId: ENV.PORTAL_TH_SP_SITE_ID as string, carpeta: 'POLITICAS Y REGLAMENTOS' };
const G = 'https://graph.microsoft.com/v1.0';
const DRIVE = `${G}/sites/${encodeURIComponent(ENV.PORTAL_TH_SP_SITE_ID as string)}/drive`;
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });
const video = (id: string, name: string) => ({ id, name, size: 15_000_000, lastModifiedDateTime: '2026-10-14T20:00:00Z', file: { mimeType: 'video/mp4' } });

function fetchFalso(manejar: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return json(200, { access_token: 'tok', expires_in: 3600 });
    return manejar(u, init ?? {});
  });
}

beforeEach(() => {
  _reiniciarCacheToken();
  _reiniciarCachePoliticas();
});

describe('leerConfigAyudas', () => {
  it('por defecto lee FORMACION/AYUDAS, con la misma app y sitio que Políticas', () => {
    const c = leerConfigAyudas(ENV);
    expect(CARPETA_AYUDAS_POR_DEFECTO).toBe('FORMACION/AYUDAS');
    expect(c).toMatchObject({ carpeta: 'FORMACION/AYUDAS', siteId: ENV.PORTAL_TH_SP_SITE_ID, clientId: 'c' });
  });
  it('PORTAL_TH_SP_HELP_FOLDER la cambia; la variable de Políticas no la afecta', () => {
    expect(leerConfigAyudas({ ...ENV, PORTAL_TH_SP_HELP_FOLDER: 'AYUDA/VIDEOS' } as NodeJS.ProcessEnv).carpeta).toBe('AYUDA/VIDEOS');
    expect(leerConfigAyudas({ ...ENV, PORTAL_TH_SP_POLICIES_FOLDER: 'OTRA' } as NodeJS.ProcessEnv).carpeta).toBe('FORMACION/AYUDAS');
  });
  it('rechaza rutas peligrosas o demasiado profundas', () => {
    for (const mala of ['..', '../x', 'A/../B', 'A//B', '/A', 'A/', 'A:B', 'A/B/C/D', 'A/ B', 'con?']) {
      expect(() => leerConfigAyudas({ ...ENV, PORTAL_TH_SP_HELP_FOLDER: mala } as NodeJS.ProcessEnv), mala).toThrow(FormacionStorageNoConfigurado);
    }
  });
  it('sin las variables de SharePoint lanza «no configurado»', () => {
    expect(() => leerConfigAyudas({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
  });
});

describe('listar la carpeta de dos niveles', () => {
  it('pide la ruta FORMACION/AYUDAS con cada nivel codificado y devuelve los videos', async () => {
    const f = fetchFalso((u) =>
      u.startsWith(`${DRIVE}/root:/FORMACION/AYUDAS:/children`)
        ? json(200, { value: [video('V2', 'Como crear una solicitud.mp4'), video('V1', 'Cambio de contraseña.mp4')] })
        : json(404, {})
    );
    const l = await listarPoliticas({ config: leerConfigAyudas(ENV), fetch: f as unknown as typeof fetch });
    expect(l.carpeta).toBe('FORMACION/AYUDAS');
    expect(l.archivos.map((a) => [a.nombre, a.tipo, a.carpeta])).toEqual([
      ['Cambio de contraseña.mp4', 'mp4', ''],
      ['Como crear una solicitud.mp4', 'mp4', ''],
    ]);
  });

  it('Políticas y Ayudas no se pisan la caché: cada carpeta guarda su listado', async () => {
    const f = fetchFalso((u) =>
      u.includes('/root:/FORMACION/AYUDAS:/children')
        ? json(200, { value: [video('V1', 'a.mp4')] })
        : json(200, { value: [{ id: 'P1', name: 'Reglamento.pdf', size: 1, file: { mimeType: 'application/pdf' } }] })
    );
    const pol = await listarPoliticas({ config: POLITICAS, fetch: f as unknown as typeof fetch });
    const ayu = await listarPoliticas({ config: leerConfigAyudas(ENV), fetch: f as unknown as typeof fetch });
    expect(pol.archivos[0].id).toBe('P1');
    expect(ayu.archivos[0].id).toBe('V1');
    const llamadas = f.mock.calls.length;
    // Vuelven de la caché, sin otra llamada a Graph, y cada una con SU listado.
    expect((await listarPoliticas({ config: POLITICAS, fetch: f as unknown as typeof fetch })).archivos[0].id).toBe('P1');
    expect((await listarPoliticas({ config: leerConfigAyudas(ENV), fetch: f as unknown as typeof fetch })).archivos[0].id).toBe('V1');
    expect(f.mock.calls.length).toBe(llamadas);
  });
});

describe('vista previa de un video de ayuda', () => {
  const embed = 'https://gsslatam.sharepoint.com/sites/TalentoHumano/_layouts/15/embed.aspx?x=1';
  it('entrega la URL de SharePoint solo para un video de ESA carpeta', async () => {
    const f = fetchFalso((u, init) => {
      if (u.includes('/root:/FORMACION/AYUDAS:/children')) return json(200, { value: [video('V1', 'a.mp4')] });
      if (u.endsWith('/items/V1/preview') && init.method === 'POST') return json(200, { getUrl: embed });
      return json(404, {});
    });
    const cfg = leerConfigAyudas(ENV);
    expect(await urlVistaPreviaPolitica('V1', { config: cfg, fetch: f as unknown as typeof fetch })).toBe(embed);
    // Un archivo que NO está en la carpeta de ayudas (p. ej. uno de Políticas) no se puede previsualizar por aquí.
    expect(await urlVistaPreviaPolitica('P1', { config: cfg, fetch: f as unknown as typeof fetch })).toBeNull();
    expect(f.mock.calls.some((c) => String(c[0]).endsWith('/items/P1/preview'))).toBe(false);
  });
});

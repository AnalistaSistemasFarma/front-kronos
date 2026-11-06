import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageNoConfigurado, _reiniciarCacheToken } from '../formacion-storage';
import {
  CARPETA_CAPACITACIONES_POR_DEFECTO,
  _reiniciarCachePoliticas,
  leerConfigAyudas,
  leerConfigCapacitaciones,
  listarPoliticas,
  urlVistaPreviaPolitica,
} from '../politicas-storage';

// CAPACITACIONES (Cristian Baldión, 2026-10-22): espejo de AYUDAS que lee FORMACION/CAPACITACIONES. SharePoint SIMULADO.

const ENV = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: 's',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,024c062f,12fcaddd',
} as unknown as NodeJS.ProcessEnv;
const G = 'https://graph.microsoft.com/v1.0';
const DRIVE = `${G}/sites/${encodeURIComponent(ENV.PORTAL_TH_SP_SITE_ID as string)}/drive`;
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });
const archivo = (id: string, name: string) => ({ id, name, size: 1000, lastModifiedDateTime: '2026-10-22T13:00:00Z', file: { mimeType: 'video/mp4' } });

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

describe('leerConfigCapacitaciones', () => {
  it('por defecto lee FORMACION/CAPACITACIONES, con la misma app y sitio que Ayudas', () => {
    expect(CARPETA_CAPACITACIONES_POR_DEFECTO).toBe('FORMACION/CAPACITACIONES');
    expect(leerConfigCapacitaciones(ENV)).toMatchObject({ carpeta: 'FORMACION/CAPACITACIONES', siteId: ENV.PORTAL_TH_SP_SITE_ID, clientId: 'c' });
  });
  it('PORTAL_TH_SP_TRAINING_FOLDER la cambia; ni Ayudas, ni Políticas, ni la carpeta de Formación (FORMACION-PRUEBAS) la afectan', () => {
    expect(leerConfigCapacitaciones({ ...ENV, PORTAL_TH_SP_TRAINING_FOLDER: 'TH/CURSOS' } as NodeJS.ProcessEnv).carpeta).toBe('TH/CURSOS');
    const otras = { ...ENV, PORTAL_TH_SP_HELP_FOLDER: 'X', PORTAL_TH_SP_POLICIES_FOLDER: 'Y', PORTAL_TH_SP_FOLDER: 'FORMACION-PRUEBAS' };
    expect(leerConfigCapacitaciones(otras as NodeJS.ProcessEnv).carpeta).toBe('FORMACION/CAPACITACIONES');
    // Y al revés: la variable de Capacitaciones no mueve la de Ayudas.
    expect(leerConfigAyudas({ ...ENV, PORTAL_TH_SP_TRAINING_FOLDER: 'TH/CURSOS' } as NodeJS.ProcessEnv).carpeta).toBe('FORMACION/AYUDAS');
  });
  it('rechaza rutas peligrosas o demasiado profundas, nombrando su variable', () => {
    for (const mala of ['..', '../x', 'A/../B', 'A//B', '/A', 'A/', 'A:B', 'A/B/C/D', 'con?']) {
      expect(() => leerConfigCapacitaciones({ ...ENV, PORTAL_TH_SP_TRAINING_FOLDER: mala } as NodeJS.ProcessEnv), mala).toThrow(
        /PORTAL_TH_SP_TRAINING_FOLDER/
      );
    }
  });
  it('sin las variables de SharePoint lanza «no configurado»', () => {
    expect(() => leerConfigCapacitaciones({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
  });
});

describe('listado y vista previa de CAPACITACIONES', () => {
  it('pide la ruta FORMACION/CAPACITACIONES y no comparte caché con Ayudas', async () => {
    const f = fetchFalso((u) => {
      if (u.startsWith(`${DRIVE}/root:/FORMACION/CAPACITACIONES:/children`)) return json(200, { value: [archivo('C1', 'Induccion.mp4')] });
      if (u.startsWith(`${DRIVE}/root:/FORMACION/AYUDAS:/children`)) return json(200, { value: [archivo('A1', 'Ayuda.mp4')] });
      return json(404, {});
    });
    const cap = await listarPoliticas({ config: leerConfigCapacitaciones(ENV), fetch: f });
    const ayu = await listarPoliticas({ config: leerConfigAyudas(ENV), fetch: f });
    expect(cap.carpeta).toBe('FORMACION/CAPACITACIONES');
    expect(cap.archivos.map((a) => a.id)).toEqual(['C1']);
    expect(ayu.archivos.map((a) => a.id)).toEqual(['A1']);
  });
  it('carpeta vacía: listado vacío, sin error', async () => {
    const f = fetchFalso(() => json(200, { value: [] }));
    const l = await listarPoliticas({ config: leerConfigCapacitaciones(ENV), fetch: f });
    expect(l).toEqual({ carpeta: 'FORMACION/CAPACITACIONES', archivos: [], truncado: false });
  });
  it('no previsualiza un archivo de otra carpeta (p. ej. de Ayudas)', async () => {
    const f = fetchFalso((u) => {
      if (u.includes('/root:/FORMACION/CAPACITACIONES:/children')) return json(200, { value: [archivo('C1', 'a.mp4')] });
      return json(500, {});
    });
    expect(await urlVistaPreviaPolitica('A1', { config: leerConfigCapacitaciones(ENV), fetch: f })).toBeNull();
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/preview'))).toBe(false);
  });
});

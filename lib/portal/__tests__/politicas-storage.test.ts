import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageNoConfigurado, _reiniciarCacheToken } from '../formacion-storage';
import {
  CARPETA_POLITICAS_POR_DEFECTO,
  MAX_ARCHIVOS,
  POLITICAS_CACHE_MS,
  PoliticasError,
  _reiniciarCachePoliticas,
  esIdValido,
  leerConfigPoliticas,
  listarPoliticas,
  urlVistaPreviaPolitica,
  type ConfigPoliticas,
} from '../politicas-storage';

/**
 * LECTURA DE "POLITICAS Y REGLAMENTOS" (Portal TH → SharePoint TalentoHumano).
 *
 * Se protege: (1) configuración y valor por defecto de la carpeta, (2) listado
 * aplanado con subcarpetas y paginación, (3) caché corta, (4) que la vista
 * previa SOLO se entregue para archivos de la carpeta y SOLO si es una URL
 * https de SharePoint, y (5) que los errores de Graph conserven su estado.
 */

const CFG: ConfigPoliticas = {
  tenantId: 'tenant-gss',
  clientId: 'app-portal-th',
  clientSecret: 'secreto',
  siteId: 'gsslatam.sharepoint.com,024c062f,12fcaddd',
  carpeta: 'POLITICAS Y REGLAMENTOS',
};
const G = 'https://graph.microsoft.com/v1.0';
const DRIVE = `${G}/sites/${encodeURIComponent(CFG.siteId)}/drive`;

const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });

function fetchFalso(manejar: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return json(200, { access_token: 'tok', expires_in: 3600 });
    return manejar(u, init ?? {});
  });
}

const raiz = `${DRIVE}/root:/POLITICAS%20Y%20REGLAMENTOS:/children`;
const archivo = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  size: 1000,
  lastModifiedDateTime: '2026-09-09T16:58:11Z',
  file: { mimeType: 'application/pdf' },
  ...extra,
});

beforeEach(() => {
  _reiniciarCacheToken();
  _reiniciarCachePoliticas();
});

describe('leerConfigPoliticas', () => {
  const env = {
    PORTAL_TH_SP_TENANT_ID: 't',
    PORTAL_TH_SP_CLIENT_ID: 'c',
    PORTAL_TH_SP_CLIENT_SECRET: 's',
    PORTAL_TH_SP_SITE_ID: 'site',
  } as unknown as NodeJS.ProcessEnv;

  it('sin credenciales lanza FormacionStorageNoConfigurado', () => {
    expect(() => leerConfigPoliticas({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
  });

  it('por defecto usa "POLITICAS Y REGLAMENTOS" y respeta PORTAL_TH_SP_POLICIES_FOLDER', () => {
    expect(leerConfigPoliticas(env).carpeta).toBe(CARPETA_POLITICAS_POR_DEFECTO);
    expect(leerConfigPoliticas({ ...env, PORTAL_TH_SP_POLICIES_FOLDER: 'REGLAMENTOS' }).carpeta).toBe('REGLAMENTOS');
  });

  it('no acepta una carpeta con separadores o ".."', () => {
    for (const malo of ['A/B', '../OTRA', 'X\\Y']) {
      expect(() => leerConfigPoliticas({ ...env, PORTAL_TH_SP_POLICIES_FOLDER: malo })).toThrow(FormacionStorageNoConfigurado);
    }
  });

  it('no se deja afectar por PORTAL_TH_SP_FOLDER (la de Formación)', () => {
    expect(leerConfigPoliticas({ ...env, PORTAL_TH_SP_FOLDER: 'FORMACION' }).carpeta).toBe(CARPETA_POLITICAS_POR_DEFECTO);
  });
});

describe('listarPoliticas', () => {
  it('aplana subcarpetas, sigue la paginación de Graph y ordena', async () => {
    const f = fetchFalso((u) => {
      if (u.startsWith(raiz)) {
        return json(200, {
          value: [archivo('b', 'Reglamento Interno.pdf'), { id: 'dir', name: 'Anexos', folder: { childCount: 1 } }],
          '@odata.nextLink': `${G}/pagina-2`,
        });
      }
      if (u === `${G}/pagina-2`) return json(200, { value: [archivo('a', 'Politica SST.pdf')] });
      if (u.startsWith(`${DRIVE}/root:/POLITICAS%20Y%20REGLAMENTOS/Anexos:/children`)) {
        return json(200, { value: [archivo('c', 'Formato.docx', { file: { mimeType: 'application/msword' } })] });
      }
      return json(404, {});
    });
    const r = await listarPoliticas({ config: CFG, fetch: f });
    expect(r.carpeta).toBe('POLITICAS Y REGLAMENTOS');
    expect(r.truncado).toBe(false);
    expect(r.archivos.map((a) => [a.carpeta, a.nombre, a.tipo])).toEqual([
      ['', 'Politica SST.pdf', 'pdf'],
      ['', 'Reglamento Interno.pdf', 'pdf'],
      ['Anexos', 'Formato.docx', 'docx'],
    ]);
    // El token va en la cabecera, nunca en la URL.
    for (const [url, init] of f.mock.calls.slice(1)) {
      expect(String(url)).not.toContain('tok');
      expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
    }
  });

  it('no sigue un nextLink que no sea de Graph', async () => {
    const f = fetchFalso((u) =>
      u.startsWith(raiz) ? json(200, { value: [archivo('a', 'x.pdf')], '@odata.nextLink': 'https://evil.example/x' }) : json(500, {})
    );
    const r = await listarPoliticas({ config: CFG, fetch: f });
    expect(r.archivos).toHaveLength(1);
    expect(f.mock.calls.some(([u]) => String(u).includes('evil'))).toBe(false);
  });

  it('corta en MAX_ARCHIVOS y lo avisa', async () => {
    const muchos = Array.from({ length: MAX_ARCHIVOS + 5 }, (_, i) => archivo(`id${i}`, `doc ${i}.pdf`));
    const f = fetchFalso(() => json(200, { value: muchos }));
    const r = await listarPoliticas({ config: CFG, fetch: f });
    expect(r.archivos).toHaveLength(MAX_ARCHIVOS);
    expect(r.truncado).toBe(true);
  });

  it('usa la caché durante POLITICAS_CACHE_MS y relista después', async () => {
    let t = 1_000_000;
    const f = fetchFalso(() => json(200, { value: [archivo('a', 'x.pdf')] }));
    await listarPoliticas({ config: CFG, fetch: f, ahora: () => t });
    await listarPoliticas({ config: CFG, fetch: f, ahora: () => t + POLITICAS_CACHE_MS - 1 });
    const listados = () => f.mock.calls.filter(([u]) => String(u).includes(':/children')).length;
    expect(listados()).toBe(1);
    t += POLITICAS_CACHE_MS + 1;
    await listarPoliticas({ config: CFG, fetch: f, ahora: () => t });
    expect(listados()).toBe(2);
  });

  it('un 403 de Graph llega como PoliticasError con su estado', async () => {
    const f = fetchFalso(() => json(403, { error: { code: 'accessDenied' } }));
    await expect(listarPoliticas({ config: CFG, fetch: f })).rejects.toMatchObject({ name: 'PoliticasError', status: 403 });
  });
});

describe('urlVistaPreviaPolitica', () => {
  const conPreview = (getUrl: unknown, status = 200) =>
    fetchFalso((u, init) => {
      if (u.includes(':/children')) return json(200, { value: [archivo('01ABC!x', 'Reglamento.pdf')] });
      if (u === `${DRIVE}/items/01ABC!x/preview` && init.method === 'POST') return json(status, { getUrl });
      return json(404, {});
    });

  it('devuelve la getUrl de SharePoint de un archivo de la carpeta', async () => {
    const url = 'https://gsslatam.sharepoint.com/sites/TalentoHumano/_layouts/15/embed.aspx?x=1';
    expect(await urlVistaPreviaPolitica('01ABC!x', { config: CFG, fetch: conPreview(url) })).toBe(url);
  });

  it('un id que no está en la carpeta devuelve null (y relista una vez antes)', async () => {
    const f = conPreview('https://gsslatam.sharepoint.com/x');
    expect(await urlVistaPreviaPolitica('OTRO', { config: CFG, fetch: f })).toBeNull();
    expect(f.mock.calls.filter(([u]) => String(u).includes('/preview'))).toHaveLength(0);
    expect(f.mock.calls.filter(([u]) => String(u).includes(':/children'))).toHaveLength(2);
  });

  it('rechaza ids con caracteres raros sin llamar a Graph', async () => {
    const f = conPreview('https://gsslatam.sharepoint.com/x');
    expect(await urlVistaPreviaPolitica('../root', { config: CFG, fetch: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(esIdValido('01ABC!x')).toBe(true);
    expect(esIdValido('a/b')).toBe(false);
  });

  it('no entrega una URL que no sea https de *.sharepoint.com', async () => {
    for (const mala of ['http://gsslatam.sharepoint.com/x', 'https://evil.example/x', 'javascript:alert(1)', undefined]) {
      _reiniciarCachePoliticas();
      await expect(urlVistaPreviaPolitica('01ABC!x', { config: CFG, fetch: conPreview(mala) })).rejects.toBeInstanceOf(
        PoliticasError
      );
    }
  });

  it('propaga el estado de Graph si la vista previa falla', async () => {
    await expect(
      urlVistaPreviaPolitica('01ABC!x', { config: CFG, fetch: conPreview(null, 403) })
    ).rejects.toMatchObject({ status: 403 });
  });
});

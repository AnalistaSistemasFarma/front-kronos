import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArchivoFueraDeCarpeta,
  FormacionStorageNoConfigurado,
  crearSesionSubida,
  obtenerArchivoSubidoEnCarpeta,
  LIMITE_SUBIDA_SIMPLE,
  TAMANO_TROZO,
  _reiniciarCacheToken,
  carpetaDeCurso,
  descargarArchivoFormacion,
  esSegmentoValido,
  leerConfigFormacion,
  nombreArchivoSeguro,
  rutaDentroDeFormacion,
  subirArchivoFormacion,
  type ConfigFormacionSharePoint,
} from '../formacion-storage';

/**
 * CLIENTE GRAPH DE FORMACIÓN (Portal TH → SharePoint TalentoHumano/FORMACION).
 *
 * Lo que se protege aquí: (1) que sin credenciales se FALLE con un error
 * claro y no se siga de largo, (2) que ninguna ruta pueda salirse de la
 * carpeta base, y (3) que la subida use el camino correcto de Graph según el
 * tamaño (PUT simple ≤ 4 MB, upload session por encima) con `rename`.
 */

const CFG: ConfigFormacionSharePoint = {
  tenantId: 'tenant-gss',
  clientId: 'app-portal-th',
  clientSecret: 'secreto',
  siteId: 'gsslatam.sharepoint.com,024c062f,12fcaddd',
  carpetaBase: 'FORMACION',
};

const ENV_COMPLETO = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: 's',
  PORTAL_TH_SP_SITE_ID: 'site',
} as unknown as NodeJS.ProcessEnv;

function respuesta(status: number, cuerpo?: unknown, headers?: Record<string, string>) {
  return new Response(cuerpo === undefined ? null : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
    status,
    headers,
  });
}

function fetchFalso(manejar: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return respuesta(200, { access_token: 'tok', expires_in: 3600 });
    return manejar(u, init ?? {});
  });
}

beforeEach(() => _reiniciarCacheToken());

describe('leerConfigFormacion', () => {
  it('sin variables, lanza FormacionStorageNoConfigurado nombrando las que faltan', () => {
    expect(() => leerConfigFormacion({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
    try {
      leerConfigFormacion({ PORTAL_TH_SP_TENANT_ID: 't' } as unknown as NodeJS.ProcessEnv);
    } catch (e) {
      expect((e as FormacionStorageNoConfigurado).detalle).toContain('PORTAL_TH_SP_CLIENT_SECRET');
      expect((e as FormacionStorageNoConfigurado).detalle).not.toContain('PORTAL_TH_SP_TENANT_ID');
    }
  });

  it('con todo, la carpeta base por defecto es FORMACION', () => {
    expect(leerConfigFormacion(ENV_COMPLETO).carpetaBase).toBe('FORMACION');
  });

  it('rechaza una carpeta base que intente salirse o anidar', () => {
    for (const mala of ['../OTRA', 'FORMACION/../X', 'A/B', '..', 'a\\b']) {
      expect(() => leerConfigFormacion({ ...ENV_COMPLETO, PORTAL_TH_SP_FOLDER: mala })).toThrow(
        FormacionStorageNoConfigurado
      );
    }
  });
});

describe('rutas seguras', () => {
  it('nombreArchivoSeguro quita rutas, .. y caracteres prohibidos', () => {
    expect(nombreArchivoSeguro('../../etc/passwd')).toBe('passwd');
    expect(nombreArchivoSeguro('C:\\Users\\x\\Informe final.pdf')).toBe('Informe final.pdf');
    expect(nombreArchivoSeguro('a..b<>:"|?*.docx')).toBe('a.b_______.docx');
    expect(nombreArchivoSeguro('..')).toBe('archivo');
    expect(nombreArchivoSeguro('')).toBe('archivo');
    expect(nombreArchivoSeguro('CON')).toBe('archivo');
    const largo = nombreArchivoSeguro(`${'x'.repeat(300)}.pptx`);
    expect(largo.length).toBeLessThanOrEqual(120);
    expect(largo.endsWith('.pptx')).toBe(true);
  });

  it('carpetaDeCurso: slug sin tildes + id', () => {
    expect(carpetaDeCurso('Inducción SST — 2026', 7)).toBe('induccion-sst-2026-7');
    expect(carpetaDeCurso('../../', 3)).toBe('curso-3');
    expect(() => carpetaDeCurso('x', 0)).toThrow();
  });

  it('rutaDentroDeFormacion siempre empieza por la carpeta base y valida cada segmento', () => {
    expect(rutaDentroDeFormacion('FORMACION', 'sst-1', 'materiales', 'a.pdf')).toBe('FORMACION/sst-1/materiales/a.pdf');
    expect(() => rutaDentroDeFormacion('FORMACION', '..', 'materiales', 'a.pdf')).toThrow();
    expect(() => rutaDentroDeFormacion('FORMACION', 'sst-1', 'materiales', '../a.pdf')).toThrow();
    expect(() =>
      rutaDentroDeFormacion('FORMACION', 'sst-1', 'otra' as unknown as 'materiales', 'a.pdf')
    ).toThrow();
    expect(esSegmentoValido('FORMACION')).toBe(true);
    expect(esSegmentoValido('a/b')).toBe(false);
  });
});

describe('subirArchivoFormacion', () => {
  it('≤ 4 MB: PUT simple a FORMACION/<curso>/materiales con conflictBehavior=rename', async () => {
    const f = fetchFalso(() =>
      respuesta(201, { id: 'ITEM1', name: 'guia.pdf', size: 3, webUrl: 'https://sp/guia.pdf', file: { mimeType: 'application/pdf' } })
    );
    const r = await subirArchivoFormacion(
      { carpetaCurso: 'sst-1', subcarpeta: 'materiales', nombreArchivo: 'guia.pdf', contenido: new Uint8Array([1, 2, 3]), mime: 'application/pdf' },
      { config: CFG, fetch: f as unknown as typeof fetch }
    );
    expect(r).toEqual({ driveItemId: 'ITEM1', webUrl: 'https://sp/guia.pdf', nombre: 'guia.pdf', tamano: 3, mime: 'application/pdf' });
    const [url, init] = f.mock.calls[1] as [string, RequestInit];
    expect(url).toContain(`/sites/${encodeURIComponent(CFG.siteId)}/drive/root:/FORMACION/sst-1/materiales/guia.pdf:/content`);
    expect(url).toContain('@microsoft.graph.conflictBehavior=rename');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('> 4 MB: createUploadSession + trozos con Content-Range y sin Bearer', async () => {
    const total = 2 * TAMANO_TROZO + 10; // 3 trozos (> 4 MB)
    const llamadas: { url: string; init: RequestInit }[] = [];
    const f = fetchFalso((url, init) => {
      llamadas.push({ url, init });
      if (url.endsWith(':/createUploadSession')) return respuesta(200, { uploadUrl: 'https://upload.sp/sesion' });
      const rango = (init.headers as Record<string, string>)['Content-Range'];
      if (rango.endsWith(`-${total - 1}/${total}`)) return respuesta(201, { id: 'GRANDE', name: 'video.mp4', size: total });
      return respuesta(202, { nextExpectedRanges: [] });
    });
    const r = await subirArchivoFormacion(
      { carpetaCurso: 'sst-1', subcarpeta: 'materiales', nombreArchivo: 'video.mp4', contenido: new Uint8Array(total), mime: 'video/mp4' },
      { config: CFG, fetch: f as unknown as typeof fetch }
    );
    expect(r.driveItemId).toBe('GRANDE');
    const sesion = llamadas[0];
    expect(sesion.url).toContain('/drive/root:/FORMACION/sst-1/materiales/video.mp4:/createUploadSession');
    expect(JSON.parse(String(sesion.init.body))).toEqual({ item: { '@microsoft.graph.conflictBehavior': 'rename' } });
    const trozos = llamadas.slice(1);
    expect(trozos).toHaveLength(3);
    expect((trozos[0].init.headers as Record<string, string>)['Content-Range']).toBe(`bytes 0-${TAMANO_TROZO - 1}/${total}`);
    for (const t of trozos) {
      expect(t.url).toBe('https://upload.sp/sesion');
      expect((t.init.headers as Record<string, string>).Authorization).toBeUndefined();
    }
    expect(TAMANO_TROZO % (320 * 1024)).toBe(0);
  });

  it('si un trozo falla, cancela la sesión y lanza', async () => {
    const f = fetchFalso((url, init) => {
      if (url.endsWith(':/createUploadSession')) return respuesta(200, { uploadUrl: 'https://upload.sp/s' });
      if (init.method === 'DELETE') return respuesta(204);
      return respuesta(500);
    });
    await expect(
      subirArchivoFormacion(
        { carpetaCurso: 'c-1', subcarpeta: 'materiales', nombreArchivo: 'x.mp4', contenido: new Uint8Array(LIMITE_SUBIDA_SIMPLE + 1), mime: 'video/mp4' },
        { config: CFG, fetch: f as unknown as typeof fetch }
      )
    ).rejects.toThrow(/trozo/);
    expect(f.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE')).toBe(true);
  });

  it('reutiliza el token mientras no venza', async () => {
    const f = fetchFalso(() => respuesta(201, { id: 'X' }));
    const deps = { config: CFG, fetch: f as unknown as typeof fetch };
    const p = { carpetaCurso: 'c-1', subcarpeta: 'materiales' as const, nombreArchivo: 'a.pdf', contenido: new Uint8Array(1), mime: 'application/pdf' };
    await subirArchivoFormacion(p, deps);
    await subirArchivoFormacion(p, deps);
    expect(f.mock.calls.filter(([u]) => String(u).includes('login.microsoftonline.com'))).toHaveLength(1);
  });

  it('sin configuración no llama a Graph', async () => {
    const f = vi.fn();
    vi.stubEnv('PORTAL_TH_SP_CLIENT_SECRET', '');
    await expect(
      subirArchivoFormacion(
        { carpetaCurso: 'c-1', subcarpeta: 'materiales', nombreArchivo: 'a.pdf', contenido: new Uint8Array(1), mime: 'application/pdf' },
        { fetch: f as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(FormacionStorageNoConfigurado);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe('descargarArchivoFormacion', () => {
  it('pide /drive/items/<id>/content con Bearer y devuelve el cuerpo', async () => {
    const f = fetchFalso(() => respuesta(200, 'PDF', { 'content-type': 'application/pdf', 'content-length': '3' }));
    const r = await descargarArchivoFormacion('01ABC', { config: CFG, fetch: f as unknown as typeof fetch });
    expect(String(f.mock.calls[1][0])).toContain('/drive/items/01ABC/content');
    expect(r.tamano).toBe(3);
    expect(await new Response(r.cuerpo).text()).toBe('PDF');
  });

  it('rechaza ids con caracteres raros', async () => {
    await expect(descargarArchivoFormacion('../x', { config: CFG, fetch: vi.fn() as unknown as typeof fetch })).rejects.toThrow();
  });
});

describe('moverMaterialAEliminados', () => {
  it('crea FORMACION/ELIMINADOS/<curso>/materiales si falta y hace PATCH con parentReference + name + rename', async () => {
    const { moverMaterialAEliminados } = await import('../formacion-storage');
    const creadas: string[] = [];
    const f = fetchFalso((url, init) => {
      if (init.method === 'PATCH') {
        return respuesta(200, { id: 'ITEM1', name: 'guia 1.pdf', webUrl: 'https://sp/ELIMINADOS/guia 1.pdf', size: 3 });
      }
      if (init.method === 'POST') {
        const nombre = JSON.parse(String(init.body)).name;
        creadas.push(nombre);
        return respuesta(201, { id: `DIR-${nombre}` });
      }
      // GET por ruta: FORMACION existe; lo demás no.
      if (url.endsWith('/root:/FORMACION')) return respuesta(200, { id: 'DIR-FORMACION' });
      return respuesta(404);
    });
    const r = await moverMaterialAEliminados(
      { driveItemId: 'ITEM1', carpetaCurso: 'sst-1', nombreArchivo: 'guia.pdf' },
      { config: CFG, fetch: f as unknown as typeof fetch }
    );
    expect(creadas).toEqual(['ELIMINADOS', 'sst-1', 'materiales']);
    const patch = f.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PATCH') as [string, RequestInit];
    expect(patch[0]).toContain('/drive/items/ITEM1?@microsoft.graph.conflictBehavior=rename');
    expect(JSON.parse(String(patch[1].body))).toEqual({ parentReference: { id: 'DIR-materiales' }, name: 'guia.pdf' });
    expect(r.driveItemId).toBe('ITEM1');
    expect(r.nombre).toBe('guia 1.pdf');
  });

  it('si Graph rechaza el movimiento, lanza', async () => {
    const { moverMaterialAEliminados } = await import('../formacion-storage');
    const f = fetchFalso((url, init) => (init.method === 'PATCH' ? respuesta(423) : respuesta(200, { id: 'DIR' })));
    await expect(
      moverMaterialAEliminados(
        { driveItemId: 'ITEM1', carpetaCurso: 'sst-1', nombreArchivo: 'a.pdf' },
        { config: CFG, fetch: f as unknown as typeof fetch }
      )
    ).rejects.toThrow(/ELIMINADOS/);
  });

  it('la ruta de ELIMINADOS queda dentro de la carpeta base y valida el curso', async () => {
    const { segmentosCarpetaEliminados, moverMaterialAEliminados } = await import('../formacion-storage');
    expect(segmentosCarpetaEliminados('FORMACION', 'sst-1')).toEqual(['FORMACION', 'ELIMINADOS', 'sst-1', 'materiales']);
    expect(() => segmentosCarpetaEliminados('FORMACION', '../otro')).toThrow();
    expect(() => segmentosCarpetaEliminados('FORMACION', '..')).toThrow();
    const f = vi.fn();
    await expect(
      moverMaterialAEliminados(
        { driveItemId: 'ITEM1', carpetaCurso: 'a/b', nombreArchivo: 'a.pdf' },
        { config: CFG, fetch: f as unknown as typeof fetch }
      )
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('subida directa del navegador (sin tope de peso, 2026-10-08)', () => {
  it('crearSesionSubida: abre la sesión en la ruta saneada y no devuelve el token', async () => {
    const f = fetchFalso((url) =>
      url.endsWith(':/createUploadSession') ? respuesta(200, { uploadUrl: 'https://upload.sp/s1', expirationDateTime: 'X' }) : respuesta(404)
    );
    const s = await crearSesionSubida(
      { carpetaCurso: 'sst-1', subcarpeta: 'materiales', nombreArchivo: 'C:\\videos\\..\\clase:1.mp4' },
      { config: CFG, fetch: f as unknown as typeof fetch }
    );
    expect(s).toEqual({ uploadUrl: 'https://upload.sp/s1', expiracion: 'X', nombre: 'clase_1.mp4' });
    expect(String(f.mock.calls.at(-1)?.[0])).toContain('/drive/root:/FORMACION/sst-1/materiales/clase_1.mp4:/createUploadSession');
  });

  it('crearSesionSubida: una uploadUrl que no es https se rechaza', async () => {
    const f = fetchFalso(() => respuesta(200, { uploadUrl: 'http://raro/s' }));
    await expect(
      crearSesionSubida({ carpetaCurso: 'sst-1', subcarpeta: 'materiales', nombreArchivo: 'a.mp4' }, { config: CFG, fetch: f as unknown as typeof fetch })
    ).rejects.toThrow(/no válida/);
  });

  it('obtenerArchivoSubidoEnCarpeta: acepta el padre exacto (codificado o no) y rechaza otro', async () => {
    const conPadre = (path: string) =>
      fetchFalso(() => respuesta(200, { id: '01X', name: 'v.mp4', size: 10, file: { mimeType: 'video/mp4' }, parentReference: { path } }));
    const op = { driveItemId: '01X', carpetaCurso: 'curso con espacio-1', subcarpeta: 'materiales' as const, mime: 'video/mp4' };
    for (const path of ['/drives/b!a/root:/FORMACION/curso%20con%20espacio-1/materiales', '/drive/root:/FORMACION/curso con espacio-1/materiales']) {
      await expect(obtenerArchivoSubidoEnCarpeta(op, { config: CFG, fetch: conPadre(path) as unknown as typeof fetch })).resolves.toMatchObject({
        driveItemId: '01X',
        tamano: 10,
      });
    }
    for (const path of ['/drive/root:/FORMACION/curso con espacio-1', '/drive/root:/FORMACION/curso con espacio-1/materiales/sub', '/drive/root:/OTRA/materiales']) {
      await expect(
        obtenerArchivoSubidoEnCarpeta(op, { config: CFG, fetch: conPadre(path) as unknown as typeof fetch })
      ).rejects.toBeInstanceOf(ArchivoFueraDeCarpeta);
    }
  });
});

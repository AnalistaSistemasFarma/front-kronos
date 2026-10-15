import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCorreoConfig } from '../config';
import { limpiarCacheNoLeidos, noLeidosBandeja, NO_LEIDOS_TTL_MS } from '../noLeidos';
import { GraphMailProvider, mailboxForSession } from '../graph';
import type { CorreoDeps } from '../service';
import type { AccesoCorreo } from '../db';
import type { MailProvider } from '../types';

// Contador del icono del Correo en la cabecera: nunca lanza, caché por persona,
// solo para inquilinos habilitados.

const acceso = (idUser = 'u1', email = 'laura@gsslatam.com'): AccesoCorreo => ({
  idUser,
  nombre: 'Laura',
  email,
  empresas: [{ idCompany: 1, companyName: 'GSS' }],
  empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }],
});

const GRAPH_ENV = {
  CORREO_MODO: 'graph',
  CORREO_INQUILINOS: 'gss',
  CORREO_GSS_TENANT_ID: '3409fd29-f351-4a98-8ef4-d98c8874a836',
  CORREO_GSS_CLIENT_ID: '28c47cc5-342a-4781-909e-d234db1bb993',
  CORREO_GSS_CLIENT_SECRET: 'secreto-de-prueba',
  CORREO_GSS_DOMINIOS: 'gsslatam.com',
};

function deps(env: Record<string, string>, extra: Partial<CorreoDeps> = {}): CorreoDeps {
  return { cfg: readCorreoConfig(env), dominiosGrupo: [], ...extra } as unknown as CorreoDeps;
}

function proveedor(p: Partial<MailProvider>): () => Promise<MailProvider> {
  return async () => p as MailProvider;
}

beforeEach(() => limpiarCacheNoLeidos());

describe('Correo · no leídos para la cabecera', () => {
  it('modo simulado: cuenta los no leídos de la Bandeja de entrada', async () => {
    const n = await noLeidosBandeja(deps({ CORREO_MODO: 'mock' }), acceso());
    expect(typeof n).toBe('number');
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it('módulo apagado o inquilino no habilitado: null, sin consultar a Microsoft', async () => {
    const fetchFn = vi.fn();
    expect(await noLeidosBandeja(deps({ CORREO_MODO: 'off' }, { fetchFn: fetchFn as never }), acceso())).toBeNull();
    expect(await noLeidosBandeja(deps(GRAPH_ENV, { fetchFn: fetchFn as never }), acceso('u2', 'ana@onelatampharma.com'))).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('usa el contador del proveedor y lo guarda 3 minutos por persona', async () => {
    let t = 1_000;
    const noLeidos = vi.fn(async () => 12);
    const d = deps(GRAPH_ENV, { now: () => t, proveedor: proveedor({ noLeidosBandeja: noLeidos }) });
    expect(await noLeidosBandeja(d, acceso())).toBe(12);
    t += NO_LEIDOS_TTL_MS - 1;
    expect(await noLeidosBandeja(d, acceso())).toBe(12);
    expect(noLeidos).toHaveBeenCalledTimes(1);
    // Otra persona no comparte la caché.
    expect(await noLeidosBandeja(d, acceso('u9'))).toBe(12);
    expect(noLeidos).toHaveBeenCalledTimes(2);
    t += 2;
    await noLeidosBandeja(d, acceso());
    expect(noLeidos).toHaveBeenCalledTimes(3);
  });

  it('consultas simultáneas de la misma persona: una sola a Microsoft', async () => {
    const noLeidos = vi.fn(async () => 3);
    const d = deps(GRAPH_ENV, { proveedor: proveedor({ noLeidosBandeja: noLeidos }) });
    const r = await Promise.all([noLeidosBandeja(d, acceso()), noLeidosBandeja(d, acceso()), noLeidosBandeja(d, acceso())]);
    expect(r).toEqual([3, 3, 3]);
    expect(noLeidos).toHaveBeenCalledTimes(1);
  });

  it('sin método propio: lo toma de la carpeta «Bandeja de entrada»', async () => {
    const d = deps(GRAPH_ENV, {
      proveedor: proveedor({ carpetas: async () => [{ id: 'a', nombre: 'Enviados', total: 9, noLeidos: 9 }, { id: 'b', nombre: 'Bandeja de entrada', total: 5, noLeidos: 2 }] }),
    });
    expect(await noLeidosBandeja(d, acceso())).toBe(2);
  });

  it('Microsoft falla o tarda: null sin lanzar', async () => {
    const d = deps(GRAPH_ENV, { proveedor: proveedor({ noLeidosBandeja: async () => { throw new Error('502'); } }) });
    await expect(noLeidosBandeja(d, acceso())).resolves.toBeNull();
    vi.useFakeTimers();
    try {
      limpiarCacheNoLeidos();
      const lento = deps(GRAPH_ENV, { proveedor: proveedor({ noLeidosBandeja: () => new Promise<number>(() => {}) }) });
      const p = noLeidosBandeja(lento, acceso());
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Graph: consulta solo el contador de la Bandeja de entrada del buzón de la sesión', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ unreadItemCount: 7 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const prov = new GraphMailProvider(mailboxForSession('laura@gsslatam.com'), async () => 'tkn', fetchFn as never);
    expect(await prov.noLeidosBandeja()).toBe(7);
    expect(urls).toEqual(['https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com/mailFolders/inbox?$select=unreadItemCount']);
  });
});

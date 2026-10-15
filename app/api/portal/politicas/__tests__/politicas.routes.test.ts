import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas de Políticas y reglamentos del Portal TH con la identidad y Graph
// simulados: exigen sesión, nunca exponen token/secreto y traducen los
// errores a mensajes claros.

const { identificar, listarPoliticas, urlVistaPreviaPolitica } = vi.hoisted(() => ({
  identificar: vi.fn(),
  listarPoliticas: vi.fn(),
  urlVistaPreviaPolitica: vi.fn(),
}));

vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/politicas-storage', async (original) => {
  const real = await original<typeof import('@/lib/portal/politicas-storage')>();
  return { ...real, listarPoliticas, urlVistaPreviaPolitica };
});

import { NextRequest } from 'next/server';
import { FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { PoliticasError } from '@/lib/portal/politicas-storage';
import { GET as listar } from '../route';
import { GET as vista } from '../[id]/vista/route';

const req = (url: string) => new NextRequest(new URL(url, 'http://localhost'));
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: 'persona@gsslatam.com', via: 'codigo' });
});

describe('GET /api/portal/politicas', () => {
  it('sin sesión responde 401 y no toca SharePoint', async () => {
    identificar.mockResolvedValue(null);
    const res = await listar(req('/api/portal/politicas'));
    expect(res.status).toBe(401);
    expect(listarPoliticas).not.toHaveBeenCalled();
  });

  it('lista los archivos con su ruta de vista previa y caché privada corta', async () => {
    listarPoliticas.mockResolvedValue({
      carpeta: 'POLITICAS Y REGLAMENTOS',
      truncado: false,
      archivos: [
        { id: '01AB!c', nombre: 'Reglamento.pdf', tipo: 'pdf', mime: 'application/pdf', tamano: 10, modificado: null, carpeta: '' },
      ],
    });
    const res = await listar(req('/api/portal/politicas'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    const data = await res.json();
    expect(data.archivos[0].vistaPrevia).toBe('/api/portal/politicas/01AB!c/vista');
    const texto = JSON.stringify(data);
    expect(texto).not.toMatch(/secret|access_token|Bearer|graph\.microsoft/i);
  });

  it('sin configuración responde 503 con mensaje para la persona', async () => {
    listarPoliticas.mockRejectedValue(new FormacionStorageNoConfigurado('Faltan variables'));
    const res = await listar(req('/api/portal/politicas'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/no está configurada/);
  });

  it('un 403 de Graph se traduce a "no tiene permiso"', async () => {
    listarPoliticas.mockRejectedValue(new PoliticasError('x', 403));
    const res = await listar(req('/api/portal/politicas'));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/no tiene permiso/);
  });
});

describe('GET /api/portal/politicas/:id/vista', () => {
  it('sin sesión responde 401', async () => {
    identificar.mockResolvedValue(null);
    const res = await vista(req('/api/portal/politicas/a/vista'), params('a'));
    expect(res.status).toBe(401);
    expect(urlVistaPreviaPolitica).not.toHaveBeenCalled();
  });

  it('id inválido responde 400 sin ir a Graph', async () => {
    const res = await vista(req('/api/portal/politicas/x/vista'), params('../otra'));
    expect(res.status).toBe(400);
    expect(urlVistaPreviaPolitica).not.toHaveBeenCalled();
  });

  it('archivo fuera de la carpeta responde 404', async () => {
    urlVistaPreviaPolitica.mockResolvedValue(null);
    const res = await vista(req('/api/portal/politicas/OTRO/vista'), params('OTRO'));
    expect(res.status).toBe(404);
  });

  it('entrega la URL embebible sin cachear', async () => {
    urlVistaPreviaPolitica.mockResolvedValue('https://gsslatam.sharepoint.com/embed?x=1');
    const res = await vista(req('/api/portal/politicas/01AB/vista'), params('01AB'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ url: 'https://gsslatam.sharepoint.com/embed?x=1' });
  });

  it('error de Graph responde 502 con mensaje genérico', async () => {
    urlVistaPreviaPolitica.mockRejectedValue(new PoliticasError('Graph 500', 500));
    const res = await vista(req('/api/portal/politicas/01AB/vista'), params('01AB'));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/vista previa/);
  });
});

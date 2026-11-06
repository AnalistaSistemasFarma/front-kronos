import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas de CAPACITACIONES del Portal TH (Cristian Baldión, 2026-10-22, espejo de AYUDAS): sesión, Graph y configuración SIMULADOS.

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
const ENV_SP = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: 's',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,1,2',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const [k, v] of Object.entries(ENV_SP)) process.env[k] = v;
  delete process.env.PORTAL_TH_SP_TRAINING_FOLDER;
  identificar.mockResolvedValue({ correo: 'persona@gsslatam.com', via: 'codigo' });
});

describe('GET /api/portal/capacitaciones', () => {
  it('sin sesión: 401 y no toca SharePoint', async () => {
    identificar.mockResolvedValue(null);
    expect((await listar(req('/api/portal/capacitaciones'))).status).toBe(401);
    expect(listarPoliticas).not.toHaveBeenCalled();
  });

  it('lee la carpeta FORMACION/CAPACITACIONES y devuelve cada archivo con SU ruta de vista previa (de capacitaciones, no de ayudas)', async () => {
    listarPoliticas.mockResolvedValue({
      carpeta: 'FORMACION/CAPACITACIONES',
      truncado: false,
      archivos: [{ id: '01AB!c', nombre: 'Cambio de contraseña.mp4', tipo: 'mp4', mime: 'video/mp4', tamano: 15000000, modificado: null, carpeta: '' }],
    });
    const res = await listar(req('/api/portal/capacitaciones'));
    expect(res.status).toBe(200);
    expect(listarPoliticas.mock.calls[0][0].config.carpeta).toBe('FORMACION/CAPACITACIONES');
    const data = await res.json();
    expect(data.archivos[0].vistaPrevia).toBe('/api/portal/capacitaciones/01AB!c/vista');
    expect(JSON.stringify(data)).not.toMatch(/token|secret|graph\.microsoft/i);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });

  it('errores: sin configurar 503, sin permiso 502 y carpeta inexistente 502, con mensajes «de capacitaciones» y sin detalles internos', async () => {
    listarPoliticas.mockRejectedValueOnce(new FormacionStorageNoConfigurado('Faltan variables: X'));
    let r = await listar(req('/api/portal/capacitaciones'));
    expect(r.status).toBe(503);
    listarPoliticas.mockRejectedValueOnce(new PoliticasError('Graph 403', 403));
    r = await listar(req('/api/portal/capacitaciones'));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('El portal no tiene permiso para leer la carpeta de capacitaciones en SharePoint. Avise a Tecnología.');
    listarPoliticas.mockRejectedValueOnce(new PoliticasError('Graph 404 FORMACION/CAPACITACIONES', 404));
    r = await listar(req('/api/portal/capacitaciones'));
    const cuerpo = await r.json();
    expect(cuerpo.error).toBe('No se encontró la carpeta de capacitaciones en SharePoint. Avise a Tecnología.');
    expect(JSON.stringify(cuerpo)).not.toContain('FORMACION');
  });
});

describe('GET /api/portal/capacitaciones/:id/vista', () => {
  it('sin sesión: 401; id inválido: 400', async () => {
    identificar.mockResolvedValue(null);
    expect((await vista(req('/x'), params('01AB'))).status).toBe(401);
    identificar.mockResolvedValue({ correo: 'p@gsslatam.com', via: 'codigo' });
    for (const id of ['../x', 'a b', 'x'.repeat(300)]) expect((await vista(req('/x'), params(id))).status, id).toBe(400);
    expect(urlVistaPreviaPolitica).not.toHaveBeenCalled();
  });

  it('devuelve la URL de vista previa, sin caché, validando contra la carpeta de CAPACITACIONES', async () => {
    urlVistaPreviaPolitica.mockResolvedValue('https://gsslatam.sharepoint.com/sites/TalentoHumano/_layouts/15/embed.aspx?x=1');
    const res = await vista(req('/x'), params('01AB'));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain('sharepoint.com');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(urlVistaPreviaPolitica.mock.calls[0][1].config.carpeta).toBe('FORMACION/CAPACITACIONES');
  });

  it('un archivo que no está en la carpeta: 404 con mensaje «de capacitaciones»; fallo de Graph: 502', async () => {
    urlVistaPreviaPolitica.mockResolvedValueOnce(null);
    let r = await vista(req('/x'), params('01AB'));
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('El archivo ya no está en la carpeta de capacitaciones.');
    urlVistaPreviaPolitica.mockRejectedValueOnce(new PoliticasError('Graph 500', 500));
    r = await vista(req('/x'), params('01AB'));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('No se pudo preparar la vista previa del documento. Intente en un momento.');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta de HEINSOHN NÓMINA (Cristian Baldión, 2026-10-15). Sesión y SharePoint SIMULADOS.

const { identificar, leerEmpresasHeinsohn } = vi.hoisted(() => ({ identificar: vi.fn(), leerEmpresasHeinsohn: vi.fn() }));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/heinsohn', () => ({ leerEmpresasHeinsohn }));

import { NextRequest } from 'next/server';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { GET as obtener } from '../route';

const req = () => new NextRequest(new URL('/api/portal/heinsohn', 'http://localhost'));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: 'persona@gsslatam.com', via: 'codigo' });
  leerEmpresasHeinsohn.mockResolvedValue({ empresas: [{ nombre: 'GROUP SHARED SERVICES SAS', url: 'https://portal.heinsohn.com.co/?domain=gss.com' }], omitidas: ['X SAS'] });
});

describe('GET /api/portal/heinsohn', () => {
  it('sin sesión: 401 y no lee SharePoint', async () => {
    identificar.mockResolvedValue(null);
    expect((await obtener(req())).status).toBe(401);
    expect(leerEmpresasHeinsohn).not.toHaveBeenCalled();
  });
  it('devuelve las empresas con su enlace y las omitidas, con caché privada corta', async () => {
    const res = await obtener(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ empresas: [{ nombre: 'GROUP SHARED SERVICES SAS', url: 'https://portal.heinsohn.com.co/?domain=gss.com' }], omitidas: ['X SAS'] });
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });
  it('errores: sin configurar 503; sin permiso, sin archivo y fallo general 502, sin detalles internos', async () => {
    leerEmpresasHeinsohn.mockRejectedValueOnce(new FormacionStorageNoConfigurado('Faltan variables: X'));
    expect((await obtener(req())).status).toBe(503);
    leerEmpresasHeinsohn.mockRejectedValueOnce(new FormacionStorageError('Graph 403 secreto', 403));
    let r = await obtener(req());
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('El portal no tiene permiso para leer el Excel de nómina en SharePoint. Avise a Tecnología.');
    leerEmpresasHeinsohn.mockRejectedValueOnce(new FormacionStorageError('Graph 404', 404));
    r = await obtener(req());
    expect((await r.json()).error).toBe('No se encontró el Excel de nómina en SharePoint. Avise a Tecnología.');
    leerEmpresasHeinsohn.mockRejectedValueOnce(new Error('boom interno'));
    r = await obtener(req());
    const cuerpo = await r.json();
    expect(r.status).toBe(502);
    expect(JSON.stringify(cuerpo)).not.toMatch(/boom|secreto/);
  });
});

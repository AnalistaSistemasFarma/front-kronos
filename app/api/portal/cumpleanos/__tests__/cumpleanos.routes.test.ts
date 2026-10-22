import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta de CUMPLEAÑOS (Cristian Baldión, 2026-10-15). Sesión y SharePoint SIMULADOS.

const { identificar, leerPersonasConCumple } = vi.hoisted(() => ({ identificar: vi.fn(), leerPersonasConCumple: vi.fn() }));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/cumpleanos', async (original) => ({ ...(await original<typeof import('@/lib/portal/cumpleanos')>()), leerPersonasConCumple }));

import { NextRequest } from 'next/server';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { GET as obtener } from '../route';

const req = (q: string) => new NextRequest(new URL('/api/portal/cumpleanos' + q, 'http://localhost'));
const RANGO = '?desde=2026-10-01&hasta=2026-11-11';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: 'persona@gsslatam.com', via: 'codigo' });
  leerPersonasConCumple.mockResolvedValue([
    { nombre: 'PEREZ GOMEZ ANA', empresa: 'GSS SAS', cargo: 'ANALISTA DE SISTEMAS', mes: 10, dia: 15 },
    { nombre: 'MORA PINTO JUAN', empresa: 'RYAN', cargo: 'AUXILIAR DE PRODUCCION', mes: 12, dia: 3 },
  ]);
});

describe('GET /api/portal/cumpleanos', () => {
  it('sin sesión: 401 y no lee SharePoint', async () => {
    identificar.mockResolvedValue(null);
    expect((await obtener(req(RANGO))).status).toBe(401);
    expect(leerPersonasConCumple).not.toHaveBeenCalled();
  });
  it('devuelve solo los cumpleaños del rango, con nombre, empresa y cargo, y nunca en caché del navegador', async () => {
    const res = await obtener(req(RANGO));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cumpleanos: [{ fecha: '2026-10-15', personas: [{ nombre: 'PEREZ GOMEZ ANA', empresa: 'GSS SAS', cargo: 'ANALISTA DE SISTEMAS' }] }] });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('no filtra el día, el mes ni el año de nacimiento', async () => {
    const texto = JSON.stringify(await (await obtener(req(RANGO))).json());
    expect(texto).not.toMatch(/"(mes|dia|nacimiento|cedula|edad|area)"/);
  });
  it('valida el rango: faltante, inválido, invertido o de más de 70 días → 400 sin leer SharePoint', async () => {
    for (const q of ['', '?desde=2026-10-01', '?desde=x&hasta=y', '?desde=2026-10-10&hasta=2026-10-01', '?desde=2026-01-01&hasta=2026-12-31', '?desde=2026-02-30&hasta=2026-03-01']) {
      expect((await obtener(req(q))).status, q).toBe(400);
    }
    expect(leerPersonasConCumple).not.toHaveBeenCalled();
  });
  it('errores: sin configurar 503; sin permiso, sin archivo y fallo general 502, sin detalles internos', async () => {
    leerPersonasConCumple.mockRejectedValueOnce(new FormacionStorageNoConfigurado('Faltan variables: X'));
    expect((await obtener(req(RANGO))).status).toBe(503);
    leerPersonasConCumple.mockRejectedValueOnce(new FormacionStorageError('Graph 403 secreto', 403));
    let r = await obtener(req(RANGO));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('El portal no tiene permiso para leer BASE PERSONAL en SharePoint. Avise a Tecnología.');
    leerPersonasConCumple.mockRejectedValueOnce(new FormacionStorageError('Graph 404', 404));
    expect((await (await obtener(req(RANGO))).json()).error).toBe('No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.');
    leerPersonasConCumple.mockRejectedValueOnce(new Error('boom con PEREZ GOMEZ ANA'));
    r = await obtener(req(RANGO));
    const cuerpo = await r.json();
    expect(r.status).toBe(502);
    expect(JSON.stringify(cuerpo)).not.toMatch(/boom|PEREZ|secreto/);
  });
});

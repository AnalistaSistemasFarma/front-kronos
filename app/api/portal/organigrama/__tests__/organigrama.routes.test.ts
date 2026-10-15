import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta del organigrama (Cristian Baldión, 2026-10-15): sesión, lectura y respuesta. Sesión y SharePoint SIMULADOS.

const { identificar, leerBasePersonal } = vi.hoisted(() => ({ identificar: vi.fn(), leerBasePersonal: vi.fn() }));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/base-personal', () => ({ leerBasePersonal }));

import { NextRequest } from 'next/server';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { MODELO } from '@/lib/portal/organigrama';
import { GET as obtener } from '../route';

const req = () => new NextRequest(new URL('/api/portal/organigrama', 'http://localhost'));
const gerente = MODELO.nodos.find((n) => n.texto === 'Gerente de Calidad')!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: 'persona@gsslatam.com', via: 'codigo' });
  leerBasePersonal.mockResolvedValue([
    { empresa: 'Farmalógica', nombre: 'PEREZ GOMEZ ANA', area: 'CALIDAD', cargo: 'GERENTE DE CALIDAD', correo: 'ana@farmalogica.com' },
    { empresa: 'Ryan', nombre: 'NADIE ENLAZADO', area: 'X', cargo: 'UN CARGO QUE NO ESTÁ EN EL DIBUJO', correo: 'otro@ryanlab.com' },
  ]);
});

describe('GET /api/portal/organigrama', () => {
  it('sin sesión: 401 y no lee SharePoint', async () => {
    identificar.mockResolvedValue(null);
    expect((await obtener(req())).status).toBe(401);
    expect(leerBasePersonal).not.toHaveBeenCalled();
  });

  it('devuelve solo las personas cuyo cargo está en el organigrama, con sus cinco datos y nada más', async () => {
    const res = await obtener(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data.personas)).toEqual([String(gerente.id)]);
    expect(data.personas[gerente.id]).toEqual([{ empresa: 'Farmalógica', nombre: 'PEREZ GOMEZ ANA', area: 'CALIDAD', cargo: 'GERENTE DE CALIDAD', correo: 'ana@farmalogica.com' }]);
    expect(data.total).toBe(1);
    expect(JSON.stringify(data)).not.toContain('NADIE ENLAZADO');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('errores: sin configurar 503; sin permiso, sin archivo y fallo general 502, sin detalles internos', async () => {
    leerBasePersonal.mockRejectedValueOnce(new FormacionStorageNoConfigurado('Faltan variables: X'));
    expect((await obtener(req())).status).toBe(503);
    leerBasePersonal.mockRejectedValueOnce(new FormacionStorageError('Graph 403 secreto', 403));
    let r = await obtener(req());
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('El portal no tiene permiso para leer BASE PERSONAL en SharePoint. Avise a Tecnología.');
    leerBasePersonal.mockRejectedValueOnce(new FormacionStorageError('Graph 404', 404));
    r = await obtener(req());
    expect((await r.json()).error).toBe('No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.');
    leerBasePersonal.mockRejectedValueOnce(new Error('boom con ana@farmalogica.com'));
    r = await obtener(req());
    const cuerpo = await r.json();
    expect(r.status).toBe(502);
    expect(JSON.stringify(cuerpo)).not.toMatch(/boom|ana@|secreto/);
  });
});

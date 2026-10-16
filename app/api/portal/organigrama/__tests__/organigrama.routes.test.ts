import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta del organigrama de GSS (Cristian Baldión, 2026-10-15): sesión, base y SharePoint SIMULADOS.

const { identificar, leerBasePersonal, getJerarquia, prisma } = vi.hoisted(() => ({
  identificar: vi.fn(),
  leerBasePersonal: vi.fn(),
  getJerarquia: vi.fn(),
  prisma: { company: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/base-personal', () => ({ leerBasePersonal }));
vi.mock('@/lib/organigrama/tree', () => ({ getJerarquia }));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { NextRequest } from 'next/server';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { GET as obtener } from '../route';

const req = () => new NextRequest(new URL('/api/portal/organigrama', 'http://localhost'));
const ARBOL = [
  { idCargoJerarquia: 1, idCargo: 10, nombre: 'DIRECTOR GENERAL', nivel: 'Estratégico', nivelClasico: null, idCargoPadre: null, aproximada: false },
  { idCargoJerarquia: 2, idCargo: 11, nombre: 'GERENTE DE CALIDAD', nivel: 'Estratégico', nivelClasico: null, idCargoPadre: 10, aproximada: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PORTAL_TH_ORGANIGRAMA_EMPRESA;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: 'persona@gsslatam.com', via: 'codigo' });
  prisma.company.findFirst.mockResolvedValue({ id_company: 8, company: 'GSS' });
  getJerarquia.mockResolvedValue(ARBOL);
  leerBasePersonal.mockResolvedValue([
    { empresa: 'GSS', nombre: 'PEREZ GOMEZ ANA', area: 'CALIDAD', cargo: 'Gerente de Calidad', correo: 'ana@gsslatam.com' },
    { empresa: 'Ryan', nombre: 'NADIE ENLAZADO', area: 'X', cargo: 'UN CARGO QUE NO ESTÁ EN EL ORGANIGRAMA', correo: 'otro@ryanlab.com' },
  ]);
});

describe('GET /api/portal/organigrama', () => {
  it('sin sesión: 401 y no lee ni la base ni SharePoint', async () => {
    identificar.mockResolvedValue(null);
    expect((await obtener(req())).status).toBe(401);
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
    expect(leerBasePersonal).not.toHaveBeenCalled();
  });

  it('busca la empresa GSS por NOMBRE y devuelve el árbol y las personas solo de cargos del organigrama', async () => {
    const res = await obtener(req());
    expect(res.status).toBe(200);
    expect(prisma.company.findFirst).toHaveBeenCalledWith({ where: { company: 'GSS' }, select: { id_company: true, company: true } });
    expect(getJerarquia).toHaveBeenCalledWith(8);
    const data = await res.json();
    expect(data.empresa).toBe('GSS');
    expect(data.nodos).toEqual([
      { id: 10, nombre: 'DIRECTOR GENERAL', nivel: 'Estratégico', padre: null },
      { id: 11, nombre: 'GERENTE DE CALIDAD', nivel: 'Estratégico', padre: 10 },
    ]);
    expect(Object.keys(data.personas)).toEqual(['11']);
    expect(data.personas[11]).toEqual([{ empresa: 'GSS', nombre: 'PEREZ GOMEZ ANA', area: 'CALIDAD', cargo: 'Gerente de Calidad', correo: 'ana@gsslatam.com' }]);
    expect(data.total).toBe(1);
    expect(JSON.stringify(data)).not.toContain('NADIE ENLAZADO');
    expect(data.avisoPersonas).toBeUndefined();
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('PORTAL_TH_ORGANIGRAMA_EMPRESA cambia la empresa que se busca', async () => {
    process.env.PORTAL_TH_ORGANIGRAMA_EMPRESA = 'FARMALOGICA S.A.';
    await obtener(req());
    expect(prisma.company.findFirst).toHaveBeenCalledWith({ where: { company: 'FARMALOGICA S.A.' }, select: { id_company: true, company: true } });
  });

  it('no se leen cédulas ni columnas de más: de cada persona salen solo sus cinco datos', async () => {
    leerBasePersonal.mockResolvedValue([{ empresa: 'GSS', nombre: 'A', area: 'B', cargo: 'GERENTE DE CALIDAD', correo: 'a@x.com', cedula: '1010101010' }]);
    const texto = JSON.stringify(await (await obtener(req())).json());
    expect(texto).not.toMatch(/cedula|1010101010/);
  });

  it('empresa que no existe: 404 con mensaje claro y sin detalles internos', async () => {
    prisma.company.findFirst.mockResolvedValue(null);
    const r = await obtener(req());
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('No se encontró la empresa GSS en SynerLink. Avise a Tecnología.');
  });

  it('la base falla: 500 genérico, sin detalles', async () => {
    getJerarquia.mockRejectedValueOnce(Object.assign(new Error('Invalid prisma invocation: ana@gsslatam.com'), { name: 'PrismaClientKnownRequestError' }));
    const r = await obtener(req());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/prisma|ana@/);
  });

  it('organigrama aún sin cargar: árbol vacío y no consulta SharePoint', async () => {
    getJerarquia.mockResolvedValue([]);
    const data = await (await obtener(req())).json();
    expect(data.nodos).toEqual([]);
    expect(leerBasePersonal).not.toHaveBeenCalled();
  });

  it('si BASE PERSONAL falla, el árbol se entrega igual y viene el aviso (sin detalles internos)', async () => {
    const casos: [unknown, string][] = [
      [new FormacionStorageNoConfigurado('Faltan variables: X'), 'Las personas de cada cargo no están configuradas en este ambiente. Avise a Tecnología.'],
      [new FormacionStorageError('Graph 403 secreto', 403), 'El portal no tiene permiso para leer BASE PERSONAL en SharePoint. Avise a Tecnología.'],
      [new FormacionStorageError('Graph 404', 404), 'No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.'],
      [new Error('boom con PEREZ GOMEZ ANA'), 'No se pudieron cargar los datos de las personas. Intente en un momento.'],
    ];
    for (const [fallo, mensaje] of casos) {
      leerBasePersonal.mockRejectedValueOnce(fallo);
      const r = await obtener(req());
      const data = await r.json();
      expect(r.status).toBe(200);
      expect(data.nodos).toHaveLength(2);
      expect(data.personas).toEqual({});
      expect(data.avisoPersonas).toBe(mensaje);
      expect(JSON.stringify(data)).not.toMatch(/boom|PEREZ|secreto/);
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// INVENTARIO DE EQUIPOS BIOMÉDICOS (fase 2, 2026-11-10): rutas con la sesión y la base simuladas.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'getBiomedAccessForUser', 'listEquipos', 'resumenInventario', 'crearEquipo', 'idsFiltrados', 'historialEquipo', 'editarEquipo', 'moverEquipos', 'listValores', 'saveValor', 'cobros', 'simularCargue', 'aplicarCargue', 'leerInventarioXlsx', 'asignarArticuloSap', 'findFirst', 'sapLogin', 'sapGet', 'sapLogout'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { sap_endpoints: { findFirst: m.findFirst } } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/biomedica/access', () => ({ getBiomedAccessForUser: m.getBiomedAccessForUser }));
vi.mock('../../../../lib/biomedica/inventario', () => ({
  listEquipos: m.listEquipos,
  resumenInventario: m.resumenInventario,
  crearEquipo: m.crearEquipo,
  idsFiltrados: m.idsFiltrados,
  historialEquipo: m.historialEquipo,
  editarEquipo: m.editarEquipo,
  moverEquipos: m.moverEquipos,
  listValores: m.listValores,
  saveValor: m.saveValor,
  cobros: m.cobros,
  simularCargue: m.simularCargue,
  aplicarCargue: m.aplicarCargue,
  asignarArticuloSap: m.asignarArticuloSap,
}));
vi.mock('../../../../lib/biomedica/inventarioExcel', () => ({ leerInventarioXlsx: m.leerInventarioXlsx, MAX_BYTES_CARGUE: 15 * 1024 * 1024 }));
vi.mock('../../../../lib/sap/serviceLayer', () => ({ sapLogin: m.sapLogin, sapGet: m.sapGet, sapLogout: m.sapLogout, SapError: class SapError extends Error { status = 502; } }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as inventario from '../inventario/route';
import * as ids from '../inventario/ids/route';
import * as equipo from '../inventario/[id]/route';
import * as movimiento from '../inventario/movimiento/route';
import * as valores from '../inventario/valores/route';
import * as cobros from '../inventario/cobros/route';
import * as cargue from '../inventario/cargue/route';
import * as sap from '../inventario/articulo-sap/route';

const EMAIL = 'byron@onelatampharma.com';
const H = { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'vitest' };
const lectura = { idCompany: 3, companyName: 'OLP', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const acceso = { idCompany: 3, companyName: 'OLP', canUse: true, canConfigure: false };
const get = (q: string) => new Request(`http://x/api${q}`, { headers: H });
const send = (method: string, body: unknown) => new Request('http://x/api', { method, body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue([lectura]);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [] });
  m.getBiomedAccessForUser.mockResolvedValue([acceso]);
});

describe('Rutas del inventario biomédico', () => {
  it('sin sesión 401, sin permiso del módulo 403; la lista pasa los filtros y trae el resumen solo si se pide', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await inventario.GET(get('/x?company=3'))).status).toBe(401);
    m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
    m.getBiomedAccessForUser.mockResolvedValue([]);
    expect((await movimiento.POST(send('POST', { company: 3, accion: 'devolver', ids: [1] }))).status).toBe(403);
    expect(m.moverEquipos).not.toHaveBeenCalled();
    m.getBiomedAccessForUser.mockResolvedValue([acceso]);
    m.listEquipos.mockResolvedValue({ total: 1, page: 2, pageSize: 100, equipos: [{ id: 1 }] });
    m.resumenInventario.mockResolvedValue({ total: 1 });
    const res = await inventario.GET(get('/x?company=3&q=SK&estado=bodega&cliente=PISA&ciudad=Bogot%C3%A1&codigo=4053677&page=2&pageSize=100&resumen=1'));
    expect(await res.json()).toEqual({ total: 1, page: 2, pageSize: 100, equipos: [{ id: 1 }], resumen: { total: 1 } });
    expect(m.listEquipos.mock.calls[0][2]).toEqual({ q: 'SK', estado: 'bodega', cliente: 'PISA', ciudad: 'Bogotá', codigo: '4053677', page: '2', pageSize: '100' });
    await inventario.GET(get('/x?company=3'));
    expect(m.resumenInventario).toHaveBeenCalledTimes(1);
    m.idsFiltrados.mockResolvedValue([1, 2]);
    expect(await (await ids.GET(get('/x?company=3&estado=bodega'))).json()).toEqual({ ids: [1, 2] });
  });

  it('alta, edición, historial, movimientos, valores y cobros con el actor de la sesión; los errores del SGC salen con su código', async () => {
    m.crearEquipo.mockResolvedValue({ id: 9 });
    expect((await inventario.POST(send('POST', { company: 3, equipo: 'BOMBA', serie: 'X' }))).status).toBe(201);
    expect(m.crearEquipo.mock.calls[0][3]).toMatchObject({ email: EMAIL, ip: '10.0.0.9' });
    m.editarEquipo.mockRejectedValue(new SgcError('Escriba por qué se cambia.', 400));
    expect((await equipo.PATCH(send('PATCH', { company: 3, serie: 'Y' }), params('9'))).status).toBe(400);
    expect((await equipo.PATCH(send('PATCH', { company: 3 }), params('x'))).status).toBe(400);
    m.historialEquipo.mockResolvedValue({ historial: [] });
    expect((await equipo.GET(get('/x?company=3'), params('9'))).status).toBe(200);
    m.moverEquipos.mockResolvedValue({ movidos: 3 });
    expect(await (await movimiento.POST(send('POST', { company: 3, accion: 'distribuir', ids: [1, 2, 3], cliente: 'SANSMED' }))).json()).toEqual({ movidos: 3 });
    expect(m.moverEquipos.mock.calls[0][2]).toMatchObject({ accion: 'distribuir', ids: [1, 2, 3], cliente: 'SANSMED' });
    m.listValores.mockResolvedValue([]);
    expect(await (await valores.GET(get('/x?company=3'))).json()).toEqual({ valores: [] });
    m.saveValor.mockResolvedValue({ codigo: '1', valor: 2, cobrosCompletados: 0 });
    expect((await valores.POST(send('POST', { company: 3, codigo: '1', valor: 2 }))).status).toBe(200);
    m.cobros.mockResolvedValue({ clientes: [], total: 0 });
    expect((await cobros.GET(get('/x?company=3'))).status).toBe(200);
    expect((await movimiento.POST(new Request('http://x/api', { method: 'POST', body: 'no-json', headers: H }))).status).toBe(400);
  });

  it('cargue: simular no escribe y devuelve el resumen; aplicar escribe; sin archivo 400; muy grande 413', async () => {
    m.leerInventarioXlsx.mockResolvedValue({ filas: [{ fila: 6, datos: { serie: 'A' } }], errores: [], hoja: 'FR-017' });
    m.simularCargue.mockResolvedValue({ leidas: 1, nuevos: [{ fila: 6, datos: { serie: 'A' } }], cambios: [], iguales: 0, errores: [], noEnArchivo: 0 });
    const form = (modo: string) => {
      const f = new FormData();
      f.append('company', '3');
      f.append('modo', modo);
      f.append('justificacion', 'Inventario de octubre');
      f.append('file', new File([new Uint8Array([0x50, 0x4b])], 'FR-017.xlsx'));
      return f;
    };
    const sim = await (await cargue.POST(new Request('http://x/api', { method: 'POST', body: form('simular'), headers: H }))).json();
    expect(sim).toMatchObject({ hoja: 'FR-017', leidas: 1, nuevos: 1, cambios: 0, errores: 0, muestraNuevos: [{ fila: 6, serie: 'A' }] });
    expect(m.aplicarCargue).not.toHaveBeenCalled();
    m.aplicarCargue.mockResolvedValue({ creados: 1, actualizados: 0 });
    expect(await (await cargue.POST(new Request('http://x/api', { method: 'POST', body: form('aplicar'), headers: H }))).json()).toEqual({ creados: 1, actualizados: 0 });
    expect(m.aplicarCargue.mock.calls[0][4]).toEqual({ justificacion: 'Inventario de octubre', nombreArchivo: 'FR-017.xlsx' });
    const sinArchivo = new FormData();
    sinArchivo.append('company', '3');
    expect((await cargue.POST(new Request('http://x/api', { method: 'POST', body: sinArchivo, headers: H }))).status).toBe(400);
    expect((await cargue.POST(new Request('http://x/api', { method: 'POST', body: form('simular'), headers: { ...H, 'content-length': String(20 * 1024 * 1024) } }))).status).toBe(413);
  });

  it('artículo de SAP: busca en el SAP de la empresa (solo lectura) y asigna en bloque', async () => {
    expect(await (await sap.GET(get('/x?company=3&q=a'))).json()).toEqual({ items: [] });
    m.findFirst.mockResolvedValue(null);
    expect((await sap.GET(get('/x?company=3&q=bomba'))).status).toBe(409);
    m.findFirst.mockResolvedValue({ base_url: 'https://sl', username: 'u', password: 'p', client: 'OLP' });
    m.sapLogin.mockResolvedValue({ s: 1 });
    m.sapGet.mockResolvedValue({ value: [{ ItemCode: 'PT-1', ItemName: "Bomba d'infusión" }] });
    expect(await (await sap.GET(get("/x?company=3&q=d'inf"))).json()).toEqual({ items: [{ itemCode: 'PT-1', itemName: "Bomba d'infusión" }] });
    expect(decodeURIComponent(m.sapGet.mock.calls[0][1])).toContain("contains(ItemName,'d''inf')");
    expect(m.sapLogout).toHaveBeenCalled();
    m.asignarArticuloSap.mockResolvedValue({ asignados: 2 });
    expect(await (await sap.POST(send('POST', { company: 3, ids: [1, 2], itemCode: 'PT-1' }))).json()).toEqual({ asignados: 2 });
  });
});

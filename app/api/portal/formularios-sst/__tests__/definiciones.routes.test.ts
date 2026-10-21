import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta de ADMINISTRACIÓN de formularios SST (Cristian Baldión, 2026-10-20): sesión y catálogo SIMULADOS; los permisos son los REALES.

const { identificar, catalogoParaAdministrar, guardarDefinicionSst, retirarFormularioSst } = vi.hoisted(() => ({
  identificar: vi.fn(),
  catalogoParaAdministrar: vi.fn(),
  guardarDefinicionSst: vi.fn(),
  retirarFormularioSst: vi.fn(),
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/formulario-servidor', () => ({ registrarErrorSinDatos: vi.fn() }));
vi.mock('@/lib/portal/formularios-sst-catalogo', async (original) => ({
  ...(await original<typeof import('@/lib/portal/formularios-sst-catalogo')>()),
  catalogoParaAdministrar,
  guardarDefinicionSst,
  retirarFormularioSst,
}));

import { NextRequest } from 'next/server';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { FORMULARIOS_SST } from '@/lib/portal/formularios-sst';
import { ErrorCatalogoSst } from '@/lib/portal/formularios-sst-catalogo';
import { DELETE, GET, POST } from '../definiciones/route';

const ADMIN = 'cristian.baldion@gsslatam.com';
const LECTOR = 'sandy.cardenal@gsslatam.com';
const url = (q = '') => new URL(`/api/portal/formularios-sst/definiciones${q}`, 'http://localhost');
const get = () => new NextRequest(url());
const post = (cuerpo: unknown) => new NextRequest(url(), { method: 'POST', body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), headers: { 'Content-Type': 'application/json' } });
const borrar = (q: string) => new NextRequest(url(q), { method: 'DELETE' });
const DEF = { formato: 1, codigo: 'SST-NUEVO', titulo: 'Nuevo', preguntas: [{ id: 'q1', texto: 'A', tipo: 'texto', obligatoria: true }] };
const ACTUALES = FORMULARIOS_SST.map((f) => ({ ...f, origen: 'base' as const, guardadoEl: null, editado: false }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: ADMIN, via: 'codigo' });
  catalogoParaAdministrar.mockResolvedValue({ formularios: ACTUALES, guardados: [] });
  guardarDefinicionSst.mockResolvedValue({ codigo: 'SST-NUEVO', titulo: 'Nuevo', origen: 'personalizado', guardadoEl: '2026-10-20T15:00:00.000Z' });
  retirarFormularioSst.mockResolvedValue(undefined);
});

describe('quién puede: SOLO el administrador', () => {
  it('sin sesión: 401 en las tres operaciones, y el catálogo ni se toca', async () => {
    identificar.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect((await POST(post({ definicion: DEF, nuevo: true }))).status).toBe(401);
    expect((await DELETE(borrar('?codigo=SST-NUEVO'))).status).toBe(401);
    expect(catalogoParaAdministrar).not.toHaveBeenCalled();
    expect(guardarDefinicionSst).not.toHaveBeenCalled();
    expect(retirarFormularioSst).not.toHaveBeenCalled();
  });
  it('los lectores SST, el buzón sst@, otra persona, correos parecidos y vacío: 403 en las tres, sin tocar nada', async () => {
    for (const correo of [LECTOR, 'sst@gsslatam.com', 'nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com.evil.com', 'xcristian.baldion@gsslatam.com', '']) {
      identificar.mockResolvedValue({ correo, via: 'codigo' });
      expect((await GET(get())).status, `GET ${correo}`).toBe(403);
      expect((await POST(post({ definicion: DEF, nuevo: true }))).status, `POST ${correo}`).toBe(403);
      expect((await DELETE(borrar('?codigo=SST-NUEVO'))).status, `DELETE ${correo}`).toBe(403);
    }
    expect(catalogoParaAdministrar).not.toHaveBeenCalled();
    expect(guardarDefinicionSst).not.toHaveBeenCalled();
    expect(retirarFormularioSst).not.toHaveBeenCalled();
  });
  it('el administrador entra aunque su correo llegue con mayúsculas', async () => {
    identificar.mockResolvedValue({ correo: 'CRISTIAN.Baldion@GSSLATAM.com', via: 'codigo' });
    expect((await GET(get())).status).toBe(200);
  });
});

describe('GET (lista con las definiciones para editar)', () => {
  it('entrega código, título, origen y la definición completa de cada formulario, sin caché', async () => {
    const r = await GET(get());
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
    const d = await r.json();
    expect(d.formularios.map((f: { codigo: string }) => f.codigo)).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
    expect(d.formularios[0]).toMatchObject({ origen: 'base', editado: false, guardadoEl: null });
    expect(d.formularios[1].definicion.preguntas).toHaveLength(26);
  });
  it('si SharePoint falla: 502 sin detalles; sin configurar: 503; sin permiso: aviso claro', async () => {
    catalogoParaAdministrar.mockRejectedValueOnce(new FormacionStorageNoConfigurado('Faltan variables: X'));
    expect((await GET(get())).status).toBe(503);
    catalogoParaAdministrar.mockRejectedValueOnce(new FormacionStorageError('Graph 403 secreto', 403));
    let r = await GET(get());
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('El portal no tiene permiso para guardar en la carpeta FORMULARIOS SST de SharePoint. Avise a Tecnología.');
    catalogoParaAdministrar.mockRejectedValueOnce(new Error('boom con 1010101010'));
    r = await GET(get());
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toMatch(/boom|1010101010|secreto/);
  });
});

describe('POST (crear o guardar una versión nueva)', () => {
  it('crea (201) con el correo de la SESIÓN y la bandera «nuevo»; editar responde 200', async () => {
    const r = await POST(post({ definicion: DEF, nuevo: true, correo: 'otro@x.com' }));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ formulario: { codigo: 'SST-NUEVO', titulo: 'Nuevo', origen: 'personalizado', guardadoEl: '2026-10-20T15:00:00.000Z' } });
    expect(guardarDefinicionSst).toHaveBeenCalledWith({ definicion: DEF, nuevo: true, correo: ADMIN });
    expect((await POST(post({ definicion: DEF, nuevo: false }))).status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
  });
  it('cuerpo que no es JSON, un arreglo, sin la bandera «nuevo» o con una bandera que no es booleana: 400; demasiado grande: 413', async () => {
    for (const cuerpo of ['esto no es json', 'null', '[]', '"x"', { definicion: DEF }, { definicion: DEF, nuevo: 'si' }]) {
      expect((await POST(post(cuerpo))).status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect((await POST(post({ definicion: { ...DEF, descripcion: 'x'.repeat(600 * 1024) }, nuevo: true }))).status).toBe(413);
    expect(guardarDefinicionSst).not.toHaveBeenCalled();
  });
  it('los problemas del formulario llegan con su código y la lista para mostrar arriba (422, 409, 404)', async () => {
    guardarDefinicionSst.mockRejectedValueOnce(new ErrorCatalogoSst(422, 'Revise el formulario.', ['Pregunta 1: escriba el enunciado.']));
    let r = await POST(post({ definicion: DEF, nuevo: true }));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'Revise el formulario.', errores: ['Pregunta 1: escriba el enunciado.'] });
    guardarDefinicionSst.mockRejectedValueOnce(new ErrorCatalogoSst(409, 'Ya existe un formulario con ese código (puede estar retirado). Cambie el código.'));
    r = await POST(post({ definicion: DEF, nuevo: true }));
    expect(r.status).toBe(409);
    expect((await r.json()).errores).toBeUndefined();
    guardarDefinicionSst.mockRejectedValueOnce(new ErrorCatalogoSst(404, 'Ese formulario no existe o fue retirado.'));
    expect((await POST(post({ definicion: DEF, nuevo: false }))).status).toBe(404);
  });
  it('errores de SharePoint: sin configurar 503; sin permiso 502; otro fallo 502 genérico sin detalles', async () => {
    guardarDefinicionSst.mockRejectedValueOnce(new FormacionStorageNoConfigurado('X'));
    expect((await POST(post({ definicion: DEF, nuevo: true }))).status).toBe(503);
    guardarDefinicionSst.mockRejectedValueOnce(new FormacionStorageError('Graph 403', 403));
    const r = await POST(post({ definicion: DEF, nuevo: true }));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/no tiene permiso para guardar/);
    guardarDefinicionSst.mockRejectedValueOnce(new Error('boom con Reporte nuevo'));
    const o = await POST(post({ definicion: DEF, nuevo: true }));
    expect(o.status).toBe(502);
    expect(JSON.stringify(await o.json())).not.toMatch(/boom|Reporte nuevo/);
  });
});

describe('DELETE (retirar)', () => {
  it('retira con el código de la URL y el correo de la sesión', async () => {
    const r = await DELETE(borrar('?codigo=SST-NUEVO'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(retirarFormularioSst).toHaveBeenCalledWith({ codigo: 'SST-NUEVO', correo: ADMIN });
  });
  it('las reglas del servicio llegan con su código (400 para los de B1 y B2, 404 si no existe)', async () => {
    retirarFormularioSst.mockRejectedValueOnce(new ErrorCatalogoSst(400, 'Los formularios del sistema (B1 y B2) no se pueden retirar; sí se pueden editar.'));
    expect((await DELETE(borrar('?codigo=SST-REPORTE-ACTOS'))).status).toBe(400);
    retirarFormularioSst.mockRejectedValueOnce(new ErrorCatalogoSst(404, 'Ese formulario no existe o ya fue retirado.'));
    expect((await DELETE(borrar('?codigo=SST-X'))).status).toBe(404);
  });
});

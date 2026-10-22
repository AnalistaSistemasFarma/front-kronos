import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas de FORMULARIOS SST (Cristian Baldión, 2026-10-20): sesión, SharePoint y Excel SIMULADOS; los permisos y las definiciones son los REALES.

const { identificar, resolverNombreEstudiante, guardarEnvioSst, listarEnviosSst, excelDeRespuestas } = vi.hoisted(() => ({
  identificar: vi.fn(),
  resolverNombreEstudiante: vi.fn(),
  guardarEnvioSst: vi.fn(),
  listarEnviosSst: vi.fn(),
  excelDeRespuestas: vi.fn(),
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/formacion', () => ({ resolverNombreEstudiante }));
vi.mock('@/lib/portal/formulario-servidor', () => ({ excelDeRespuestas, registrarErrorSinDatos: vi.fn() }));
// El catálogo (B1 y B2 del código + los que crea el administrador) se simula con los del código; su lógica se prueba en `formularios-sst-catalogo.test.ts`.
vi.mock('@/lib/portal/formularios-sst-catalogo', async () => {
  const base = await import('@/lib/portal/formularios-sst');
  const actuales = base.FORMULARIOS_SST.map((f) => ({ ...f, origen: 'base' as const, guardadoEl: null, editado: false }));
  return {
    listarFormulariosSst: vi.fn(async () => actuales),
    formularioSstActual: vi.fn(async (codigo: unknown) => actuales.find((f) => f.codigo === codigo) ?? null),
  };
});
vi.mock('@/lib/portal/formularios-sst-servidor', async (original) => ({
  ...(await original<typeof import('@/lib/portal/formularios-sst-servidor')>()),
  guardarEnvioSst,
  listarEnviosSst,
}));

import { NextRequest } from 'next/server';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import type { PreguntaFormulario, Respuestas } from '@/lib/portal/formulario';
import { FORMULARIOS_SST, LIMITE_EXCEL_SST, LIMITE_TABLA_SST } from '@/lib/portal/formularios-sst';
import { ErrorEnvioSst } from '@/lib/portal/formularios-sst-servidor';
import { GET as lista } from '../route';
import { GET as abrir, POST as enviar } from '../[codigo]/route';
import { GET as respuestas } from '../[codigo]/respuestas/route';
import { GET as excel } from '../[codigo]/respuestas/excel/route';

const [REPORTE, SALUD] = FORMULARIOS_SST;
const LECTOR = 'sandy.cardenal@gsslatam.com';
const ADMIN = 'cristian.baldion@gsslatam.com';
const url = (ruta: string) => new URL(`/api/portal/formularios-sst${ruta}`, 'http://localhost');
const get = (ruta = '') => new NextRequest(url(ruta));
const post = (ruta: string, cuerpo: unknown) => new NextRequest(url(ruta), { method: 'POST', body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), headers: { 'Content-Type': 'application/json' } });
const con = (codigo: string) => ({ params: Promise.resolve({ codigo }) });

function respuestaValida(p: PreguntaFormulario): Respuestas[string] {
  if (p.tipo === 'seleccion') return (p.opciones as string[])[0];
  if (p.tipo === 'seleccion_multiple') return [(p.opciones as string[])[0]];
  if (p.tipo === 'si_no') return 'Sí';
  if (p.tipo === 'escala') return String(p.escala?.min ?? 0);
  return 'Dato de prueba';
}
const completas = (f: (typeof FORMULARIOS_SST)[number]): Respuestas => Object.fromEntries(f.definicion.preguntas.map((p) => [p.id, respuestaValida(p)]));

const TABLA = { formulario: { codigo: REPORTE.codigo, titulo: REPORTE.titulo }, columnas: [{ id: 'r01', texto: 'Nombre' }], filas: [{ id: '20261020100000-aaaaaaaa-abc123.json', correo: 'a@x.com', enviadaEl: '2026-10-20T15:00:00.000Z', autorizacionVersion: null, respuestas: { r01: 'Ana' } }], total: 1, truncado: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: 'laura.gomez@gsslatam.com', via: 'codigo' });
  resolverNombreEstudiante.mockResolvedValue('Laura Gómez');
  guardarEnvioSst.mockResolvedValue({ enviadoEl: '2026-10-20T15:00:00.000Z' });
  listarEnviosSst.mockResolvedValue(TABLA);
  excelDeRespuestas.mockResolvedValue(Buffer.from('xlsx-falso'));
});

describe('GET /api/portal/formularios-sst (lista)', () => {
  it('sin sesión: 401', async () => {
    identificar.mockResolvedValue(null);
    expect((await lista(get())).status).toBe(401);
  });
  it('cualquier sesión ve los dos formularios, pero solo administrador y lectores ven que pueden ver las respuestas', async () => {
    const r = await lista(get());
    const d = await r.json();
    expect(d.formularios.map((f: { codigo: string }) => f.codigo)).toEqual([REPORTE.codigo, SALUD.codigo]);
    expect(d.formularios[1].datosSensibles).toBe(true);
    expect(d.formularios.map((f: { origen: string }) => f.origen)).toEqual(['base', 'base']);
    expect(d.puedeVerRespuestas).toBe(false);
    expect(d.puedeAdministrar).toBe(false);
    expect(r.headers.get('cache-control')).toContain('no-store');
    for (const correo of [LECTOR, ADMIN, 'SANDY.cardenal@GSSLATAM.com']) {
      identificar.mockResolvedValue({ correo, via: 'codigo' });
      expect((await (await lista(get())).json()).puedeVerRespuestas, correo).toBe(true);
    }
  });
  it('solo el ADMINISTRADOR ve que puede administrar: los lectores SST ven respuestas pero no crean ni editan', async () => {
    identificar.mockResolvedValue({ correo: LECTOR, via: 'codigo' });
    expect(await (await lista(get())).json()).toMatchObject({ puedeVerRespuestas: true, puedeAdministrar: false });
    identificar.mockResolvedValue({ correo: 'CRISTIAN.baldion@gsslatam.com', via: 'codigo' });
    expect(await (await lista(get())).json()).toMatchObject({ puedeVerRespuestas: true, puedeAdministrar: true });
  });
  it('no entrega las preguntas ni ninguna respuesta', async () => {
    const texto = JSON.stringify(await (await lista(get())).json());
    expect(texto).not.toMatch(/preguntas|respuestas"|opciones/);
  });
});

describe('GET /api/portal/formularios-sst/:codigo (abrir)', () => {
  it('sin sesión 401; código inexistente 404', async () => {
    identificar.mockResolvedValue(null);
    expect((await abrir(get(`/${REPORTE.codigo}`), con(REPORTE.codigo))).status).toBe(401);
    identificar.mockResolvedValue({ correo: 'a@x.com', via: 'codigo' });
    expect((await abrir(get('/NO-EXISTE'), con('NO-EXISTE'))).status).toBe(404);
  });
  it('entrega la definición, el correo y el nombre de la sesión para prellenar, y nunca respuestas ni caché', async () => {
    const r = await abrir(get(`/${SALUD.codigo}`), con(SALUD.codigo));
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.formulario.definicion.codigo).toBe(SALUD.codigo);
    expect(d.formulario.definicion.preguntas).toHaveLength(26);
    expect(d.prellenado).toEqual({ correo: 'laura.gomez@gsslatam.com', nombre: 'Laura Gómez' });
    expect(d.enviadaEl).toBeNull();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(guardarEnvioSst).not.toHaveBeenCalled();
    expect(listarEnviosSst).not.toHaveBeenCalled();
  });
});

describe('POST /api/portal/formularios-sst/:codigo (enviar)', () => {
  it('sin sesión 401; código inexistente 404; cuerpo que no es JSON, un arreglo o demasiado largo: 400 y 413', async () => {
    identificar.mockResolvedValue(null);
    expect((await enviar(post(`/${REPORTE.codigo}`, {}), con(REPORTE.codigo))).status).toBe(401);
    identificar.mockResolvedValue({ correo: 'a@x.com', via: 'codigo' });
    expect((await enviar(post('/NO-EXISTE', {}), con('NO-EXISTE'))).status).toBe(404);
    for (const cuerpo of ['esto no es json', 'null', '[]', '"texto"']) expect((await enviar(post(`/${REPORTE.codigo}`, cuerpo), con(REPORTE.codigo))).status, cuerpo).toBe(400);
    expect((await enviar(post(`/${REPORTE.codigo}`, { respuestas: { r06: 'x'.repeat(600 * 1024) } }), con(REPORTE.codigo))).status).toBe(413);
    expect(guardarEnvioSst).not.toHaveBeenCalled();
  });
  it('B1 completo: 201, y lo guardado lleva el correo de la SESIÓN y las respuestas validadas', async () => {
    const r = await enviar(post(`/${REPORTE.codigo}`, { respuestas: completas(REPORTE) }), con(REPORTE.codigo));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ ok: true, completado: true, enviadaEl: '2026-10-20T15:00:00.000Z' });
    expect(guardarEnvioSst).toHaveBeenCalledTimes(1);
    expect(guardarEnvioSst.mock.calls[0][0]).toMatchObject({ formulario: REPORTE, correo: 'laura.gomez@gsslatam.com', autorizaDatos: false, respuestas: completas(REPORTE) });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('B1 incompleto o con una opción inventada: 422 con las preguntas señaladas, y no se guarda nada', async () => {
    const sin = completas(REPORTE);
    delete sin.r06;
    const r = await enviar(post(`/${REPORTE.codigo}`, { respuestas: sin }), con(REPORTE.codigo));
    expect(r.status).toBe(422);
    expect((await r.json()).errores.map((e: { id: string }) => e.id)).toEqual(['r06']);
    const inventada = await enviar(post(`/${REPORTE.codigo}`, { respuestas: { ...completas(REPORTE), r03: 'La luna' } }), con(REPORTE.codigo));
    expect(inventada.status).toBe(422);
    expect(guardarEnvioSst).not.toHaveBeenCalled();
  });
  it('B2 sin la autorización de datos: 422 y no se guarda nada; con ella, 201 y queda constancia', async () => {
    const sin = await enviar(post(`/${SALUD.codigo}`, { respuestas: completas(SALUD) }), con(SALUD.codigo));
    expect(sin.status).toBe(422);
    expect((await sin.json()).errores).toEqual([{ id: 'autorizacion', mensaje: 'Debe leer y aceptar la autorización de tratamiento de datos personales para enviar el formulario.' }]);
    for (const falso of ['true', 1, 'si', null]) {
      expect((await enviar(post(`/${SALUD.codigo}`, { autorizaDatos: falso, respuestas: completas(SALUD) }), con(SALUD.codigo))).status, String(falso)).toBe(422);
    }
    expect(guardarEnvioSst).not.toHaveBeenCalled();
    const ok = await enviar(post(`/${SALUD.codigo}`, { autorizaDatos: true, respuestas: completas(SALUD) }), con(SALUD.codigo));
    expect(ok.status).toBe(201);
    expect(guardarEnvioSst.mock.calls[0][0]).toMatchObject({ formulario: SALUD, autorizaDatos: true });
  });
  it('B2 con «Otras» y la escala en 0: se acepta; una escala de 11 se rechaza', async () => {
    const base = { ...completas(SALUD), o10: ['Cabeza', 'Otras: Ojo izquierdo'], o11: '0' };
    expect((await enviar(post(`/${SALUD.codigo}`, { autorizaDatos: true, respuestas: base }), con(SALUD.codigo))).status).toBe(201);
    const mal = await enviar(post(`/${SALUD.codigo}`, { autorizaDatos: true, respuestas: { ...base, o11: '11' } }), con(SALUD.codigo));
    expect(mal.status).toBe(422);
    expect((await mal.json()).errores).toEqual([{ id: 'o11', mensaje: 'Elija un valor de 0 a 10.' }]);
  });
  it('el tope diario (429) llega con su mensaje; sin configurar es 503; sin permiso 502; y cualquier otro fallo, 502 genérico sin respuestas ni detalles', async () => {
    guardarEnvioSst.mockRejectedValueOnce(new ErrorEnvioSst(429, 'Ya envió este formulario 20 veces hoy.'));
    let r = await enviar(post(`/${REPORTE.codigo}`, { respuestas: completas(REPORTE) }), con(REPORTE.codigo));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('Ya envió este formulario 20 veces hoy.');

    guardarEnvioSst.mockRejectedValueOnce(new FormacionStorageNoConfigurado('Faltan variables: X'));
    expect((await enviar(post(`/${REPORTE.codigo}`, { respuestas: completas(REPORTE) }), con(REPORTE.codigo))).status).toBe(503);

    guardarEnvioSst.mockRejectedValueOnce(new FormacionStorageError('Graph 403 secreto', 403));
    r = await enviar(post(`/${REPORTE.codigo}`, { respuestas: completas(REPORTE) }), con(REPORTE.codigo));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('El portal no tiene permiso para guardar el formulario en SharePoint. Avise a Tecnología.');

    guardarEnvioSst.mockRejectedValueOnce(new Error('boom con 1010101010 y Piso mojado'));
    r = await enviar(post(`/${REPORTE.codigo}`, { respuestas: completas(REPORTE) }), con(REPORTE.codigo));
    const cuerpo = JSON.stringify(await r.json());
    expect(r.status).toBe(502);
    expect(cuerpo).not.toMatch(/boom|1010101010|Piso mojado|secreto/);
  });
});

describe('GET .../respuestas (tabla)', () => {
  it('sin sesión 401; quien NO es administrador ni lector recibe 403 y SharePoint ni se toca, tenga o no respuestas', async () => {
    identificar.mockResolvedValue(null);
    expect((await respuestas(get(`/${REPORTE.codigo}/respuestas`), con(REPORTE.codigo))).status).toBe(401);
    for (const correo of ['laura.gomez@gsslatam.com', 'sst@gsslatam.com', 'nicolas.rivera@gsslatam.com', 'sandy.cardenal@gsslatam.com.evil.com', '']) {
      identificar.mockResolvedValue({ correo, via: 'codigo' });
      expect((await respuestas(get(`/${REPORTE.codigo}/respuestas`), con(REPORTE.codigo))).status, correo).toBe(403);
    }
    expect(listarEnviosSst).not.toHaveBeenCalled();
  });
  it('el lector y el administrador reciben la tabla (los más recientes, sin caché); un código inexistente es 404', async () => {
    for (const correo of [LECTOR, ADMIN]) {
      identificar.mockResolvedValue({ correo, via: 'codigo' });
      const r = await respuestas(get(`/${REPORTE.codigo}/respuestas`), con(REPORTE.codigo));
      expect(r.status, correo).toBe(200);
      expect(await r.json()).toEqual(TABLA);
      expect(r.headers.get('cache-control')).toContain('no-store');
    }
    expect(listarEnviosSst).toHaveBeenCalledWith(expect.objectContaining({ codigo: REPORTE.codigo }), LIMITE_TABLA_SST);
    expect((await respuestas(get('/NO-EXISTE/respuestas'), con('NO-EXISTE'))).status).toBe(404);
  });
  it('errores de SharePoint: sin configurar 503; sin permiso 502; otro fallo 502 sin detalles', async () => {
    identificar.mockResolvedValue({ correo: LECTOR, via: 'codigo' });
    listarEnviosSst.mockRejectedValueOnce(new FormacionStorageNoConfigurado('Faltan variables: X'));
    expect((await respuestas(get(`/${REPORTE.codigo}/respuestas`), con(REPORTE.codigo))).status).toBe(503);
    listarEnviosSst.mockRejectedValueOnce(new FormacionStorageError('Graph 403', 403));
    const r = await respuestas(get(`/${REPORTE.codigo}/respuestas`), con(REPORTE.codigo));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('El portal no tiene permiso para leer FORMULARIOS SST en SharePoint. Avise a Tecnología.');
    listarEnviosSst.mockRejectedValueOnce(new Error('boom con a@x.com'));
    const o = await respuestas(get(`/${REPORTE.codigo}/respuestas`), con(REPORTE.codigo));
    expect(o.status).toBe(502);
    expect(JSON.stringify(await o.json())).not.toMatch(/boom|a@x\.com/);
  });
});

describe('GET .../respuestas/excel', () => {
  it('sin sesión 401; quien no es administrador ni lector, 403 sin generar nada', async () => {
    identificar.mockResolvedValue(null);
    expect((await excel(get(`/${REPORTE.codigo}/respuestas/excel`), con(REPORTE.codigo))).status).toBe(401);
    identificar.mockResolvedValue({ correo: 'laura.gomez@gsslatam.com', via: 'codigo' });
    expect((await excel(get(`/${REPORTE.codigo}/respuestas/excel`), con(REPORTE.codigo))).status).toBe(403);
    expect(listarEnviosSst).not.toHaveBeenCalled();
    expect(excelDeRespuestas).not.toHaveBeenCalled();
  });
  it('el lector descarga el .xlsx: hasta 2000 envíos, con el nombre del formulario y sin caché; código inexistente 404', async () => {
    identificar.mockResolvedValue({ correo: LECTOR, via: 'codigo' });
    const r = await excel(get(`/${REPORTE.codigo}/respuestas/excel`), con(REPORTE.codigo));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(r.headers.get('content-disposition')).toBe(`attachment; filename="${REPORTE.codigo}-respuestas.xlsx"`);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('xlsx-falso');
    expect(listarEnviosSst).toHaveBeenCalledWith(expect.objectContaining({ codigo: REPORTE.codigo }), LIMITE_EXCEL_SST);
    const [tabla, etiqueta] = excelDeRespuestas.mock.calls[0];
    expect(etiqueta).toBe('Formularios SST');
    expect(tabla).toMatchObject({ evaluacion: false, columnas: TABLA.columnas, formulario: { codigo: REPORTE.codigo, version: 1 } });
    expect(tabla.filas).toEqual([{ id: 1, correo: 'a@x.com', enviadaEl: '2026-10-20T15:00:00.000Z', version: 1, autorizacionVersion: null, autorizadoEl: null, respuestas: { r01: 'Ana' } }]);
    expect((await excel(get('/NO-EXISTE/respuestas/excel'), con('NO-EXISTE'))).status).toBe(404);
  });
  it('en el formulario de salud la fecha de autorización es la del envío', async () => {
    identificar.mockResolvedValue({ correo: ADMIN, via: 'codigo' });
    listarEnviosSst.mockResolvedValueOnce({ ...TABLA, filas: [{ ...TABLA.filas[0], autorizacionVersion: 'AUT-1' }] });
    await excel(get(`/${SALUD.codigo}/respuestas/excel`), con(SALUD.codigo));
    expect(excelDeRespuestas.mock.calls[0][0].filas[0]).toMatchObject({ autorizacionVersion: 'AUT-1', autorizadoEl: '2026-10-20T15:00:00.000Z' });
  });
  it('errores: sin configurar 503, sin permiso o fallo 502, sin detalles', async () => {
    identificar.mockResolvedValue({ correo: LECTOR, via: 'codigo' });
    listarEnviosSst.mockRejectedValueOnce(new FormacionStorageNoConfigurado('X'));
    expect((await excel(get(`/${REPORTE.codigo}/respuestas/excel`), con(REPORTE.codigo))).status).toBe(503);
    listarEnviosSst.mockRejectedValueOnce(new FormacionStorageError('Graph 403', 403));
    expect((await excel(get(`/${REPORTE.codigo}/respuestas/excel`), con(REPORTE.codigo))).status).toBe(502);
    excelDeRespuestas.mockRejectedValueOnce(new Error('boom con 1010101010'));
    const r = await excel(get(`/${REPORTE.codigo}/respuestas/excel`), con(REPORTE.codigo));
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toMatch(/boom|1010101010/);
  });
});

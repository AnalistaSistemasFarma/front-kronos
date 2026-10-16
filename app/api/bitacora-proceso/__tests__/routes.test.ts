import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas de Órdenes de Trabajo con la sesión y la base simuladas: permisos en el
// servidor, aislamiento por empresa y SIN rutas de edición ni borrado.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getOtAccessForUser', 'getActiveUserId', 'listOrdenes', 'crearOrden', 'getOrdenDetalle',
    'crearRegistro', 'confirmarVistoBueno', 'prepararConfirmante', 'listActividades', 'crearActividad', 'cambiarActividad', 'listUsuariosEmpresa', 'buscarOps',
    'datosAviso', 'createAndSendNotifications', 'listOperadores', 'crearOperador', 'cambiarOperador', 'agregarOperadores', 'listAreas', 'crearArea', 'cambiarArea',
    'listSupervisoresEmpresa', 'listResponsables', 'listResponsablesEmpresa', 'listCandidatosResponsable', 'asignarResponsable', 'cambiarResponsable', 'importarOperadores', 'estadoPin', 'configurarPin', 'listPinsEmpresa', 'restablecerPin', 'verificarPassword',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/bitacora-proceso/db', () => ({
  getOtAccessForUser: m.getOtAccessForUser, getActiveUserId: m.getActiveUserId, listOrdenes: m.listOrdenes, crearOrden: m.crearOrden,
  getOrdenDetalle: m.getOrdenDetalle, crearRegistro: m.crearRegistro, confirmarVistoBueno: m.confirmarVistoBueno, listActividades: m.listActividades,
  crearActividad: m.crearActividad, cambiarActividad: m.cambiarActividad, listUsuariosEmpresa: m.listUsuariosEmpresa,
  datosAviso: m.datosAviso, importarOperadores: m.importarOperadores, estadoPin: m.estadoPin, configurarPin: m.configurarPin,
  listPinsEmpresa: m.listPinsEmpresa, restablecerPin: m.restablecerPin, listOperadores: m.listOperadores, crearOperador: m.crearOperador, cambiarOperador: m.cambiarOperador,
  agregarOperadores: m.agregarOperadores, listAreas: m.listAreas, crearArea: m.crearArea, cambiarArea: m.cambiarArea, listSupervisoresEmpresa: m.listSupervisoresEmpresa,
  listResponsables: m.listResponsables, listResponsablesEmpresa: m.listResponsablesEmpresa, listCandidatosResponsable: m.listCandidatosResponsable,
  asignarResponsable: m.asignarResponsable, cambiarResponsable: m.cambiarResponsable,
}));
// El notificador compartido (campana + push): se simula para ver QUÉ se avisa y a QUIÉN.
vi.mock('../../../../lib/notifications.js', () => ({ createAndSendNotifications: m.createAndSendNotifications }));
vi.mock('../../../../lib/bitacora-proceso/sap', () => ({ buscarOps: m.buscarOps }));
vi.mock('../_lib/firmante', () => ({ prepararConfirmante: m.prepararConfirmante }));
vi.mock('../../../../lib/auth/verifyPassword', () => ({ synerlinkPasswordVerifier: () => m.verificarPassword }));

import { OtError } from '../../../../lib/bitacora-proceso/rules';
import { SapError } from '../../../../lib/sap/serviceLayer';
import * as lista from '../route';
import * as detalle from '../[id]/route';
import * as registros from '../[id]/registros/route';
import * as confirmar from '../[id]/confirmar/route';
import * as pin from '../pin/route';
import * as pinUsuarios from '../pin/usuarios/route';
import * as pinRestablecer from '../pin/restablecer/route';
import * as importar from '../operadores/importar/route';
import * as actividades from '../actividades/route';
import * as sapOp from '../sap-op/route';
import * as usuarios from '../usuarios/route';
import * as operadores from '../operadores/route';
import * as areas from '../areas/route';
import * as supervisores from '../supervisores/route';
import * as responsables from '../responsables/route';
import * as operadoresOrden from '../[id]/operadores/route';

const FARMA = 1;
const operario = { idCompany: FARMA, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: false };
const supervisor = { ...operario, canManage: true };
function asUser(access: object[], idUser: string | null = 'u1', role = 'user') {
  m.getServerSession.mockResolvedValue({ user: { email: 'op@farmalogica.com', role } });
  m.getOtAccessForUser.mockResolvedValue(access);
  m.getActiveUserId.mockResolvedValue(idUser);
}
const H = { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'vitest' };
const get = (q: string) => new Request(`http://x/api${q}`, { headers: H });
const send = (method: string, body: unknown, q = '') => new Request(`http://x/api${q}`, { method, body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const nueva = { company: FARMA, producto: 'Cefazolina', lote: 'L1', turno: 'TARDE', operadores: [7], idArea: 3, inspector: 'u2', jefeProduccion: 'u3' };
const confirma = { rol: 'SUPERVISOR', persona: 'u-sup', confirmo: true, pin: '4821' };

const avisoBase = { idOrden: 9, idCompany: FARMA, consecutivo: 1, producto: 'Cefazolina', lote: 'L1', inspectorEmail: 'inspector@farmalogica.com', jefeEmail: 'jefe@farmalogica.com', actorNombre: 'Supervisor', actorEmail: 'op@farmalogica.com' };
const vb = (rol: string, siguiente: string | null) => ({ rol, firmadoEn: '2026-10-15T13:00:00.000Z', contentSha256: 'a'.repeat(64), nombre: 'Supervisora', siguiente });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.datosAviso.mockImplementation(async (_db: unknown, idOrden: number) => ({ ...avisoBase, idOrden }));
  m.createAndSendNotifications.mockResolvedValue({ saved: 1, pushed: 1 });
});

describe('Bitácora de Proceso · rutas', () => {
  it('sin sesión: 401; sin permiso del módulo o usuario inactivo: 403', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await lista.GET(get(''))).status).toBe(401);
    asUser([]);
    expect((await lista.GET(get(''))).status).toBe(403);
    asUser([operario], null);
    expect((await registros.POST(send('POST', { id_actividad: 1 }, '?company=1'), params('5'))).status).toBe(403);
  });

  it('no existen rutas de edición ni de borrado de órdenes ni registros', () => {
    for (const mod of [lista, detalle, registros, confirmar, operadoresOrden, importar, pinRestablecer]) {
      expect(mod).not.toHaveProperty('PUT');
      expect(mod).not.toHaveProperty('DELETE');
      expect(mod).not.toHaveProperty('PATCH');
    }
    for (const mod of [actividades, operadores, areas]) {
      expect(mod).not.toHaveProperty('DELETE');
      expect(mod).not.toHaveProperty('PUT');
    }
  });

  it('listado: solo acceso o la empresa pedida; otra empresa sin permiso es 403 (aislamiento)', async () => {
    asUser([operario]);
    const acc = await lista.GET(get('?solo=acceso'));
    expect(await acc.json()).toEqual({ companies: [operario] });
    m.listOrdenes.mockResolvedValue([{ id: 1 }]);
    const res = await lista.GET(get(''));
    expect(res.status).toBe(200);
    expect(m.listOrdenes).toHaveBeenCalledWith({ tag: 'prisma' }, FARMA, 'u1');
    expect((await lista.GET(get('?company=3'))).status).toBe(403);
    expect((await detalle.GET(get('?company=3'), params('1'))).status).toBe(403);
    expect((await registros.POST(send('POST', { id_actividad: 1 }, '?company=3'), params('1'))).status).toBe(403);
    expect((await actividades.GET(get('?company=3'))).status).toBe(403);
  });

  it('sin Gestión no se puede abrir, administrar catálogo/operarios/áreas, agregar operarios, buscar OP ni listar usuarios', async () => {
    asUser([operario]);
    const all = await Promise.all([
      lista.POST(send('POST', nueva)),
      operadores.GET(get('?company=1')),
      operadores.POST(send('POST', { company: FARMA, nombre: 'Pepito' })),
      operadores.PATCH(send('PATCH', { company: FARMA, id_operador: 7, activo: false })),
      areas.GET(get('?company=1')),
      areas.POST(send('POST', { company: FARMA, nombre: 'Llenado' })),
      areas.PATCH(send('PATCH', { company: FARMA, id_area: 3, activo: false })),
      operadoresOrden.POST(send('POST', { operadores: [7] }, '?company=1'), params('1')),
      actividades.GET(get('?company=1&todas=1')),
      actividades.POST(send('POST', { company: FARMA, nombre: 'X' })),
      actividades.PATCH(send('PATCH', { company: FARMA, id_actividad: 1, activo: false })),
      sapOp.GET(get('?company=1&q=PTCZ')),
      usuarios.GET(get('?company=1')),
      importar.POST(send('POST', { company: FARMA, texto: 'Ana; 1' })),
      pinUsuarios.GET(get('?company=1')),
      pinRestablecer.POST(send('POST', { company: FARMA, idUser: 'u9' })),
      responsables.GET(get('?company=1')),
      responsables.GET(get('?company=1&rol=INSPECTOR')),
      responsables.POST(send('POST', { company: FARMA, id_user: 'u9', rol: 'INSPECTOR' })),
      responsables.PATCH(send('PATCH', { company: FARMA, id_responsable: 1, activo: false })),
    ]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 403));
    expect(m.crearOrden).not.toHaveBeenCalled();
    expect(m.crearOperador).not.toHaveBeenCalled();
    expect(m.agregarOperadores).not.toHaveBeenCalled();
    expect(m.buscarOps).not.toHaveBeenCalled();
    expect(m.importarOperadores).not.toHaveBeenCalled();
    expect(m.restablecerPin).not.toHaveBeenCalled();
    expect(m.asignarResponsable).not.toHaveBeenCalled();
    expect(m.cambiarResponsable).not.toHaveBeenCalled();
    expect(m.listResponsables).not.toHaveBeenCalled();
  });

  it('B3 con cuenta compartida: una sesión SIN Gestión llega al visto bueno; la persona la elige y la valida el servidor (PIN)', async () => {
    asUser([operario], 'u-planta');
    const conf = { rol: 'SUPERVISOR', idUser: 'u-sup', email: 'sup@farmalogica.com', nombre: 'Supervisora', access: supervisor, metodo: 'pin_tablet' };
    m.prepararConfirmante.mockResolvedValue(conf);
    m.confirmarVistoBueno.mockResolvedValue(vb('SUPERVISOR', 'INSPECTOR'));
    const res = await confirmar.POST(send('POST', { ...confirma, observacion: 'Fin' }, '?company=1'), params('7'));
    expect(res.status).toBe(200);
    expect(m.prepararConfirmante.mock.calls[0][1]).toBe(FARMA);
    expect(m.prepararConfirmante.mock.calls[0][2]).toEqual({ rol: 'SUPERVISOR', persona: 'u-sup', idOperador: null, pin: '4821', observacion: 'Fin' });
    expect(m.confirmarVistoBueno.mock.calls[0][3]).toBe('Fin');
    expect(m.confirmarVistoBueno.mock.calls[0][4]).toBe(conf);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, rol: 'SUPERVISOR', firmante: 'Supervisora', siguiente: 'INSPECTOR' });
    // El PIN nunca vuelve en la respuesta.
    expect(JSON.stringify(body)).not.toContain('4821');
    // El aviso sale a nombre de quien confirmó, no de la cuenta de planta.
    expect(m.datosAviso.mock.calls[0][3]).toMatchObject({ idUser: 'u-sup', email: 'sup@farmalogica.com', nombre: 'Supervisora' });
    // Otra empresa: 403 sin preparar a nadie; sin «Sí, confirmo» o rol inválido: 400.
    expect((await confirmar.POST(send('POST', confirma, '?company=3'), params('7'))).status).toBe(403);
    expect((await confirmar.POST(send('POST', { ...confirma, confirmo: false }, '?company=1'), params('7'))).status).toBe(400);
    expect((await confirmar.POST(send('POST', { ...confirma, rol: 'CALIDAD' }, '?company=1'), params('7'))).status).toBe(400);
    expect((await confirmar.POST(send('POST', confirma, '?company=1'), params('x'))).status).toBe(400);
    expect(m.prepararConfirmante).toHaveBeenCalledTimes(1);
    // PIN incorrecto / regla de negocio: pasan tal cual.
    m.prepararConfirmante.mockRejectedValueOnce(new OtError('PIN incorrecto: el visto bueno no se registró.', 403));
    expect((await confirmar.POST(send('POST', confirma, '?company=1'), params('7'))).status).toBe(403);
    m.prepararConfirmante.mockResolvedValue(conf);
    m.confirmarVistoBueno.mockRejectedValueOnce(new OtError('Falta el visto bueno del operario.', 409));
    expect((await confirmar.POST(send('POST', confirma, '?company=1'), params('7'))).status).toBe(409);
  });

  it('B8: importar operarios (vista previa por defecto) solo con Gestión', async () => {
    asUser([supervisor]);
    m.importarOperadores.mockResolvedValue({ simulado: true, crear: [{ linea: 1, nombre: 'Ana', documento: '1' }], existentes: [], errores: [], creados: 0 });
    const res = await importar.POST(send('POST', { company: FARMA, texto: 'Ana; 1' }));
    expect(res.status).toBe(200);
    expect(m.importarOperadores.mock.calls[0][1]).toMatchObject({ idCompany: FARMA, simular: true, filas: [{ linea: 1, nombre: 'Ana', documento: '1' }] });
    await importar.POST(send('POST', { company: FARMA, texto: 'Ana; 1', simular: false }));
    expect(m.importarOperadores.mock.calls[1][1].simular).toBe(false);
    expect((await importar.POST(send('POST', { company: FARMA, texto: ' ' }))).status).toBe(400);
  });

  it('B3: PIN propio (estado y configurar con la contraseña); restablecer y listar solo supervisor o administrador', async () => {
    asUser([operario], 'u-ana');
    m.estadoPin.mockResolvedValue({ configurado: false, bloqueado: false, intentosFallidos: 0 });
    expect(await (await pin.GET(get(''))).json()).toMatchObject({ configurado: false });
    expect(m.estadoPin).toHaveBeenCalledWith({ tag: 'prisma' }, 'u-ana');
    m.verificarPassword.mockResolvedValue(false);
    expect((await pin.POST(send('POST', { pin: '4821', confirmacion: '4821', password: 'mala' }))).status).toBe(403);
    expect(m.configurarPin).not.toHaveBeenCalled();
    m.verificarPassword.mockResolvedValue(true);
    const ok = await pin.POST(send('POST', { pin: '4821', confirmacion: '4821', password: 'buena' }));
    expect(ok.status).toBe(200);
    expect(m.configurarPin.mock.calls[0].slice(1, 3)).toEqual(['u-ana', '4821']);
    expect(JSON.stringify(await ok.json())).not.toContain('4821');
    expect((await pin.POST(send('POST', { pin: '1234', confirmacion: '1234', password: 'buena' }))).status).toBe(400);
    // Restablecer: operario 403; supervisor sí; administrador sin el módulo de esa empresa también.
    expect((await pinRestablecer.POST(send('POST', { company: FARMA, idUser: 'u9' }))).status).toBe(403);
    asUser([supervisor], 'u-sup');
    expect((await pinRestablecer.POST(send('POST', { company: FARMA, idUser: 'u9' }))).status).toBe(200);
    expect(m.restablecerPin).toHaveBeenCalledWith({ tag: 'prisma' }, FARMA, 'u9', { idUser: 'u-sup', email: 'op@farmalogica.com' });
    expect((await pinRestablecer.POST(send('POST', { company: FARMA }))).status).toBe(400);
    m.listPinsEmpresa.mockResolvedValue([]);
    expect((await pinUsuarios.GET(get('?company=1'))).status).toBe(200);
    expect((await pinUsuarios.GET(get(''))).status).toBe(400);
    asUser([{ ...operario, idCompany: 3, companyName: 'OLP' }], 'u-admin', 'admin');
    expect((await pinRestablecer.POST(send('POST', { company: FARMA, idUser: 'u9' }))).status).toBe(200);
    expect((await pinUsuarios.GET(get('?company=1'))).status).toBe(200);
  });

  it('A1: maestro de operarios, áreas y operarios de una bitácora abierta (solo Gestión, solo se agregan)', async () => {
    asUser([supervisor]);
    m.listOperadores.mockResolvedValue([]);
    expect((await operadores.GET(get('?company=1'))).status).toBe(200);
    expect(m.listOperadores).toHaveBeenCalledWith({ tag: 'prisma' }, FARMA, true);
    expect((await operadores.GET(get('?company=1&todas=1'))).status).toBe(200);
    expect(m.listOperadores).toHaveBeenLastCalledWith({ tag: 'prisma' }, FARMA, false);
    m.crearOperador.mockResolvedValue({ id_operador: 7 });
    expect((await operadores.POST(send('POST', { company: FARMA, nombre: 'Pepito Pérez' }))).status).toBe(201);
    expect((await operadores.POST(send('POST', { company: FARMA, nombre: '' }))).status).toBe(400);
    m.cambiarOperador.mockResolvedValue({ id_operador: 7 });
    expect((await operadores.PATCH(send('PATCH', { company: FARMA, id_operador: 7, activo: false }))).status).toBe(200);
    m.listAreas.mockResolvedValue([]);
    expect((await areas.GET(get('?company=1'))).status).toBe(200);
    m.crearArea.mockResolvedValue({ id_area: 3 });
    expect((await areas.POST(send('POST', { company: FARMA, nombre: 'Envase y agrafado' }))).status).toBe(201);
    m.cambiarArea.mockResolvedValue({ id_area: 3 });
    expect((await areas.PATCH(send('PATCH', { company: FARMA, id_area: 3, activo: false }))).status).toBe(200);
    m.agregarOperadores.mockResolvedValue({ agregados: 1 });
    expect((await operadoresOrden.POST(send('POST', { operadores: [8] }, '?company=1'), params('9'))).status).toBe(200);
    expect(m.agregarOperadores.mock.calls[0][3]).toEqual([8]);
    expect((await operadoresOrden.POST(send('POST', { operadores: [] }, '?company=1'), params('9'))).status).toBe(400);
  });

  it('supervisores: cualquier sesión del módulo ve la lista para elegir quién cierra (aislada por empresa)', async () => {
    asUser([operario]);
    m.listSupervisoresEmpresa.mockResolvedValue([{ id: 'u-sup', name: 'Supervisora' }]);
    const res = await supervisores.GET(get('?company=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ supervisores: [{ id: 'u-sup', name: 'Supervisora' }] });
    expect((await supervisores.GET(get('?company=3'))).status).toBe(403);
  });

  it('responsables: cada selector pide SOLO los asignados al rol; asignar y desactivar (Gestión, aislado por empresa)', async () => {
    asUser([supervisor]);
    m.listResponsables.mockResolvedValue([{ id: 'u-judy', name: 'Judy Alvarez', email: 'judy.alvarez@farmalogica.com' }]);
    const res = await responsables.GET(get('?company=1&rol=INSPECTOR'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ responsables: [{ id: 'u-judy', name: 'Judy Alvarez', email: 'judy.alvarez@farmalogica.com' }] });
    expect(m.listResponsables).toHaveBeenCalledWith({ tag: 'prisma' }, FARMA, 'INSPECTOR');
    expect((await responsables.GET(get('?company=1&rol=OPERARIO'))).status).toBe(400);
    expect((await responsables.GET(get('?company=3&rol=INSPECTOR'))).status).toBe(403);

    m.listResponsablesEmpresa.mockResolvedValue([]);
    m.listCandidatosResponsable.mockResolvedValue([]);
    expect(await (await responsables.GET(get('?company=1'))).json()).toEqual({ responsables: [], candidatos: [] });

    m.asignarResponsable.mockResolvedValue({ idResponsable: 5, nombre: 'Karen Blanco' });
    const post = await responsables.POST(send('POST', { company: FARMA, id_user: 'u-karen', rol: 'JEFE_PROD' }));
    expect(post.status).toBe(201);
    expect(m.asignarResponsable.mock.calls[0][1]).toEqual({ idCompany: FARMA, idUser: 'u-karen', rol: 'JEFE_PROD' });
    expect((await responsables.POST(send('POST', { company: 3, id_user: 'u-karen', rol: 'JEFE_PROD' }))).status).toBe(403);
    expect((await responsables.POST(send('POST', { company: FARMA, id_user: 'u-karen', rol: 'OPERARIO' }))).status).toBe(400);
    m.asignarResponsable.mockRejectedValueOnce(new OtError('Judy no tiene el permiso «Bitácora de Proceso: Gestión»: sin él no puede ser supervisor.', 400));
    const sinGestion = await responsables.POST(send('POST', { company: FARMA, id_user: 'u-judy', rol: 'SUPERVISOR' }));
    expect(sinGestion.status).toBe(400);
    expect((await sinGestion.json()).error).toContain('Gestión');

    m.cambiarResponsable.mockResolvedValue({ ok: true });
    expect((await responsables.PATCH(send('PATCH', { company: FARMA, id_responsable: 5, activo: false }))).status).toBe(200);
    expect(m.cambiarResponsable.mock.calls[0][1]).toEqual({ idCompany: FARMA, idResponsable: 5, activo: false });
    expect(responsables).not.toHaveProperty('DELETE');
  });

  it('abrir con un inspector o jefe sin el rol: el 400 de la capa de datos llega tal cual', async () => {
    asUser([supervisor]);
    m.crearOrden.mockRejectedValue(new OtError('La persona elegida no está asignada como inspector en esta empresa (Catálogo → Responsables).', 400));
    const res = await lista.POST(send('POST', { ...nueva, inspector: 'u-otro' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('no está asignada como inspector');
  });

  it('el supervisor abre una orden SIN OP; los datos inválidos dan 400', async () => {
    asUser([supervisor]);
    m.crearOrden.mockResolvedValue({ id: 9, consecutivo: 1 });
    const res = await lista.POST(send('POST', nueva));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ orden: { id: 9, consecutivo: 1 } });
    expect(m.crearOrden.mock.calls[0][1]).toMatchObject({ sapOp: null, turno: 'TARDE', inspector: 'u2', jefeProduccion: 'u3', operadores: [7], idArea: 3 });
    expect((await lista.POST(send('POST', { ...nueva, inspector: '' }))).status).toBe(400);
    expect((await lista.POST(send('POST', { ...nueva, jefeProduccion: '' }))).status).toBe(400);
    expect(m.crearOrden.mock.calls[0][2]).toEqual({ idUser: 'u1', email: 'op@farmalogica.com', ip: '10.0.0.9' });
    expect((await lista.POST(send('POST', { ...nueva, lote: '' }))).status).toBe(400);
  });

  it('registro: la hora del cliente no llega a la base; el 403/409 del negocio pasa tal cual', async () => {
    asUser([operario]);
    m.crearRegistro.mockResolvedValue({ id: '1', registradoEn: '2026-10-13T20:00:00.000Z', actividad: 'Refrigerio' });
    const ok = await registros.POST(send('POST', { id_actividad: 2, id_operador: 7, registrado_en: '1999-01-01T00:00:00Z', id_user: 'otro' }, '?company=1'), params('5'));
    expect(ok.status).toBe(201);
    expect(m.crearRegistro.mock.calls[0][3]).toEqual({ idActividad: 2, idOperador: 7, observacion: null });
    // El usuario que se guarda es el de la SESIÓN (aparte del operario elegido).
    expect(m.crearRegistro.mock.calls[0][4]).toMatchObject({ idUser: 'u1' });
    m.crearRegistro.mockRejectedValueOnce(new OtError('La bitácora está cerrada: ya no admite registros.', 409));
    const cerrada = await registros.POST(send('POST', { id_actividad: 2 }, '?company=1'), params('5'));
    expect(cerrada.status).toBe(409);
    expect((await cerrada.json()).error).toMatch(/cerrada/);
    m.crearRegistro.mockRejectedValueOnce(new Error('falla interna con detalle'));
    const boom = await registros.POST(send('POST', { id_actividad: 2 }, '?company=1'), params('5'));
    expect(boom.status).toBe(500);
    expect((await boom.json()).error).not.toMatch(/detalle/);
    expect((await registros.POST(send('POST', { id_actividad: 2 }, '?company=1'), params('abc'))).status).toBe(400);
  });

  it('detalle 404 si la orden no es de la empresa', async () => {
    asUser([supervisor]);
    m.getOrdenDetalle.mockResolvedValue(null);
    expect((await detalle.GET(get('?company=1'), params('7'))).status).toBe(404);
    m.getOrdenDetalle.mockResolvedValue({ id: 7 });
    expect((await detalle.GET(get('?company=1'), params('7'))).status).toBe(200);
    expect((await detalle.GET(get('?company=1'), params('0'))).status).toBe(400);
  });

  it('AVISOS: al abrir, al inspector y al jefe; tras cada visto bueno, a quien le toca el siguiente', async () => {
    asUser([supervisor]);
    m.crearOrden.mockResolvedValue({ id: 9, consecutivo: 1 });
    expect((await lista.POST(send('POST', nueva))).status).toBe(201);
    expect(m.datosAviso).toHaveBeenCalledWith(expect.anything(), 9, FARMA, { idUser: 'u1', email: 'op@farmalogica.com', ip: '10.0.0.9' });
    expect(m.createAndSendNotifications).toHaveBeenCalledTimes(2);
    expect(m.createAndSendNotifications.mock.calls.map((c) => [c[0][0], c[1].title])).toEqual([
      ['inspector@farmalogica.com', 'Fue designado inspector de una bitácora · SynerLink'],
      ['jefe@farmalogica.com', 'Fue designado jefe de producción de una bitácora · SynerLink'],
    ]);

    m.prepararConfirmante.mockResolvedValue({ rol: 'SUPERVISOR', idUser: 'u1', email: 'op@farmalogica.com', nombre: 'Supervisor', access: supervisor });
    m.confirmarVistoBueno.mockResolvedValue(vb('SUPERVISOR', 'INSPECTOR'));
    expect((await confirmar.POST(send('POST', confirma, '?company=1'), params('7'))).status).toBe(200);
    const [to2, p2] = m.createAndSendNotifications.mock.calls[2];
    expect(to2).toEqual(['inspector@farmalogica.com']);
    expect(p2).toMatchObject({ title: 'Bitácora pendiente de su visto bueno · SynerLink', url: '/process/bitacora-proceso/7?empresa=1', tag: 'ot-7-inspector' });

    m.confirmarVistoBueno.mockResolvedValue(vb('INSPECTOR', 'JEFE_PROD'));
    expect((await confirmar.POST(send('POST', { ...confirma, rol: 'INSPECTOR' }, '?company=1'), params('7'))).status).toBe(200);
    expect(m.createAndSendNotifications.mock.calls[3][0]).toEqual(['jefe@farmalogica.com']);
  });

  it('AVISOS: si el aviso falla, la acción queda igual; un visto bueno fallido no avisa; el último no avisa', async () => {
    asUser([supervisor]);
    m.crearOrden.mockResolvedValue({ id: 9, consecutivo: 1 });
    m.createAndSendNotifications.mockRejectedValue(new Error('push caído'));
    expect((await lista.POST(send('POST', nueva))).status).toBe(201);
    m.datosAviso.mockRejectedValueOnce(new Error('BD'));
    m.prepararConfirmante.mockResolvedValue({ rol: 'SUPERVISOR', idUser: 'u1', email: 'op@farmalogica.com', nombre: 'S', access: supervisor });
    m.confirmarVistoBueno.mockResolvedValue(vb('SUPERVISOR', 'INSPECTOR'));
    expect((await confirmar.POST(send('POST', confirma, '?company=1'), params('7'))).status).toBe(200);

    m.createAndSendNotifications.mockReset();
    m.confirmarVistoBueno.mockRejectedValueOnce(new OtError('La bitácora ya está cerrada.', 409));
    expect((await confirmar.POST(send('POST', confirma, '?company=1'), params('7'))).status).toBe(409);
    m.datosAviso.mockResolvedValueOnce({ ...avisoBase, inspectorEmail: null });
    expect((await confirmar.POST(send('POST', confirma, '?company=1'), params('7'))).status).toBe(200);
    m.confirmarVistoBueno.mockResolvedValue(vb('JEFE_PROD', null));
    expect((await confirmar.POST(send('POST', { ...confirma, rol: 'JEFE_PROD' }, '?company=1'), params('7'))).status).toBe(200);
    expect(m.createAndSendNotifications).not.toHaveBeenCalled();
  });

  it('catálogo: el operario lee solo las activas; el supervisor agrega y cambia', async () => {
    asUser([operario]);
    m.listActividades.mockResolvedValue([]);
    expect((await actividades.GET(get('?company=1'))).status).toBe(200);
    expect(m.listActividades).toHaveBeenCalledWith({ tag: 'prisma' }, FARMA, true);
    asUser([supervisor]);
    expect((await actividades.GET(get('?company=1&todas=1'))).status).toBe(200);
    expect(m.listActividades).toHaveBeenLastCalledWith({ tag: 'prisma' }, FARMA, false);
    m.crearActividad.mockResolvedValue({ id_actividad: 1 });
    expect((await actividades.POST(send('POST', { company: FARMA, nombre: 'Limpieza' }))).status).toBe(201);
    m.cambiarActividad.mockResolvedValue({ id_actividad: 1 });
    expect((await actividades.PATCH(send('PATCH', { company: FARMA, id_actividad: 1, activo: false }))).status).toBe(200);
    expect((await actividades.PATCH(send('PATCH', { company: FARMA, id_actividad: 1, nombre: 'x' }))).status).toBe(400);
  });

  it('SAP: solo lectura, sin consulta con menos de 2 letras y error de SAP sin detalle', async () => {
    asUser([supervisor]);
    expect(await (await sapOp.GET(get('?company=1&q=P'))).json()).toEqual({ ops: [] });
    m.buscarOps.mockResolvedValue([{ AbsoluteEntry: 1, DocumentNumber: 2 }]);
    const ok = await sapOp.GET(get('?company=1&q=PTCZ'));
    expect((await ok.json()).ops).toHaveLength(1);
    m.buscarOps.mockRejectedValueOnce(new SapError('SAP Login fallido (401)', 401, 'secreto'));
    const fail = await sapOp.GET(get('?company=1&q=PTCZ'));
    expect(fail.status).toBe(502);
    expect((await fail.json()).error).toMatch(/a mano/);
    m.listUsuariosEmpresa.mockResolvedValue([]);
    expect((await usuarios.GET(get('?company=1'))).status).toBe(200);
  });
});

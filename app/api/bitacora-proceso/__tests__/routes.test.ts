import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas de Órdenes de Trabajo con la sesión y la base simuladas: permisos en el
// servidor, aislamiento por empresa y SIN rutas de edición ni borrado.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getOtAccessForUser', 'getActiveUserId', 'listOrdenes', 'crearOrden', 'getOrdenDetalle',
    'crearRegistro', 'cerrarYFirmar', 'verificarYFirmar', 'prepararFirmante', 'listActividades', 'crearActividad', 'cambiarActividad', 'listUsuariosEmpresa', 'buscarOpsLiberadas',
    'datosAvisoInspector', 'createAndSendNotifications',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/bitacora-proceso/db', () => ({
  getOtAccessForUser: m.getOtAccessForUser, getActiveUserId: m.getActiveUserId, listOrdenes: m.listOrdenes, crearOrden: m.crearOrden,
  getOrdenDetalle: m.getOrdenDetalle, crearRegistro: m.crearRegistro, cerrarYFirmar: m.cerrarYFirmar, verificarYFirmar: m.verificarYFirmar, listActividades: m.listActividades,
  crearActividad: m.crearActividad, cambiarActividad: m.cambiarActividad, listUsuariosEmpresa: m.listUsuariosEmpresa,
  datosAvisoInspector: m.datosAvisoInspector,
}));
// El notificador compartido (campana + push): se simula para ver QUÉ se avisa y a QUIÉN.
vi.mock('../../../../lib/notifications.js', () => ({ createAndSendNotifications: m.createAndSendNotifications }));
vi.mock('../../../../lib/bitacora-proceso/sap', () => ({ buscarOpsLiberadas: m.buscarOpsLiberadas }));
vi.mock('../_lib/firmante', () => ({ prepararFirmante: m.prepararFirmante }));

import { OtError } from '../../../../lib/bitacora-proceso/rules';
import { SapError } from '../../../../lib/sap/serviceLayer';
import * as lista from '../route';
import * as detalle from '../[id]/route';
import * as registros from '../[id]/registros/route';
import * as cerrar from '../[id]/cerrar/route';
import * as verificar from '../[id]/verificar/route';
import * as actividades from '../actividades/route';
import * as sapOp from '../sap-op/route';
import * as usuarios from '../usuarios/route';

const FARMA = 1;
const operario = { idCompany: FARMA, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: false };
const supervisor = { ...operario, canManage: true };
function asUser(access: object[], idUser: string | null = 'u1') {
  m.getServerSession.mockResolvedValue({ user: { email: 'op@farmalogica.com' } });
  m.getOtAccessForUser.mockResolvedValue(access);
  m.getActiveUserId.mockResolvedValue(idUser);
}
const H = { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'vitest' };
const get = (q: string) => new Request(`http://x/api${q}`, { headers: H });
const send = (method: string, body: unknown, q = '') => new Request(`http://x/api${q}`, { method, body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const nueva = { company: FARMA, producto: 'Cefazolina', lote: 'L1', turno: 'TARDE', operarios: ['u1'], inspector: 'u2' };

const avisoBase = { idOrden: 9, idCompany: FARMA, consecutivo: 1, producto: 'Cefazolina', lote: 'L1', inspectorEmail: 'inspector@farmalogica.com', actorNombre: 'Supervisor', actorEmail: 'op@farmalogica.com' };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.datosAvisoInspector.mockImplementation(async (_db: unknown, idOrden: number) => ({ ...avisoBase, idOrden }));
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
    for (const mod of [lista, detalle, registros, cerrar, verificar]) {
      expect(mod).not.toHaveProperty('PUT');
      expect(mod).not.toHaveProperty('DELETE');
      expect(mod).not.toHaveProperty('PATCH');
    }
    expect(actividades).not.toHaveProperty('DELETE');
    expect(actividades).not.toHaveProperty('PUT');
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

  it('sin Gestión no se puede abrir, cerrar, administrar el catálogo, buscar OP ni listar usuarios', async () => {
    asUser([operario]);
    const all = await Promise.all([
      lista.POST(send('POST', nueva)),
      cerrar.POST(send('POST', {}, '?company=1'), params('1')),
      actividades.GET(get('?company=1&todas=1')),
      actividades.POST(send('POST', { company: FARMA, nombre: 'X' })),
      actividades.PATCH(send('PATCH', { company: FARMA, id_actividad: 1, activo: false })),
      sapOp.GET(get('?company=1&q=PTCZ')),
      usuarios.GET(get('?company=1')),
    ]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 403));
    expect(m.crearOrden).not.toHaveBeenCalled();
    expect(m.cerrarYFirmar).not.toHaveBeenCalled();
    expect(m.prepararFirmante).not.toHaveBeenCalled();
    expect(m.buscarOpsLiberadas).not.toHaveBeenCalled();
  });

  it('el supervisor abre una orden SIN OP; los datos inválidos dan 400', async () => {
    asUser([supervisor]);
    m.crearOrden.mockResolvedValue({ id: 9, consecutivo: 1 });
    const res = await lista.POST(send('POST', nueva));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ orden: { id: 9, consecutivo: 1 } });
    expect(m.crearOrden.mock.calls[0][1]).toMatchObject({ sapOp: null, turno: 'TARDE', inspector: 'u2' });
    expect((await lista.POST(send('POST', { ...nueva, inspector: '' }))).status).toBe(400);
    expect(m.crearOrden.mock.calls[0][2]).toEqual({ idUser: 'u1', email: 'op@farmalogica.com', ip: '10.0.0.9' });
    expect((await lista.POST(send('POST', { ...nueva, lote: '' }))).status).toBe(400);
  });

  it('registro: la hora del cliente no llega a la base; el 403/409 del negocio pasa tal cual', async () => {
    asUser([operario]);
    m.crearRegistro.mockResolvedValue({ id: '1', registradoEn: '2026-10-13T20:00:00.000Z', actividad: 'Refrigerio' });
    const ok = await registros.POST(send('POST', { id_actividad: 2, registrado_en: '1999-01-01T00:00:00Z' }, '?company=1'), params('5'));
    expect(ok.status).toBe(201);
    expect(m.crearRegistro.mock.calls[0][3]).toEqual({ idActividad: 2, observacion: null });
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

  it('detalle 404 si la orden no es de la empresa; cierre por el supervisor', async () => {
    asUser([supervisor]);
    m.getOrdenDetalle.mockResolvedValue(null);
    expect((await detalle.GET(get('?company=1'), params('7'))).status).toBe(404);
    m.getOrdenDetalle.mockResolvedValue({ id: 7 });
    expect((await detalle.GET(get('?company=1'), params('7'))).status).toBe(200);
    expect((await detalle.GET(get('?company=1'), params('0'))).status).toBe(400);
    const firmante = { idUser: 'u1', email: 'op@farmalogica.com', ip: '10.0.0.9', nombre: 'Supervisor', imagen: null };
    m.prepararFirmante.mockResolvedValue(firmante);
    m.cerrarYFirmar.mockResolvedValue({ firmadoEn: '2026-10-13T22:00:00.000Z', contentSha256: 'a'.repeat(64) });
    const body = { observacion: 'Fin de lote', password: 'secreta', acepto: true };
    const res = await cerrar.POST(send('POST', body, '?company=1'), params('7'));
    expect(res.status).toBe(200);
    expect(m.prepararFirmante.mock.calls[0][1]).toEqual(body);
    expect(m.cerrarYFirmar.mock.calls[0][3]).toBe('Fin de lote');
    expect(m.cerrarYFirmar.mock.calls[0][4]).toBe(firmante);
    // La contraseña nunca vuelve en la respuesta.
    expect(JSON.stringify(await res.json())).not.toContain('secreta');
    m.prepararFirmante.mockRejectedValueOnce(new OtError('Contraseña incorrecta: la firma no se registró.', 403));
    const mala = await cerrar.POST(send('POST', { password: 'x', acepto: true }, '?company=1'), params('7'));
    expect(mala.status).toBe(403);
    expect(m.cerrarYFirmar).toHaveBeenCalledTimes(1);
  });

  it('verificar: cualquier participante con el módulo llega a la ruta; la regla del inspector la aplica la capa de datos', async () => {
    asUser([operario]);
    m.prepararFirmante.mockResolvedValue({ idUser: 'u1', email: 'op@farmalogica.com', ip: null, nombre: 'Inspector', imagen: null });
    m.verificarYFirmar.mockResolvedValue({ firmadoEn: '2026-10-13T22:10:00.000Z', contentSha256: 'b'.repeat(64) });
    const ok = await verificar.POST(send('POST', { password: 'x', acepto: true }, '?company=1'), params('7'));
    expect(ok.status).toBe(200);
    expect(m.verificarYFirmar.mock.calls[0][1]).toBe(7);
    m.verificarYFirmar.mockRejectedValueOnce(new OtError('Solo el inspector designado en esta bitácora puede verificarla.', 403));
    expect((await verificar.POST(send('POST', { password: 'x', acepto: true }, '?company=1'), params('7'))).status).toBe(403);
    expect((await verificar.POST(send('POST', {}, '?company=3'), params('7'))).status).toBe(403);
    expect((await verificar.POST(send('POST', {}, '?company=1'), params('x'))).status).toBe(400);
  });

  it('AVISOS: al abrir se avisa al inspector designado; al cerrar firmado, que la verifique (campana + push, enlace directo)', async () => {
    asUser([supervisor]);
    m.crearOrden.mockResolvedValue({ id: 9, consecutivo: 1 });
    expect((await lista.POST(send('POST', nueva))).status).toBe(201);
    expect(m.datosAvisoInspector).toHaveBeenCalledWith(expect.anything(), 9, FARMA, { idUser: 'u1', email: 'op@farmalogica.com', ip: '10.0.0.9' });
    expect(m.createAndSendNotifications).toHaveBeenCalledTimes(1);
    const [to1, p1] = m.createAndSendNotifications.mock.calls[0];
    expect(to1).toEqual(['inspector@farmalogica.com']);
    expect(p1).toMatchObject({ title: 'Fue designado inspector de una bitácora · SynerLink', url: '/process/bitacora-proceso/9?empresa=1' });

    m.prepararFirmante.mockResolvedValue({ idUser: 'u1', email: 'op@farmalogica.com', ip: '10.0.0.9', nombre: 'Supervisor', imagen: null, avisoFirma: null });
    m.cerrarYFirmar.mockResolvedValue({ firmadoEn: '2026-10-14T13:00:00.000Z', contentSha256: 'a'.repeat(64) });
    const res = await cerrar.POST(send('POST', { password: 'x', acepto: true }, '?company=1'), params('7'));
    expect(res.status).toBe(200);
    expect(m.createAndSendNotifications).toHaveBeenCalledTimes(2);
    const [to2, p2] = m.createAndSendNotifications.mock.calls[1];
    expect(to2).toEqual(['inspector@farmalogica.com']);
    expect(p2).toMatchObject({ title: 'Bitácora por verificar · SynerLink', url: '/process/bitacora-proceso/7?empresa=1', tag: 'ot-7-verificar' });
  });

  it('AVISOS: si el aviso falla, la bitácora se abre/cierra igual; un cierre fallido no avisa; verificar no avisa', async () => {
    asUser([supervisor]);
    m.crearOrden.mockResolvedValue({ id: 9, consecutivo: 1 });
    m.createAndSendNotifications.mockRejectedValue(new Error('push caído'));
    expect((await lista.POST(send('POST', nueva))).status).toBe(201);
    m.datosAvisoInspector.mockRejectedValueOnce(new Error('BD'));
    m.prepararFirmante.mockResolvedValue({ idUser: 'u1', email: 'op@farmalogica.com', ip: null, nombre: 'S', imagen: null, avisoFirma: null });
    m.cerrarYFirmar.mockResolvedValue({ firmadoEn: '2026-10-14T13:00:00.000Z', contentSha256: 'a'.repeat(64) });
    expect((await cerrar.POST(send('POST', { password: 'x', acepto: true }, '?company=1'), params('7'))).status).toBe(200);

    m.createAndSendNotifications.mockReset();
    m.cerrarYFirmar.mockRejectedValueOnce(new OtError('La bitácora ya está cerrada.', 409));
    expect((await cerrar.POST(send('POST', { password: 'x', acepto: true }, '?company=1'), params('7'))).status).toBe(409);
    // Sin inspector activo: no hay a quién avisar.
    m.datosAvisoInspector.mockResolvedValueOnce({ ...avisoBase, inspectorEmail: null });
    expect((await cerrar.POST(send('POST', { password: 'x', acepto: true }, '?company=1'), params('7'))).status).toBe(200);
    m.verificarYFirmar.mockResolvedValue({ firmadoEn: '2026-10-14T13:10:00.000Z', contentSha256: 'b'.repeat(64) });
    expect((await verificar.POST(send('POST', { password: 'x', acepto: true }, '?company=1'), params('7'))).status).toBe(200);
    expect(m.createAndSendNotifications).not.toHaveBeenCalled();
  });

  it('el aviso de firma (GSS Firma no la guardó) vuelve en la respuesta del cierre', async () => {
    asUser([supervisor]);
    m.prepararFirmante.mockResolvedValue({ idUser: 'u1', email: 'op@farmalogica.com', ip: null, nombre: 'S', imagen: 'data:image/png;base64,AA==', avisoFirma: 'GSS Firma no la guardó' });
    m.cerrarYFirmar.mockResolvedValue({ firmadoEn: '2026-10-14T13:00:00.000Z', contentSha256: 'a'.repeat(64) });
    const res = await cerrar.POST(send('POST', { password: 'x', acepto: true, firmaNueva: { imagen: 'data:image/png;base64,AA==', metodo: 'uploaded' } }, '?company=1'), params('7'));
    expect((await res.json()).avisoFirma).toBe('GSS Firma no la guardó');
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
    m.buscarOpsLiberadas.mockResolvedValue([{ AbsoluteEntry: 1, DocumentNumber: 2 }]);
    const ok = await sapOp.GET(get('?company=1&q=PTCZ'));
    expect((await ok.json()).ops).toHaveLength(1);
    m.buscarOpsLiberadas.mockRejectedValueOnce(new SapError('SAP Login fallido (401)', 401, 'secreto'));
    const fail = await sapOp.GET(get('?company=1&q=PTCZ'));
    expect(fail.status).toBe(502);
    expect((await fail.json()).error).toMatch(/a mano/);
    m.listUsuariosEmpresa.mockResolvedValue([]);
    expect((await usuarios.GET(get('?company=1'))).status).toBe(200);
  });
});

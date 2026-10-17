import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { OT_PROCESS_NAME, OT_SUBPROCESS_NAMES, OT_SUBPROCESS_URLS } from '../../../lib/bitacora-proceso/constants';
import {
  agregarOperadores,
  cambiarActividad,
  cambiarArea,
  cambiarOperador,
  confirmarVistoBueno,
  configurarPin,
  estadoPin,
  importarOperadores,
  listPinsEmpresa,
  restablecerPin,
  verificarPinPersona,
  crearActividad,
  crearArea,
  crearOperador,
  crearOrden,
  crearRegistro,
  getOrdenDetalle,
  getOtAccessForUser,
  listActividades,
  listAreas,
  listOperadores,
  listOrdenes,
  listSupervisoresEmpresa,
  listUsuariosEmpresa,
  asignarResponsable,
  cambiarResponsable,
  listCandidatosResponsable,
  listResponsables,
  listResponsablesEmpresa,
  datosAviso,
  type ConfirmanteActor,
} from '../../../lib/bitacora-proceso/db';
import type { OtFirmaRol } from '../../../lib/bitacora-proceso/constants';
import { avisoSiguienteVistoBueno } from '../../../lib/bitacora-proceso/notificaciones';
import { codificarPng } from '../../../lib/firma-gss/png';
import { FIRMA_GSS_AUDIT_ACTION, registrarFirmaGss } from '../../../lib/firma-gss/miFirma';
import { isOtError, parseImportarOperadores, parseNuevaOrden, type OtCompanyAccess } from '../../../lib/bitacora-proceso/rules';

/**
 * Integración de la Bitácora de Proceso contra un SQL Server real (CI: `prisma db
 * push` + las migraciones del módulo, con sus triggers, y las siembras).
 * Prueba la hora del servidor, el bloqueo tras el cierre, los operarios SIN
 * usuario (A1) con la cuenta compartida de planta, las áreas (A5), la
 * confirmación «Cerró»/«Verificó» con la persona elegida (A4), el aislamiento
 * por empresa y que la base impide editar o borrar.
 */
const url = process.env.SGC_IT_DATABASE_URL;

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    if (isOtError(e)) return e.status;
    throw e;
  }
}

describe.skipIf(!url)('Bitácora de Proceso · integración con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const FARMA = 1;
  const OLP = 3;
  const sufijo = Date.now().toString(36);
  let supervisorId = '';
  let operarioId = '';
  let ajenoId = '';
  let inspectorId = '';
  let jefeId = '';
  let inspector: OtCompanyAccess;
  let jefe: OtCompanyAccess;
  let supervisor: OtCompanyAccess;
  let operario: OtCompanyAccess;
  let ajeno: OtCompanyAccess;
  let idTolva = 0;
  let idOtra = 0;
  let idArea = 0;
  let opA = 0;
  let opB = 0;
  let opInactivo = 0;

  const actor = (idUser: string) => ({ idUser, email: `${idUser}@it`, ip: '10.0.0.1' });
  /** Quien da el VISTO BUENO (ya validado en la ruta: sesión propia o PIN), con SU acceso. */
  const conf = (rol: OtFirmaRol, idUser: string | null, access: OtCompanyAccess | null, extra: Partial<ConfirmanteActor> = {}): ConfirmanteActor => ({
    rol,
    idUser,
    idOperador: null,
    email: `${idUser ?? 'planta'}@it`,
    nombre: idUser ? `Nombre ${idUser}` : null,
    access,
    metodo: 'sesion_propia',
    sesion: { idUser: ajenoId, email: 'planta@it' },
    ip: '10.0.0.1',
    userAgent: 'vitest',
    ...extra,
  });
  const vbOperario = (idOrden: number, access: OtCompanyAccess, idOperador = opA) =>
    confirmarVistoBueno(prisma, idOrden, access, null, conf('OPERARIO', null, null, { idOperador, metodo: 'operario_tablet' }));
  /** Cierre del supervisor (con el visto bueno del operario, que desde R4 es opcional pero se sigue registrando). */
  const cerrar = async (idOrden: number, access: OtCompanyAccess, obs: string | null = null) => {
    await vbOperario(idOrden, access);
    return confirmarVistoBueno(prisma, idOrden, access, obs, conf('SUPERVISOR', supervisorId, supervisor));
  };
  const orden = (extra: Record<string, unknown> = {}) =>
    parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT', lote: `L-${sufijo}`, turno: 'MANANA', operadores: [opA], idArea, inspector: inspectorId, jefeProduccion: jefeId, ...extra });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${FARMA}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${FARMA}, N'FARMALOGICA S.A.');
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${OLP}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${OLP}, N'ONELATAMPHARMA');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);

    const mk = (n: string) => prisma.user.create({ data: { email: `${n}.${sufijo}@farmalogica.com`, name: `${n} IT` } });
    const [sup, op, aj, insp, jf] = await Promise.all([mk('supervisor'), mk('operario'), mk('ajeno'), mk('inspector'), mk('jefe')]);
    inspectorId = insp.id;
    jefeId = jf.id;
    supervisorId = sup.id;
    operarioId = op.id;
    ajenoId = aj.id;

    let proc = await prisma.process.findFirst({ where: { process: OT_PROCESS_NAME } });
    if (!proc) proc = await prisma.process.create({ data: { process: OT_PROCESS_NAME } });
    const subs: Record<string, number> = {};
    for (const perm of Object.keys(OT_SUBPROCESS_URLS) as (keyof typeof OT_SUBPROCESS_URLS)[]) {
      const existing = await prisma.subprocess.findFirst({ where: { subprocess_url: OT_SUBPROCESS_URLS[perm] } });
      subs[perm] = (existing ?? (await prisma.subprocess.create({ data: { subprocess: OT_SUBPROCESS_NAMES[perm], subprocess_url: OT_SUBPROCESS_URLS[perm], id_process: proc.id_process } }))).id_subprocess;
    }
    const cuSup = await prisma.companyUser.create({ data: { id_company: FARMA, id_user: sup.id } });
    const cuOp = await prisma.companyUser.create({ data: { id_company: FARMA, id_user: op.id } });
    const cuAj = await prisma.companyUser.create({ data: { id_company: FARMA, id_user: aj.id } });
    const cuInsp = await prisma.companyUser.create({ data: { id_company: FARMA, id_user: insp.id } });
    const cuJefe = await prisma.companyUser.create({ data: { id_company: FARMA, id_user: jf.id } });
    await prisma.subprocessUserCompany.createMany({
      data: [
        { id_subprocess: subs.operario, id_company_user: cuSup.id_company_user },
        { id_subprocess: subs.gestion, id_company_user: cuSup.id_company_user },
        { id_subprocess: subs.operario, id_company_user: cuOp.id_company_user },
        { id_subprocess: subs.operario, id_company_user: cuAj.id_company_user },
        { id_subprocess: subs.operario, id_company_user: cuInsp.id_company_user },
        { id_subprocess: subs.operario, id_company_user: cuJefe.id_company_user },
      ],
    });
    // Responsables (2026-10-16): solo estas asignaciones salen en los selectores.
    await prisma.otResponsable.createMany({
      data: [
        { id_company: FARMA, id_user: sup.id, rol: 'SUPERVISOR', created_by: 'it' },
        { id_company: FARMA, id_user: insp.id, rol: 'INSPECTOR', created_by: 'it' },
        { id_company: FARMA, id_user: jf.id, rol: 'JEFE_PROD', created_by: 'it' },
      ],
    });
    [supervisor] = await getOtAccessForUser(prisma, sup.email);
    [operario] = await getOtAccessForUser(prisma, op.email);
    [ajeno] = await getOtAccessForUser(prisma, aj.email);
    [inspector] = await getOtAccessForUser(prisma, insp.email);
    [jefe] = await getOtAccessForUser(prisma, jf.email);

    // Catálogo propio de la prueba (el de la siembra puede existir: nombres distintos).
    idTolva = (await crearActividad(prisma, { idCompany: FARMA, nombre: `Tolva ${sufijo}`, exigeObservacion: false, orden: 1, icono: null }, actor(supervisorId))).id_actividad;
    idOtra = (await crearActividad(prisma, { idCompany: FARMA, nombre: `Otra ${sufijo}`, exigeObservacion: true, orden: 2, icono: null }, actor(supervisorId))).id_actividad;

    // Maestro de operarios SIN usuario (A1) y área del catálogo (A5).
    opA = (await crearOperador(prisma, { idCompany: FARMA, nombre: `Pepito Pérez ${sufijo}`, documento: '123' }, actor(supervisorId))).id_operador;
    opB = (await crearOperador(prisma, { idCompany: FARMA, nombre: `Ana Gómez ${sufijo}`, documento: null }, actor(supervisorId))).id_operador;
    opInactivo = (await crearOperador(prisma, { idCompany: FARMA, nombre: `Retirado ${sufijo}`, documento: null }, actor(supervisorId))).id_operador;
    await cambiarOperador(prisma, { idOperador: opInactivo, idCompany: FARMA, activo: false }, actor(supervisorId));
    idArea = (await crearArea(prisma, { idCompany: FARMA, nombre: `Área IT ${sufijo}`, orden: 1 }, actor(supervisorId))).id_area;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('resuelve el acceso real: supervisor con Gestión, operario sin ella; supervisores de la empresa', async () => {
    expect(supervisor).toMatchObject({ idCompany: FARMA, canOperate: true, canManage: true });
    expect(operario).toMatchObject({ idCompany: FARMA, canOperate: true, canManage: false });
    expect(ajeno.canManage).toBe(false);
    const sups = await listSupervisoresEmpresa(prisma, FARMA);
    expect(sups.some((u) => u.id === supervisorId)).toBe(true);
    expect(sups.some((u) => u.id === operarioId)).toBe(false);
    expect((await listSupervisoresEmpresa(prisma, OLP)).some((u) => u.id === supervisorId)).toBe(false);
  });

  it('RESPONSABLES: cada selector lista SOLO a los asignados al rol en la empresa; el servidor rechaza a los demás', async () => {
    const ids = async (rol: 'SUPERVISOR' | 'INSPECTOR' | 'JEFE_PROD', c = FARMA) => (await listResponsables(prisma, c, rol)).map((u) => u.id);
    expect(await ids('INSPECTOR')).toContain(inspectorId);
    expect(await ids('JEFE_PROD')).toContain(jefeId);
    expect(await ids('SUPERVISOR')).toContain(supervisorId);
    // Usuarios de la empresa con el módulo pero SIN rol: no salen (antes salían todos).
    for (const rol of ['SUPERVISOR', 'INSPECTOR', 'JEFE_PROD'] as const) {
      expect(await ids(rol)).not.toContain(operarioId);
      expect(await ids(rol)).not.toContain(ajenoId);
    }
    expect(await ids('INSPECTOR')).not.toContain(jefeId);
    expect(await ids('JEFE_PROD')).not.toContain(inspectorId);
    // Aislamiento por empresa.
    expect(await ids('INSPECTOR', OLP)).not.toContain(inspectorId);

    // Abrir con un inspector o jefe SIN el rol: 400 (aunque sea usuario activo de la empresa).
    expect(await status(crearOrden(prisma, orden({ inspector: operarioId }), actor(supervisorId)))).toBe(400);
    expect(await status(crearOrden(prisma, orden({ jefeProduccion: ajenoId }), actor(supervisorId)))).toBe(400);
    // El inspector asignado NO sirve como jefe (rol distinto).
    expect(await status(crearOrden(prisma, orden({ inspector: jefeId, jefeProduccion: jefeId }), actor(supervisorId)))).toBe(400);

    // Supervisor: exige Gestión para asignarse; con Gestión pero sin el rol, no puede cerrar.
    expect(await status(asignarResponsable(prisma, { idCompany: FARMA, idUser: ajenoId, rol: 'SUPERVISOR' }, actor(supervisorId)))).toBe(400);
    const o = await crearOrden(prisma, orden({ lote: `RS-${sufijo}` }), actor(supervisorId));
    await vbOperario(o.id, supervisor);
    const fila = await prisma.otResponsable.findFirstOrThrow({ where: { id_company: FARMA, id_user: supervisorId, rol: 'SUPERVISOR' } });
    await cambiarResponsable(prisma, { idCompany: FARMA, idResponsable: fila.id_responsable, activo: false }, actor(supervisorId));
    try {
      expect(await ids('SUPERVISOR')).not.toContain(supervisorId);
      expect((await listSupervisoresEmpresa(prisma, FARMA)).some((u) => u.id === supervisorId)).toBe(false);
      expect(await status(confirmarVistoBueno(prisma, o.id, supervisor, null, conf('SUPERVISOR', supervisorId, supervisor)))).toBe(403);
      // El rechazo no deja nada: sigue abierta y sin visto bueno del supervisor.
      expect((await prisma.otOrdenTrabajo.findUniqueOrThrow({ where: { id_orden_trabajo: o.id } })).estado).toBe('ABIERTA');
    } finally {
      // Reasignar reactiva la misma fila (idempotente, sin duplicar).
      await asignarResponsable(prisma, { idCompany: FARMA, idUser: supervisorId, rol: 'SUPERVISOR' }, actor(supervisorId));
      await asignarResponsable(prisma, { idCompany: FARMA, idUser: supervisorId, rol: 'SUPERVISOR' }, actor(supervisorId));
    }
    expect(await prisma.otResponsable.count({ where: { id_company: FARMA, id_user: supervisorId, rol: 'SUPERVISOR' } })).toBe(1);
    expect((await confirmarVistoBueno(prisma, o.id, supervisor, null, conf('SUPERVISOR', supervisorId, supervisor))).rol).toBe('SUPERVISOR');

    // Catálogo: asignación visible con su estado; candidatos = usuarios con el módulo (con la marca de Gestión).
    const cat = await listResponsablesEmpresa(prisma, FARMA);
    expect(cat.find((r) => r.idUser === inspectorId && r.rol === 'INSPECTOR')).toMatchObject({ activo: true, habilitado: true });
    const cand = await listCandidatosResponsable(prisma, FARMA);
    expect(cand.find((c) => c.id === supervisorId)?.gestion).toBe(true);
    expect(cand.find((c) => c.id === operarioId)?.gestion).toBe(false);
    expect(await status(cambiarResponsable(prisma, { idCompany: OLP, idResponsable: fila.id_responsable, activo: false }, actor(supervisorId)))).toBe(404);
  });

  it('la siembra del 2026-10-14 dejó el área «Envase y agrafado» y las actividades nuevas sin duplicar', async () => {
    const areas = await listAreas(prisma, FARMA, true);
    expect(areas.some((a) => a.nombre === 'Envase y agrafado')).toBe(true);
    const acts = await listActividades(prisma, FARMA, true);
    for (const n of ['Alistamiento inicial', 'Despeje de área (fin de lote)', 'Aseo de área']) {
      expect(acts.filter((a) => a.nombre === n)).toHaveLength(1);
    }
    expect(acts.find((a) => a.nombre === 'Alistamiento inicial')?.orden).toBe(5);
    // Observación opcional en todas: la siembra apagó la marca de «Otra».
    expect(acts.find((a) => a.nombre === 'Otra')?.exige_observacion).toBe(false);
  });

  it('abre con operarios del maestro, área del catálogo y consecutivo por empresa, sin OP y con OP', async () => {
    const a = await crearOrden(prisma, orden(), actor(supervisorId));
    const b = await crearOrden(
      prisma,
      orden({ turno: 'TARDE', operadores: [opA, opB], sapOp: { AbsoluteEntry: 14259, DocumentNumber: 14045, ItemNo: 'PTCZ0121', U_Cod_Lote: '1565426' } }),
      actor(supervisorId)
    );
    expect(b.consecutivo).toBe(a.consecutivo + 1);
    const det = await getOrdenDetalle(prisma, b.id, supervisor, supervisorId);
    expect(det?.sapOpDocNum).toBe(14045);
    expect(det?.itemCode).toBe('PTCZ0121');
    expect(det?.sapOp).toMatchObject({ U_Cod_Lote: '1565426' });
    expect(det?.area).toBe(`Área IT ${sufijo}`);
    expect(det?.operadores.map((p) => p.id).sort()).toEqual([opA, opB].sort());
    expect(det?.operarios).toEqual([]);
    // Cualquier sesión con el módulo (cuenta de planta) puede registrar en ellas.
    const lista = await listOrdenes(prisma, FARMA, ajenoId);
    expect(lista.filter((o) => o.lote === `L-${sufijo}`).every((o) => o.soyOperario && o.operadores > 0 && o.estado === 'ABIERTA')).toBe(true);
  });

  it('rechaza operarios inexistentes o inactivos, área ausente o de otra empresa, y jefe de producción inválido', async () => {
    expect(await status(crearOrden(prisma, orden({ operadores: [999999] }), actor(supervisorId)))).toBe(400);
    expect(await status(crearOrden(prisma, orden({ operadores: [opInactivo] }), actor(supervisorId)))).toBe(400);
    expect(await status(crearOrden(prisma, orden({ idArea: undefined }), actor(supervisorId)))).toBe(400);
    const areaOlp = await crearArea(prisma, { idCompany: OLP, nombre: `OLP ${sufijo}`, orden: 1 }, actor(supervisorId));
    expect(await status(crearOrden(prisma, orden({ idArea: areaOlp.id_area }), actor(supervisorId)))).toBe(400);
    expect(await status(crearOrden(prisma, orden({ inspector: 'no-existe' }), actor(supervisorId)))).toBe(400);
    expect(await status(crearOrden(prisma, orden({ inspector: supervisorId }), actor(supervisorId)))).toBe(400);
    expect(await status(crearOrden(prisma, orden({ jefeProduccion: 'no-existe' }), actor(supervisorId)))).toBe(400);
    expect(await status(crearOrden(prisma, orden({ jefeProduccion: supervisorId }), actor(supervisorId)))).toBe(400);
    expect(await status(crearOrden(prisma, orden({ jefeProduccion: inspectorId }), actor(supervisorId)))).toBe(400);
  });

  it('A1/A2: la cuenta compartida registra con el OPERARIO elegido; se guardan operario y usuario de sesión, con la HORA DEL SERVIDOR', async () => {
    const o = await crearOrden(prisma, orden({ lote: `R-${sufijo}`, turno: 'NOCHE' }), actor(supervisorId));
    const [{ antes }] = await prisma.$queryRaw<{ antes: Date }[]>`SELECT SYSUTCDATETIME() AS antes`;
    // «ajeno» hace de cuenta compartida de planta: tiene el módulo, no Gestión ni usuario de operario.
    const r = await crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(ajenoId));
    const [{ despues }] = await prisma.$queryRaw<{ despues: Date }[]>`SELECT SYSUTCDATETIME() AS despues`;
    const t = new Date(r.registradoEn).getTime();
    expect(t).toBeGreaterThanOrEqual(antes.getTime() - 1);
    expect(t).toBeLessThanOrEqual(despues.getTime() + 1);
    expect(r.operador).toBe(`Pepito Pérez ${sufijo}`);

    // Sin operario: 400; operario no programado: 403; «Otra» sin observación: se admite (observación opcional).
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: null, observacion: null }, actor(ajenoId)))).toBe(400);
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opB, observacion: null }, actor(ajenoId)))).toBe(403);
    await crearRegistro(prisma, o.id, ajeno, { idActividad: idOtra, idOperador: opA, observacion: null }, actor(ajenoId));

    // El supervisor agrega a otro operario durante el turno (solo se agrega; repetir no duplica).
    expect(await agregarOperadores(prisma, o.id, supervisor, [opB, opA], actor(supervisorId))).toEqual({ agregados: 1 });
    expect(await agregarOperadores(prisma, o.id, supervisor, [opB], actor(supervisorId))).toEqual({ agregados: 0 });
    expect(await status(agregarOperadores(prisma, o.id, supervisor, [opInactivo], actor(supervisorId)))).toBe(400);
    await crearRegistro(prisma, o.id, operario, { idActividad: idTolva, idOperador: opB, observacion: 'Cambio de guantes' }, actor(operarioId));

    const fila = await prisma.otRegistro.findFirst({ where: { id_orden_trabajo: o.id, id_operador: opB } });
    expect(fila).toMatchObject({ id_user: operarioId, operador_nombre: `Ana Gómez ${sufijo}` });
    const det = await getOrdenDetalle(prisma, o.id, operario, operarioId);
    expect(det?.registros.map((x) => [x.actividad, x.operador])).toEqual([
      [`Tolva ${sufijo}`, `Pepito Pérez ${sufijo}`],
      [`Otra ${sufijo}`, `Pepito Pérez ${sufijo}`],
      [`Tolva ${sufijo}`, `Ana Gómez ${sufijo}`],
    ]);
    expect(det?.registros[0].usuario).toBe('ajeno IT');
    expect(det?.puedeRegistrar).toBe(true);

    // Un operario desactivado en el maestro ya no registra aunque esté programado.
    await cambiarOperador(prisma, { idOperador: opB, idCompany: FARMA, activo: false }, actor(supervisorId));
    try {
      expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opB, observacion: null }, actor(ajenoId)))).toBe(403);
    } finally {
      await cambiarOperador(prisma, { idOperador: opB, idCompany: FARMA, activo: true }, actor(supervisorId));
    }

    // Cierre: solo una vez; después no se admiten registros ni operarios.
    await cerrar(o.id, supervisor, 'Fin del turno');
    expect(await status(confirmarVistoBueno(prisma, o.id, supervisor, null, conf('SUPERVISOR', supervisorId, supervisor)))).toBe(409);
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(ajenoId)))).toBe(409);
    expect(await status(agregarOperadores(prisma, o.id, supervisor, [opA], actor(supervisorId)))).toBe(409);
    const cerrada = await getOrdenDetalle(prisma, o.id, supervisor, supervisorId);
    expect(cerrada).toMatchObject({ estado: 'CERRADA', observacionCierre: 'Fin del turno', puedeRegistrar: false });
    expect(cerrada?.cerradaEn).toBeTruthy();
  });

  it('la BASE impide editar o borrar registros y operarios programados, borrar maestros u órdenes y modificar una cerrada', async () => {
    const o = await crearOrden(prisma, orden({ lote: `T-${sufijo}` }), actor(supervisorId));
    await crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(ajenoId));
    await expect(prisma.$executeRaw`UPDATE dbo.ot_registro SET observacion = N'editado' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/no se pueden editar ni borrar/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_registro WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/no se pueden editar ni borrar/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_orden_operador WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/operarios programados/);
    await expect(prisma.$executeRaw`UPDATE dbo.ot_orden_operador SET id_operador = ${opB} WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/operarios programados/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_operador WHERE id_operador = ${opInactivo}`).rejects.toThrow(/se desactivan/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_area WHERE id_area = ${idArea}`).rejects.toThrow(/se desactivan/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_orden_trabajo WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/no se pueden borrar/);
    await cerrar(o.id, supervisor);
    await expect(prisma.$executeRaw`UPDATE dbo.ot_orden_trabajo SET estado = N'ABIERTA' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/cerrada no se puede modificar/);
    await expect(prisma.$executeRaw`UPDATE dbo.ot_orden_trabajo SET turno = N'OTRO' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow();
    const det = await getOrdenDetalle(prisma, o.id, supervisor, supervisorId);
    expect(det?.registros).toHaveLength(1);
    expect(det?.estado).toBe('CERRADA');
  });

  it('B2: vistos buenos en orden (operario opcional → supervisor → inspector → jefe), con persona, hora, método y sesión; inmutables', async () => {
    const o = await crearOrden(prisma, orden({ producto: 'PRUEBA IT VISTOS', lote: `F-${sufijo}`, operadores: [opA, opB] }), actor(supervisorId));
    await crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(ajenoId));
    let det = await getOrdenDetalle(prisma, o.id, ajeno, ajenoId);
    // R4 (2026-10-17): el del operario es opcional; lo siguiente es el cierre.
    expect(det).toMatchObject({ siguiente: 'SUPERVISOR', completa: false, puedeVistoOperario: true, idUsuarioSesion: ajenoId, inspector: { id: inspectorId }, jefe: { id: jefeId } });
    expect(det?.vistos.map((v) => [v.rol, v.estado])).toEqual([['OPERARIO', 'opcional'], ['SUPERVISOR', 'pendiente'], ['INSPECTOR', 'pendiente'], ['JEFE_PROD', 'pendiente']]);

    // Fuera de orden: el inspector no va antes del cierre.
    expect(await status(confirmarVistoBueno(prisma, o.id, ajeno, null, conf('INSPECTOR', inspectorId, inspector)))).toBe(409);
    // Operario no programado: 403. Cualquiera de los programados sirve: queda cuál.
    expect(await status(vbOperario(o.id, ajeno, opInactivo))).toBe(403);
    const vo = await vbOperario(o.id, ajeno, opB);
    expect(vo).toMatchObject({ rol: 'OPERARIO', nombre: `Ana Gómez ${sufijo}`, siguiente: 'SUPERVISOR' });
    expect(await status(vbOperario(o.id, ajeno, opA))).toBe(409);

    // Cierre: supervisor (su acceso) o el jefe designado (R3); nunca el inspector, aunque tenga Gestión.
    expect(await status(confirmarVistoBueno(prisma, o.id, ajeno, null, conf('SUPERVISOR', operarioId, operario)))).toBe(403);
    expect(await status(confirmarVistoBueno(prisma, o.id, ajeno, null, conf('SUPERVISOR', inspectorId, { ...inspector, canManage: true })))).toBe(403);
    const c = await confirmarVistoBueno(prisma, o.id, ajeno, 'Fin', conf('SUPERVISOR', supervisorId, supervisor, { metodo: 'pin_tablet' }));
    expect(c).toMatchObject({ rol: 'SUPERVISOR', siguiente: 'INSPECTOR' });
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(ajenoId)))).toBe(409);

    // El jefe no va antes del inspector; solo el designado da cada uno.
    expect(await status(confirmarVistoBueno(prisma, o.id, ajeno, null, conf('JEFE_PROD', jefeId, jefe)))).toBe(409);
    expect(await status(confirmarVistoBueno(prisma, o.id, ajeno, null, conf('INSPECTOR', operarioId, operario)))).toBe(403);
    const vi_ = await confirmarVistoBueno(prisma, o.id, ajeno, null, conf('INSPECTOR', inspectorId, inspector, { metodo: 'pin_tablet' }));
    expect(vi_.siguiente).toBe('JEFE_PROD');
    const vj = await confirmarVistoBueno(prisma, o.id, jefe, null, conf('JEFE_PROD', jefeId, jefe, { sesion: { idUser: jefeId, email: 'jefe@it' } }));
    expect(vj.siguiente).toBeNull();
    expect(await status(confirmarVistoBueno(prisma, o.id, jefe, null, conf('JEFE_PROD', jefeId, jefe)))).toBe(409);

    det = await getOrdenDetalle(prisma, o.id, supervisor, supervisorId);
    expect(det).toMatchObject({ estado: 'CERRADA', completa: true, siguiente: null, puedeVerificar: false, observacionCierre: 'Fin' });
    expect(det?.vistos.map((v) => [v.rol, v.estado, v.firma?.metodo])).toEqual([
      ['OPERARIO', 'dado', 'operario_tablet'],
      ['SUPERVISOR', 'dado', 'pin_tablet'],
      ['INSPECTOR', 'dado', 'pin_tablet'],
      ['JEFE_PROD', 'dado', 'sesion_propia'],
    ]);
    expect(det?.firmas[0]).not.toHaveProperty('imagen');
    expect((await listOrdenes(prisma, FARMA, supervisorId)).find((x) => x.id === o.id)).toMatchObject({ verificada: true, pendiente: null });
    expect((await prisma.otOrdenTrabajo.findFirst({ where: { id_orden_trabajo: o.id } }))?.cerrada_por).toBe(supervisorId);

    const filas = await prisma.otFirma.findMany({ where: { id_orden_trabajo: o.id }, orderBy: { id_firma: 'asc' } });
    expect(filas.map((f) => [f.rol, f.id_user, f.id_operador, f.id_user_sesion])).toEqual([
      ['OPERARIO', ajenoId, opB, ajenoId],
      ['SUPERVISOR', supervisorId, null, ajenoId],
      ['INSPECTOR', inspectorId, null, ajenoId],
      ['JEFE_PROD', jefeId, null, jefeId],
    ]);
    expect(new Set(filas.map((f) => f.content_sha256)).size).toBe(4);
    expect(filas[1]).toMatchObject({ significado: 'Cerró', auth_method: 'pin_tablet', consent_version: 'bitacora-visto-bueno-2026-10-17', firma_png: null, ip: '10.0.0.1', user_agent: 'vitest' });
    await expect(prisma.$executeRaw`UPDATE dbo.ot_firma SET signer_name = N'otro' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/firmas de la bitácora no se pueden editar/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_firma WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/firmas de la bitácora no se pueden editar/);
    // La base rechaza roles fuera de los cuatro.
    await expect(prisma.$executeRaw`INSERT INTO dbo.ot_firma (id_orden_trabajo, rol, significado, id_user, signer_email, content_sha256, auth_method, consent_version) VALUES (${o.id}, N'CALIDAD', N'x', N'u', N'e', ${'a'.repeat(64)}, N'x', N'x')`).rejects.toThrow();
  });

  it('R3/R4 (2026-10-17): el JEFE asignado abre sin Gestión, es el jefe de su bitácora y la cierra sin esperar al operario; su cierre cuenta como su visto bueno', async () => {
    // Abre como jefe (sin Gestión): debe quedar él mismo como jefe de producción.
    expect(await status(crearOrden(prisma, orden({ lote: `JX-${sufijo}`, jefeProduccion: jefeId }), actor(supervisorId), 'JEFE_PROD'))).toBe(403);
    const o = await crearOrden(prisma, orden({ producto: 'PRUEBA IT JEFE', lote: `J-${sufijo}`, jefeProduccion: jefeId }), actor(jefeId), 'JEFE_PROD');
    // El que abre con Gestión también puede ser el jefe (ya no se exige que sean distintos).
    expect(await status(crearOrden(prisma, orden({ lote: `JS-${sufijo}` }), actor(jefeId)))).toBe(0);
    // El inspector sigue siendo distinto de quien abre.
    expect(await status(crearOrden(prisma, orden({ lote: `JI-${sufijo}`, inspector: jefeId }), actor(jefeId), 'JEFE_PROD'))).toBe(400);

    await crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(ajenoId));
    // R4: sin visto bueno del operario, el jefe cierra desde su sesión propia (sin Gestión).
    const c = await confirmarVistoBueno(prisma, o.id, jefe, 'Fin', conf('SUPERVISOR', jefeId, jefe, { sesion: { idUser: jefeId, email: 'jefe@it' } }));
    expect(c).toMatchObject({ rol: 'SUPERVISOR', siguiente: 'INSPECTOR' });
    const fila = await prisma.otFirma.findFirstOrThrow({ where: { id_orden_trabajo: o.id, rol: 'SUPERVISOR' } });
    expect(fila).toMatchObject({ id_user: jefeId, significado: 'Cerró (jefe)', auth_method: 'sesion_propia', id_user_sesion: jefeId });
    expect((await prisma.otOrdenTrabajo.findUniqueOrThrow({ where: { id_orden_trabajo: o.id } })).cerrada_por).toBe(jefeId);
    // Ya cerrada: el operario no da su visto bueno y nadie registra.
    expect(await status(vbOperario(o.id, ajeno))).toBe(409);
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(ajenoId)))).toBe(409);
    // Falta solo el inspector; el jefe no firma otra vez.
    expect(await status(confirmarVistoBueno(prisma, o.id, jefe, null, conf('JEFE_PROD', jefeId, jefe)))).toBe(409);
    expect((await confirmarVistoBueno(prisma, o.id, ajeno, null, conf('INSPECTOR', inspectorId, inspector, { metodo: 'pin_tablet' }))).siguiente).toBeNull();
    const det = await getOrdenDetalle(prisma, o.id, jefe, jefeId);
    expect(det).toMatchObject({ estado: 'CERRADA', completa: true, siguiente: null });
    expect(det?.vistos.map((v) => [v.rol, v.estado])).toEqual([['OPERARIO', 'opcional'], ['SUPERVISOR', 'dado'], ['INSPECTOR', 'dado'], ['JEFE_PROD', 'no_aplica']]);
    expect(det?.vistos[0].nota).toBe('Sin visto bueno del operario');
    expect(det?.vistos[3].nota).toMatch(/cuenta como su visto bueno de jefe/);
    // Transparencia: quién abrió y con qué rol; quién cerró, con qué rol, cuándo y cómo.
    expect(det).toMatchObject({ abiertaComo: 'JEFE_PROD', cierre: { como: 'JEFE_PROD', metodo: 'sesion_propia', cuentaComoVistoJefe: true } });
    expect(det?.cierre?.en).toBeTruthy();

    // Un jefe que deja de estar asignado ya no cierra (mensaje con lo que falta).
    const o2 = await crearOrden(prisma, orden({ lote: `J2-${sufijo}` }), actor(supervisorId));
    const fj = await prisma.otResponsable.findFirstOrThrow({ where: { id_company: FARMA, id_user: jefeId, rol: 'JEFE_PROD' } });
    await cambiarResponsable(prisma, { idCompany: FARMA, idResponsable: fj.id_responsable, activo: false }, actor(supervisorId));
    try {
      const err = await confirmarVistoBueno(prisma, o2.id, jefe, null, conf('SUPERVISOR', jefeId, jefe)).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: 403 });
      expect(String((err as Error).message)).toMatch(/desactivado como jefe de producción/);
    } finally {
      await asignarResponsable(prisma, { idCompany: FARMA, idUser: jefeId, rol: 'JEFE_PROD' }, actor(supervisorId));
    }
  });

  it('TEXTO LIBRE (2026-10-17): Gestión marca la actividad; el texto es obligatorio, queda saneado y marcado en el registro aunque luego cambie el catálogo', async () => {
    const act = await crearActividad(prisma, { idCompany: FARMA, nombre: `Novedad ${sufijo}`, exigeObservacion: false, textoLibre: true, orden: 950, icono: null }, actor(supervisorId));
    expect(act).toMatchObject({ texto_libre: true });
    expect((await listActividades(prisma, FARMA, true)).find((a) => a.id_actividad === act.id_actividad)?.texto_libre).toBe(true);
    const o = await crearOrden(prisma, orden({ producto: 'PRUEBA IT TEXTO', lote: `TL-${sufijo}` }), actor(supervisorId));
    // Sin texto, o demasiado corto: 400; con observación aparte: 400.
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: act.id_actividad, idOperador: opA, observacion: null }, actor(ajenoId)))).toBe(400);
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: act.id_actividad, idOperador: opA, observacion: null, texto: 'ab' }, actor(ajenoId)))).toBe(400);
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: act.id_actividad, idOperador: opA, observacion: 'x', texto: 'texto válido' }, actor(ajenoId)))).toBe(400);
    // En una actividad normal no se admite texto libre.
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null, texto: 'no va' }, actor(ajenoId)))).toBe(400);
    await crearRegistro(prisma, o.id, ajeno, { idActividad: act.id_actividad, idOperador: opA, observacion: null, texto: 'Se cayó un frasco en la línea 2' }, actor(ajenoId));
    await crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: 'opcional' }, actor(ajenoId));
    // Gestión desmarca la actividad: el registro ya hecho sigue marcado como texto libre.
    await cambiarActividad(prisma, { idActividad: act.id_actividad, idCompany: FARMA, textoLibre: false });
    const det = await getOrdenDetalle(prisma, o.id, supervisor, supervisorId);
    expect(det?.registros.map((r) => [r.observacion, r.textoLibre])).toEqual([
      ['Se cayó un frasco en la línea 2', true],
      ['opcional', false],
    ]);
    expect(det).toMatchObject({ abiertaComo: 'SUPERVISOR', cierre: null });
  });

  it('B3: PIN en la base — hash bcrypt, bloqueo a los 5 fallos (auditado), restablecer y volver a configurar', async () => {
    expect(await estadoPin(prisma, inspectorId)).toEqual({ configurado: false, bloqueado: false, intentosFallidos: 0 });
    expect(await status(verificarPinPersona(prisma, inspectorId, '4821', 'Insp', 'planta@it'))).toBe(409);
    await configurarPin(prisma, inspectorId, '4821', { email: `inspector.${sufijo}@farmalogica.com`, ip: '10.0.0.1' });
    const fila = await prisma.otPin.findUnique({ where: { id_user: inspectorId } });
    expect(fila?.pin_hash).toMatch(/^\$2[aby]\$10\$/);
    expect(fila?.pin_hash).not.toContain('4821');
    await verificarPinPersona(prisma, inspectorId, '4821', 'Insp', 'planta@it');
    for (let i = 1; i <= 4; i++) expect(await status(verificarPinPersona(prisma, inspectorId, '0000', 'Insp', 'planta@it'))).toBe(403);
    // Un acierto antes del quinto fallo reinicia el contador.
    await verificarPinPersona(prisma, inspectorId, '4821', 'Insp', 'planta@it');
    expect((await estadoPin(prisma, inspectorId)).intentosFallidos).toBe(0);
    for (let i = 1; i <= 4; i++) await status(verificarPinPersona(prisma, inspectorId, '0000', 'Insp', 'planta@it'));
    expect(await status(verificarPinPersona(prisma, inspectorId, '0000', 'Insp', 'planta@it'))).toBe(423);
    // Bloqueado: ni el PIN correcto pasa.
    expect(await status(verificarPinPersona(prisma, inspectorId, '4821', 'Insp', 'planta@it'))).toBe(423);
    expect((await listPinsEmpresa(prisma, FARMA)).find((u) => u.id === inspectorId)).toMatchObject({ configurado: true, bloqueado: true });
    expect(JSON.stringify(await listPinsEmpresa(prisma, FARMA))).not.toMatch(/\$2[aby]\$/);
    // Restablecer: solo personas de la empresa; borra y desbloquea.
    expect(await status(restablecerPin(prisma, OLP, inspectorId, { idUser: supervisorId, email: 's@it' }))).toBe(404);
    await restablecerPin(prisma, FARMA, inspectorId, { idUser: supervisorId, email: 's@it' });
    expect(await estadoPin(prisma, inspectorId)).toEqual({ configurado: false, bloqueado: false, intentosFallidos: 0 });
    await configurarPin(prisma, inspectorId, '5937', { email: 'i@it', ip: null });
    await verificarPinPersona(prisma, inspectorId, '5937', 'Insp', 'planta@it');
    const audit = await prisma.userAuditLog.findMany({ where: { user_id: inspectorId, action: { startsWith: 'BITACORA_PIN_' } }, orderBy: { id_audit_log: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['BITACORA_PIN_CONFIGURADO', 'BITACORA_PIN_BLOQUEADO', 'BITACORA_PIN_RESTABLECIDO', 'BITACORA_PIN_CONFIGURADO']);
    expect(audit.map((a) => a.details ?? '').join(' ')).not.toMatch(/4821|5937/);
  });

  it('B8: importar operarios — vista previa sin escribir, crea solo los nuevos, aislado por empresa', async () => {
    const texto = `Nombre; documento\nImportado Uno ${sufijo}; 111\npepito pérez ${sufijo}\nImportado Dos ${sufijo}`;
    const previa = await importarOperadores(prisma, parseImportarOperadores({ company: FARMA, texto }), actor(supervisorId));
    expect(previa).toMatchObject({ simulado: true, creados: 0 });
    expect(previa.crear.map((f) => f.nombre)).toEqual([`Importado Uno ${sufijo}`, `Importado Dos ${sufijo}`]);
    expect(previa.existentes).toEqual([{ linea: 3, nombre: `Pepito Pérez ${sufijo}`, activo: true }]);
    expect((await listOperadores(prisma, FARMA, false)).some((p) => p.nombre === `Importado Uno ${sufijo}`)).toBe(false);
    const hecho = await importarOperadores(prisma, parseImportarOperadores({ company: FARMA, texto, simular: false }), actor(supervisorId));
    expect(hecho.creados).toBe(2);
    expect((await listOperadores(prisma, FARMA, true)).find((p) => p.nombre === `Importado Uno ${sufijo}`)).toMatchObject({ documento: '111', activo: true });
    // Repetir no duplica; en OLP se crean aparte.
    expect((await importarOperadores(prisma, parseImportarOperadores({ company: FARMA, texto, simular: false }), actor(supervisorId))).creados).toBe(0);
    expect((await importarOperadores(prisma, parseImportarOperadores({ company: OLP, texto, simular: true }), actor(supervisorId))).crear).toHaveLength(3);
  });

  it('bitácoras ANTERIORES (auxiliares con usuario y firma con imagen) siguen legibles y con sus reglas', async () => {
    // Se crea como la dejaba el modelo del 2026-10-13: sin operarios del maestro, con auxiliar usuario.
    const vieja = await prisma.otOrdenTrabajo.create({
      data: { id_company: FARMA, consecutivo: 900000 + Math.floor(Math.random() * 99999), producto: 'VIEJA', lote: `V-${sufijo}`, turno: 'MANANA', estado: 'ABIERTA', abierta_por: supervisorId, id_inspector: inspectorId },
    });
    await prisma.otOrdenOperario.create({ data: { id_orden_trabajo: vieja.id_orden_trabajo, id_user: operarioId } });
    await crearRegistro(prisma, vieja.id_orden_trabajo, operario, { idActividad: idTolva, idOperador: null, observacion: null }, actor(operarioId));
    expect(await status(crearRegistro(prisma, vieja.id_orden_trabajo, ajeno, { idActividad: idTolva, idOperador: null, observacion: null }, actor(ajenoId)))).toBe(403);
    expect(await status(crearRegistro(prisma, vieja.id_orden_trabajo, operario, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(operarioId)))).toBe(400);
    await prisma.otFirma.create({
      data: { id_orden_trabajo: vieja.id_orden_trabajo, rol: 'SUPERVISOR', significado: 'Cerró', id_user: supervisorId, signer_email: 's@it', signer_name: 'Sup', content_sha256: 'a'.repeat(64), auth_method: 'contrasena_synerlink', consent_version: 'co-ley527-d2364-v1', firma_png: 'data:image/png;base64,iVBORw0KGgo=' },
    });
    const det = await getOrdenDetalle(prisma, vieja.id_orden_trabajo, supervisor, supervisorId);
    expect(det?.operarios.map((p) => p.id)).toEqual([operarioId]);
    expect(det?.operadores).toEqual([]);
    expect(det?.registros[0]).toMatchObject({ operador: null, usuario: 'operario IT' });
    expect(det?.firmas).toEqual([expect.objectContaining({ rol: 'SUPERVISOR', nombre: 'Sup' })]);
    expect(JSON.stringify(det?.firmas)).not.toContain('base64');
  });

  it('aísla por empresa: una orden de Farmalógica no se ve ni se registra desde OLP; operarios y áreas tampoco', async () => {
    const o = await crearOrden(prisma, orden({ lote: `E-${sufijo}`, turno: 'TARDE' }), actor(supervisorId));
    const olp: OtCompanyAccess = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canOperate: true, canManage: true };
    expect(await getOrdenDetalle(prisma, o.id, olp, supervisorId)).toBeNull();
    expect(await status(crearRegistro(prisma, o.id, olp, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(supervisorId)))).toBe(404);
    expect(await status(confirmarVistoBueno(prisma, o.id, olp, null, conf('SUPERVISOR', supervisorId, olp)))).toBe(404);
    expect(await status(agregarOperadores(prisma, o.id, olp, [opA], actor(supervisorId)))).toBe(404);
    expect((await listOrdenes(prisma, OLP, supervisorId)).some((x) => x.id === o.id)).toBe(false);
    const actOlp = await crearActividad(prisma, { idCompany: OLP, nombre: `OLP ${sufijo}`, exigeObservacion: false, orden: 1, icono: null }, actor(supervisorId));
    expect(await status(crearRegistro(prisma, o.id, supervisor, { idActividad: actOlp.id_actividad, idOperador: opA, observacion: null }, actor(supervisorId)))).toBe(400);
    expect((await listUsuariosEmpresa(prisma, FARMA)).some((u) => u.id === operarioId)).toBe(true);
    expect((await listUsuariosEmpresa(prisma, OLP)).some((u) => u.id === operarioId)).toBe(false);
    expect((await listOperadores(prisma, OLP, false)).some((p) => p.id_operador === opA)).toBe(false);
    expect(await status(cambiarOperador(prisma, { idOperador: opA, idCompany: OLP, activo: false }, actor(supervisorId)))).toBe(404);
    expect(await status(cambiarArea(prisma, { idArea, idCompany: OLP, activo: false }))).toBe(404);
    // Un operario de OLP no se programa en Farmalógica.
    const opOlp = await crearOperador(prisma, { idCompany: OLP, nombre: `OLP op ${sufijo}`, documento: null }, actor(supervisorId));
    expect(await status(crearOrden(prisma, orden({ operadores: [opOlp.id_operador] }), actor(supervisorId)))).toBe(400);
  });

  it('maestro de operarios: sin duplicados por empresa, edición y desactivación (no se borran)', async () => {
    expect(await status(crearOperador(prisma, { idCompany: FARMA, nombre: `Pepito Pérez ${sufijo}`, documento: null }, actor(supervisorId)))).toBe(409);
    expect(await status(cambiarOperador(prisma, { idOperador: opB, idCompany: FARMA, nombre: `Pepito Pérez ${sufijo}` }, actor(supervisorId)))).toBe(409);
    const c = await cambiarOperador(prisma, { idOperador: opB, idCompany: FARMA, documento: '999' }, actor(supervisorId));
    expect(c).toMatchObject({ documento: '999', activo: true });
    const fila = await prisma.otOperador.findFirst({ where: { id_operador: opB } });
    expect(fila?.updated_by).toBe(supervisorId);
    expect((await listOperadores(prisma, FARMA, true)).some((p) => p.id_operador === opInactivo)).toBe(false);
    expect((await listOperadores(prisma, FARMA, false)).some((p) => p.id_operador === opInactivo)).toBe(true);
    expect(await status(crearArea(prisma, { idCompany: FARMA, nombre: `Área IT ${sufijo}`, orden: 2 }, actor(supervisorId)))).toBe(409);
  });

  it('catálogo: no hay duplicados, se desactiva (no se borra) y una inactiva no se registra', async () => {
    expect(await status(crearActividad(prisma, { idCompany: FARMA, nombre: `Tolva ${sufijo}`, exigeObservacion: false, orden: 3, icono: null }, actor(supervisorId)))).toBe(409);
    const nueva = await crearActividad(prisma, { idCompany: FARMA, nombre: `Mantenimiento ${sufijo}`, exigeObservacion: false, orden: 5, icono: null }, actor(supervisorId));
    const cambiada = await cambiarActividad(prisma, { idActividad: nueva.id_actividad, idCompany: FARMA, activo: false, orden: 7, icono: 'equipo' });
    expect(cambiada).toMatchObject({ activo: false, orden: 7, icono: 'equipo' });
    expect((await listActividades(prisma, FARMA, true)).some((a) => a.id_actividad === nueva.id_actividad)).toBe(false);
    expect((await listActividades(prisma, FARMA, false)).some((a) => a.id_actividad === nueva.id_actividad)).toBe(true);
    expect(await status(cambiarActividad(prisma, { idActividad: nueva.id_actividad, idCompany: OLP, activo: true }))).toBe(404);
    const o = await crearOrden(prisma, orden({ lote: `C-${sufijo}` }), actor(supervisorId));
    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: nueva.id_actividad, idOperador: opA, observacion: null }, actor(ajenoId)))).toBe(400);
  });

  it('AVISO al inspector y al jefe: correos ACTIVOS, encabezado y nombre de quien confirma; nada de otra empresa', async () => {
    const o = await crearOrden(prisma, orden({ producto: 'PRUEBA AVISO', lote: `AV-${sufijo}` }), actor(supervisorId));
    const a = await datosAviso(prisma, o.id, FARMA, { ...actor(supervisorId), nombre: 'Quien confirma' });
    expect(a).toMatchObject({
      idOrden: o.id, idCompany: FARMA, consecutivo: o.consecutivo, producto: 'PRUEBA AVISO', lote: `AV-${sufijo}`,
      inspectorEmail: `inspector.${sufijo}@farmalogica.com`, jefeEmail: `jefe.${sufijo}@farmalogica.com`, actorNombre: 'Quien confirma',
    });
    expect(avisoSiguienteVistoBueno(a!, 'SUPERVISOR', 'INSPECTOR')[0].emails).toEqual([`inspector.${sufijo}@farmalogica.com`]);
    expect((await datosAviso(prisma, o.id, FARMA, actor(supervisorId)))?.actorNombre).toBe('supervisor IT');
    expect(await datosAviso(prisma, o.id, OLP, actor(supervisorId))).toBeNull();
    await prisma.user.update({ where: { id: inspectorId }, data: { isActive: false } });
    try {
      expect((await datosAviso(prisma, o.id, FARMA, actor(supervisorId)))?.inspectorEmail).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: inspectorId }, data: { isActive: true } });
    }
  });

  it('MIGRACIÓN 20261015180000: en las bitácoras del #617, id_inspector (= jefe) pasa a id_jefe_produccion, incluso CERRADAS; idempotente y deja el trigger activo', async () => {
    const vieja = await prisma.otOrdenTrabajo.create({
      data: { id_company: FARMA, consecutivo: 800000 + Math.floor(Math.random() * 99999), producto: 'DEL 617', lote: `M-${sufijo}`, turno: 'TARDE', estado: 'ABIERTA', abierta_por: supervisorId, id_inspector: jefeId },
    });
    await prisma.$executeRaw`UPDATE dbo.ot_orden_trabajo SET estado = N'CERRADA', cerrada_por = ${supervisorId}, cerrada_en = SYSUTCDATETIME() WHERE id_orden_trabajo = ${vieja.id_orden_trabajo}`;
    await prisma.otFirma.create({
      data: { id_orden_trabajo: vieja.id_orden_trabajo, rol: 'SUPERVISOR', significado: 'Cerró', id_user: supervisorId, signer_email: 's@it', signer_name: 'Sup', content_sha256: 'a'.repeat(64), auth_method: 'contrasena_synerlink', consent_version: 'bitacora-check-2026-10-14' },
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del repositorio (la migración)
    const sql = readFileSync(fileURLToPath(new URL('../../../prisma/migrations/20261015180000_bitacora_proceso_cuatro_actores/migration.sql', import.meta.url)), 'utf8');
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql);
    const fila = await prisma.otOrdenTrabajo.findFirst({ where: { id_orden_trabajo: vieja.id_orden_trabajo } });
    expect(fila).toMatchObject({ id_inspector: null, id_jefe_produccion: jefeId, estado: 'CERRADA' });
    // La cerrada sigue protegida por el trigger.
    await expect(prisma.$executeRaw`UPDATE dbo.ot_orden_trabajo SET lote = N'X' WHERE id_orden_trabajo = ${vieja.id_orden_trabajo}`).rejects.toThrow(/cerrada no se puede modificar/);
    // Sin inspector: el siguiente es el jefe, que la verifica después del cierre.
    const det = await getOrdenDetalle(prisma, vieja.id_orden_trabajo, supervisor, supervisorId);
    expect(det?.vistos.map((v) => v.estado)).toEqual(['no_aplica', 'dado', 'no_aplica', 'pendiente']);
    expect(det?.siguiente).toBe('JEFE_PROD');
    await confirmarVistoBueno(prisma, vieja.id_orden_trabajo, jefe, null, conf('JEFE_PROD', jefeId, jefe));
    expect((await getOrdenDetalle(prisma, vieja.id_orden_trabajo, supervisor, supervisorId))?.completa).toBe(true);
  });

  it('el «Verificó» del modelo anterior se lee como el visto bueno del JEFE de producción', async () => {
    const v = await prisma.otOrdenTrabajo.create({
      data: { id_company: FARMA, consecutivo: 700000 + Math.floor(Math.random() * 99999), producto: 'VERIFICO', lote: `VV-${sufijo}`, turno: 'NOCHE', estado: 'ABIERTA', abierta_por: supervisorId, id_jefe_produccion: jefeId },
    });
    for (const [rol, significado, idUser] of [['SUPERVISOR', 'Cerró', supervisorId], ['INSPECTOR', 'Verificó', jefeId]] as const) {
      await prisma.otFirma.create({ data: { id_orden_trabajo: v.id_orden_trabajo, rol, significado, id_user: idUser, signer_email: 'x@it', signer_name: 'X', content_sha256: 'b'.repeat(64), auth_method: 'contrasena_synerlink', consent_version: 'bitacora-check-2026-10-14' } });
    }
    const det = await getOrdenDetalle(prisma, v.id_orden_trabajo, supervisor, supervisorId);
    expect(det?.firmas.map((f) => [f.rol, f.significado, f.metodo])).toEqual([['SUPERVISOR', 'Cerró', 'contrasena_synerlink'], ['JEFE_PROD', 'Verificó', 'contrasena_synerlink']]);
    expect(det?.vistos.find((x) => x.rol === 'JEFE_PROD')?.estado).toBe('dado');
  });

  it('MI FIRMA (GSS Firma): la auditoría queda en user_audit_log con la huella, sin la imagen', async () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(255);
    rgba.set([0, 0, 0, 255], 0);
    const imagen = `data:image/png;base64,${codificarPng({ width: 4, height: 4, rgba }).toString('base64')}`;
    const r = await registrarFirmaGss(
      { guardar: async () => ({ ok: true }), auditar: (row) => prisma.userAuditLog.create({ data: row }) },
      { idUser: supervisorId, email: `supervisor.${sufijo}@farmalogica.com`, firma: { imagen, metodo: 'uploaded' }, origen: 'bitacora-proceso', ip: '10.0.0.1', userAgent: 'vitest' }
    );
    const rows = await prisma.userAuditLog.findMany({ where: { user_id: supervisorId, action: FIRMA_GSS_AUDIT_ACTION } });
    expect(rows).toHaveLength(1);
    expect(rows[0].performed_by).toBe(`supervisor.${sufijo}@farmalogica.com`);
    expect(JSON.parse(rows[0].details ?? '{}')).toMatchObject({ sha256: r.sha256, metodo: 'uploaded', origen: 'bitacora-proceso', guardadaEnGssFirma: true });
    expect(rows[0].details).not.toContain('base64');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { OT_PROCESS_NAME, OT_SUBPROCESS_NAMES, OT_SUBPROCESS_URLS } from '../../../lib/bitacora-proceso/constants';
import {
  agregarOperadores,
  cambiarActividad,
  cambiarArea,
  cambiarOperador,
  cerrarYFirmar,
  verificarYFirmar,
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
  datosAvisoInspector,
} from '../../../lib/bitacora-proceso/db';
import { avisoPorVerificar } from '../../../lib/bitacora-proceso/notificaciones';
import { codificarPng } from '../../../lib/firma-gss/png';
import { FIRMA_GSS_AUDIT_ACTION, registrarFirmaGss } from '../../../lib/firma-gss/miFirma';
import { isOtError, parseNuevaOrden, type OtCompanyAccess } from '../../../lib/bitacora-proceso/rules';

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
  let inspector: OtCompanyAccess;
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
  /** Persona que CONFIRMA (elegida en la lista y validada con su contraseña en la ruta), con SU acceso. */
  const firmante = (idUser: string, access: OtCompanyAccess | null) => ({ ...actor(idUser), userAgent: 'vitest', nombre: `Nombre ${idUser}`, access });
  const orden = (extra: Record<string, unknown> = {}) =>
    parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT', lote: `L-${sufijo}`, turno: 'MANANA', operadores: [opA], idArea, inspector: inspectorId, ...extra });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${FARMA}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${FARMA}, N'FARMALOGICA S.A.');
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${OLP}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${OLP}, N'ONELATAMPHARMA');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);

    const mk = (n: string) => prisma.user.create({ data: { email: `${n}.${sufijo}@farmalogica.com`, name: `${n} IT` } });
    const [sup, op, aj, insp] = await Promise.all([mk('supervisor'), mk('operario'), mk('ajeno'), mk('inspector')]);
    inspectorId = insp.id;
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
    await prisma.subprocessUserCompany.createMany({
      data: [
        { id_subprocess: subs.operario, id_company_user: cuSup.id_company_user },
        { id_subprocess: subs.gestion, id_company_user: cuSup.id_company_user },
        { id_subprocess: subs.operario, id_company_user: cuOp.id_company_user },
        { id_subprocess: subs.operario, id_company_user: cuAj.id_company_user },
        { id_subprocess: subs.operario, id_company_user: cuInsp.id_company_user },
      ],
    });
    [supervisor] = await getOtAccessForUser(prisma, sup.email);
    [operario] = await getOtAccessForUser(prisma, op.email);
    [ajeno] = await getOtAccessForUser(prisma, aj.email);
    [inspector] = await getOtAccessForUser(prisma, insp.email);

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
    await cerrarYFirmar(prisma, o.id, supervisor, 'Fin del turno', firmante(supervisorId, supervisor));
    expect(await status(cerrarYFirmar(prisma, o.id, supervisor, null, firmante(supervisorId, supervisor)))).toBe(409);
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
    await cerrarYFirmar(prisma, o.id, supervisor, null, firmante(supervisorId, supervisor));
    await expect(prisma.$executeRaw`UPDATE dbo.ot_orden_trabajo SET estado = N'ABIERTA' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/cerrada no se puede modificar/);
    await expect(prisma.$executeRaw`UPDATE dbo.ot_orden_trabajo SET turno = N'OTRO' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow();
    const det = await getOrdenDetalle(prisma, o.id, supervisor, supervisorId);
    expect(det?.registros).toHaveLength(1);
    expect(det?.estado).toBe('CERRADA');
  });

  it('A4: «Cerró» lo confirma un SUPERVISOR elegido (no la sesión) y «Verificó» el JEFE DE PRODUCCIÓN; sin imagen; huellas encadenadas; inmutables', async () => {
    const o = await crearOrden(prisma, orden({ producto: 'PRUEBA IT CONFIRMA', lote: `F-${sufijo}` }), actor(supervisorId));
    await crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, idOperador: opA, observacion: null }, actor(ajenoId));
    // La sesión (cuenta de planta, sin Gestión) ve el botón de cierre; quien confirma debe ser supervisor.
    expect((await getOrdenDetalle(prisma, o.id, ajeno, ajenoId))?.puedeCerrar).toBe(true);
    expect(await status(verificarYFirmar(prisma, o.id, ajeno, firmante(inspectorId, inspector)))).toBe(409);
    expect(await status(cerrarYFirmar(prisma, o.id, ajeno, null, firmante(operarioId, operario)))).toBe(403);
    expect(await status(cerrarYFirmar(prisma, o.id, ajeno, null, firmante(operarioId, null)))).toBe(403);
    const jefeConGestion: OtCompanyAccess = { ...inspector, canManage: true };
    expect(await status(cerrarYFirmar(prisma, o.id, ajeno, null, firmante(inspectorId, jefeConGestion)))).toBe(403);

    // Sesión de planta (ajeno) + confirma la supervisora con SU cuenta.
    const c = await cerrarYFirmar(prisma, o.id, ajeno, 'Fin', firmante(supervisorId, supervisor));
    expect(c.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    let det = await getOrdenDetalle(prisma, o.id, ajeno, ajenoId);
    expect(det).toMatchObject({ estado: 'CERRADA', puedeVerificar: true, puedeCerrar: false });
    expect(det?.firmas).toEqual([expect.objectContaining({ rol: 'SUPERVISOR', significado: 'Cerró', nombre: `Nombre ${supervisorId}`, contentSha256: c.contentSha256 })]);
    expect(det?.firmas[0]).not.toHaveProperty('imagen');
    expect((await prisma.otOrdenTrabajo.findFirst({ where: { id_orden_trabajo: o.id } }))?.cerrada_por).toBe(supervisorId);

    // Solo el jefe de producción designado verifica, y una sola vez.
    expect(await status(verificarYFirmar(prisma, o.id, ajeno, firmante(operarioId, operario)))).toBe(403);
    const v = await verificarYFirmar(prisma, o.id, ajeno, firmante(inspectorId, inspector));
    expect(v.contentSha256).not.toBe(c.contentSha256);
    expect(await status(verificarYFirmar(prisma, o.id, ajeno, firmante(inspectorId, inspector)))).toBe(409);
    det = await getOrdenDetalle(prisma, o.id, inspector, inspectorId);
    expect(det?.firmas.map((f) => [f.rol, f.significado])).toEqual([['SUPERVISOR', 'Cerró'], ['INSPECTOR', 'Verificó']]);
    expect(det?.puedeVerificar).toBe(false);
    expect((await listOrdenes(prisma, FARMA, supervisorId)).find((x) => x.id === o.id)?.verificada).toBe(true);

    const filas = await prisma.otFirma.findMany({ where: { id_orden_trabajo: o.id }, orderBy: { id_firma: 'asc' } });
    expect(filas.map((f) => f.id_user)).toEqual([supervisorId, inspectorId]);
    expect(filas[0]).toMatchObject({ auth_method: 'contrasena_synerlink', consent_version: 'bitacora-check-2026-10-14', firma_png: null, firma_sha256: null, ip: '10.0.0.1', user_agent: 'vitest' });
    await expect(prisma.$executeRaw`UPDATE dbo.ot_firma SET signer_name = N'otro' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/firmas de la bitácora no se pueden editar/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_firma WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/firmas de la bitácora no se pueden editar/);
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
    expect(await status(cerrarYFirmar(prisma, o.id, olp, null, firmante(supervisorId, olp)))).toBe(404);
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

  it('AVISO al jefe de producción: correo ACTIVO, encabezado y nombre de quien confirma; nada de otra empresa', async () => {
    const o = await crearOrden(prisma, orden({ producto: 'PRUEBA AVISO', lote: `AV-${sufijo}` }), actor(supervisorId));
    const a = await datosAvisoInspector(prisma, o.id, FARMA, actor(supervisorId));
    expect(a).toMatchObject({ idOrden: o.id, idCompany: FARMA, consecutivo: o.consecutivo, producto: 'PRUEBA AVISO', lote: `AV-${sufijo}`, inspectorEmail: `inspector.${sufijo}@farmalogica.com`, actorNombre: 'supervisor IT' });
    expect(avisoPorVerificar(a!)[0].emails).toEqual([`inspector.${sufijo}@farmalogica.com`]);
    expect(await datosAvisoInspector(prisma, o.id, OLP, actor(supervisorId))).toBeNull();
    await prisma.user.update({ where: { id: inspectorId }, data: { isActive: false } });
    try {
      expect((await datosAvisoInspector(prisma, o.id, FARMA, actor(supervisorId)))?.inspectorEmail).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: inspectorId }, data: { isActive: true } });
    }
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

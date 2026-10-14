import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { OT_PROCESS_NAME, OT_SUBPROCESS_NAMES, OT_SUBPROCESS_URLS } from '../../../lib/bitacora-proceso/constants';
import {
  cambiarActividad,
  cerrarYFirmar,
  verificarYFirmar,
  crearActividad,
  crearOrden,
  crearRegistro,
  getOrdenDetalle,
  getOtAccessForUser,
  listActividades,
  listOrdenes,
  listUsuariosEmpresa,
  datosAvisoInspector,
} from '../../../lib/bitacora-proceso/db';
import { avisoPorVerificar } from '../../../lib/bitacora-proceso/notificaciones';
import { codificarPng } from '../../../lib/firma-gss/png';
import { FIRMA_GSS_AUDIT_ACTION, registrarFirmaGss } from '../../../lib/firma-gss/miFirma';
import { isOtError, parseNuevaOrden, type OtCompanyAccess } from '../../../lib/bitacora-proceso/rules';

/**
 * Integración de Órdenes de Trabajo contra un SQL Server real (CI: `prisma db
 * push` + la migración 20261013180000_ordenes_trabajo_p0, con sus triggers).
 * Prueba la hora del servidor, el bloqueo tras el cierre, la lista de
 * operarios, el aislamiento por empresa y que la base impide editar o borrar.
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

  const actor = (idUser: string) => ({ idUser, email: `${idUser}@it`, ip: '10.0.0.1' });
  const firmante = (idUser: string, imagen: string | null = null) => ({ ...actor(idUser), userAgent: 'vitest', nombre: `Nombre ${idUser}`, imagen });

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
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('resuelve el acceso real: supervisor con Gestión, operario sin ella', () => {
    expect(supervisor).toMatchObject({ idCompany: FARMA, canOperate: true, canManage: true });
    expect(operario).toMatchObject({ idCompany: FARMA, canOperate: true, canManage: false });
    expect(ajeno.canManage).toBe(false);
  });

  it('abre órdenes con consecutivo por empresa, sin OP y con OP (copia guardada)', async () => {
    const a = await crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT', lote: `L-${sufijo}`, turno: 'MANANA', operarios: [operarioId], inspector: inspectorId }), actor(supervisorId));
    const b = await crearOrden(
      prisma,
      parseNuevaOrden({
        company: FARMA, producto: 'PRUEBA IT OP', lote: `L-${sufijo}`, turno: 'TARDE', operarios: [operarioId], inspector: inspectorId,
        sapOp: { AbsoluteEntry: 14259, DocumentNumber: 14045, ItemNo: 'PTCZ0121', U_Cod_Lote: '1565426' },
      }),
      actor(supervisorId)
    );
    expect(b.consecutivo).toBe(a.consecutivo + 1);
    const det = await getOrdenDetalle(prisma, b.id, supervisor, supervisorId);
    expect(det?.sapOpDocNum).toBe(14045);
    expect(det?.itemCode).toBe('PTCZ0121');
    expect(det?.sapOp).toMatchObject({ U_Cod_Lote: '1565426' });
    const lista = await listOrdenes(prisma, FARMA, operarioId);
    expect(lista.filter((o) => o.lote === `L-${sufijo}`).every((o) => o.soyOperario && o.estado === 'ABIERTA')).toBe(true);
  });

  it('rechaza operarios que no son usuarios activos de la empresa', async () => {
    const st = await status(crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'X', lote: 'X', turno: 'NOCHE', operarios: ['no-existe'], inspector: inspectorId }), actor(supervisorId)));
    expect(st).toBe(400);
  });

  it('registra con la HORA DEL SERVIDOR; solo operarios listados (o supervisor); observación obligatoria si se exige', async () => {
    const o = await crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT', lote: `R-${sufijo}`, turno: 'NOCHE', operarios: [operarioId], inspector: inspectorId }), actor(supervisorId));
    const [{ antes }] = await prisma.$queryRaw<{ antes: Date }[]>`SELECT SYSUTCDATETIME() AS antes`;
    const r = await crearRegistro(prisma, o.id, operario, { idActividad: idTolva, observacion: null }, actor(operarioId));
    const [{ despues }] = await prisma.$queryRaw<{ despues: Date }[]>`SELECT SYSUTCDATETIME() AS despues`;
    const t = new Date(r.registradoEn).getTime();
    expect(t).toBeGreaterThanOrEqual(antes.getTime() - 1);
    expect(t).toBeLessThanOrEqual(despues.getTime() + 1);

    expect(await status(crearRegistro(prisma, o.id, ajeno, { idActividad: idTolva, observacion: null }, actor(ajenoId)))).toBe(403);
    expect(await status(crearRegistro(prisma, o.id, operario, { idActividad: idOtra, observacion: null }, actor(operarioId)))).toBe(400);
    await crearRegistro(prisma, o.id, operario, { idActividad: idOtra, observacion: 'Cambio de guantes' }, actor(operarioId));
    await crearRegistro(prisma, o.id, supervisor, { idActividad: idTolva, observacion: null }, actor(supervisorId));

    const det = await getOrdenDetalle(prisma, o.id, operario, operarioId);
    expect(det?.registros.map((x) => x.actividad)).toEqual([`Tolva ${sufijo}`, `Otra ${sufijo}`, `Tolva ${sufijo}`]);
    expect(det?.registros[1].observacion).toBe('Cambio de guantes');
    expect(det?.puedeRegistrar).toBe(true);
    expect((await getOrdenDetalle(prisma, o.id, ajeno, ajenoId))?.puedeRegistrar).toBe(false);

    // Cierre: solo una vez; después no se admiten registros.
    await cerrarYFirmar(prisma, o.id, supervisor, 'Fin del turno', firmante(supervisorId));
    expect(await status(cerrarYFirmar(prisma, o.id, supervisor, null, firmante(supervisorId)))).toBe(409);
    expect(await status(crearRegistro(prisma, o.id, operario, { idActividad: idTolva, observacion: null }, actor(operarioId)))).toBe(409);
    const cerrada = await getOrdenDetalle(prisma, o.id, supervisor, supervisorId);
    expect(cerrada).toMatchObject({ estado: 'CERRADA', observacionCierre: 'Fin del turno', puedeRegistrar: false });
    expect(cerrada?.cerradaEn).toBeTruthy();
  });

  it('la BASE impide editar o borrar registros y operarios, borrar órdenes y modificar una cerrada', async () => {
    const o = await crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT', lote: `T-${sufijo}`, turno: 'MANANA', operarios: [operarioId], inspector: inspectorId }), actor(supervisorId));
    await crearRegistro(prisma, o.id, operario, { idActividad: idTolva, observacion: null }, actor(operarioId));
    await expect(prisma.$executeRaw`UPDATE dbo.ot_registro SET observacion = N'editado' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/no se pueden editar ni borrar/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_registro WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/no se pueden editar ni borrar/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_orden_operario WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/operarios/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_orden_trabajo WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/no se pueden borrar/);
    await cerrarYFirmar(prisma, o.id, supervisor, null, firmante(supervisorId));
    await expect(prisma.$executeRaw`UPDATE dbo.ot_orden_trabajo SET estado = N'ABIERTA' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/cerrada no se puede modificar/);
    await expect(prisma.$executeRaw`UPDATE dbo.ot_orden_trabajo SET turno = N'OTRO' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow();
    const det = await getOrdenDetalle(prisma, o.id, supervisor, supervisorId);
    expect(det?.registros).toHaveLength(1);
    expect(det?.estado).toBe('CERRADA');
  });

  it('el INSPECTOR (sin ser auxiliar) registra y queda en el encabezado; debe ser usuario activo de la empresa', async () => {
    const o = await crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT', lote: `I-${sufijo}`, turno: 'TARDE', operarios: [operarioId], inspector: inspectorId }), actor(supervisorId));
    const r = await crearRegistro(prisma, o.id, inspector, { idActividad: idTolva, observacion: 'Inspección' }, actor(inspectorId));
    expect(r.actividad).toBe(`Tolva ${sufijo}`);
    const det = await getOrdenDetalle(prisma, o.id, inspector, inspectorId);
    expect(det?.inspector?.id).toBe(inspectorId);
    expect(det?.puedeRegistrar).toBe(true);
    expect((await listOrdenes(prisma, FARMA, inspectorId)).find((x) => x.id === o.id)?.soyOperario).toBe(true);
    expect(await status(crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'X', lote: 'X', turno: 'NOCHE', operarios: [operarioId], inspector: 'no-existe' }), actor(supervisorId)))).toBe(400);
  });

  it('FIRMAS: el supervisor cierra firmando («Cerró»), el inspector verifica («Verificó»); huellas encadenadas; la base impide editarlas', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    // Al abrir, el inspector no puede ser el supervisor.
    expect(await status(crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'X', lote: 'X', turno: 'NOCHE', operarios: [operarioId], inspector: supervisorId }), actor(supervisorId)))).toBe(400);
    const o = await crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT FIRMAS', lote: `F-${sufijo}`, turno: 'MANANA', operarios: [operarioId], inspector: inspectorId }), actor(supervisorId));
    await crearRegistro(prisma, o.id, operario, { idActividad: idTolva, observacion: null }, actor(operarioId));
    // Antes del cierre no se verifica; el operario no cierra; el inspector no cierra.
    expect(await status(verificarYFirmar(prisma, o.id, inspector, firmante(inspectorId)))).toBe(409);
    expect(await status(cerrarYFirmar(prisma, o.id, operario, null, firmante(operarioId)))).toBe(403);
    const inspectorConGestion: OtCompanyAccess = { ...inspector, canManage: true };
    expect(await status(cerrarYFirmar(prisma, o.id, inspectorConGestion, null, firmante(inspectorId)))).toBe(403);

    const c = await cerrarYFirmar(prisma, o.id, supervisor, 'Fin', firmante(supervisorId, PNG));
    expect(c.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    let det = await getOrdenDetalle(prisma, o.id, inspector, inspectorId);
    expect(det).toMatchObject({ estado: 'CERRADA', puedeVerificar: true, puedeCerrar: false });
    expect(det?.firmas).toEqual([expect.objectContaining({ rol: 'SUPERVISOR', significado: 'Cerró', nombre: `Nombre ${supervisorId}`, imagen: PNG, contentSha256: c.contentSha256 })]);
    expect((await getOrdenDetalle(prisma, o.id, operario, operarioId))?.puedeVerificar).toBe(false);

    // Solo el inspector designado verifica, y una sola vez.
    expect(await status(verificarYFirmar(prisma, o.id, operario, firmante(operarioId)))).toBe(403);
    const v = await verificarYFirmar(prisma, o.id, inspector, firmante(inspectorId));
    expect(v.contentSha256).not.toBe(c.contentSha256);
    expect(await status(verificarYFirmar(prisma, o.id, inspector, firmante(inspectorId)))).toBe(409);
    det = await getOrdenDetalle(prisma, o.id, inspector, inspectorId);
    expect(det?.firmas.map((f) => [f.rol, f.significado])).toEqual([['SUPERVISOR', 'Cerró'], ['INSPECTOR', 'Verificó']]);
    expect(det?.puedeVerificar).toBe(false);
    expect((await listOrdenes(prisma, FARMA, supervisorId)).find((x) => x.id === o.id)?.verificada).toBe(true);

    const fila = await prisma.otFirma.findFirst({ where: { id_orden_trabajo: o.id, rol: 'SUPERVISOR' } });
    expect(fila).toMatchObject({ auth_method: 'contrasena_synerlink', consent_version: 'co-ley527-d2364-v1', ip: '10.0.0.1', user_agent: 'vitest' });
    expect(fila?.firma_sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(prisma.$executeRaw`UPDATE dbo.ot_firma SET signer_name = N'otro' WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/firmas de la bitácora no se pueden editar/);
    await expect(prisma.$executeRaw`DELETE FROM dbo.ot_firma WHERE id_orden_trabajo = ${o.id}`).rejects.toThrow(/firmas de la bitácora no se pueden editar/);
  });

  it('aísla por empresa: una orden de Farmalógica no se ve ni se registra desde OLP', async () => {
    const o = await crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT', lote: `E-${sufijo}`, turno: 'TARDE', operarios: [operarioId], inspector: inspectorId }), actor(supervisorId));
    const olp: OtCompanyAccess = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canOperate: true, canManage: true };
    expect(await getOrdenDetalle(prisma, o.id, olp, supervisorId)).toBeNull();
    expect(await status(crearRegistro(prisma, o.id, olp, { idActividad: idTolva, observacion: null }, actor(supervisorId)))).toBe(404);
    expect(await status(cerrarYFirmar(prisma, o.id, olp, null, firmante(supervisorId)))).toBe(404);
    expect((await listOrdenes(prisma, OLP, supervisorId)).some((x) => x.id === o.id)).toBe(false);
    // Una actividad de otra empresa no sirve en una orden de Farmalógica.
    const actOlp = await crearActividad(prisma, { idCompany: OLP, nombre: `OLP ${sufijo}`, exigeObservacion: false, orden: 1, icono: null }, actor(supervisorId));
    expect(await status(crearRegistro(prisma, o.id, supervisor, { idActividad: actOlp.id_actividad, observacion: null }, actor(supervisorId)))).toBe(400);
    expect((await listUsuariosEmpresa(prisma, FARMA)).some((u) => u.id === operarioId)).toBe(true);
    expect((await listUsuariosEmpresa(prisma, OLP)).some((u) => u.id === operarioId)).toBe(false);
  });

  it('catálogo: no hay duplicados, se desactiva (no se borra) y una inactiva no se registra', async () => {
    expect(await status(crearActividad(prisma, { idCompany: FARMA, nombre: `Tolva ${sufijo}`, exigeObservacion: false, orden: 3, icono: null }, actor(supervisorId)))).toBe(409);
    const nueva = await crearActividad(prisma, { idCompany: FARMA, nombre: `Mantenimiento ${sufijo}`, exigeObservacion: false, orden: 5, icono: null }, actor(supervisorId));
    const cambiada = await cambiarActividad(prisma, { idActividad: nueva.id_actividad, idCompany: FARMA, activo: false, orden: 7, icono: 'equipo' });
    expect(cambiada).toMatchObject({ activo: false, orden: 7, icono: 'equipo' });
    expect((await listActividades(prisma, FARMA, true)).some((a) => a.id_actividad === nueva.id_actividad)).toBe(false);
    expect((await listActividades(prisma, FARMA, false)).some((a) => a.id_actividad === nueva.id_actividad)).toBe(true);
    expect(await status(cambiarActividad(prisma, { idActividad: nueva.id_actividad, idCompany: OLP, activo: true }))).toBe(404);
    const o = await crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'PRUEBA IT', lote: `C-${sufijo}`, turno: 'MANANA', operarios: [operarioId], inspector: inspectorId }), actor(supervisorId));
    expect(await status(crearRegistro(prisma, o.id, operario, { idActividad: nueva.id_actividad, observacion: null }, actor(operarioId)))).toBe(400);
  });

  it('AVISO al inspector: correo del inspector ACTIVO, encabezado y nombre de quien cierra; nada de otra empresa', async () => {
    const o = await crearOrden(prisma, parseNuevaOrden({ company: FARMA, producto: 'PRUEBA AVISO', lote: `AV-${sufijo}`, turno: 'MANANA', operarios: [operarioId], inspector: inspectorId }), actor(supervisorId));
    const a = await datosAvisoInspector(prisma, o.id, FARMA, actor(supervisorId));
    expect(a).toMatchObject({ idOrden: o.id, idCompany: FARMA, consecutivo: o.consecutivo, producto: 'PRUEBA AVISO', lote: `AV-${sufijo}`, inspectorEmail: `inspector.${sufijo}@farmalogica.com`, actorNombre: 'supervisor IT' });
    expect(avisoPorVerificar(a!)[0].emails).toEqual([`inspector.${sufijo}@farmalogica.com`]);
    expect(await datosAvisoInspector(prisma, o.id, OLP, actor(supervisorId))).toBeNull();
    // Inspector desactivado: no se le avisa.
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

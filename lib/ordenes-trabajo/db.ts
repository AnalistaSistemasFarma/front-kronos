import type { PrismaClient } from '../../app/generated/prisma';
import { OT_DIAS_CERRADAS, OT_SUBPROCESS_URLS } from './constants';
import {
  assertActividadRegistrable,
  assertPuedeRegistrar,
  OtError,
  resolveOtAccess,
  type CambioActividadInput,
  type NuevaActividadInput,
  type NuevaOrdenInput,
  type NuevoRegistroInput,
  type OtCompanyAccess,
} from './rules';

/**
 * Capa de datos de Órdenes de Trabajo. Recibe el cliente Prisma como parámetro
 * (la ruta usa el de la app; las pruebas de integración, uno contra el SQL
 * Server efímero de la CI). Toda consulta va filtrada por `id_company`.
 *
 * Integridad: no hay funciones de edición ni de borrado de órdenes o registros.
 * La hora de cada registro la pone la base (DEFAULT SYSUTCDATETIME()).
 */
export type OtDb = PrismaClient;

export interface OtActor {
  idUser: string;
  email: string;
  ip: string | null;
}

/** Acceso efectivo por empresa de la persona (solo usuarios activos). */
export async function getOtAccessForUser(db: OtDb, email: string): Promise<OtCompanyAccess[]> {
  const grants = await db.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email, isActive: true } },
      subprocess: { subprocess_url: { in: Object.values(OT_SUBPROCESS_URLS) } },
    },
    select: {
      subprocess: { select: { subprocess_url: true } },
      companyUser: { select: { company: { select: { id_company: true, company: true } } } },
    },
  });
  return resolveOtAccess(
    grants.map((g) => ({
      subprocessUrl: g.subprocess.subprocess_url,
      idCompany: g.companyUser.company.id_company,
      companyName: g.companyUser.company.company,
    }))
  );
}

/** Id del usuario de la sesión (activo), o null. */
export async function getActiveUserId(db: OtDb, email: string): Promise<string | null> {
  const u = await db.user.findFirst({ where: { email, isActive: true }, select: { id: true } });
  return u?.id ?? null;
}

async function nombresDeUsuarios(db: OtDb, ids: readonly string[]): Promise<Map<string, { name: string; email: string }>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((r) => [r.id, { name: r.name?.trim() || r.email, email: r.email }]));
}

function parseSnapshot(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------

export interface OrdenResumen {
  id: number;
  consecutivo: number;
  producto: string;
  itemCode: string | null;
  lote: string;
  turno: string;
  area: string | null;
  sapOpDocNum: number | null;
  estado: string;
  abiertaEn: string;
  abiertaPor: string;
  cerradaEn: string | null;
  registros: number;
  soyOperario: boolean;
}

/**
 * Listado (R16, P0): todas las ABIERTAS y las CERRADAS de los últimos 30 días
 * de la empresa. Un operario sin Gestión ve las órdenes de su empresa, pero
 * solo registra en las que figura (`soyOperario`).
 */
export async function listOrdenes(db: OtDb, idCompany: number, idUser: string, now: Date = new Date()): Promise<OrdenResumen[]> {
  const desde = new Date(now.getTime() - OT_DIAS_CERRADAS * 24 * 60 * 60 * 1000);
  const rows = await db.otOrdenTrabajo.findMany({
    where: {
      id_company: idCompany,
      OR: [{ estado: 'ABIERTA' }, { estado: 'CERRADA', cerrada_en: { gte: desde } }],
    },
    orderBy: [{ abierta_en: 'desc' }],
    take: 500,
    select: {
      id_orden_trabajo: true,
      consecutivo: true,
      producto: true,
      item_code: true,
      lote: true,
      turno: true,
      area: true,
      sap_op_docnum: true,
      estado: true,
      abierta_en: true,
      abierta_por: true,
      cerrada_en: true,
      operarios: { select: { id_user: true } },
      _count: { select: { registros: true } },
    },
  });
  const nombres = await nombresDeUsuarios(db, rows.map((r) => r.abierta_por));
  return rows.map((r) => ({
    id: r.id_orden_trabajo,
    consecutivo: r.consecutivo,
    producto: r.producto,
    itemCode: r.item_code,
    lote: r.lote,
    turno: r.turno,
    area: r.area,
    sapOpDocNum: r.sap_op_docnum,
    estado: r.estado,
    abiertaEn: r.abierta_en.toISOString(),
    abiertaPor: nombres.get(r.abierta_por)?.name ?? r.abierta_por,
    cerradaEn: r.cerrada_en ? r.cerrada_en.toISOString() : null,
    registros: r._count.registros,
    soyOperario: r.operarios.some((o) => o.id_user === idUser),
  }));
}

/** Usuarios activos de la empresa (candidatos a operario). */
export async function listUsuariosEmpresa(db: OtDb, idCompany: number) {
  const rows = await db.companyUser.findMany({
    where: { id_company: idCompany, user: { isActive: true } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return rows
    .map((r) => ({ id: r.user.id, name: r.user.name?.trim() || r.user.email, email: r.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Abre una orden de trabajo (R2). Consecutivo por empresa, calculado dentro de
 * la transacción con bloqueo (UPDLOCK, HOLDLOCK) para que dos supervisores a la
 * vez no choquen. Los operarios deben ser usuarios activos de la empresa.
 */
export async function crearOrden(db: OtDb, input: NuevaOrdenInput, actor: OtActor): Promise<{ id: number; consecutivo: number }> {
  const validos = await db.companyUser.findMany({
    where: { id_company: input.idCompany, id_user: { in: input.operarios }, user: { isActive: true } },
    select: { id_user: true },
  });
  const validSet = new Set(validos.map((v) => v.id_user));
  const invalidos = input.operarios.filter((id) => !validSet.has(id));
  if (invalidos.length > 0) {
    throw new OtError('Algún operario seleccionado no es un usuario activo de la empresa.', 400);
  }

  return db.$transaction(async (tx) => {
    const next = await tx.$queryRaw<Array<{ siguiente: number }>>`
      SELECT ISNULL(MAX(consecutivo), 0) + 1 AS siguiente
      FROM [dbo].[ot_orden_trabajo] WITH (UPDLOCK, HOLDLOCK)
      WHERE id_company = ${input.idCompany}`;
    const consecutivo = Number(next[0]?.siguiente ?? 1);
    const orden = await tx.otOrdenTrabajo.create({
      data: {
        id_company: input.idCompany,
        consecutivo,
        producto: input.producto,
        item_code: input.itemCode ?? input.sapOp?.ItemNo ?? null,
        lote: input.lote,
        turno: input.turno,
        area: input.area,
        sap_op_absentry: input.sapOp?.AbsoluteEntry ?? null,
        sap_op_docnum: input.sapOp?.DocumentNumber ?? null,
        sap_op_snapshot: input.sapOp ? JSON.stringify(input.sapOp) : null,
        estado: 'ABIERTA',
        abierta_por: actor.idUser,
      },
      select: { id_orden_trabajo: true, consecutivo: true },
    });
    await tx.otOrdenOperario.createMany({
      data: input.operarios.map((id_user) => ({ id_orden_trabajo: orden.id_orden_trabajo, id_user })),
    });
    return { id: orden.id_orden_trabajo, consecutivo: orden.consecutivo };
  });
}

export interface OrdenDetalle {
  id: number;
  idCompany: number;
  consecutivo: number;
  producto: string;
  itemCode: string | null;
  lote: string;
  turno: string;
  area: string | null;
  sapOp: Record<string, unknown> | null;
  sapOpDocNum: number | null;
  estado: string;
  abiertaEn: string;
  abiertaPor: string;
  cerradaEn: string | null;
  cerradaPor: string | null;
  observacionCierre: string | null;
  operarios: Array<{ id: string; name: string; email: string }>;
  registros: Array<{ id: string; actividad: string; usuario: string; registradoEn: string; observacion: string | null }>;
  puedeRegistrar: boolean;
  puedeGestionar: boolean;
}

/** Detalle de una orden de la empresa indicada, con su cronología (o null si no es de esa empresa). */
export async function getOrdenDetalle(db: OtDb, idOrden: number, access: OtCompanyAccess, idUser: string): Promise<OrdenDetalle | null> {
  const o = await db.otOrdenTrabajo.findFirst({
    where: { id_orden_trabajo: idOrden, id_company: access.idCompany },
    include: {
      operarios: { select: { id_user: true } },
      registros: { orderBy: [{ registrado_en: 'asc' }, { id_registro: 'asc' }] },
    },
  });
  if (!o) return null;
  const ids = [o.abierta_por, o.cerrada_por ?? '', ...o.operarios.map((x) => x.id_user), ...o.registros.map((r) => r.id_user)];
  const nombres = await nombresDeUsuarios(db, ids);
  const nombre = (id: string | null) => (id ? (nombres.get(id)?.name ?? id) : null);
  const operarioIds = o.operarios.map((x) => x.id_user);
  return {
    id: o.id_orden_trabajo,
    idCompany: o.id_company,
    consecutivo: o.consecutivo,
    producto: o.producto,
    itemCode: o.item_code,
    lote: o.lote,
    turno: o.turno,
    area: o.area,
    sapOp: parseSnapshot(o.sap_op_snapshot),
    sapOpDocNum: o.sap_op_docnum,
    estado: o.estado,
    abiertaEn: o.abierta_en.toISOString(),
    abiertaPor: nombre(o.abierta_por) ?? o.abierta_por,
    cerradaEn: o.cerrada_en ? o.cerrada_en.toISOString() : null,
    cerradaPor: nombre(o.cerrada_por),
    observacionCierre: o.observacion_cierre,
    operarios: operarioIds
      .map((id) => ({ id, name: nombres.get(id)?.name ?? id, email: nombres.get(id)?.email ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    registros: o.registros.map((r) => ({
      id: r.id_registro.toString(),
      actividad: r.actividad_nombre,
      usuario: nombre(r.id_user) ?? r.id_user,
      registradoEn: r.registrado_en.toISOString(),
      observacion: r.observacion,
    })),
    puedeRegistrar: o.estado === 'ABIERTA' && (access.canManage || operarioIds.includes(idUser)),
    puedeGestionar: access.canManage,
  };
}

/**
 * Crea un registro (R4, R5, R6, R8, R15). Bloquea la fila de la orden
 * (UPDLOCK) para que un cierre simultáneo no deje pasar un registro tardío.
 * La hora la pone la base: el cliente nunca la envía.
 */
export async function crearRegistro(
  db: OtDb,
  idOrden: number,
  access: OtCompanyAccess,
  input: NuevoRegistroInput,
  actor: OtActor
): Promise<{ id: string; registradoEn: string; actividad: string }> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ estado: string }>>`
      SELECT estado FROM [dbo].[ot_orden_trabajo] WITH (UPDLOCK, ROWLOCK)
      WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany}`;
    if (locked.length === 0) throw new OtError('Orden de trabajo no encontrada.', 404);
    const operarios = await tx.otOrdenOperario.findMany({ where: { id_orden_trabajo: idOrden }, select: { id_user: true } });
    assertPuedeRegistrar({ estado: locked[0].estado, operarios: operarios.map((x) => x.id_user) }, actor.idUser, access);

    const actividad = await tx.otActividad.findFirst({
      where: { id_actividad: input.idActividad, id_company: access.idCompany },
      select: { id_actividad: true, nombre: true, activo: true, exige_observacion: true },
    });
    assertActividadRegistrable(actividad, input.observacion);

    const r = await tx.otRegistro.create({
      data: {
        id_orden_trabajo: idOrden,
        id_actividad: actividad!.id_actividad,
        actividad_nombre: actividad!.nombre,
        id_user: actor.idUser,
        observacion: input.observacion,
        ip: actor.ip ? actor.ip.slice(0, 64) : null,
      },
      select: { id_registro: true, registrado_en: true, actividad_nombre: true },
    });
    return { id: r.id_registro.toString(), registradoEn: r.registrado_en.toISOString(), actividad: r.actividad_nombre };
  });
}

/**
 * Cierra la orden (R8). UPDATE condicional (solo si sigue ABIERTA): si otra
 * persona la cerró antes, responde 409. Se hace con SQL directo porque la tabla
 * tiene un trigger de UPDATE (Prisma usa OUTPUT sin INTO, que SQL Server no
 * admite en ese caso).
 */
export async function cerrarOrden(
  db: OtDb,
  idOrden: number,
  access: OtCompanyAccess,
  observacion: string | null,
  actor: OtActor
): Promise<void> {
  const existe = await db.otOrdenTrabajo.findFirst({
    where: { id_orden_trabajo: idOrden, id_company: access.idCompany },
    select: { estado: true },
  });
  if (!existe) throw new OtError('Orden de trabajo no encontrada.', 404);
  if (existe.estado !== 'ABIERTA') throw new OtError('La orden de trabajo ya está cerrada.', 409);
  const n = await db.$executeRaw`
    UPDATE [dbo].[ot_orden_trabajo]
    SET estado = N'CERRADA', cerrada_por = ${actor.idUser}, cerrada_en = SYSUTCDATETIME(), observacion_cierre = ${observacion}
    WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany} AND estado = N'ABIERTA'`;
  if (n === 0) throw new OtError('La orden de trabajo ya está cerrada.', 409);
}

// ---------------------------------------------------------------------------
// Catálogo de actividades (R7)
// ---------------------------------------------------------------------------

export async function listActividades(db: OtDb, idCompany: number, soloActivas: boolean) {
  const rows = await db.otActividad.findMany({
    where: { id_company: idCompany, ...(soloActivas ? { activo: true } : {}) },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    select: { id_actividad: true, nombre: true, exige_observacion: true, orden: true, activo: true },
  });
  return rows;
}

export async function crearActividad(db: OtDb, input: NuevaActividadInput, actor: OtActor) {
  const dup = await db.otActividad.findFirst({
    where: { id_company: input.idCompany, nombre: input.nombre },
    select: { id_actividad: true },
  });
  if (dup) throw new OtError('Ya existe una actividad con ese nombre (si está desactivada, actívela).', 409);
  return db.otActividad.create({
    data: {
      id_company: input.idCompany,
      nombre: input.nombre,
      exige_observacion: input.exigeObservacion,
      orden: input.orden,
      activo: true,
      created_by: actor.idUser,
    },
    select: { id_actividad: true, nombre: true, exige_observacion: true, orden: true, activo: true },
  });
}

export async function cambiarActividad(db: OtDb, input: CambioActividadInput) {
  const res = await db.otActividad.updateMany({
    where: { id_actividad: input.idActividad, id_company: input.idCompany },
    data: {
      ...(input.activo !== undefined ? { activo: input.activo } : {}),
      ...(input.exigeObservacion !== undefined ? { exige_observacion: input.exigeObservacion } : {}),
      ...(input.orden !== undefined ? { orden: input.orden } : {}),
    },
  });
  if (res.count === 0) throw new OtError('Actividad no encontrada.', 404);
  return db.otActividad.findFirst({
    where: { id_actividad: input.idActividad, id_company: input.idCompany },
    select: { id_actividad: true, nombre: true, exige_observacion: true, orden: true, activo: true },
  });
}

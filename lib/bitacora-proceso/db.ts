import type { PrismaClient } from '../../app/generated/prisma';
import { OT_DIAS_CERRADAS, OT_SUBPROCESS_URLS } from './constants';
import type { AvisoInspector } from './notificaciones';
import {
  assertInspectorDistinto,
  assertPuedeCerrar,
  assertPuedeVerificar,
  huellaContenido,
  OT_CONFIRMACION_VERSION,
  OT_FIRMA_AUTH_METHOD,
  OT_FIRMA_SIGNIFICADO,
  type ContenidoFirmable,
  type OtFirmaRol,
} from './firmas';
import {
  assertActividadRegistrable,
  assertOperadorDeLaOrden,
  assertPuedeRegistrar,
  OtError,
  resolveOtAccess,
  resolverArea,
  type CambioActividadInput,
  type CambioAreaInput,
  type CambioOperadorInput,
  type NuevaActividadInput,
  type NuevaAreaInput,
  type NuevaOrdenInput,
  type NuevoOperadorInput,
  type NuevoRegistroInput,
  type OtCompanyAccess,
} from './rules';

/**
 * Capa de datos de la Bitácora de Proceso (tablas ot_*). Recibe el cliente Prisma como parámetro
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
  userAgent?: string | null;
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
  /** Operarios sin usuario programados (A1). */
  operadores: number;
  /** La sesión puede registrar en ella (supervisor, bitácora con operarios programados o auxiliar del modelo anterior). */
  soyOperario: boolean;
  verificada: boolean;
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
      id_inspector: true,
      operarios: { select: { id_user: true } },
      firmas: { select: { rol: true } },
      _count: { select: { registros: true, operadores: true } },
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
    operadores: r._count.operadores,
    soyOperario: r._count.operadores > 0 || r.id_inspector === idUser || r.operarios.some((o) => o.id_user === idUser),
    verificada: r.firmas.some((f) => f.rol === 'INSPECTOR'),
  }));
}

/** Usuarios activos de la empresa (candidatos a jefe de producción). */
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
 * Supervisores de la empresa: usuarios ACTIVOS con el permiso de Gestión. Son
 * quienes pueden confirmar el cierre («Cerró») eligiendo su nombre en la tablet.
 */
export async function listSupervisoresEmpresa(db: OtDb, idCompany: number) {
  const grants = await db.subprocessUserCompany.findMany({
    where: {
      subprocess: { subprocess_url: OT_SUBPROCESS_URLS.gestion },
      companyUser: { id_company: idCompany, user: { isActive: true } },
    },
    select: { companyUser: { select: { user: { select: { id: true, name: true, email: true } } } } },
  });
  const map = new Map<string, { id: string; name: string }>();
  for (const g of grants) {
    const u = g.companyUser.user;
    map.set(u.id, { id: u.id, name: u.name?.trim() || u.email });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Operarios activos de la empresa entre los ids dados (para validar la programación). */
async function operadoresActivos(db: Pick<OtDb, 'otOperador'>, idCompany: number, ids: readonly number[]) {
  if (ids.length === 0) return [];
  return db.otOperador.findMany({ where: { id_company: idCompany, id_operador: { in: [...ids] }, activo: true }, select: { id_operador: true, nombre: true } });
}

/**
 * Abre una orden de trabajo (R2). Consecutivo por empresa, calculado dentro de
 * la transacción con bloqueo (UPDLOCK, HOLDLOCK) para que dos supervisores a la
 * vez no choquen. Los operarios (A1) deben estar ACTIVOS en el maestro de la
 * empresa; el área (A5) sale del catálogo; el jefe de producción es un usuario
 * activo de la empresa, distinto de quien abre.
 */
export async function crearOrden(db: OtDb, input: NuevaOrdenInput, actor: OtActor): Promise<{ id: number; consecutivo: number }> {
  const [jefe, ops, areas] = await Promise.all([
    db.companyUser.findFirst({ where: { id_company: input.idCompany, id_user: input.inspector, user: { isActive: true } }, select: { id_user: true } }),
    operadoresActivos(db, input.idCompany, input.operadores),
    db.otArea.findMany({ where: { id_company: input.idCompany, activo: true }, select: { id_area: true, nombre: true } }),
  ]);
  if (ops.length !== input.operadores.length) {
    throw new OtError('Algún operario seleccionado no existe o está inactivo en el maestro de la empresa.', 400);
  }
  if (!jefe) throw new OtError('El jefe de producción seleccionado no es un usuario activo de la empresa.', 400);
  const area = resolverArea(areas, input.idArea);

  assertInspectorDistinto(input.inspector, actor.idUser);
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
        area: area?.nombre ?? null,
        id_area: area?.id_area ?? null,
        sap_op_absentry: input.sapOp?.AbsoluteEntry ?? null,
        sap_op_docnum: input.sapOp?.DocumentNumber ?? null,
        sap_op_snapshot: input.sapOp ? JSON.stringify(input.sapOp) : null,
        estado: 'ABIERTA',
        abierta_por: actor.idUser,
        id_inspector: input.inspector,
      },
      select: { id_orden_trabajo: true, consecutivo: true },
    });
    await tx.otOrdenOperador.createMany({
      data: input.operadores.map((id_operador) => ({ id_orden_trabajo: orden.id_orden_trabajo, id_operador, agregado_por: actor.idUser })),
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
  /** Auxiliares CON usuario (solo bitácoras anteriores al 2026-10-14). */
  operarios: Array<{ id: string; name: string; email: string }>;
  /** Operarios SIN usuario programados (A1). */
  operadores: Array<{ id: number; nombre: string; activo: boolean }>;
  /** Jefe de producción (columna interna id_inspector). */
  inspector: { id: string; name: string } | null;
  /** `operador` = operario elegido en la tablet; `usuario` = usuario de la sesión que registró. */
  registros: Array<{ id: string; actividad: string; operador: string | null; usuario: string; registradoEn: string; observacion: string | null }>;
  firmas: FirmaVista[];
  puedeRegistrar: boolean;
  puedeGestionar: boolean;
  /** Se puede iniciar el cierre (abierta). Quien confirma elige su nombre; el servidor valida que sea supervisor. */
  puedeCerrar: boolean;
  /** Cerrada por el supervisor y falta la verificación del jefe de producción. */
  puedeVerificar: boolean;
}

/** Confirmación («Cerró» / «Verificó»). Sin imagen de firma (A4): las filas viejas la conservan en la base. */
export interface FirmaVista {
  rol: OtFirmaRol;
  significado: string;
  nombre: string;
  email: string;
  firmadoEn: string;
  contentSha256: string;
}

/** Detalle de una orden de la empresa indicada, con su cronología (o null si no es de esa empresa). */
export async function getOrdenDetalle(db: OtDb, idOrden: number, access: OtCompanyAccess, idUser: string): Promise<OrdenDetalle | null> {
  const o = await db.otOrdenTrabajo.findFirst({
    where: { id_orden_trabajo: idOrden, id_company: access.idCompany },
    include: {
      operarios: { select: { id_user: true } },
      operadores: { select: { operador: { select: { id_operador: true, nombre: true, activo: true } } } },
      registros: { orderBy: [{ registrado_en: 'asc' }, { id_registro: 'asc' }] },
      firmas: { orderBy: { id_firma: 'asc' } },
    },
  });
  if (!o) return null;
  const ids = [o.abierta_por, o.cerrada_por ?? '', o.id_inspector ?? '', ...o.operarios.map((x) => x.id_user), ...o.registros.map((r) => r.id_user)];
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
    operadores: o.operadores
      .map((x) => ({ id: x.operador.id_operador, nombre: x.operador.nombre, activo: x.operador.activo }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    inspector: o.id_inspector ? { id: o.id_inspector, name: nombres.get(o.id_inspector)?.name ?? o.id_inspector } : null,
    registros: o.registros.map((r) => ({
      id: r.id_registro.toString(),
      actividad: r.actividad_nombre,
      operador: r.operador_nombre,
      usuario: nombre(r.id_user) ?? r.id_user,
      registradoEn: r.registrado_en.toISOString(),
      observacion: r.observacion,
    })),
    firmas: o.firmas.map((f) => ({
      rol: f.rol as OtFirmaRol,
      significado: f.significado,
      nombre: f.signer_name ?? f.signer_email,
      email: f.signer_email,
      firmadoEn: f.firmado_en.toISOString(),
      contentSha256: f.content_sha256,
    })),
    puedeRegistrar:
      o.estado === 'ABIERTA' && (access.canManage || o.operadores.length > 0 || operarioIds.includes(idUser) || o.id_inspector === idUser),
    puedeGestionar: access.canManage,
    puedeCerrar: o.estado === 'ABIERTA',
    puedeVerificar: o.estado === 'CERRADA' && o.firmas.some((f) => f.rol === 'SUPERVISOR') && !o.firmas.some((f) => f.rol === 'INSPECTOR'),
  };
}

/**
 * Crea un registro (R4, R5, R6, R8; A1). Bloquea la fila de la orden
 * (UPDLOCK) para que un cierre simultáneo no deje pasar un registro tardío.
 * La hora la pone la base: el cliente nunca la envía. Guarda el OPERARIO
 * elegido (y la copia de su nombre) y, aparte, el USUARIO de la sesión.
 */
export async function crearRegistro(
  db: OtDb,
  idOrden: number,
  access: OtCompanyAccess,
  input: NuevoRegistroInput,
  actor: OtActor
): Promise<{ id: string; registradoEn: string; actividad: string; operador: string | null }> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ estado: string; id_inspector: string | null }>>`
      SELECT estado, id_inspector FROM [dbo].[ot_orden_trabajo] WITH (UPDLOCK, ROWLOCK)
      WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany}`;
    if (locked.length === 0) throw new OtError('Bitácora no encontrada.', 404);
    const [operarios, programados] = await Promise.all([
      tx.otOrdenOperario.findMany({ where: { id_orden_trabajo: idOrden }, select: { id_user: true } }),
      tx.otOrdenOperador.findMany({ where: { id_orden_trabajo: idOrden }, select: { id_operador: true } }),
    ]);
    const operadores = programados.map((x) => x.id_operador);
    assertPuedeRegistrar(
      { estado: locked[0].estado, operarios: operarios.map((x) => x.id_user), inspector: locked[0].id_inspector, operadores },
      actor.idUser,
      access
    );
    assertOperadorDeLaOrden(operadores, input.idOperador);
    let operador: { id_operador: number; nombre: string } | null = null;
    if (input.idOperador !== null) {
      operador = (await operadoresActivos(tx, access.idCompany, [input.idOperador]))[0] ?? null;
      if (!operador) throw new OtError('El operario elegido está inactivo en el maestro. Pida al supervisor que lo revise.', 403);
    }

    const actividad = await tx.otActividad.findFirst({
      where: { id_actividad: input.idActividad, id_company: access.idCompany },
      select: { id_actividad: true, nombre: true, activo: true },
    });
    assertActividadRegistrable(actividad);

    const r = await tx.otRegistro.create({
      data: {
        id_orden_trabajo: idOrden,
        id_actividad: actividad!.id_actividad,
        actividad_nombre: actividad!.nombre,
        id_user: actor.idUser,
        id_operador: operador?.id_operador ?? null,
        operador_nombre: operador?.nombre ?? null,
        observacion: input.observacion,
        ip: actor.ip ? actor.ip.slice(0, 64) : null,
      },
      select: { id_registro: true, registrado_en: true, actividad_nombre: true, operador_nombre: true },
    });
    return { id: r.id_registro.toString(), registradoEn: r.registrado_en.toISOString(), actividad: r.actividad_nombre, operador: r.operador_nombre };
  });
}

/**
 * Datos para avisar al JEFE DE PRODUCCIÓN (campana + push): su correo (usuario activo),
 * el encabezado de la bitácora y el nombre de quien hizo la acción. null si la
 * bitácora no existe en la empresa.
 */
export async function datosAvisoInspector(
  db: OtDb,
  idOrden: number,
  idCompany: number,
  actor: Pick<OtActor, 'idUser' | 'email'>
): Promise<AvisoInspector | null> {
  const o = await db.otOrdenTrabajo.findFirst({
    where: { id_orden_trabajo: idOrden, id_company: idCompany },
    select: { id_orden_trabajo: true, id_company: true, consecutivo: true, producto: true, lote: true, id_inspector: true },
  });
  if (!o) return null;
  const ids = [actor.idUser, o.id_inspector ?? ''].filter(Boolean);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, isActive: true } });
  const insp = users.find((u) => u.id === o.id_inspector && u.isActive);
  const yo = users.find((u) => u.id === actor.idUser);
  return {
    idOrden: o.id_orden_trabajo,
    idCompany: o.id_company,
    consecutivo: o.consecutivo,
    producto: o.producto,
    lote: o.lote,
    inspectorEmail: insp?.email ?? null,
    actorNombre: yo?.name?.trim() || actor.email,
    actorEmail: actor.email,
  };
}

/**
 * Persona que CONFIRMA («Cerró» / «Verificó»): la elegida en la lista y validada
 * con SU contraseña (no la sesión, que en la tablet es la cuenta compartida de
 * planta). `access` es el acceso al módulo de ESA persona en la empresa.
 */
export interface FirmaActor extends OtActor {
  nombre: string | null;
  access: OtCompanyAccess | null;
}

type Tx = Parameters<Parameters<OtDb['$transaction']>[0]>[0];

/** Contenido firmable leído DENTRO de la transacción (con la fila de la bitácora ya bloqueada). */
async function contenidoDe(tx: Tx, idOrden: number, idCompany: number) {
  const o = await tx.otOrdenTrabajo.findFirst({
    where: { id_orden_trabajo: idOrden, id_company: idCompany },
    include: {
      operarios: { select: { id_user: true } },
      operadores: { select: { id_operador: true } },
      registros: { orderBy: [{ registrado_en: 'asc' }, { id_registro: 'asc' }] },
      firmas: { select: { rol: true, id_user: true, content_sha256: true } },
    },
  });
  if (!o) throw new OtError('Bitácora no encontrada.', 404);
  const contenido: ContenidoFirmable = {
    idOrden: o.id_orden_trabajo,
    idCompany: o.id_company,
    consecutivo: o.consecutivo,
    producto: o.producto,
    itemCode: o.item_code,
    lote: o.lote,
    turno: o.turno,
    area: o.area,
    sapOpDocNum: o.sap_op_docnum,
    supervisor: o.abierta_por,
    inspector: o.id_inspector,
    abiertaEn: o.abierta_en.toISOString(),
    auxiliares: o.operarios.map((x) => x.id_user),
    operadores: o.operadores.map((x) => x.id_operador),
    registros: o.registros.map((r) => ({
      id: r.id_registro.toString(),
      actividad: r.actividad_nombre,
      usuario: r.id_user,
      operador: r.id_operador,
      registradoEn: r.registrado_en.toISOString(),
      observacion: r.observacion,
    })),
    observacionCierre: o.observacion_cierre,
  };
  return { o, contenido };
}

async function insertarFirma(tx: Tx, idOrden: number, rol: OtFirmaRol, contentSha256: string, actor: FirmaActor) {
  return tx.otFirma.create({
    data: {
      id_orden_trabajo: idOrden,
      rol,
      significado: OT_FIRMA_SIGNIFICADO[rol],
      id_user: actor.idUser,
      signer_email: actor.email,
      signer_name: actor.nombre,
      content_sha256: contentSha256,
      auth_method: OT_FIRMA_AUTH_METHOD,
      consent_version: OT_CONFIRMACION_VERSION,
      firma_png: null,
      firma_sha256: null,
      ip: actor.ip ? actor.ip.slice(0, 64) : null,
      user_agent: actor.userAgent ? actor.userAgent.slice(0, 400) : null,
    },
    select: { id_firma: true, firmado_en: true, content_sha256: true },
  });
}

/**
 * CIERRE CONFIRMADO (R8 + «Cerró» del supervisor, A4). La contraseña de QUIEN
 * CONFIRMA ya se verificó en la ruta. En una transacción: bloquea la fila,
 * valida que esa persona sea supervisor (Gestión) y no el jefe de producción,
 * calcula la huella, cierra (UPDATE condicional por SQL: la tabla tiene trigger
 * de UPDATE) e inserta la confirmación. Si cualquier paso falla, no se cierra.
 */
export async function cerrarYFirmar(
  db: OtDb,
  idOrden: number,
  access: OtCompanyAccess,
  observacion: string | null,
  actor: FirmaActor
): Promise<{ firmadoEn: string; contentSha256: string }> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ estado: string; id_inspector: string | null }>>`
      SELECT estado, id_inspector FROM [dbo].[ot_orden_trabajo] WITH (UPDLOCK, ROWLOCK)
      WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany}`;
    if (locked.length === 0) throw new OtError('Bitácora no encontrada.', 404);
    assertPuedeCerrar({ estado: locked[0].estado, inspector: locked[0].id_inspector }, actor.idUser, actor.access);
    const { contenido } = await contenidoDe(tx, idOrden, access.idCompany);
    const huella = huellaContenido({ ...contenido, observacionCierre: observacion, cerradaPor: actor.idUser });
    const n = await tx.$executeRaw`
      UPDATE [dbo].[ot_orden_trabajo]
      SET estado = N'CERRADA', cerrada_por = ${actor.idUser}, cerrada_en = SYSUTCDATETIME(), observacion_cierre = ${observacion}
      WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany} AND estado = N'ABIERTA'`;
    if (n === 0) throw new OtError('La bitácora ya está cerrada.', 409);
    const f = await insertarFirma(tx, idOrden, 'SUPERVISOR', huella, actor);
    return { firmadoEn: f.firmado_en.toISOString(), contentSha256: f.content_sha256 };
  });
}

/**
 * VERIFICACIÓN CONFIRMADA («Verificó» del jefe de producción designado), después
 * del cierre. La huella encadena la del supervisor y la hora de cierre.
 */
export async function verificarYFirmar(
  db: OtDb,
  idOrden: number,
  access: OtCompanyAccess,
  actor: FirmaActor
): Promise<{ firmadoEn: string; contentSha256: string }> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ estado: string }>>`
      SELECT estado FROM [dbo].[ot_orden_trabajo] WITH (UPDLOCK, ROWLOCK)
      WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany}`;
    if (locked.length === 0) throw new OtError('Bitácora no encontrada.', 404);
    const { o, contenido } = await contenidoDe(tx, idOrden, access.idCompany);
    assertPuedeVerificar({ estado: o.estado, inspector: o.id_inspector }, o.firmas, actor.idUser);
    const sup = o.firmas.find((f) => f.rol === 'SUPERVISOR');
    const huella = huellaContenido({
      ...contenido,
      cerradaPor: o.cerrada_por,
      cerradaEn: o.cerrada_en ? o.cerrada_en.toISOString() : null,
      firmaSupervisorSha256: sup?.content_sha256 ?? null,
    });
    const f = await insertarFirma(tx, idOrden, 'INSPECTOR', huella, actor);
    return { firmadoEn: f.firmado_en.toISOString(), contentSha256: f.content_sha256 };
  });
}

// ---------------------------------------------------------------------------
// Catálogo de actividades (R7)
// ---------------------------------------------------------------------------

export async function listActividades(db: OtDb, idCompany: number, soloActivas: boolean) {
  const rows = await db.otActividad.findMany({
    where: { id_company: idCompany, ...(soloActivas ? { activo: true } : {}) },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    select: { id_actividad: true, nombre: true, exige_observacion: true, orden: true, activo: true, icono: true },
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
      icono: input.icono,
      activo: true,
      created_by: actor.idUser,
    },
    select: { id_actividad: true, nombre: true, exige_observacion: true, orden: true, activo: true, icono: true },
  });
}

export async function cambiarActividad(db: OtDb, input: CambioActividadInput) {
  const res = await db.otActividad.updateMany({
    where: { id_actividad: input.idActividad, id_company: input.idCompany },
    data: {
      ...(input.activo !== undefined ? { activo: input.activo } : {}),
      ...(input.exigeObservacion !== undefined ? { exige_observacion: input.exigeObservacion } : {}),
      ...(input.orden !== undefined ? { orden: input.orden } : {}),
      ...(input.icono !== undefined ? { icono: input.icono } : {}),
    },
  });
  if (res.count === 0) throw new OtError('Actividad no encontrada.', 404);
  return db.otActividad.findFirst({
    where: { id_actividad: input.idActividad, id_company: input.idCompany },
    select: { id_actividad: true, nombre: true, exige_observacion: true, orden: true, activo: true, icono: true },
  });
}

// ---------------------------------------------------------------------------
// Maestro de operarios sin usuario (A1)
// ---------------------------------------------------------------------------

const OPERADOR_SELECT = { id_operador: true, nombre: true, documento: true, activo: true } as const;

export async function listOperadores(db: OtDb, idCompany: number, soloActivos: boolean) {
  return db.otOperador.findMany({
    where: { id_company: idCompany, ...(soloActivos ? { activo: true } : {}) },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    select: OPERADOR_SELECT,
  });
}

async function assertNombreOperadorLibre(db: OtDb, idCompany: number, nombre: string, salvo?: number) {
  const dup = await db.otOperador.findFirst({
    where: { id_company: idCompany, nombre, ...(salvo ? { NOT: { id_operador: salvo } } : {}) },
    select: { id_operador: true },
  });
  if (dup) throw new OtError('Ya existe un operario con ese nombre (si está inactivo, actívelo).', 409);
}

export async function crearOperador(db: OtDb, input: NuevoOperadorInput, actor: OtActor) {
  await assertNombreOperadorLibre(db, input.idCompany, input.nombre);
  return db.otOperador.create({
    data: { id_company: input.idCompany, nombre: input.nombre, documento: input.documento, activo: true, created_by: actor.idUser },
    select: OPERADOR_SELECT,
  });
}

export async function cambiarOperador(db: OtDb, input: CambioOperadorInput, actor: OtActor) {
  if (input.nombre !== undefined) await assertNombreOperadorLibre(db, input.idCompany, input.nombre, input.idOperador);
  const res = await db.otOperador.updateMany({
    where: { id_operador: input.idOperador, id_company: input.idCompany },
    data: {
      ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
      ...(input.documento !== undefined ? { documento: input.documento } : {}),
      ...(input.activo !== undefined ? { activo: input.activo } : {}),
      updated_by: actor.idUser,
      updated_at: new Date(),
    },
  });
  if (res.count === 0) throw new OtError('Operario no encontrado.', 404);
  return db.otOperador.findFirst({ where: { id_operador: input.idOperador, id_company: input.idCompany }, select: OPERADOR_SELECT });
}

/**
 * Agrega operarios a una bitácora ABIERTA (el supervisor ajusta durante el
 * turno). Solo se agregan: los ya programados se ignoran y nunca se quitan.
 */
export async function agregarOperadores(db: OtDb, idOrden: number, access: OtCompanyAccess, ids: readonly number[], actor: OtActor) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ estado: string }>>`
      SELECT estado FROM [dbo].[ot_orden_trabajo] WITH (UPDLOCK, ROWLOCK)
      WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany}`;
    if (locked.length === 0) throw new OtError('Bitácora no encontrada.', 404);
    if (locked[0].estado !== 'ABIERTA') throw new OtError('La bitácora está cerrada: ya no se pueden agregar operarios.', 409);
    const ops = await operadoresActivos(tx, access.idCompany, ids);
    if (ops.length !== ids.length) throw new OtError('Algún operario no existe o está inactivo en el maestro de la empresa.', 400);
    const ya = new Set((await tx.otOrdenOperador.findMany({ where: { id_orden_trabajo: idOrden }, select: { id_operador: true } })).map((x) => x.id_operador));
    const nuevos = ids.filter((id) => !ya.has(id));
    if (nuevos.length > 0) {
      await tx.otOrdenOperador.createMany({ data: nuevos.map((id_operador) => ({ id_orden_trabajo: idOrden, id_operador, agregado_por: actor.idUser })) });
    }
    return { agregados: nuevos.length };
  });
}

// ---------------------------------------------------------------------------
// Catálogo de áreas (A5)
// ---------------------------------------------------------------------------

const AREA_SELECT = { id_area: true, nombre: true, orden: true, activo: true } as const;

export async function listAreas(db: OtDb, idCompany: number, soloActivas: boolean) {
  return db.otArea.findMany({
    where: { id_company: idCompany, ...(soloActivas ? { activo: true } : {}) },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    select: AREA_SELECT,
  });
}

export async function crearArea(db: OtDb, input: NuevaAreaInput, actor: OtActor) {
  const dup = await db.otArea.findFirst({ where: { id_company: input.idCompany, nombre: input.nombre }, select: { id_area: true } });
  if (dup) throw new OtError('Ya existe un área con ese nombre (si está inactiva, actívela).', 409);
  return db.otArea.create({
    data: { id_company: input.idCompany, nombre: input.nombre, orden: input.orden, activo: true, created_by: actor.idUser },
    select: AREA_SELECT,
  });
}

export async function cambiarArea(db: OtDb, input: CambioAreaInput) {
  const res = await db.otArea.updateMany({
    where: { id_area: input.idArea, id_company: input.idCompany },
    data: { ...(input.activo !== undefined ? { activo: input.activo } : {}), ...(input.orden !== undefined ? { orden: input.orden } : {}) },
  });
  if (res.count === 0) throw new OtError('Área no encontrada.', 404);
  return db.otArea.findFirst({ where: { id_area: input.idArea, id_company: input.idCompany }, select: AREA_SELECT });
}

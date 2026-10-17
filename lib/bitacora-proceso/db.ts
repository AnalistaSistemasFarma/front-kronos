import type { PrismaClient } from '../../app/generated/prisma';
import { isOtResponsableRol, OT_DIAS_CERRADAS, OT_SUBPROCESS_URLS, type OtResponsableRol } from './constants';
import type { AvisoBitacora } from './notificaciones';
import {
  assertActoresDistintos,
  assertPuedeConfirmar,
  esCierreDelJefe,
  huellaContenido,
  OT_CONFIRMACION_VERSION,
  OT_FIRMA_SIGNIFICADO,
  OT_VISTOS_BUENOS,
  significadoCierre,
  rolVisible,
  siguienteVistoBueno,
  vistosCompletos,
  vistosDados,
  vistosRequeridos,
  type ContenidoFirmable,
  type OtFirmaRol,
  type OtMetodoConfirmacion,
} from './firmas';
import { assertPinUsable, compararPin, hashPin, mensajePinIncorrecto } from './pin';
import {
  assertActividadRegistrable,
  assertOperadorDeLaOrden,
  assertPuedeSerResponsable,
  assertPuedeRegistrar,
  motivoSinRol,
  OtError,
  resolveOtAccess,
  resolverArea,
  type CambioActividadInput,
  type CambioAreaInput,
  type CambioOperadorInput,
  type CambioResponsableInput,
  type ImportarOperadoresInput,
  type NuevaActividadInput,
  type NuevaAreaInput,
  type NuevaOrdenInput,
  type NuevoOperadorInput,
  type NuevoResponsableInput,
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
  /** Cerrada y con todos los vistos buenos que le corresponden (B2). */
  verificada: boolean;
  /** Siguiente visto bueno pendiente (null si están todos). */
  pendiente: OtFirmaRol | null;
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
      id_jefe_produccion: true,
      operarios: { select: { id_user: true } },
      operadores: { select: { id_operador: true } },
      firmas: { select: { rol: true, significado: true, id_user: true } },
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
    soyOperario: r._count.operadores > 0 || r.id_inspector === idUser || r.id_jefe_produccion === idUser || r.operarios.some((o) => o.id_user === idUser),
    ...(() => {
      const actores = { estado: r.estado, inspector: r.id_inspector, jefe: r.id_jefe_produccion, operadores: r.operadores.map((x) => x.id_operador) };
      return { verificada: vistosCompletos(actores, r.firmas), pendiente: siguienteVistoBueno(actores, r.firmas) };
    })(),
  }));
}

/** Usuarios activos de la empresa (candidatos a inspector y a jefe de producción). */
export async function listUsuariosEmpresa(db: OtDb, idCompany: number) {
  const rows = await db.companyUser.findMany({
    where: { id_company: idCompany, user: { isActive: true } },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return rows
    .map((r) => ({ id: r.user.id, name: r.user.name?.trim() || r.user.email, email: r.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// ---------------------------------------------------------------------------
// Responsables por empresa (2026-10-16): supervisor, inspector y jefe de producción
// ---------------------------------------------------------------------------

/**
 * Acceso al módulo (Bitácora de Proceso y Gestión) de varias personas en UNA empresa,
 * solo usuarios activos. Mapa user.id → acceso; quien no tenga el módulo no aparece.
 */
async function accesoModuloEnEmpresa(db: Pick<OtDb, 'subprocessUserCompany'>, idCompany: number, ids: readonly string[]) {
  const out = new Map<string, OtCompanyAccess>();
  if (ids.length === 0) return out;
  const grants = await db.subprocessUserCompany.findMany({
    where: {
      subprocess: { subprocess_url: { in: Object.values(OT_SUBPROCESS_URLS) } },
      companyUser: { id_company: idCompany, id_user: { in: [...new Set(ids)] }, user: { isActive: true } },
    },
    select: {
      subprocess: { select: { subprocess_url: true } },
      companyUser: { select: { id_user: true, company: { select: { id_company: true, company: true } } } },
    },
  });
  const porUsuario = new Map<string, { subprocessUrl: string | null; idCompany: number; companyName: string }[]>();
  for (const g of grants) {
    const list = porUsuario.get(g.companyUser.id_user) ?? [];
    list.push({ subprocessUrl: g.subprocess.subprocess_url, idCompany: g.companyUser.company.id_company, companyName: g.companyUser.company.company });
    porUsuario.set(g.companyUser.id_user, list);
  }
  for (const [id, rows] of porUsuario) {
    const a = resolveOtAccess(rows)[0];
    if (a) out.set(id, a);
  }
  return out;
}

/**
 * Personas que HOY pueden actuar con el rol en la empresa: asignadas y activas en
 * `ot_responsable`, usuario activo y con el módulo en la empresa (el supervisor, además,
 * con Gestión). Es la lista de cada selector; nada más sale en ellos.
 */
export async function listResponsables(db: OtDb, idCompany: number, rol: OtResponsableRol): Promise<Array<{ id: string; name: string; email: string }>> {
  const asignados = await db.otResponsable.findMany({ where: { id_company: idCompany, rol, activo: true }, select: { id_user: true } });
  const ids = asignados.map((a) => a.id_user);
  if (ids.length === 0) return [];
  const [acceso, nombres] = await Promise.all([accesoModuloEnEmpresa(db, idCompany, ids), nombresDeUsuarios(db, ids)]);
  return ids
    .filter((id) => {
      const a = acceso.get(id);
      return Boolean(a && a.canOperate && (rol !== 'SUPERVISOR' || a.canManage));
    })
    .map((id) => ({ id, name: nombres.get(id)?.name ?? id, email: nombres.get(id)?.email ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** ¿La persona puede actuar HOY con ese rol en la empresa? (misma regla que el selector). */
export async function tieneRolResponsable(db: OtDb, idCompany: number, idUser: string, rol: OtResponsableRol): Promise<boolean> {
  const fila = await db.otResponsable.findFirst({ where: { id_company: idCompany, id_user: idUser, rol, activo: true }, select: { id_responsable: true } });
  if (!fila) return false;
  const a = (await accesoModuloEnEmpresa(db, idCompany, [idUser])).get(idUser);
  return Boolean(a && a.canOperate && (rol !== 'SUPERVISOR' || a.canManage));
}

/**
 * Motivo EXACTO por el que la persona no puede actuar HOY con el rol en la empresa
 * (null = sí puede; misma regla que tieneRolResponsable). Para los mensajes de error.
 */
export async function motivoSinRolPersona(db: OtDb, idCompany: number, idUser: string, rol: OtResponsableRol): Promise<string | null> {
  const [fila, acceso, nombres, empresa] = await Promise.all([
    db.otResponsable.findFirst({ where: { id_company: idCompany, id_user: idUser, rol }, select: { activo: true } }),
    accesoModuloEnEmpresa(db, idCompany, [idUser]),
    nombresDeUsuarios(db, [idUser]),
    db.company.findFirst({ where: { id_company: idCompany }, select: { company: true } }),
  ]);
  return motivoSinRol(rol, {
    nombre: nombres.get(idUser)?.name ?? 'La persona elegida',
    empresa: empresa?.company?.trim() || 'esta empresa',
    asignado: fila ? fila.activo : null,
    access: acceso.get(idUser) ?? null,
  });
}

/**
 * ¿Puede ABRIR una bitácora en la empresa? (R3, 2026-10-17: abren el supervisor o el jefe).
 *   - con «Bitácora de Proceso: Gestión» (supervisor), como hasta ahora;
 *   - o, sin Gestión, si está asignado y activo como JEFE DE PRODUCCIÓN en la empresa. Ese
 *     acceso es SOLO para abrir (no administra el catálogo) y la bitácora que abre queda
 *     con él mismo como jefe de producción (ver crearOrden).
 */
export async function puedeAbrirComoJefe(db: OtDb, access: OtCompanyAccess, idUser: string): Promise<boolean> {
  if (!access.canOperate) return false;
  return tieneRolResponsable(db, access.idCompany, idUser, 'JEFE_PROD');
}

/** Empresas (ids) donde la persona es hoy jefe de producción asignado y activo. */
export async function empresasComoJefe(db: OtDb, idUser: string): Promise<Set<number>> {
  const filas = await db.otResponsable.findMany({ where: { id_user: idUser, rol: 'JEFE_PROD', activo: true }, select: { id_company: true } });
  return new Set(filas.map((f) => f.id_company));
}

/**
 * Supervisores de la empresa: quienes pueden confirmar el cierre («Cerró») eligiendo su
 * nombre en la tablet. Desde el 2026-10-16 son SOLO los asignados como SUPERVISOR en
 * Catálogo → Responsables (antes: todo usuario con Gestión, incluida la cuenta de planta).
 */
export async function listSupervisoresEmpresa(db: OtDb, idCompany: number) {
  return (await listResponsables(db, idCompany, 'SUPERVISOR')).map(({ id, name }) => ({ id, name }));
}

export interface ResponsableVista {
  idResponsable: number;
  idUser: string;
  rol: OtResponsableRol;
  activo: boolean;
  name: string;
  email: string;
  /** Usuario activo con el permiso que el rol exige (si no, no sale en el selector). */
  habilitado: boolean;
}

/** Catálogo → Responsables: todas las asignaciones de la empresa (activas e inactivas). */
export async function listResponsablesEmpresa(db: OtDb, idCompany: number): Promise<ResponsableVista[]> {
  const filas = await db.otResponsable.findMany({
    where: { id_company: idCompany },
    select: { id_responsable: true, id_user: true, rol: true, activo: true },
  });
  const ids = filas.map((f) => f.id_user);
  const [acceso, nombres] = await Promise.all([accesoModuloEnEmpresa(db, idCompany, ids), nombresDeUsuarios(db, ids)]);
  return filas
    .filter((f): f is typeof f & { rol: OtResponsableRol } => isOtResponsableRol(f.rol))
    .map((f) => {
      const a = acceso.get(f.id_user);
      return {
        idResponsable: f.id_responsable,
        idUser: f.id_user,
        rol: f.rol,
        activo: f.activo,
        name: nombres.get(f.id_user)?.name ?? f.id_user,
        email: nombres.get(f.id_user)?.email ?? '',
        habilitado: Boolean(a && a.canOperate && (f.rol !== 'SUPERVISOR' || a.canManage)),
      };
    })
    .sort((x, y) => Number(y.activo) - Number(x.activo) || x.name.localeCompare(y.name, 'es'));
}

/**
 * Personas que se pueden ASIGNAR (Catálogo → Responsables): usuarios activos con el módulo
 * en la empresa, con la marca de Gestión (requisito del supervisor).
 */
export async function listCandidatosResponsable(db: OtDb, idCompany: number) {
  const usuarios = await listUsuariosEmpresa(db, idCompany);
  const acceso = await accesoModuloEnEmpresa(db, idCompany, usuarios.map((u) => u.id));
  return usuarios.filter((u) => acceso.get(u.id)?.canOperate).map((u) => ({ ...u, gestion: Boolean(acceso.get(u.id)?.canManage) }));
}

/** Asigna (o reactiva) el rol a la persona en la empresa. Idempotente. */
export async function asignarResponsable(db: OtDb, input: NuevoResponsableInput, actor: OtActor) {
  const persona = await personaActivaEmpresa(db, input.idUser, input.idCompany);
  if (!persona) throw new OtError('La persona no es un usuario activo de la empresa.', 400);
  const nombre = persona.name?.trim() || persona.email;
  assertPuedeSerResponsable(input.rol, (await accesoModuloEnEmpresa(db, input.idCompany, [input.idUser])).get(input.idUser) ?? null, nombre);
  const ahora = new Date();
  const fila = await db.otResponsable.upsert({
    where: { id_company_id_user_rol: { id_company: input.idCompany, id_user: input.idUser, rol: input.rol } },
    create: { id_company: input.idCompany, id_user: input.idUser, rol: input.rol, activo: true, created_by: actor.idUser },
    update: { activo: true, updated_by: actor.idUser, updated_at: ahora },
    select: { id_responsable: true },
  });
  return { idResponsable: fila.id_responsable, nombre };
}

/** Activa o desactiva una asignación de la empresa (no se borran). */
export async function cambiarResponsable(db: OtDb, input: CambioResponsableInput, actor: OtActor) {
  const res = await db.otResponsable.updateMany({
    where: { id_responsable: input.idResponsable, id_company: input.idCompany },
    data: { activo: input.activo, updated_by: actor.idUser, updated_at: new Date() },
  });
  if (res.count === 0) throw new OtError('Responsable no encontrado.', 404);
  return { ok: true };
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
 * empresa; el área (A5) sale del catálogo; el inspector y el jefe de producción deben
 * estar ASIGNADOS a ese rol en la empresa (ot_responsable); el inspector, distinto de quien
 * abre y del jefe. Quien abre SÍ puede ser el jefe (R3, 2026-10-17); si abre como jefe (sin
 * Gestión), solo puede abrir bitácoras de las que él mismo es el jefe.
 */
export async function crearOrden(
  db: OtDb,
  input: NuevaOrdenInput,
  actor: OtActor,
  /** 'GESTION' = abre con el permiso de Gestión; 'JEFE_PROD' = abre como jefe asignado (R3). */
  abreComo: 'GESTION' | 'JEFE_PROD' = 'GESTION'
): Promise<{ id: number; consecutivo: number }> {
  // Quien abre sin Gestión (como jefe) solo abre bitácoras de las que él mismo es el jefe.
  if (abreComo === 'JEFE_PROD' && input.jefeProduccion !== actor.idUser) {
    throw new OtError('Usted abre como jefe de producción (sin el permiso de Gestión): elíjase a sí mismo como jefe de producción de esta bitácora.', 403);
  }
  // Inspector y jefe: SOLO personas asignadas a ese rol en la empresa (2026-10-16).
  const [insp, jefe, ops, areas] = await Promise.all([
    motivoSinRolPersona(db, input.idCompany, input.inspector, 'INSPECTOR'),
    motivoSinRolPersona(db, input.idCompany, input.jefeProduccion, 'JEFE_PROD'),
    operadoresActivos(db, input.idCompany, input.operadores),
    db.otArea.findMany({ where: { id_company: input.idCompany, activo: true }, select: { id_area: true, nombre: true } }),
  ]);
  if (ops.length !== input.operadores.length) {
    throw new OtError('Algún operario seleccionado no existe o está inactivo en el maestro de la empresa.', 400);
  }
  assertActoresDistintos({ abre: actor.idUser, inspector: input.inspector, jefe: input.jefeProduccion });
  if (insp) throw new OtError(insp, 400);
  if (jefe) throw new OtError(jefe, 400);
  const area = resolverArea(areas, input.idArea);

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
        id_jefe_produccion: input.jefeProduccion,
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
  /** Inspector (B1, 2026-10-15). Las bitácoras del #617 no lo tienen. */
  inspector: { id: string; name: string } | null;
  /** Jefe de producción (B1; columna id_jefe_produccion). */
  jefe: { id: string; name: string } | null;
  /** `operador` = operario elegido en la tablet; `usuario` = usuario de la sesión que registró. */
  registros: Array<{ id: string; actividad: string; operador: string | null; usuario: string; registradoEn: string; observacion: string | null }>;
  /** Vistos buenos dados (rol VISIBLE: las filas viejas «Verificó» salen como JEFE_PROD). */
  firmas: FirmaVista[];
  /** Los cuatro vistos buenos en orden, con su estado (B2). */
  vistos: VistoBuenoVista[];
  /** Siguiente visto bueno pendiente (null si están todos). */
  siguiente: OtFirmaRol | null;
  /** Cerrada y con todos los vistos buenos que le corresponden. */
  completa: boolean;
  /** user.id de la SESIÓN (para saber si quien confirma está en su propia sesión). */
  idUsuarioSesion: string;
  puedeRegistrar: boolean;
  puedeGestionar: boolean;
  /** Se puede iniciar el cierre (abierta). Quien confirma elige su nombre; el servidor valida que sea supervisor. */
  puedeCerrar: boolean;
  /** Cerrada y falta algún visto bueno posterior (inspector o jefe). */
  puedeVerificar: boolean;
  /** Abierta, con operarios programados y sin el visto bueno (opcional) del operario. */
  puedeVistoOperario: boolean;
}

/** Visto bueno dado (sin imagen de firma, huella visible ni IP en pantalla). */
export interface FirmaVista {
  rol: OtFirmaRol;
  significado: string;
  nombre: string;
  email: string;
  firmadoEn: string;
  contentSha256: string;
  /** sesion_propia | pin_tablet | operario_tablet | contrasena_synerlink (modelo anterior). */
  metodo: string;
}

export interface VistoBuenoVista {
  rol: OtFirmaRol;
  /** dado | pendiente | opcional (operario, R4) | no_aplica (p. ej. sin inspector en bitácoras del #617). */
  estado: 'dado' | 'pendiente' | 'opcional' | 'no_aplica';
  /** Aclaración visible (p. ej. «Cerró la bitácora: su cierre cuenta como su visto bueno»). */
  nota: string | null;
  /** Persona designada (inspector o jefe) cuando está pendiente. */
  designado: string | null;
  firma: FirmaVista | null;
}

function firmaVista(f: { rol: string; significado: string; signer_name: string | null; signer_email: string; firmado_en: Date; content_sha256: string; auth_method: string }): FirmaVista | null {
  const rol = rolVisible(f);
  if (!rol) return null;
  return {
    rol,
    significado: f.significado,
    nombre: f.signer_name ?? f.signer_email,
    email: f.signer_email,
    firmadoEn: f.firmado_en.toISOString(),
    contentSha256: f.content_sha256,
    metodo: f.auth_method,
  };
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
  const ids = [o.abierta_por, o.cerrada_por ?? '', o.id_inspector ?? '', o.id_jefe_produccion ?? '', ...o.operarios.map((x) => x.id_user), ...o.registros.map((r) => r.id_user)];
  const nombres = await nombresDeUsuarios(db, ids);
  const nombre = (id: string | null) => (id ? (nombres.get(id)?.name ?? id) : null);
  const persona = (id: string | null) => (id ? { id, name: nombres.get(id)?.name ?? id } : null);
  const operarioIds = o.operarios.map((x) => x.id_user);
  const actores = { estado: o.estado, inspector: o.id_inspector, jefe: o.id_jefe_produccion, operadores: o.operadores.map((x) => x.operador.id_operador) };
  const firmas = o.firmas.map(firmaVista).filter((f): f is FirmaVista => f !== null);
  const dados = vistosDados(o.firmas);
  const requeridos = vistosRequeridos(actores, o.firmas);
  const siguiente = siguienteVistoBueno(actores, o.firmas);
  const cerroElJefe = esCierreDelJefe(dados.SUPERVISOR);
  const vistos: VistoBuenoVista[] = OT_VISTOS_BUENOS.map((rol) => {
    const f = dados[rol];
    const designado = rol === 'INSPECTOR' ? nombre(o.id_inspector) : rol === 'JEFE_PROD' ? nombre(o.id_jefe_produccion) : null;
    if (f) return { rol, estado: 'dado', designado, firma: firmaVista(f), nota: null };
    if (rol === 'JEFE_PROD' && cerroElJefe) return { rol, estado: 'no_aplica', designado, firma: null, nota: 'Cerró la bitácora: su cierre cuenta como su visto bueno' };
    // R4: el del operario es opcional (se puede dar mientras está abierta; no frena el cierre).
    if (rol === 'OPERARIO' && actores.operadores.length > 0) return { rol, estado: 'opcional', designado, firma: null, nota: o.estado === 'ABIERTA' ? 'Opcional' : 'No se dio (opcional)' };
    return { rol, estado: requeridos.includes(rol) ? 'pendiente' : 'no_aplica', designado, firma: null, nota: null };
  });
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
    inspector: persona(o.id_inspector),
    jefe: persona(o.id_jefe_produccion),
    registros: o.registros.map((r) => ({
      id: r.id_registro.toString(),
      actividad: r.actividad_nombre,
      operador: r.operador_nombre,
      usuario: nombre(r.id_user) ?? r.id_user,
      registradoEn: r.registrado_en.toISOString(),
      observacion: r.observacion,
    })),
    firmas,
    vistos,
    siguiente,
    completa: o.estado === 'CERRADA' && siguiente === null,
    idUsuarioSesion: idUser,
    puedeRegistrar:
      o.estado === 'ABIERTA' &&
      (access.canManage || o.operadores.length > 0 || operarioIds.includes(idUser) || o.id_inspector === idUser || o.id_jefe_produccion === idUser),
    puedeGestionar: access.canManage,
    puedeCerrar: o.estado === 'ABIERTA',
    puedeVerificar: o.estado === 'CERRADA' && siguiente !== null,
    puedeVistoOperario: o.estado === 'ABIERTA' && actores.operadores.length > 0 && !dados.OPERARIO,
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
    const locked = await tx.$queryRaw<Array<{ estado: string; id_inspector: string | null; id_jefe_produccion: string | null }>>`
      SELECT estado, id_inspector, id_jefe_produccion FROM [dbo].[ot_orden_trabajo] WITH (UPDLOCK, ROWLOCK)
      WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany}`;
    if (locked.length === 0) throw new OtError('Bitácora no encontrada.', 404);
    const [operarios, programados] = await Promise.all([
      tx.otOrdenOperario.findMany({ where: { id_orden_trabajo: idOrden }, select: { id_user: true } }),
      tx.otOrdenOperador.findMany({ where: { id_orden_trabajo: idOrden }, select: { id_operador: true } }),
    ]);
    const operadores = programados.map((x) => x.id_operador);
    assertPuedeRegistrar(
      { estado: locked[0].estado, operarios: operarios.map((x) => x.id_user), inspector: locked[0].id_inspector, jefe: locked[0].id_jefe_produccion, operadores },
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
 * Datos para los AVISOS (campana + push) al inspector y al jefe de producción: sus
 * correos (usuarios activos), el encabezado de la bitácora y el nombre de quien hizo
 * la acción. null si la bitácora no existe en la empresa.
 */
export async function datosAviso(
  db: OtDb,
  idOrden: number,
  idCompany: number,
  actor: Pick<OtActor, 'idUser' | 'email'> & { nombre?: string | null }
): Promise<AvisoBitacora | null> {
  const o = await db.otOrdenTrabajo.findFirst({
    where: { id_orden_trabajo: idOrden, id_company: idCompany },
    select: { id_orden_trabajo: true, id_company: true, consecutivo: true, producto: true, lote: true, id_inspector: true, id_jefe_produccion: true },
  });
  if (!o) return null;
  const ids = [actor.idUser, o.id_inspector ?? '', o.id_jefe_produccion ?? ''].filter(Boolean);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, isActive: true } });
  const activo = (id: string | null) => users.find((u) => u.id === id && u.isActive)?.email ?? null;
  const yo = users.find((u) => u.id === actor.idUser);
  return {
    idOrden: o.id_orden_trabajo,
    idCompany: o.id_company,
    consecutivo: o.consecutivo,
    producto: o.producto,
    lote: o.lote,
    inspectorEmail: activo(o.id_inspector),
    jefeEmail: activo(o.id_jefe_produccion),
    actorNombre: actor.nombre?.trim() || yo?.name?.trim() || actor.email,
    actorEmail: actor.email,
  };
}

/**
 * Quien da el visto bueno (B2/B3), ya validado en la ruta: la persona elegida (con su
 * sesión propia o su PIN) o el operario elegido en la tablet. `access` es el acceso al
 * módulo de ESA persona (null para el operario). La sesión se guarda aparte.
 */
export interface ConfirmanteActor {
  rol: OtFirmaRol;
  /** user.id de la persona (null para el operario). */
  idUser: string | null;
  idOperador: number | null;
  email: string;
  nombre: string | null;
  access: OtCompanyAccess | null;
  metodo: OtMetodoConfirmacion;
  /** Usuario y correo de la SESIÓN desde la que se confirmó. */
  sesion: { idUser: string; email: string };
  ip: string | null;
  userAgent: string | null;
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
      firmas: { select: { rol: true, significado: true, id_user: true, id_operador: true, content_sha256: true }, orderBy: { id_firma: 'asc' } },
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
    jefeProduccion: o.id_jefe_produccion,
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
    cerradaPor: o.cerrada_por,
    cerradaEn: o.cerrada_en ? o.cerrada_en.toISOString() : null,
    vistosPrevios: o.firmas.map((f) => ({ rol: rolVisible(f) ?? f.rol, sha256: f.content_sha256 })),
  };
  return { o, contenido };
}

/**
 * VISTO BUENO (B2). En una transacción: bloquea la fila, aplica el orden y la
 * designación (assertPuedeConfirmar), calcula la huella (encadena los vistos
 * anteriores) e inserta la evidencia en ot_firma. El del SUPERVISOR además CIERRA la
 * bitácora («Cerró»): UPDATE condicional por SQL (la tabla tiene trigger de UPDATE).
 * Si cualquier paso falla, no queda nada.
 */
export async function confirmarVistoBueno(
  db: OtDb,
  idOrden: number,
  access: OtCompanyAccess,
  observacion: string | null,
  c: ConfirmanteActor
): Promise<{ rol: OtFirmaRol; firmadoEn: string; contentSha256: string; nombre: string; siguiente: OtFirmaRol | null }> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ estado: string }>>`
      SELECT estado FROM [dbo].[ot_orden_trabajo] WITH (UPDLOCK, ROWLOCK)
      WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany}`;
    if (locked.length === 0) throw new OtError('Bitácora no encontrada.', 404);
    const { o, contenido } = await contenidoDe(tx, idOrden, access.idCompany);
    const actores = { estado: o.estado, inspector: o.id_inspector, jefe: o.id_jefe_produccion, operadores: o.operadores.map((x) => x.id_operador) };
    const cierreComo = assertPuedeConfirmar(actores, o.firmas, { rol: c.rol, idUser: c.idUser, idOperador: c.idOperador, access: c.access });
    // Cierra SOLO un supervisor asignado en la empresa (2026-10-16), no cualquiera con Gestión;
    // o el jefe de producción DESIGNADO en la bitácora, si sigue asignado como jefe (R3, 2026-10-17).
    if (c.rol === 'SUPERVISOR' && cierreComo && c.idUser) {
      const motivo = await motivoSinRolPersona(tx as OtDb, access.idCompany, c.idUser, cierreComo);
      if (motivo) throw new OtError(motivo, 403);
    }

    let nombre = c.nombre ?? c.email;
    if (c.rol === 'OPERARIO') {
      const op = (await operadoresActivos(tx, access.idCompany, [c.idOperador ?? 0]))[0];
      if (!op) throw new OtError('El operario elegido está inactivo en el maestro. Pida al supervisor que lo revise.', 403);
      nombre = op.nombre;
    }

    // Traza de con qué rol se cerró: «Cerró» (supervisor) o «Cerró (jefe)».
    const significado = c.rol === 'SUPERVISOR' ? significadoCierre(cierreComo ?? 'SUPERVISOR') : OT_FIRMA_SIGNIFICADO[c.rol];
    let huella: string;
    if (c.rol === 'SUPERVISOR') {
      huella = huellaContenido({ ...contenido, observacionCierre: observacion, cerradaPor: c.idUser, cerradaEn: null, cierreComo });
      const n = await tx.$executeRaw`
        UPDATE [dbo].[ot_orden_trabajo]
        SET estado = N'CERRADA', cerrada_por = ${c.idUser}, cerrada_en = SYSUTCDATETIME(), observacion_cierre = ${observacion}
        WHERE id_orden_trabajo = ${idOrden} AND id_company = ${access.idCompany} AND estado = N'ABIERTA'`;
      if (n === 0) throw new OtError('La bitácora ya está cerrada.', 409);
    } else {
      huella = huellaContenido(contenido);
    }

    const f = await tx.otFirma.create({
      data: {
        id_orden_trabajo: idOrden,
        rol: c.rol,
        significado,
        // El operario no tiene usuario: id_user = la sesión desde la que tocó su nombre.
        id_user: c.idUser ?? c.sesion.idUser,
        signer_email: c.email,
        signer_name: nombre,
        content_sha256: huella,
        auth_method: c.metodo,
        consent_version: OT_CONFIRMACION_VERSION,
        firma_png: null,
        firma_sha256: null,
        id_operador: c.rol === 'OPERARIO' ? c.idOperador : null,
        id_user_sesion: c.sesion.idUser,
        ip: c.ip ? c.ip.slice(0, 64) : null,
        user_agent: c.userAgent ? c.userAgent.slice(0, 400) : null,
      },
      select: { firmado_en: true, content_sha256: true },
    });
    const despues = [...o.firmas, { rol: c.rol, significado, id_user: c.idUser ?? c.sesion.idUser }];
    const estado = c.rol === 'SUPERVISOR' ? 'CERRADA' : o.estado;
    return {
      rol: c.rol,
      firmadoEn: f.firmado_en.toISOString(),
      contentSha256: f.content_sha256,
      nombre,
      siguiente: siguienteVistoBueno({ ...actores, estado }, despues),
    };
  });
}

// ---------------------------------------------------------------------------
// PIN personal de la bitácora (B3)
// ---------------------------------------------------------------------------

export const OT_PIN_AUDIT = {
  configurado: 'BITACORA_PIN_CONFIGURADO',
  restablecido: 'BITACORA_PIN_RESTABLECIDO',
  bloqueado: 'BITACORA_PIN_BLOQUEADO',
} as const;

/** Estado del PIN de una persona (nunca el hash). */
export async function estadoPin(db: OtDb, idUser: string): Promise<{ configurado: boolean; bloqueado: boolean; intentosFallidos: number }> {
  const f = await db.otPin.findUnique({ where: { id_user: idUser }, select: { pin_hash: true, bloqueado: true, intentos_fallidos: true } });
  return { configurado: Boolean(f?.pin_hash), bloqueado: Boolean(f?.bloqueado), intentosFallidos: f?.intentos_fallidos ?? 0 };
}

/** La persona configura (o cambia) SU PIN desde su sesión: queda desbloqueado y con 0 intentos. */
export async function configurarPin(db: OtDb, idUser: string, pin: string, por: { email: string; ip: string | null }): Promise<void> {
  const pin_hash = await hashPin(pin);
  const ahora = new Date();
  await db.$transaction([
    db.otPin.upsert({
      where: { id_user: idUser },
      create: { id_user: idUser, pin_hash, intentos_fallidos: 0, bloqueado: false, configurado_en: ahora },
      update: { pin_hash, intentos_fallidos: 0, bloqueado: false, ultimo_fallo_en: null, configurado_en: ahora, updated_at: ahora },
    }),
    db.userAuditLog.create({ data: { user_id: idUser, action: OT_PIN_AUDIT.configurado, performed_by: por.email, details: JSON.stringify({ origen: 'bitacora-proceso', ip: por.ip }) } }),
  ]);
}

/**
 * Valida el PIN de la persona (B3). Lleva el contador en la base: un acierto lo pone en
 * 0; cada fallo suma y al quinto queda BLOQUEADO (y se audita).
 */
export async function verificarPinPersona(db: OtDb, idUser: string, pin: string, nombre: string, sesionEmail: string): Promise<void> {
  const fila = await db.otPin.findUnique({ where: { id_user: idUser }, select: { pin_hash: true, intentos_fallidos: true, bloqueado: true } });
  assertPinUsable(fila, nombre);
  const r = await compararPin(fila, pin);
  if (r.ok) {
    if (fila.intentos_fallidos > 0) await db.otPin.update({ where: { id_user: idUser }, data: { intentos_fallidos: 0, updated_at: new Date() } });
    return;
  }
  const ahora = new Date();
  await db.otPin.update({ where: { id_user: idUser }, data: { intentos_fallidos: { increment: 1 }, bloqueado: r.bloquear, ultimo_fallo_en: ahora, updated_at: ahora } });
  if (r.bloquear) {
    await db.userAuditLog.create({ data: { user_id: idUser, action: OT_PIN_AUDIT.bloqueado, performed_by: sesionEmail, details: JSON.stringify({ origen: 'bitacora-proceso', intentos: r.intentos }) } });
  }
  throw mensajePinIncorrecto(r);
}

/**
 * Un supervisor (Gestión en la empresa) o un administrador RESTABLECE el PIN de una
 * persona de la empresa: lo borra y lo desbloquea. Nadie fija el PIN de otro: la persona
 * lo vuelve a configurar desde su sesión.
 */
export async function restablecerPin(db: OtDb, idCompany: number, idUser: string, por: { idUser: string; email: string }): Promise<void> {
  const cu = await db.companyUser.findFirst({ where: { id_company: idCompany, id_user: idUser }, select: { id_user: true } });
  if (!cu) throw new OtError('La persona no pertenece a esta empresa.', 404);
  const ahora = new Date();
  await db.$transaction([
    db.otPin.upsert({
      where: { id_user: idUser },
      create: { id_user: idUser, pin_hash: null, intentos_fallidos: 0, bloqueado: false, restablecido_por: por.idUser, restablecido_en: ahora },
      update: { pin_hash: null, intentos_fallidos: 0, bloqueado: false, ultimo_fallo_en: null, restablecido_por: por.idUser, restablecido_en: ahora, updated_at: ahora },
    }),
    db.userAuditLog.create({ data: { user_id: idUser, action: OT_PIN_AUDIT.restablecido, performed_by: por.email, details: JSON.stringify({ origen: 'bitacora-proceso', idCompany }) } }),
  ]);
}

/** Usuarios activos de la empresa con el estado de su PIN (para restablecer). Sin hashes. */
export async function listPinsEmpresa(db: OtDb, idCompany: number) {
  const usuarios = await listUsuariosEmpresa(db, idCompany);
  if (usuarios.length === 0) return [];
  const pins = await db.otPin.findMany({
    where: { id_user: { in: usuarios.map((u) => u.id) } },
    select: { id_user: true, pin_hash: true, bloqueado: true, intentos_fallidos: true, configurado_en: true },
  });
  const byUser = new Map(pins.map((p) => [p.id_user, p]));
  return usuarios.map((u) => {
    const p = byUser.get(u.id);
    return {
      ...u,
      configurado: Boolean(p?.pin_hash),
      bloqueado: Boolean(p?.bloqueado),
      intentosFallidos: p?.intentos_fallidos ?? 0,
      configuradoEn: p?.configurado_en ? p.configurado_en.toISOString() : null,
    };
  });
}

/** Persona activa de la empresa (para confirmar), o null. */
export async function personaActivaEmpresa(db: OtDb, idUser: string, idCompany: number) {
  const cu = await db.companyUser.findFirst({
    where: { id_company: idCompany, id_user: idUser, user: { isActive: true } },
    select: { user: { select: { id: true, email: true, name: true } } },
  });
  return cu?.user ?? null;
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

/**
 * Importación del maestro de operarios (B8, «Catálogo → Operarios → Importar»).
 * Crea solo los nombres que NO existen en la empresa (sin distinguir mayúsculas; los
 * existentes, activos o no, se informan y no se tocan). Con `simular` no escribe.
 */
export async function importarOperadores(db: OtDb, input: ImportarOperadoresInput, actor: OtActor) {
  const existentes = await db.otOperador.findMany({ where: { id_company: input.idCompany }, select: { id_operador: true, nombre: true, activo: true } });
  const porNombre = new Map(existentes.map((e) => [e.nombre.toLocaleLowerCase('es'), e]));
  const nuevos = input.filas.filter((f) => !porNombre.has(f.nombre.toLocaleLowerCase('es')));
  const yaEstan = input.filas
    .filter((f) => porNombre.has(f.nombre.toLocaleLowerCase('es')))
    .map((f) => ({ linea: f.linea, nombre: porNombre.get(f.nombre.toLocaleLowerCase('es'))!.nombre, activo: porNombre.get(f.nombre.toLocaleLowerCase('es'))!.activo }));
  if (!input.simular && nuevos.length > 0) {
    await db.$transaction(async (tx) => {
      await tx.otOperador.createMany({
        data: nuevos.map((f) => ({ id_company: input.idCompany, nombre: f.nombre, documento: f.documento, activo: true, created_by: actor.idUser })),
      });
    });
  }
  return {
    simulado: input.simular,
    crear: nuevos.map((f) => ({ linea: f.linea, nombre: f.nombre, documento: f.documento })),
    existentes: yaEstan,
    errores: input.errores,
    creados: input.simular ? 0 : nuevos.length,
  };
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

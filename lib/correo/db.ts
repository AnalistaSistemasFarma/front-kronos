import type { PrismaClient } from '../../app/generated/prisma';
import { CORREO_SUBPROCESS_URL, type CorreoAuditAccion, type CorreoTipoMensaje } from './constants';
import { claveAcuse } from './acuse';
import { CorreoError } from './errors';
import type { UsuarioSynerLink } from './rules';
import type { VinculoHilo } from './types';

/**
 * Capa de datos del módulo Correo sobre Prisma (tablas email_* + permisos y
 * usuarios). Todas las consultas de hilos van FILTRADAS por el usuario de la
 * sesión: nadie lee vínculos ajenos por id (anti-IDOR). Se prueba contra un SQL
 * Server real en tests/integration/correo.
 */

export type CorreoDb = Pick<
  PrismaClient,
  'subprocessUserCompany' | 'user' | 'emailThreadLink' | 'emailThreadMessage' | 'emailAudit' | 'chatProjectEmail' | 'emailThreadCase' | '$transaction'
>;

export interface EmpresaCorreo {
  idCompany: number;
  companyName: string;
}

export interface AccesoCorreo {
  idUser: string;
  nombre: string;
  email: string;
  /** Empresas con el subproceso «Correo» (dan acceso al módulo). */
  empresas: EmpresaCorreo[];
  /**
   * Empresas donde puede crear solicitudes desde el Correo: aquellas a las que
   * pertenece (company_user), igual que en «Nueva solicitud».
   */
  empresasSolicitud: EmpresaCorreo[];
}

/** Acceso al módulo: usuario activo con el subproceso «Correo» en al menos una empresa. */
export async function getCorreoAccess(db: CorreoDb, email: string): Promise<AccesoCorreo | null> {
  const user = await db.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, name: true, email: true, role: true, companyUsers: { select: { company: { select: { id_company: true, company: true } } } } },
  });
  if (!user || user.role === 'supplier') return null;
  const grants = await db.subprocessUserCompany.findMany({
    where: { companyUser: { id_user: user.id }, subprocess: { subprocess_url: CORREO_SUBPROCESS_URL } },
    select: { companyUser: { select: { company: { select: { id_company: true, company: true } } } } },
  });
  const empresas = new Map<number, EmpresaCorreo>();
  for (const g of grants) {
    const c = g.companyUser.company;
    empresas.set(c.id_company, { idCompany: c.id_company, companyName: c.company });
  }
  if (empresas.size === 0) return null;
  const porNombre = (a: EmpresaCorreo, b: EmpresaCorreo) => a.companyName.localeCompare(b.companyName);
  const solicitud = new Map<number, EmpresaCorreo>(empresas);
  for (const cu of user.companyUsers ?? []) {
    solicitud.set(cu.company.id_company, { idCompany: cu.company.id_company, companyName: cu.company.company.trim() });
  }
  return {
    idUser: user.id,
    nombre: user.name?.trim() || user.email,
    email: user.email,
    empresas: [...empresas.values()].sort(porNombre),
    empresasSolicitud: [...solicitud.values()].sort(porNombre),
  };
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

/** Usuarios ACTIVOS de SynerLink por correo (minúsculas), con sus empresas. Excluye proveedores. */
export async function usuariosPorCorreo(db: CorreoDb, correos: string[]): Promise<Map<string, UsuarioSynerLink>> {
  const unicos = [...new Set(correos.map((c) => c.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  const out = new Map<string, UsuarioSynerLink>();
  if (unicos.length === 0) return out;
  const rows = await db.user.findMany({
    where: { email: { in: unicos }, isActive: true, NOT: { role: 'supplier' } },
    select: { id: true, name: true, email: true, companyUsers: { select: { id_company: true } } },
  });
  for (const r of rows) {
    const correo = r.email.trim().toLowerCase();
    out.set(correo, { id: r.id, nombre: r.name?.trim() || r.email, correo, empresas: r.companyUsers.map((c) => c.id_company) });
  }
  return out;
}

/** Usuario activo (no proveedor) que pertenece a la empresa. */
export async function usuarioDeEmpresa(db: CorreoDb, idUser: string, idCompany: number): Promise<UsuarioSynerLink | null> {
  const r = await db.user.findFirst({
    where: { id: idUser, isActive: true, NOT: { role: 'supplier' }, companyUsers: { some: { id_company: idCompany } } },
    select: { id: true, name: true, email: true, companyUsers: { select: { id_company: true } } },
  });
  return r ? { id: r.id, nombre: r.name?.trim() || r.email, correo: r.email.toLowerCase(), empresas: r.companyUsers.map((c) => c.id_company) } : null;
}

/** Búsqueda de solicitantes de una empresa (para elegirlo en la simulación). */
export async function buscarUsuariosEmpresa(db: CorreoDb, idCompany: number, q: string): Promise<UsuarioSynerLink[]> {
  const texto = q.trim().slice(0, 60);
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      NOT: { role: 'supplier' },
      companyUsers: { some: { id_company: idCompany } },
      ...(texto ? { OR: [{ name: { contains: texto } }, { email: { contains: texto } }] } : {}),
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
    take: 20,
  });
  return rows.map((r) => ({ id: r.id, nombre: r.name?.trim() || r.email, correo: r.email.toLowerCase(), empresas: [idCompany] }));
}

// ---------------------------------------------------------------------------
// Hilo ↔ ticket de mesa de ayuda («Crear ticket», solo TI, 2026-10-21)
// ---------------------------------------------------------------------------

/** Ticket del hilo (ACTIVO) de la persona, o null. Una reserva en curso (CREANDO) no cuenta. */
export async function ticketDeHilo(db: CorreoDb, idUser: string, conversationId: string): Promise<{ idCase: number; creadoEn: string } | null> {
  const r = await db.emailThreadCase.findUnique({ where: { id_user_conversation_id: { id_user: idUser, conversation_id: conversationId } } });
  return r && r.estado === 'ACTIVO' && r.id_case ? { idCase: r.id_case, creadoEn: r.created_at.toISOString() } : null;
}

/**
 * Reserva el hilo ANTES de insertar el ticket (un solo ticket por hilo y persona, aunque haya
 * doble clic o dos pestañas). Si ya hay un ticket que sigue existiendo → 409 DUPLICADO con su
 * número; si hay otra creación en curso → 409 EN_CURSO. Las reservas caídas a mitad de camino
 * y los vínculos a tickets borrados se limpian y se permite crear.
 */
export async function reservarTicket(
  db: CorreoDb,
  p: { idUser: string; mailbox: string; conversationId: string; internetMessageId: string | null; asunto: string; casoExiste: (idCase: number) => Promise<boolean> }
): Promise<{ idReserva: number }> {
  const existente = await db.emailThreadCase.findUnique({ where: { id_user_conversation_id: { id_user: p.idUser, conversation_id: p.conversationId } } });
  if (existente) {
    if (existente.estado === 'ACTIVO' && existente.id_case && (await p.casoExiste(existente.id_case))) {
      throw new CorreoError(`Este hilo ya tiene el ticket #${existente.id_case}.`, 409, 'DUPLICADO');
    }
    if (existente.estado === 'CREANDO' && Date.now() - existente.created_at.getTime() <= RESERVA_HUERFANA_MS) {
      throw new CorreoError('El ticket de este hilo se está creando en este momento. Espere unos segundos.', 409, 'EN_CURSO');
    }
    await db.emailThreadCase.deleteMany({ where: { id: existente.id } });
  }
  try {
    const r = await db.emailThreadCase.create({
      data: {
        id_user: p.idUser,
        mailbox: p.mailbox.slice(0, 320),
        conversation_id: p.conversationId,
        internet_message_id: p.internetMessageId?.slice(0, 512) ?? null,
        estado: 'CREANDO',
        asunto: p.asunto.slice(0, 255),
        created_by: p.idUser,
      },
    });
    return { idReserva: r.id };
  } catch (e) {
    if (esUnico(e)) throw new CorreoError('El ticket de este hilo se está creando en este momento. Espere unos segundos.', 409, 'EN_CURSO');
    throw e;
  }
}

/** Activa la reserva con el ticket creado. */
export async function activarTicket(db: CorreoDb, idReserva: number, idCase: number): Promise<void> {
  await db.emailThreadCase.update({ where: { id: idReserva }, data: { estado: 'ACTIVO', id_case: idCase } });
}

/** Libera una reserva que no llegó a crear el ticket. */
export async function liberarTicket(db: CorreoDb, idReserva: number): Promise<void> {
  await db.emailThreadCase.deleteMany({ where: { id: idReserva, estado: 'CREANDO' } });
}

// ---------------------------------------------------------------------------
// Hilos vinculados
// ---------------------------------------------------------------------------

function aVinculo(r: { id: number; conversation_id: string; id_request: number | null; asunto: string | null; created_at: Date; origen: string }): VinculoHilo {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    idRequest: r.id_request ?? 0,
    asunto: r.asunto,
    creadoEn: r.created_at.toISOString(),
    origen: r.origen === 'VINCULADA' ? 'VINCULADA' : 'CREADA',
  };
}

/** Vínculos ACTIVOS de los hilos indicados, SOLO del usuario. */
export async function vinculosDeHilos(db: CorreoDb, idUser: string, conversationIds: string[]): Promise<Map<string, VinculoHilo>> {
  const ids = [...new Set(conversationIds)].slice(0, 200);
  const out = new Map<string, VinculoHilo>();
  if (ids.length === 0) return out;
  const rows = await db.emailThreadLink.findMany({ where: { id_user: idUser, conversation_id: { in: ids }, estado: 'ACTIVO' } });
  for (const r of rows) out.set(r.conversation_id, aVinculo(r));
  return out;
}

/**
 * Proyectos del chat a los que la persona (u otro miembro, desde el MISMO buzón) vinculó estos hilos. El buzón es
 * el de la sesión: nunca se consultan vínculos de otro buzón. Hilo → nombres de proyecto.
 */
export async function proyectosDeHilos(db: CorreoDb, mailbox: string, conversationIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(conversationIds)].slice(0, 200);
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const rows = await db.chatProjectEmail.findMany({
    where: { mailbox: mailbox.toLowerCase(), conversation_id: { in: ids } },
    select: { conversation_id: true, project: { select: { name: true } } },
  });
  for (const r of rows) out.set(r.conversation_id, [...(out.get(r.conversation_id) ?? []), r.project.name]);
  return out;
}

/** Vínculos del usuario a una solicitud (para el enlace desde la solicitud). */
export async function vinculosDeSolicitud(db: CorreoDb, idUser: string, idRequest: number): Promise<VinculoHilo[]> {
  const rows = await db.emailThreadLink.findMany({ where: { id_user: idUser, id_request: idRequest, estado: 'ACTIVO' }, orderBy: { created_at: 'asc' } });
  return rows.map(aVinculo);
}

/** Correos ya registrados (en cualquier buzón) → solicitud a la que pertenecen. */
export async function solicitudesDeCorreos(db: CorreoDb, internetMessageIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(internetMessageIds.filter(Boolean))].slice(0, 500);
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await db.emailThreadMessage.findMany({
    where: { internet_message_id: { in: ids } },
    select: { internet_message_id: true, link: { select: { id_request: true, estado: true } } },
  });
  for (const r of rows) if (r.link.id_request && r.link.estado === 'ACTIVO') out.set(r.internet_message_id, r.link.id_request);
  return out;
}

function esUnico(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: string }).code === 'P2002');
}

export interface Reclamo {
  idLink: number;
}

/**
 * Una reserva en CREANDO más vieja que esto es un intento que murió a mitad de camino
 * (proceso caído, compensación fallida): ya no bloquea y se limpia al reintentar.
 */
export const RESERVA_HUERFANA_MS = 5 * 60_000;

/** ¿La solicitud existe todavía en requests_general? */
export type SolicitudExiste = (idRequest: number) => Promise<boolean>;

type FilaVinculo = { id: number; id_request: number | null; estado: string; created_at: Date };

/** Mensaje de duplicado con el número de la solicitud (la UI ofrece abrirla). */
export function errorDuplicado(idRequest: number | null): CorreoError {
  return idRequest
    ? new CorreoError(`Este correo ya fue convertido en la solicitud #${idRequest}.`, 409, 'DUPLICADO', idRequest)
    : new CorreoError('Este correo ya fue convertido en una solicitud.', 409, 'DUPLICADO');
}

/**
 * Estado real de un vínculo: VIGENTE (ACTIVO con la solicitud existente), EN_CURSO (reserva
 * reciente) u HUERFANO (ACTIVO cuya solicitud ya no existe, o reserva vieja que nunca se activó).
 */
async function estadoVinculo(l: FilaVinculo, existe: SolicitudExiste | undefined, ahora: number): Promise<'VIGENTE' | 'EN_CURSO' | 'HUERFANO'> {
  if (l.estado === 'ACTIVO') {
    if (!l.id_request) return 'HUERFANO';
    // Sin verificador (llamadores antiguos) se asume que existe: nunca se borra por duda.
    return !existe || (await existe(l.id_request)) ? 'VIGENTE' : 'HUERFANO';
  }
  return ahora - l.created_at.getTime() > RESERVA_HUERFANA_MS ? 'HUERFANO' : 'EN_CURSO';
}

/** Borra un vínculo huérfano y sus correos registrados (para poder volver a convertir). */
async function limpiarVinculo(db: CorreoDb, idLink: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.emailThreadMessage.deleteMany({ where: { id_link: idLink } });
    await tx.emailThreadLink.deleteMany({ where: { id: idLink } });
  });
}

/**
 * Reserva el hilo ANTES de crear la solicitud (idempotencia): crea el vínculo en
 * estado CREANDO y registra los correos de origen en UNA transacción. Bloquea (409) solo
 * si el hilo o alguno de los correos pertenece a una solicitud que TODAVÍA EXISTE (el
 * error trae su número) o a una conversión en curso. Los vínculos huérfanos (solicitud
 * borrada o intento caído a mitad de camino) se limpian y se permite crear.
 *
 * Las copias de un mismo correo (p. ej. «Enviados» y «Bandeja de entrada» cuando la
 * persona se escribe a sí misma) comparten internetMessageId: se registran UNA vez.
 */
export async function reservarHilo(
  db: CorreoDb,
  p: {
    idUser: string;
    mailbox: string;
    conversationId: string;
    asunto: string;
    correos: Array<{ internetMessageId: string; recibido: string | null }>;
    solicitudExiste?: SolicitudExiste;
  }
): Promise<Reclamo & { limpiados: number[] }> {
  const ahora = Date.now();
  const limpiados: number[] = [];
  const correos = [
    ...new Map(
      p.correos
        .filter((c) => c.internetMessageId)
        .map((c) => ({ ...c, internetMessageId: c.internetMessageId.slice(0, 512) }))
        .map((c) => [c.internetMessageId, c] as const)
    ).values(),
  ];

  const existente = await db.emailThreadLink.findUnique({
    where: { id_user_conversation_id: { id_user: p.idUser, conversation_id: p.conversationId } },
  });
  if (existente) {
    const e = await estadoVinculo(existente, p.solicitudExiste, ahora);
    if (e === 'VIGENTE') throw errorDuplicado(existente.id_request);
    if (e === 'EN_CURSO') throw new CorreoError('Este hilo se está convirtiendo en este momento. Espere unos segundos.', 409, 'EN_CURSO');
    await limpiarVinculo(db, existente.id);
    limpiados.push(existente.id);
  }

  // Correos ya registrados en OTROS vínculos (de esta u otra persona).
  if (correos.length) {
    const previos = await db.emailThreadMessage.findMany({
      where: { internet_message_id: { in: correos.map((c) => c.internetMessageId) } },
      select: { link: { select: { id: true, id_request: true, estado: true, created_at: true } } },
    });
    const vinculos = new Map(previos.map((r) => [r.link.id, r.link] as const));
    for (const l of vinculos.values()) {
      if (limpiados.includes(l.id)) continue;
      const e = await estadoVinculo(l, p.solicitudExiste, ahora);
      if (e === 'VIGENTE') throw errorDuplicado(l.id_request);
      if (e === 'EN_CURSO') throw new CorreoError('Este correo se está convirtiendo en este momento. Espere unos segundos.', 409, 'EN_CURSO');
      await limpiarVinculo(db, l.id);
      limpiados.push(l.id);
    }
  }

  try {
    const link = await db.$transaction(async (tx) => {
      const l = await tx.emailThreadLink.create({
        data: { id_user: p.idUser, mailbox: p.mailbox, conversation_id: p.conversationId, estado: 'CREANDO', origen: 'CREADA', asunto: p.asunto.slice(0, 255), created_by: p.idUser },
      });
      for (const c of correos) {
        await tx.emailThreadMessage.create({
          data: { id_link: l.id, internet_message_id: c.internetMessageId, tipo: 'ORIGEN', received_at: c.recibido ? new Date(c.recibido) : null },
        });
      }
      return l;
    });
    return { idLink: link.id, limpiados };
  } catch (e) {
    // Carrera con otra conversión simultánea: se informa a qué solicitud quedó (si ya la hay).
    if (esUnico(e)) {
      const otro = correos.length
        ? await db.emailThreadMessage.findFirst({ where: { internet_message_id: { in: correos.map((c) => c.internetMessageId) } }, select: { link: { select: { id_request: true } } } })
        : null;
      throw errorDuplicado(otro?.link.id_request ?? null);
    }
    throw e;
  }
}

/** Activa la reserva con la solicitud creada. */
export async function activarHilo(db: CorreoDb, idLink: number, idRequest: number): Promise<void> {
  await db.emailThreadLink.update({ where: { id: idLink }, data: { estado: 'ACTIVO', id_request: idRequest, last_synced_at: new Date() } });
}

/** Libera una reserva que no llegó a crear la solicitud. */
export async function liberarHilo(db: CorreoDb, idLink: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.emailThreadMessage.deleteMany({ where: { id_link: idLink } });
    await tx.emailThreadLink.deleteMany({ where: { id: idLink, estado: 'CREANDO' } });
  });
}

/** Vincula un hilo a una solicitud EXISTENTE (la verificación de acceso a la solicitud la hace el llamador). */
export async function vincularExistente(
  db: CorreoDb,
  p: { idUser: string; mailbox: string; conversationId: string; idRequest: number; asunto: string | null }
): Promise<VinculoHilo> {
  try {
    const r = await db.emailThreadLink.create({
      data: {
        id_user: p.idUser,
        mailbox: p.mailbox,
        conversation_id: p.conversationId,
        id_request: p.idRequest,
        estado: 'ACTIVO',
        origen: 'VINCULADA',
        asunto: p.asunto?.slice(0, 255) ?? null,
        created_by: p.idUser,
        last_synced_at: new Date(),
      },
    });
    return aVinculo(r);
  } catch (e) {
    if (esUnico(e)) {
      const otro = await db.emailThreadLink.findUnique({ where: { id_user_conversation_id: { id_user: p.idUser, conversation_id: p.conversationId } }, select: { id_request: true } });
      throw errorDuplicado(otro?.id_request ?? null);
    }
    throw e;
  }
}

/** Vínculo activo de un hilo del usuario (o null). */
export async function vinculoDeHilo(db: CorreoDb, idUser: string, conversationId: string): Promise<(VinculoHilo & { lastSyncedAt: string | null }) | null> {
  const r = await db.emailThreadLink.findUnique({ where: { id_user_conversation_id: { id_user: idUser, conversation_id: conversationId } } });
  if (!r || r.estado !== 'ACTIVO') return null;
  const v = aVinculo(r);
  // ¿Ya se informó en el hilo? (la reserva del acuse queda como constancia con su fecha)
  const acuse = v.idRequest
    ? await db.emailThreadMessage.findFirst({ where: { id_link: r.id, internet_message_id: claveAcuse(v.idRequest, r.id) }, select: { created_at: true } })
    : null;
  return { ...v, lastSyncedAt: r.last_synced_at?.toISOString() ?? null, acuseEnviadoEn: acuse?.created_at.toISOString() ?? null };
}

/** internetMessageIds ya registrados (en cualquier hilo). */
export async function correosRegistrados(db: CorreoDb, internetMessageIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(internetMessageIds.filter(Boolean))].slice(0, 500);
  if (ids.length === 0) return new Set();
  const rows = await db.emailThreadMessage.findMany({ where: { internet_message_id: { in: ids } }, select: { internet_message_id: true } });
  return new Set(rows.map((r) => r.internet_message_id));
}

/** Registra un correo en el hilo; false si ya estaba (idempotente). */
export async function registrarCorreo(
  db: CorreoDb,
  p: { idLink: number; internetMessageId: string; tipo: CorreoTipoMensaje; recibido: string | null }
): Promise<boolean> {
  try {
    await db.emailThreadMessage.create({
      data: { id_link: p.idLink, internet_message_id: p.internetMessageId.slice(0, 512), tipo: p.tipo, received_at: p.recibido ? new Date(p.recibido) : null },
    });
    return true;
  } catch (e) {
    if (esUnico(e)) return false;
    throw e;
  }
}

/**
 * Reserva el acuse de una solicitud en un hilo ANTES de enviarlo (idempotencia): una fila
 * RESPUESTA con la clave sintética «synerlink-acuse:<solicitud>:<vínculo>» en el índice
 * único global. false → ya se envió (o se está enviando): no se manda dos veces.
 */
export async function reservarAcuse(db: CorreoDb, idLink: number, clave: string): Promise<boolean> {
  return registrarCorreo(db, { idLink, internetMessageId: clave, tipo: 'RESPUESTA', recibido: null });
}

/** Libera la reserva de un acuse que NO salió (para poder reintentarlo). */
export async function liberarAcuse(db: CorreoDb, idLink: number, clave: string): Promise<void> {
  await db.emailThreadMessage.deleteMany({ where: { id_link: idLink, internet_message_id: clave } });
}

export async function marcarSincronizado(db: CorreoDb, idLink: number): Promise<void> {
  await db.emailThreadLink.update({ where: { id: idLink }, data: { last_synced_at: new Date() } });
}

/** Hilos activos, los menos recientes primero (para la tarea de fondo). */
export async function hilosParaSincronizar(db: CorreoDb, limite: number): Promise<Array<{ idLink: number; idUser: string; conversationId: string; idRequest: number }>> {
  const rows = await db.emailThreadLink.findMany({
    where: { estado: 'ACTIVO' },
    orderBy: { last_synced_at: 'asc' },
    take: limite,
  });
  return rows.map((r) => ({ idLink: r.id, idUser: r.id_user, conversationId: r.conversation_id, idRequest: r.id_request ?? 0 }));
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

export interface EntradaAuditoria {
  idUser: string;
  mailbox?: string | null;
  accion: CorreoAuditAccion;
  mensajeId?: string | null;
  conversationId?: string | null;
  internetMessageId?: string | null;
  idRequest?: number | null;
  detalle?: string | null;
  ip?: string | null;
}

export async function auditar(db: CorreoDb, e: EntradaAuditoria): Promise<void> {
  await db.emailAudit.create({
    data: {
      id_user: e.idUser,
      mailbox: e.mailbox?.slice(0, 320) ?? null,
      accion: e.accion,
      mensaje_id: e.mensajeId?.slice(0, 512) ?? null,
      conversation_id: e.conversationId?.slice(0, 512) ?? null,
      internet_message_id: e.internetMessageId?.slice(0, 512) ?? null,
      id_request: e.idRequest ?? null,
      detalle: e.detalle?.slice(0, 1000) ?? null,
      ip: e.ip?.slice(0, 64) ?? null,
    },
  });
}

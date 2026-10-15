import type { PrismaClient } from '../../app/generated/prisma';
import { CORREO_SUBPROCESS_URL, type CorreoAuditAccion, type CorreoTipoMensaje } from './constants';
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
  'subprocessUserCompany' | 'user' | 'emailThreadLink' | 'emailThreadMessage' | 'emailAudit' | '$transaction'
>;

export interface EmpresaCorreo {
  idCompany: number;
  companyName: string;
}

export interface AccesoCorreo {
  idUser: string;
  nombre: string;
  email: string;
  empresas: EmpresaCorreo[];
}

/** Acceso al módulo: usuario activo con el subproceso «Correo» en al menos una empresa. */
export async function getCorreoAccess(db: CorreoDb, email: string): Promise<AccesoCorreo | null> {
  const user = await db.user.findFirst({ where: { email, isActive: true }, select: { id: true, name: true, email: true, role: true } });
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
  return {
    idUser: user.id,
    nombre: user.name?.trim() || user.email,
    email: user.email,
    empresas: [...empresas.values()].sort((a, b) => a.companyName.localeCompare(b.companyName)),
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
 * Reserva el hilo ANTES de crear la solicitud (idempotencia): crea el vínculo en
 * estado CREANDO y registra los correos de origen. Si el hilo ya está vinculado
 * para este usuario, o alguno de los correos ya pertenece a otra solicitud,
 * responde 409 sin crear nada.
 */
export async function reservarHilo(
  db: CorreoDb,
  p: { idUser: string; mailbox: string; conversationId: string; asunto: string; correos: Array<{ internetMessageId: string; recibido: string | null }> }
): Promise<Reclamo> {
  const existente = await db.emailThreadLink.findUnique({
    where: { id_user_conversation_id: { id_user: p.idUser, conversation_id: p.conversationId } },
  });
  if (existente?.estado === 'ACTIVO') throw new CorreoError(`Este hilo ya está vinculado a la solicitud #${existente.id_request}.`, 409, 'DUPLICADO');
  if (existente) throw new CorreoError('Este hilo se está convirtiendo en este momento. Espere unos segundos.', 409, 'EN_CURSO');
  try {
    return await db.$transaction(async (tx) => {
      const link = await tx.emailThreadLink.create({
        data: { id_user: p.idUser, mailbox: p.mailbox, conversation_id: p.conversationId, estado: 'CREANDO', origen: 'CREADA', asunto: p.asunto.slice(0, 255), created_by: p.idUser },
      });
      for (const c of p.correos) {
        if (!c.internetMessageId) continue;
        await tx.emailThreadMessage.create({
          data: { id_link: link.id, internet_message_id: c.internetMessageId.slice(0, 512), tipo: 'ORIGEN', received_at: c.recibido ? new Date(c.recibido) : null },
        });
      }
      return { idLink: link.id };
    });
  } catch (e) {
    if (esUnico(e)) throw new CorreoError('Este correo ya fue convertido en una solicitud.', 409, 'DUPLICADO');
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
    if (esUnico(e)) throw new CorreoError('Este hilo ya está vinculado a una solicitud.', 409, 'DUPLICADO');
    throw e;
  }
}

/** Vínculo activo de un hilo del usuario (o null). */
export async function vinculoDeHilo(db: CorreoDb, idUser: string, conversationId: string): Promise<(VinculoHilo & { lastSyncedAt: string | null }) | null> {
  const r = await db.emailThreadLink.findUnique({ where: { id_user_conversation_id: { id_user: idUser, conversation_id: conversationId } } });
  if (!r || r.estado !== 'ACTIVO') return null;
  return { ...aVinculo(r), lastSyncedAt: r.last_synced_at?.toISOString() ?? null };
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

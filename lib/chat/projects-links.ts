/**
 * Módulo «Proyectos» — CORREOS y SOLICITUDES vinculados a un proyecto.
 *
 * CORREOS (mínimo privilegio):
 *   - Solo se vincula un hilo del buzón PROPIO. El buzón sale de la SESIÓN
 *     (lib/correo: getCorreoAccess + proveedorDe → mailboxForSession); de
 *     afuera solo llega el id del hilo, y si no está en ese buzón, 404.
 *     Además hace falta el permiso del módulo «Correo».
 *   - Se guarda la referencia y una COPIA MÍNIMA (asunto, remitente, fecha,
 *     n.º de mensajes y un resumen que quien vincula revisa y edita). El
 *     cuerpo NO se copia: los demás miembros y el agente ven solo eso. Abrir
 *     el hilo completo solo lo puede hacer quien lo vinculó, desde su Correo.
 *     Es la opción más segura por defecto; la decisión es de Nicolás.
 *
 * SOLICITUDES:
 *   - Se vincula un caso si la persona PARTICIPA en él (solicitante,
 *     responsable de una tarea o del proceso: la misma regla del Correo,
 *     lib/correo/kronos.ts → solicitudVisible) y es de la empresa del
 *     proyecto. Los miembros ven número, asunto, proceso y estado; abrir el
 *     caso sigue sujeto al permiso propio de SynerLink.
 */
import { prisma } from '../prisma';
import { sql, withMssqlPool } from '../mssqlPool';
import { getCorreoAccess } from '../correo/db';
import { auditarLectura, proveedorDe, type CorreoDeps } from '../correo/service';
import { assertGraphId } from '../correo/graph';
import { CorreoError } from '../correo/errors';
import { solicitudVisible } from '../correo/kronos';
import { rutaSolicitud } from '../correo/acuse';
import { capabilitiesFor, MAX_LINK_SUMMARY_CHARS, MAX_PROJECT_LINKS, type ProjectRole } from './projects-rules';
import type { ProjectAccess, ProjectUser } from './projects';

export class LinkError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function recortar(t: string | null | undefined, max: number): string | null {
  const v = (t ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

async function totalVinculos(idProject: number): Promise<number> {
  const [a, b] = await Promise.all([
    prisma.chatProjectEmail.count({ where: { id_project: idProject } }),
    prisma.chatProjectRequest.count({ where: { id_project: idProject } }),
  ]);
  return a + b;
}

/* ─────────────────────────────── Correos ─────────────────────────────── */

async function accesoCorreo(user: ProjectUser) {
  const acceso = await getCorreoAccess(prisma, user.email);
  if (!acceso) throw new LinkError('Para vincular correos necesita el permiso del módulo «Correo».', 403);
  return acceso;
}

/** Hilos del buzón PROPIO (búsqueda), para escoger cuál vincular. */
export async function buscarHilosPropios(d: CorreoDeps, user: ProjectUser, project: ProjectAccess, q: string, ip: string | null) {
  const acceso = await accesoCorreo(user);
  const prov = await proveedorDe(d, acceso);
  const buscar = q.trim().slice(0, 80) || null;
  const pagina = await prov.mensajes({ buscar });
  await auditarLectura(d, acceso, { accion: 'LEER_BANDEJA', detalle: `Proyectos: buscar hilo para el proyecto ${project.idProject}` }, ip).catch(() => null);

  const ya = await prisma.chatProjectEmail.findMany({
    where: { id_project: project.idProject, mailbox: acceso.email.toLowerCase() },
    select: { conversation_id: true },
  });
  const vinculados = new Set(ya.map((x) => x.conversation_id));

  // Un renglón por hilo: el mensaje más reciente manda.
  const porHilo = new Map<string, (typeof pagina.mensajes)[number]>();
  for (const m of pagina.mensajes) {
    const actual = porHilo.get(m.conversationId);
    if (!actual || actual.fecha < m.fecha) porHilo.set(m.conversationId, m);
  }
  return {
    mailbox: acceso.email.toLowerCase(),
    threads: [...porHilo.values()]
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
      .slice(0, 25)
      .map((m) => ({
        conversationId: m.conversationId,
        subject: m.asunto || '(Sin asunto)',
        senderName: m.de.nombre || null,
        senderEmail: m.de.correo || null,
        lastMessageAt: m.fecha || null,
        extracto: recortar(m.extracto, MAX_LINK_SUMMARY_CHARS),
        yaVinculado: vinculados.has(m.conversationId),
      })),
  };
}

/**
 * Vincula un hilo del buzón PROPIO. El hilo se lee con el proveedor de la
 * sesión: un id que no esté en ese buzón da 404 y no deja rastro.
 */
export async function vincularCorreo(
  d: CorreoDeps,
  user: ProjectUser,
  project: ProjectAccess,
  entrada: { conversationId: unknown; summary: string | null },
  ip: string | null
): Promise<{ id: number }> {
  if (!capabilitiesFor(project.role).contribute || project.archived) {
    throw new LinkError('Su rol en el proyecto no permite vincular correos.', 403);
  }
  if (typeof entrada.conversationId !== 'string' || entrada.conversationId.length > 512) {
    throw new LinkError('Hilo de correo inválido.', 400);
  }
  const conversationId = assertGraphId(entrada.conversationId, 'hilo');
  const acceso = await accesoCorreo(user);
  const prov = await proveedorDe(d, acceso);
  const mensajes = await prov.hilo(conversationId, { imagenes: 'ninguna' });
  if (mensajes.length === 0) throw new LinkError('No se encontró el hilo en su buzón.', 404);
  await auditarLectura(d, acceso, { accion: 'LEER_HILO', conversationId, detalle: `Proyectos: vincular al proyecto ${project.idProject}` }, ip).catch(() => null);

  const mailbox = acceso.email.toLowerCase();
  const existente = await prisma.chatProjectEmail.findFirst({
    where: { id_project: project.idProject, mailbox, conversation_id: conversationId },
    select: { id_project_email: true },
  });
  if (existente) throw new LinkError('Ese hilo ya está vinculado al proyecto.', 409);
  if ((await totalVinculos(project.idProject)) >= MAX_PROJECT_LINKS) {
    throw new LinkError(`Un proyecto puede tener hasta ${MAX_PROJECT_LINKS} vínculos. Quite alguno antes de agregar otro.`, 409);
  }

  const ordenados = [...mensajes].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const primero = ordenados[0];
  const ultimo = ordenados[ordenados.length - 1];
  const fila = await prisma.$transaction(async (tx) => {
    const creada = await tx.chatProjectEmail.create({
      data: {
        id_project: project.idProject,
        mailbox,
        conversation_id: conversationId,
        subject: recortar(primero.asunto, 400) ?? '(Sin asunto)',
        sender_name: recortar(ultimo.de.nombre, 200),
        sender_email: recortar(ultimo.de.correo, 254),
        last_message_at: ultimo.fecha ? new Date(ultimo.fecha) : null,
        message_count: mensajes.length,
        summary: entrada.summary,
        linked_by: user.id,
      },
      select: { id_project_email: true },
    });
    // La versión del contexto del puente es updated_at: así el agente lo ve en su próximo turno.
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: new Date() } });
    return creada;
  });
  return { id: fila.id_project_email };
}

/* ───────────────────────────── Solicitudes ───────────────────────────── */

/** Casos de la empresa del proyecto en los que la persona participa (búsqueda). */
export async function buscarSolicitudesVisibles(user: ProjectUser, project: ProjectAccess, q: string) {
  const texto = q.trim().slice(0, 80);
  const numero = /^#?\d{1,9}$/.test(texto) ? Number(texto.replace('#', '')) : null;
  const filas = await withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('company', sql.Int, project.idCompany)
      .input('user', sql.NVarChar(255), user.id)
      .input('numero', sql.Int, numero)
      .input('like', sql.NVarChar(100), texto ? `%${texto.replace(/[%_[\]]/g, (c) => `[${c}]`)}%` : null)
      .query<{ id: number; subject_request: string; created_at: Date | null; status: string | null; process: string | null }>(`
        SELECT TOP 25 rg.id, rg.subject_request, rg.created_at, sc.status, pr.process
        FROM requests_general rg
        LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
        OUTER APPLY (
          SELECT TOP 1 pc.process FROM process_category_request_general pcrg
          INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
          WHERE pcrg.id_request_general = rg.id
        ) pr
        WHERE rg.id_company = @company
          AND (@numero IS NULL OR rg.id = @numero)
          AND (@like IS NULL OR @numero IS NOT NULL OR rg.subject_request LIKE @like)
          AND (
            rg.id_requester = @user
            OR EXISTS (SELECT 1 FROM task_request_general t WHERE t.id_request_general = rg.id AND t.id_assigned = @user)
            OR EXISTS (
              SELECT 1 FROM process_category_request_general pcr
              INNER JOIN user_process_category_request_general up ON up.id_process_category = pcr.id_process_category
              WHERE pcr.id_request_general = rg.id AND up.id_user = @user
            )
          )
        ORDER BY rg.id DESC
      `);
    return r.recordset;
  });
  const ya = await prisma.chatProjectRequest.findMany({
    where: { id_project: project.idProject, id_request: { in: filas.map((f) => f.id) } },
    select: { id_request: true },
  });
  const vinculadas = new Set(ya.map((x) => x.id_request));
  return filas.map((f) => ({
    idRequest: f.id,
    subject: f.subject_request,
    processName: f.process,
    estado: f.status,
    createdAt: f.created_at ? new Date(f.created_at).toISOString() : null,
    yaVinculada: vinculadas.has(f.id),
  }));
}

export async function vincularSolicitud(
  user: ProjectUser,
  project: ProjectAccess,
  idRequest: unknown,
  visible: typeof solicitudVisible = solicitudVisible
): Promise<{ id: number }> {
  if (!capabilitiesFor(project.role).contribute || project.archived) {
    throw new LinkError('Su rol en el proyecto no permite vincular solicitudes.', 403);
  }
  if (typeof idRequest !== 'number' || !Number.isInteger(idRequest) || idRequest <= 0) {
    throw new LinkError('Número de solicitud inválido.', 400);
  }
  const caso = await visible(user.id, idRequest);
  // Ni existencia ni ajena: el mismo 404 (no se confirma que el caso exista).
  if (!caso || caso.idCompany !== project.idCompany) throw new LinkError('No se encontró la solicitud entre las suyas de esta empresa.', 404);

  const existente = await prisma.chatProjectRequest.findFirst({
    where: { id_project: project.idProject, id_request: idRequest },
    select: { id_project_request: true },
  });
  if (existente) throw new LinkError('Esa solicitud ya está vinculada al proyecto.', 409);
  if ((await totalVinculos(project.idProject)) >= MAX_PROJECT_LINKS) {
    throw new LinkError(`Un proyecto puede tener hasta ${MAX_PROJECT_LINKS} vínculos. Quite alguno antes de agregar otro.`, 409);
  }
  const fila = await prisma.$transaction(async (tx) => {
    const creada = await tx.chatProjectRequest.create({
      data: {
        id_project: project.idProject,
        id_request: idRequest,
        id_company: caso.idCompany,
        subject: recortar(caso.asunto, 400) ?? `Solicitud ${idRequest}`,
        process_name: recortar(caso.proceso ?? null, 200),
        linked_by: user.id,
      },
      select: { id_project_request: true },
    });
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: new Date() } });
    return creada;
  });
  return { id: fila.id_project_request };
}

/** Estado vivo de varios casos (una consulta). */
export async function estadosDeSolicitudes(ids: number[]): Promise<Map<number, string | null>> {
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_PROJECT_LINKS);
  const out = new Map<number, string | null>();
  if (unicos.length === 0) return out;
  try {
    await withMssqlPool(async (pool) => {
      const req = pool.request();
      const marcas = unicos.map((id, i) => {
        req.input(`id${i}`, sql.Int, id);
        return `@id${i}`;
      });
      const r = await req.query<{ id: number; status: string | null }>(
        `SELECT rg.id, sc.status FROM requests_general rg LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req WHERE rg.id IN (${marcas.join(', ')})`
      );
      for (const f of r.recordset) out.set(f.id, f.status);
    });
  } catch (err) {
    // El estado es un adorno: si SQL falla, el proyecto se muestra igual.
    console.error('[proyectos] no se pudo leer el estado de las solicitudes:', (err as Error).message);
  }
  return out;
}

/* ───────────────────────────── Quitar ───────────────────────────── */

function puedeQuitar(role: ProjectRole, actorId: string, autor: string): boolean {
  const c = capabilitiesFor(role);
  return c.removeAny || (c.contribute && autor === actorId);
}

export async function quitarVinculo(user: ProjectUser, project: ProjectAccess, tipo: 'correo' | 'solicitud', idLink: number): Promise<void> {
  if (project.archived) throw new LinkError('El proyecto está archivado.', 403);
  if (!Number.isInteger(idLink) || idLink <= 0) throw new LinkError('Vínculo no encontrado.', 404);
  const fila =
    tipo === 'correo'
      ? await prisma.chatProjectEmail.findFirst({ where: { id_project_email: idLink, id_project: project.idProject }, select: { linked_by: true } })
      : await prisma.chatProjectRequest.findFirst({ where: { id_project_request: idLink, id_project: project.idProject }, select: { linked_by: true } });
  if (!fila) throw new LinkError('Vínculo no encontrado.', 404);
  if (!puedeQuitar(project.role, user.id, fila.linked_by)) {
    throw new LinkError('Solo el dueño del proyecto o quien lo vinculó lo puede quitar.', 403);
  }
  await prisma.$transaction([
    tipo === 'correo'
      ? prisma.chatProjectEmail.delete({ where: { id_project_email: idLink } })
      : prisma.chatProjectRequest.delete({ where: { id_project_request: idLink } }),
    prisma.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: new Date() } }),
  ]);
}

/* ──────────────────────────── Lectura ──────────────────────────── */

/**
 * Vínculos del proyecto tal como los ven los MIEMBROS (y, con `paraAgente`,
 * el agente: lo mismo, sin datos de navegación).
 */
export async function vinculosDelProyecto(idProject: number, viewer: { user: ProjectUser; role: ProjectRole; archived: boolean } | null) {
  const [emails, requests] = await Promise.all([
    prisma.chatProjectEmail.findMany({
      where: { id_project: idProject },
      orderBy: { linked_at: 'desc' },
      take: MAX_PROJECT_LINKS,
      select: {
        id_project_email: true,
        mailbox: true,
        conversation_id: true,
        subject: true,
        sender_name: true,
        sender_email: true,
        last_message_at: true,
        message_count: true,
        summary: true,
        linked_by: true,
        linked_at: true,
        linker: { select: { name: true, email: true } },
      },
    }),
    prisma.chatProjectRequest.findMany({
      where: { id_project: idProject },
      orderBy: { linked_at: 'desc' },
      take: MAX_PROJECT_LINKS,
      select: {
        id_project_request: true,
        id_request: true,
        subject: true,
        process_name: true,
        linked_by: true,
        linked_at: true,
        linker: { select: { name: true, email: true } },
        project: { select: { company: { select: { company: true } } } },
      },
    }),
  ]);
  const estados = await estadosDeSolicitudes(requests.map((r) => r.id_request));
  const yo = viewer?.user;
  const quitar = (autor: string) => Boolean(viewer && yo && !viewer.archived && puedeQuitar(viewer.role, yo.id, autor));

  return {
    emails: emails.map((e) => ({
      id: e.id_project_email,
      subject: e.subject,
      senderName: e.sender_name,
      senderEmail: e.sender_email,
      lastMessageAt: e.last_message_at ? e.last_message_at.toISOString() : null,
      messageCount: e.message_count,
      summary: e.summary,
      linkedBy: { id: e.linked_by, name: e.linker.name?.trim() || e.linker.email },
      linkedAt: e.linked_at.toISOString(),
      // Solo quien lo vinculó, y solo si sigue siendo SU buzón: abre su Correo.
      abrirUrl:
        yo && e.linked_by === yo.id && e.mailbox === yo.email.toLowerCase()
          ? `/process/correo?hilo=${encodeURIComponent(e.conversation_id)}`
          : null,
      puedoQuitar: quitar(e.linked_by),
    })),
    requests: requests.map((r) => ({
      id: r.id_project_request,
      idRequest: r.id_request,
      subject: r.subject,
      processName: r.process_name,
      companyName: r.project.company.company.trim(),
      estado: estados.get(r.id_request) ?? null,
      linkedBy: { id: r.linked_by, name: r.linker.name?.trim() || r.linker.email },
      linkedAt: r.linked_at.toISOString(),
      url: rutaSolicitud(r.id_request),
      puedoQuitar: quitar(r.linked_by),
    })),
  };
}

/** Traduce los errores del Correo y de los vínculos a un estado HTTP y un texto. */
export function errorDeVinculo(err: unknown): { status: number; error: string } | null {
  if (err instanceof LinkError) return { status: err.status, error: err.message };
  if (err instanceof CorreoError) return { status: err.status ?? 400, error: err.message };
  return null;
}

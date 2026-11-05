import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { authenticateAgent } from '../../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { assertAgentProjectConversation } from '../../../../../../lib/chat/projects';
import { profileLabel } from '../../../../../../lib/chat/projects-rules';
import { vinculosDelProyecto } from '../../../../../../lib/chat/projects-links';
import { cronogramaParaAgente } from '../../../../../../lib/proyectos/cronograma';
import { equipoParaAgente } from '../../../../../../lib/proyectos/equipo';
import { historialParaAgente, MAX_HISTORIAL_MENSAJES } from '../../../../../../lib/proyectos/hilos-rules';

export const dynamic = 'force-dynamic';

/**
 * CONTEXTO DE UN PROYECTO para el PUENTE DE HILOS.
 *
 *   GET /api/chat/agent/projects/context?idConversation=12
 *   Authorization: Bearer <llave del agente con scope "projects">
 *
 * Devuelve lo que el puente necesita para preparar la carpeta y la sesión del
 * hilo: nombre, empresa, PERFIL de conectores, instrucciones, lista de
 * archivos y una `version` (updated_at del proyecto) para no volver a bajar
 * los archivos si nada cambió.
 *
 * Módulo «Proyectos» (2026-10-18): trae además la descripción y lo VINCULADO
 * (correos y solicitudes) con EXACTAMENTE lo que ven los miembros: de un
 * correo, asunto, remitente, fecha y resumen —nunca el cuerpo—; de una
 * solicitud, número, asunto, proceso y estado actual. Es de solo lectura: el
 * puente lo escribe en ./contexto/vinculados.md de la carpeta del hilo.
 *
 * Cronograma (2026-10-18): trae además `schedule` (tareas con fechas, estado,
 * avance y responsable; solicitudes con sus fechas y actividades). El puente lo
 * escribe en ./contexto/cronograma.md. El agente NO cambia el cronograma: deja
 * propuestas (POST /api/chat/agent/projects/proposals) que una persona confirma.
 *
 * Equipo de subagentes (F2, 2026-10-18): trae además `team` con SOLO los
 * subagentes APROBADOS por el dueño, el interruptor y el tope de simultáneos.
 * El puente los convierte en la definición `--agents` (puente-hilos/src/equipo.mjs).
 *
 * Multiagente (2026-10-29): trae además `conversation.history` (los últimos
 * mensajes del hilo, recortados), `conversation.mainAgent` y
 * `conversation.invited`. El puente escribe el historial en
 * ./contexto/hilo.md: así un agente MENCIONADO en el hilo de otro tiene la
 * conversación completa, y el principal ve lo que respondieron los demás.
 *
 * Solo con la llave del puente: la del bot vivo responde 404 aquí, igual que
 * una conversación que no es de un proyecto de ESTE agente.
 */
export async function GET(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    if (agent.scope !== 'projects') {
      return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    }

    const idConversation = Number(request.nextUrl.searchParams.get('idConversation'));
    if (!Number.isInteger(idConversation) || idConversation <= 0) {
      return badRequest('Debe indicar idConversation.');
    }

    const conv = await assertAgentProjectConversation(agent.idAgent, idConversation);
    if (!conv) return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });

    const p = await prisma.chatProject.findUnique({
      where: { id_project: conv.idProject },
      select: {
        id_project: true,
        name: true,
        description: true,
        profile: true,
        instructions: true,
        updated_at: true,
        company: { select: { id_company: true, company: true } },
        files: {
          select: { id_project_file: true, file_name: true, content_type: true, size_bytes: true },
          orderBy: { id_project_file: 'asc' },
        },
        conversations: {
          where: { id: idConversation },
          select: { title: true, agent: { select: { id_agent: true, code: true, display_name: true } } },
        },
      },
    });
    if (!p) return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });

    // Historial del hilo (los más recientes, en orden). Si falla, el turno sigue sin él.
    let history: ReturnType<typeof historialParaAgente> = [];
    try {
      const filas = await prisma.chatMessage.findMany({
        where: { id_conversation: idConversation },
        orderBy: { id: 'desc' },
        take: MAX_HISTORIAL_MENSAJES,
        select: {
          id: true,
          role: true,
          body: true,
          created_at: true,
          userAuthor: { select: { name: true, email: true } },
          agentAuthor: { select: { id_agent: true, code: true, display_name: true } },
          attachments: { select: { file_name: true } },
        },
      });
      history = historialParaAgente([...filas].reverse());
    } catch (err) {
      console.error('[agent/projects/context] historial:', (err as Error).message);
    }
    const principal = p.conversations[0]?.agent ?? null;

    const vinculos = await vinculosDelProyecto(p.id_project, null);
    // Sin equipo si falla: el turno sigue, y sin subagentes (falla cerrado).
    let team: Awaited<ReturnType<typeof equipoParaAgente>> = { enabled: false, maxParallel: 1, members: [] };
    try {
      team = await equipoParaAgente(p.id_project);
    } catch (err) {
      console.error('[agent/projects/context] equipo:', (err as Error).message);
    }
    let schedule: Awaited<ReturnType<typeof cronogramaParaAgente>> | null = null;
    try {
      schedule = await cronogramaParaAgente(p.id_project);
    } catch (err) {
      // El cronograma es un adorno del contexto: si falla, el turno sigue.
      console.error('[agent/projects/context] cronograma:', (err as Error).message);
    }

    return jsonNoStore({
      project: {
        idProject: p.id_project,
        name: p.name,
        company: { idCompany: p.company.id_company, companyName: p.company.company },
        profile: { key: p.profile, label: profileLabel(p.profile) },
        description: p.description,
        instructions: p.instructions,
        version: p.updated_at.toISOString(),
        links: {
          emails: vinculos.emails.map((e) => ({
            id: e.id,
            subject: e.subject,
            senderName: e.senderName,
            senderEmail: e.senderEmail,
            lastMessageAt: e.lastMessageAt,
            messageCount: e.messageCount,
            summary: e.summary,
            linkedBy: e.linkedBy?.name ?? null,
            linkedAt: e.linkedAt,
          })),
          requests: vinculos.requests.map((r) => ({
            idRequest: r.idRequest,
            subject: r.subject,
            processName: r.processName,
            companyName: r.companyName,
            estado: r.estado,
            linkedBy: r.linkedBy?.name ?? null,
            linkedAt: r.linkedAt,
          })),
        },
        schedule,
        team,
        files: p.files.map((f) => ({
          id: f.id_project_file,
          fileName: f.file_name,
          contentType: f.content_type,
          sizeBytes: f.size_bytes,
          downloadUrl: `/api/chat/agent/projects/files/${f.id_project_file}`,
        })),
      },
      conversation: {
        id: idConversation,
        title: p.conversations[0]?.title ?? null,
        // Multiagente (2026-10-29): de quién es el hilo y si a ESTE agente lo invitaron por mención.
        mainAgent: principal ? { idAgent: principal.id_agent, code: principal.code, name: principal.display_name } : null,
        invited: conv.invitado,
        history,
      },
    });
  } catch (error) {
    return serverError('GET /api/chat/agent/projects/context', error);
  }
}

import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { canAuditAgents } from '../../../../lib/chat/audit-access';
import { formatDateLocal } from '../../../../lib/dashboard/dateRange';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized, forbidden } from '../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * ANALÍTICA DE USO DE AGENTES — pestaña "Agentes" de /dashboard/solicitudes.
 *
 *   GET /api/dashboard/agentes?desde=&hasta=&agente=&empresa=
 *
 * Pedido de Nicolás (2026-09-11): "analizar el comportamiento de la gente con
 * los agentes, para ver quien mas lo usa, tendencia de uso en el tiempo" +
 * "añade también el análisis por empresa".
 *
 * EMPRESA POR MENSAJE: en un hilo de GRUPO la empresa es la del grupo
 * (`conversation.id_company`). En un hilo DIRECTO (la mayoría) esa columna
 * es NULL a propósito — la empresa la define el permiso sobre el agente, no
 * el hilo (ver comentario del modelo). Como proxy razonable se usa la
 * empresa PRINCIPAL del agente (`agent_company.is_primary`); si un agente no
 * tiene ninguna marcada como principal, se usa la primera que tenga.
 *
 * Misma reja que el módulo de auditoría (lib/chat/audit-access.ts): esto
 * expone quién usa cada agente y cuánto, así que es información reservada a
 * administración, no un dashboard general.
 *
 * DE DÓNDE SALE CADA COSA:
 *   - actividad (ranking de usuarios, tendencia diaria, ranking de agentes por
 *     mensajes): `chat_message` — se cuentan solo los mensajes de PERSONA
 *     (role='user'), que son los que representan "uso" real del agente.
 *   - costo por agente: `chat_agent_turn_usage`, agregado con groupBy nativo
 *     (ya trae id_agent directo, no hace falta unir con la conversación).
 *
 * Se trae de `chat_message` solo {id_user_author, created_at, id_conversation
 * -> id_agent} — nunca el `body` ni los adjuntos — para poder repartir esas
 * tres dimensiones (usuario, agente, día) en una sola pasada sin cargar el
 * contenido pesado de la conversación.
 */

function fecha(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await canAuditAgents(user.email))) {
      return forbidden('La analítica de agentes está reservada a la administración.');
    }

    const sp = request.nextUrl.searchParams;
    const desde = fecha(sp.get('desde'));
    const hasta = fecha(sp.get('hasta'));
    const idAgent = Number(sp.get('agente')) || null;
    const idCompanyFilter = Number(sp.get('empresa')) || null;

    // Igual que en /api/chat/auditoria: `hasta` llega como día (YYYY-MM-DD),
    // se toma completo o se pierde el día de hoy.
    if (hasta && hasta.getUTCHours() === 0 && hasta.getUTCMinutes() === 0) {
      hasta.setUTCHours(23, 59, 59, 999);
    }

    const rangoMensajes = {
      role: 'user',
      id_user_author: { not: null },
      ...(desde || hasta
        ? { created_at: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
        : {}),
      ...(idAgent ? { conversation: { id_agent: idAgent } } : {}),
    } as const;

    const rangoUsage = {
      ...(desde || hasta
        ? { created_at: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
        : {}),
      ...(idAgent ? { id_agent: idAgent } : {}),
    } as const;

    const [agentes, mensajes, usagePorAgente, agentCompanies, companies] = await Promise.all([
      prisma.agent.findMany({
        where: { is_active: true },
        select: { id_agent: true, code: true, display_name: true },
        orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
      }),
      // Fila liviana: sin `body` ni adjuntos. Es lo mínimo para repartir por
      // usuario, por agente y por día en una sola pasada.
      prisma.chatMessage.findMany({
        where: rangoMensajes,
        select: {
          id_user_author: true,
          created_at: true,
          conversation: {
            select: {
              id: true,
              id_agent: true,
              id_company: true,
              agent: { select: { id_agent: true, code: true, display_name: true } },
            },
          },
        },
      }),
      prisma.chatAgentTurnUsage.groupBy({
        by: ['id_agent'],
        where: rangoUsage,
        _sum: { total_tokens: true },
        _count: { id: true },
      }),
      prisma.agentCompany.findMany({
        select: { id_agent: true, id_company: true, is_primary: true },
        orderBy: [{ is_primary: 'desc' }],
      }),
      prisma.company.findMany({ select: { id_company: true, company: true } }),
    ]);

    const companyNameById = new Map(companies.map((c) => [c.id_company, c.company]));

    // Empresa principal por agente: la primera de la lista ya ordenada por
    // `is_primary desc`, o sea la marcada como principal si existe.
    const agentPrimaryCompanyId = new Map<number, number>();
    for (const ac of agentCompanies) {
      if (!agentPrimaryCompanyId.has(ac.id_agent)) {
        agentPrimaryCompanyId.set(ac.id_agent, ac.id_company);
      }
    }

    /** Empresa de un mensaje: la del grupo si es hilo de grupo, si no la
     * principal del agente. `null` = sin empresa determinable. */
    function companyIdOf(m: { conversation: { id_agent: number; id_company: number | null } }) {
      return m.conversation.id_company ?? agentPrimaryCompanyId.get(m.conversation.id_agent) ?? null;
    }

    // --- Comparativo por empresa (SIEMPRE sobre todo el periodo/agente,
    // nunca se filtra por `empresa` — es la vista que permite comparar) ---
    const porEmpresaAgg = new Map<
      number | null,
      { mensajes: number; usuarios: Set<string>; conversaciones: Set<number> }
    >();
    for (const m of mensajes) {
      const idCompanyMsg = companyIdOf(m);
      const e = porEmpresaAgg.get(idCompanyMsg) ?? {
        mensajes: 0,
        usuarios: new Set<string>(),
        conversaciones: new Set<number>(),
      };
      e.mensajes += 1;
      e.usuarios.add(m.id_user_author as string);
      e.conversaciones.add(m.conversation.id);
      porEmpresaAgg.set(idCompanyMsg, e);
    }

    // --- Ranking de usuarios --------------------------------------------
    const porUsuario = new Map<
      string,
      { mensajes: number; conversaciones: Set<number>; agentes: Set<number> }
    >();
    // --- Ranking de agentes (por mensajes + usuarios distintos) ---------
    const porAgenteMsg = new Map<
      number,
      { mensajes: number; conversaciones: Set<number>; usuarios: Set<string> }
    >();
    // --- Tendencia diaria (global y por agente) --------------------------
    const porDia = new Map<string, number>();
    const porDiaPorAgente = new Map<number, Map<string, number>>();

    const mensajesFiltrados = idCompanyFilter
      ? mensajes.filter((m) => companyIdOf(m) === idCompanyFilter)
      : mensajes;

    for (const m of mensajesFiltrados) {
      const idUser = m.id_user_author as string;
      const idAgentMsg = m.conversation.id_agent;
      const diaKey = formatDateLocal(m.created_at);

      const u = porUsuario.get(idUser) ?? {
        mensajes: 0,
        conversaciones: new Set<number>(),
        agentes: new Set<number>(),
      };
      u.mensajes += 1;
      u.conversaciones.add(m.conversation.id);
      u.agentes.add(idAgentMsg);
      porUsuario.set(idUser, u);

      const a = porAgenteMsg.get(idAgentMsg) ?? {
        mensajes: 0,
        conversaciones: new Set<number>(),
        usuarios: new Set<string>(),
      };
      a.mensajes += 1;
      a.conversaciones.add(m.conversation.id);
      a.usuarios.add(idUser);
      porAgenteMsg.set(idAgentMsg, a);

      porDia.set(diaKey, (porDia.get(diaKey) ?? 0) + 1);
      const serieAgente = porDiaPorAgente.get(idAgentMsg) ?? new Map<string, number>();
      serieAgente.set(diaKey, (serieAgente.get(diaKey) ?? 0) + 1);
      porDiaPorAgente.set(idAgentMsg, serieAgente);
    }

    const userIds = Array.from(porUsuario.keys());
    const usuarios = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const usuarioInfo = new Map(usuarios.map((u) => [u.id, u]));

    const rankingUsuarios = Array.from(porUsuario.entries())
      .map(([idUser, v]) => ({
        id: idUser,
        nombre: usuarioInfo.get(idUser)?.name?.trim() || usuarioInfo.get(idUser)?.email || idUser,
        email: usuarioInfo.get(idUser)?.email ?? null,
        mensajes: v.mensajes,
        conversaciones: v.conversaciones.size,
        agentesDistintos: v.agentes.size,
      }))
      .sort((a, b) => b.mensajes - a.mensajes)
      .slice(0, 20);

    const usageByAgent = new Map(
      usagePorAgente.map((u) => [u.id_agent, { tokens: u._sum.total_tokens ?? 0, turnos: u._count.id }])
    );

    const rankingAgentes = agentes
      .filter((ag) => !idCompanyFilter || agentPrimaryCompanyId.get(ag.id_agent) === idCompanyFilter)
      .map((ag) => {
        const stat = porAgenteMsg.get(ag.id_agent);
        const usage = usageByAgent.get(ag.id_agent);
        return {
          idAgent: ag.id_agent,
          code: ag.code,
          displayName: ag.display_name,
          mensajes: stat?.mensajes ?? 0,
          conversaciones: stat?.conversaciones.size ?? 0,
          usuariosDistintos: stat?.usuarios.size ?? 0,
          totalTokens: usage?.tokens ?? 0,
          turnos: usage?.turnos ?? 0,
        };
      })
      .filter((a) => a.mensajes > 0 || a.totalTokens > 0)
      .sort((a, b) => b.mensajes - a.mensajes);

    const diasOrdenados = Array.from(porDia.keys()).sort();
    const tendencia = diasOrdenados.map((dia) => ({ fecha: dia, mensajes: porDia.get(dia) ?? 0 }));

    const tendenciaPorAgente = idAgent
      ? diasOrdenados.map((dia) => ({
          fecha: dia,
          mensajes: porDiaPorAgente.get(idAgent)?.get(dia) ?? 0,
        }))
      : [];

    const usuariosActivos = porUsuario.size;
    const totalMensajes = mensajesFiltrados.length;
    const agenteTop = rankingAgentes[0] ?? null;

    const porEmpresa = Array.from(porEmpresaAgg.entries())
      .map(([idCompany, v]) => ({
        idCompany,
        nombre: idCompany ? companyNameById.get(idCompany) ?? `Empresa ${idCompany}` : 'Sin empresa',
        mensajes: v.mensajes,
        usuariosActivos: v.usuarios.size,
        conversaciones: v.conversaciones.size,
      }))
      .sort((a, b) => b.mensajes - a.mensajes);

    return jsonNoStore({
      desde: desde ? formatDateLocal(desde) : null,
      hasta: hasta ? formatDateLocal(hasta) : null,
      agentes: agentes.map((a) => ({ idAgent: a.id_agent, code: a.code, displayName: a.display_name })),
      resumen: {
        totalMensajes,
        usuariosActivos,
        totalConversaciones: new Set(mensajesFiltrados.map((m) => m.conversation.id)).size,
        agenteTop: agenteTop
          ? { displayName: agenteTop.displayName, mensajes: agenteTop.mensajes }
          : null,
      },
      rankingUsuarios,
      rankingAgentes,
      tendencia,
      tendenciaPorAgente,
      // Comparativo por empresa: SIEMPRE sobre todo el periodo (no respeta
      // `empresa`, es justamente lo que permite comparar entre empresas).
      porEmpresa,
      empresas: porEmpresa
        .filter((e) => e.idCompany !== null)
        .map((e) => ({ idCompany: e.idCompany as number, nombre: e.nombre })),
    });
  } catch (error) {
    return serverError('GET /api/dashboard/agentes', error);
  }
}

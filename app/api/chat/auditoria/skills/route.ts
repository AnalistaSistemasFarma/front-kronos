import { prisma } from '../../../../../lib/prisma';
import { canAuditAgents, getAuditScope } from '../../../../../lib/chat/audit-access';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import catalogo from '../../../../../lib/agent-audit/skills-catalog.json';
import flota from '../../../../../scripts/agent-inventory/flota.json';

export const dynamic = 'force-dynamic';

/**
 * CATÁLOGO DE SKILLS DE LA FLOTA — pestaña "Skills" de la Auditoría de agentes.
 *
 *   GET /api/chat/auditoria/skills
 *
 * El dato sale de un JSON versionado (lib/agent-audit/skills-catalog.json) que
 * se regenera con scripts/agent-skills-catalog.py, escaneando por SSH los
 * equipos de la flota. La aplicación no tiene acceso a esos equipos, por eso
 * no se consulta en vivo.
 *
 * Misma reja que /api/chat/auditoria: el catálogo dice qué sabe hacer cada
 * agente y en qué equipo corre, así que se reserva a quien puede auditar.
 *
 * ALCANCE POR EMPRESA (2026-10-06): fuera de la administración, solo los
 * skills de los agentes de sus empresas. El catálogo nombra al agente por su
 * carpeta y su equipo (p. ej. «linabot · Mac mini de Jorge»), no por su código
 * de SynerLink; la traducción sale de scripts/agent-inventory/flota.json. Los
 * skills compartidos del equipo («global» para Claude Code, «openclaw» para
 * openclaw) se muestran si hay un agente del alcance de esa clase en ese equipo.
 */

type Entrada = { agent: string; host: string };

/** ¿Esta entrada del catálogo es de alguno de estos agentes (por código)? */
function entradaEnAlcance(e: Entrada, codigos: Set<string>): boolean {
  return flota.agentes.some((a) => {
    if (!codigos.has(a.code)) return false;
    const equipo = flota.equipos[a.host as keyof typeof flota.equipos];
    if (equipo !== e.host) return false;
    if (e.agent === 'global') return a.kind === 'claude-code';
    if (e.agent === 'openclaw') return a.kind === 'openclaw';
    return 'dir' in a && a.dir === `.${e.agent}`;
  });
}
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await canAuditAgents(user.email))) {
      return jsonNoStore(
        { error: 'La auditoría de agentes está reservada a la administración.' },
        { status: 403 }
      );
    }

    const alcance = await getAuditScope(user.email);
    if (alcance.all) return jsonNoStore(catalogo);

    const agentes = await prisma.agent.findMany({
      where: { id_agent: { in: alcance.agentIds } },
      select: { code: true },
    });
    const codigos = new Set(agentes.map((a) => a.code));
    return jsonNoStore({
      ...catalogo,
      skills: catalogo.skills
        .map((s) => ({ ...s, agents: s.agents.filter((e) => entradaEnAlcance(e, codigos)) }))
        .filter((s) => s.agents.length > 0),
    });
  } catch (error) {
    return serverError('auditoria-skills', error);
  }
}

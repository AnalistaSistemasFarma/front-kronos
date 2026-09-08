import { prisma } from '../../../../lib/prisma';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';

/**
 * ORGANIGRAMA DE LA FLOTA: los agentes agrupados por empresa, con su operador.
 *
 *   GET /api/chat/organigrama
 *
 * Pedido de Nicolás (2026-09-08): quería el organigrama de agentes también
 * DENTRO de SynerLink, no como una imagen aparte. La diferencia importa: una
 * imagen queda vieja el día que se siembra un agente; esto se arma con lo que
 * hay en la base cada vez que se abre.
 *
 * EL ORQUESTADOR NO ESTÁ ESCRITO EN EL CÓDIGO: sale de la variable de entorno
 * `CHAT_ORCHESTRATOR_CODE` (por defecto `horus`). Se hizo así, y no con una
 * columna en la tabla, para no obligar a una migración —que en este repositorio
 * significa ventana con el servicio abajo— por un dato que cambia casi nunca.
 * El día que ese papel pase a otro agente es una línea del `.env` y un
 * `pm2 reload`, sin interrupción. Si algún día hay que registrar más cosas del
 * papel de cada agente, ahí sí vale la columna.
 *
 * SOLO ADMINISTRADORES: la vista muestra TODOS los agentes y quién opera cada
 * uno, incluidos los que el usuario no tiene permiso de usar. Es información
 * de la organización, no de su trabajo diario.
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await checkAdminPrivileges(user.email))) {
      return jsonNoStore(
        { error: 'El organigrama de la flota está reservado a los administradores.' },
        { status: 403 }
      );
    }

    const codigoOrquestador = (process.env.CHAT_ORCHESTRATOR_CODE ?? 'horus').trim();

    const agents = await prisma.agent.findMany({
      where: { is_active: true },
      include: {
        companies: { include: { company: true } },
        subprocess: {
          include: {
            subprocessUserCompanies: {
              include: {
                companyUser: {
                  include: {
                    user: { select: { name: true, email: true } },
                    company: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
    });

    const salida = agents.map((a) => {
      const principal =
        a.companies.find((c) => c.is_primary)?.company ?? a.companies[0]?.company ?? null;

      // Los operadores son quienes tienen el subproceso DEL AGENTE. Se ordenan
      // por nombre para que la vista no baile entre recargas.
      const operadores = (a.subprocess?.subprocessUserCompanies ?? [])
        .map((s) => ({
          name: s.companyUser.user.name,
          email: s.companyUser.user.email,
          company: s.companyUser.company.company,
        }))
        .sort((x, y) => (x.name ?? x.email).localeCompare(y.name ?? y.email, 'es'));

      return {
        idAgent: a.id_agent,
        code: a.code,
        displayName: a.display_name,
        handle: a.handle,
        avatarUrl: a.avatar_url,
        isOrchestrator: a.code === codigoOrquestador,
        company: principal
          ? { idCompany: principal.id_company, companyName: principal.company }
          : null,
        companies: a.companies.map((c) => c.company.company),
        operators: operadores,
      };
    });

    return jsonNoStore({
      agents: salida,
      total: salida.length,
      orchestratorCode: codigoOrquestador,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return serverError('GET /api/chat/organigrama', error);
  }
}

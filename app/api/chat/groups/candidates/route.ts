import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { CHAT_MODULE_URL, getChatAccess } from '../../../../../lib/chat/access';
import {
  badRequest,
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';

/**
 * A QUIÉN SE PUEDE METER a un grupo de una empresa: las personas y los
 * asistentes elegibles.
 *
 *   GET /api/chat/groups/candidates?idCompany=8
 *
 * Existe para que el cuadro de "crear grupo" solo ofrezca gente que
 * REALMENTE va a ver el grupo. La alternativa —listar todos los usuarios y
 * validar al guardar— produce el peor error posible en este módulo: un grupo
 * creado donde alguien figura como integrante y nunca le llega nada, algo que
 * se descubre días después y por queja.
 *
 * Las personas que salen son las que tienen el subproceso del módulo
 * (`/process/chat`) EN ESA EMPRESA y están activas. Los asistentes, los que el
 * propio administrador puede usar en esa empresa.
 *
 * Solo administradores, el mismo criterio de POST /api/chat/groups: si esta
 * lista fuera abierta, sería un directorio de quién tiene qué habilitado.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await checkAdminPrivileges(user.email))) {
      return jsonNoStore({ error: 'Solo los administradores crean grupos.' }, { status: 403 });
    }

    const idCompany = Number(request.nextUrl.searchParams.get('idCompany'));
    if (!Number.isInteger(idCompany) || idCompany <= 0) {
      return badRequest('Debe indicar idCompany.');
    }

    const access = await getChatAccess(user.email);
    if (!access.canUseChat || !access.companies.some((c) => c.idCompany === idCompany)) {
      return jsonNoStore(
        { error: 'No tiene el módulo habilitado en esa empresa.' },
        { status: 403 }
      );
    }

    const [personas, empresa] = await Promise.all([
      prisma.user.findMany({
        where: {
          isActive: true,
          companyUsers: {
            some: {
              id_company: idCompany,
              subprocesses: { some: { subprocess: { subprocess_url: CHAT_MODULE_URL } } },
            },
          },
        },
        select: { id: true, name: true, email: true, image: true },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
      }),
      prisma.company.findUnique({
        where: { id_company: idCompany },
        select: { id_company: true, company: true },
      }),
    ]);

    const agentes = access.agents
      .filter((a) => a.companies.some((c) => c.idCompany === idCompany))
      .map((a) => ({
        idAgent: a.idAgent,
        code: a.code,
        displayName: a.displayName,
        handle: a.handle,
        avatarUrl: a.avatarUrl,
      }));

    return jsonNoStore({
      company: empresa
        ? { idCompany: empresa.id_company, companyName: empresa.company }
        : null,
      users: personas.map((p) => ({
        id: p.id,
        name: p.name?.trim() || p.email,
        email: p.email,
        avatarUrl: p.image,
        // Quien crea el grupo entra siempre; la interfaz lo marca fijo.
        isSelf: p.id === user.id,
      })),
      agents: agentes,
    });
  } catch (error) {
    return serverError('GET /api/chat/groups/candidates', error);
  }
}

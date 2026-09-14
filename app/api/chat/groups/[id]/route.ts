import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { assertGroupAccess } from '../../../../../lib/chat/groups';
import {
  badRequest,
  forbidden,
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';

/**
 * BORRAR UN GRUPO.
 *
 *   DELETE /api/chat/groups/12
 *
 * Pedido de Nicolás (2026-09-09). Se borra de verdad: el grupo, sus mensajes,
 * sus integrantes y sus indicadores. No es un "archivar" disfrazado — archivar
 * ya existe y es otra cosa, y llamarle borrar a algo que no borra es la clase
 * de mentira que se descubre el día que importa.
 *
 * QUIÉN PUEDE: el DUEÑO del grupo, o un administrador. No cualquier
 * integrante: en un grupo de doce personas, que cualquiera pueda desaparecer
 * la conversación de todos es un accidente esperando ocurrir.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const idConversacion = Number.parseInt(id, 10);
    if (!Number.isInteger(idConversacion) || idConversacion <= 0) {
      return badRequest('Identificador de grupo no válido.');
    }

    // La misma reja que usa todo lo demás del grupo: participante y con el
    // módulo en la empresa del grupo. Un id que no le corresponde se comporta
    // como si no existiera.
    const grupo = await assertGroupAccess(user.email, user.id, idConversacion);
    if (!grupo) return forbidden('No tiene acceso a ese grupo.');

    // `assertGroupAccess` ya devuelve el papel de QUIEN preguntó dentro del
    // grupo, así que no hay que volver a recorrer los integrantes.
    if (grupo.role !== 'owner' && !(await checkAdminPrivileges(user.email))) {
      return forbidden('Solo el dueño del grupo o un administrador puede borrarlo.');
    }

    await prisma.$transaction(async (tx) => {
      /*
       * PRIMERO SE SUELTAN LAS CITAS, Y NO ES UN DETALLE.
       *
       * `chat_message.id_reply_to` es una llave foránea a la MISMA tabla y va
       * con NO ACTION —tiene que ser así: SQL Server no admite combinarla con
       * el borrado en cascada que ya baja desde la conversación—. Si un
       * mensaje del grupo cita a otro, el borrado en cascada choca con esa
       * llave y la operación entera falla con un error de integridad.
       *
       * Poniéndolas en NULL antes, la cascada baja limpia. Y no se pierde
       * nada que importe: esos mensajes se van a borrar en la misma
       * transacción.
       */
      await tx.chatMessage.updateMany({
        where: { id_conversation: idConversacion, id_reply_to: { not: null } },
        data: { id_reply_to: null },
      });

      // La cascada se lleva mensajes, adjuntos, entregas, integrantes e
      // indicadores (ver las relaciones en prisma/schema.prisma).
      await tx.chatConversation.delete({ where: { id: idConversacion } });
    });

    /*
     * Los ADJUNTOS quedan en OneDrive.
     *
     * Se borran sus filas, así que desde la aplicación nadie llega a ellos,
     * pero el archivo sigue allá. Es el mismo compromiso que ya acepta el
     * envío de adjuntos (lib/chat/attachmentStorage.ts): borrarlos por Graph
     * agrega llamadas externas que también pueden fallar, y en mitad de un
     * borrado eso deja las cosas peor. Se registra para que quede rastro.
     */
    console.warn(
      `[chat] grupo ${idConversacion} ("${grupo.title ?? 'sin título'}") borrado por ${user.email}. ` +
        'Los adjuntos que tuviera siguen en OneDrive, sin referencia en la base.'
    );

    return jsonNoStore({ ok: true, idConversation: idConversacion });
  } catch (error) {
    return serverError('DELETE /api/chat/groups/[id]', error);
  }
}

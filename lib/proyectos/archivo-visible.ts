import { prisma } from '../prisma';
import { guardProject } from '../chat/projects-guard';
import type { ChatSessionUser } from '../chat/http';
import type { ArchivoOrigen } from '../chat/reenviar-archivo';

/**
 * Puerta de un ARCHIVO DE PROYECTO para el visor y «Compartir» (2026-11-05): la persona
 * es miembro del proyecto (guardProject, la misma de la descarga) y el archivo es de ese
 * proyecto y tiene contenido en OneDrive. Si no, null (la ruta responde 404 sin pistas).
 */
export async function archivoDeProyectoVisible(
  rawProyecto: string,
  rawArchivo: string
): Promise<{ response: Response } | { user: ChatSessionUser; archivo: ArchivoOrigen } | null> {
  const guard = await guardProject(rawProyecto, { allowArchived: true });
  if ('response' in guard) return { response: guard.response };
  const idFile = /^\d+$/.test(rawArchivo) ? Number.parseInt(rawArchivo, 10) : NaN;
  if (!Number.isInteger(idFile) || idFile <= 0) return null;
  const f = await prisma.chatProjectFile.findFirst({
    where: { id_project_file: idFile, id_project: guard.project.idProject },
    select: { file_name: true, content_type: true, size_bytes: true, onedrive_item_id: true },
  });
  if (!f?.onedrive_item_id) return null;
  return {
    user: guard.user,
    archivo: { file_name: f.file_name, content_type: f.content_type, size_bytes: f.size_bytes, onedrive_item_id: f.onedrive_item_id },
  };
}

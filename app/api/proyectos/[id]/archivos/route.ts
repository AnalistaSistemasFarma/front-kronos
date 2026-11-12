import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, readMessageRequest, rejectOversizedBody, serverError } from '../../../../../lib/chat/http';
import { collectChatAttachments } from '../../../../../lib/chat/attachments';
import { uploadProjectFiles } from '../../../../../lib/chat/attachmentStorage';
import { archivedProject, guardProject } from '../../../../../lib/chat/projects-guard';
import { capabilitiesFor, MAX_PROJECT_FILES } from '../../../../../lib/chat/projects-rules';
import { CarpetaInvalida, normalizarCarpeta } from '../../../../../lib/proyectos/carpetas';
import { asegurarCarpetas } from '../../../../../lib/proyectos/carpetas-db';

export const dynamic = 'force-dynamic';

/**
 * ARCHIVOS del proyecto (base de conocimiento del hilo).
 *
 *   POST multipart/form-data, campo `files` (hasta 5 por envío, 25 MB c/u,
 *        mismas extensiones bloqueadas que el chat). Dueño o editor.
 *        2026-11-06: campo opcional `folder` («A/B/C»; vacío = la raíz): los
 *        archivos quedan en esa carpeta y la carpeta (con sus padres) se crea
 *        si no existe. «Cargar carpeta» manda un envío por cada subcarpeta.
 *
 * El puente de hilos los baja a la carpeta del proyecto con la llave del
 * agente (GET /api/chat/agent/projects/files/[fileId]); el agente los lee
 * como cualquier archivo local, sin herramientas de ejecución.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();
    if (!capabilitiesFor(guard.project.role).contribute) {
      return forbidden('Su rol en el proyecto no permite cargar archivos.');
    }

    const oversized = rejectOversizedBody(request);
    if (oversized) return oversized;

    const payload = await readMessageRequest(request);
    if (!payload?.form) return badRequest('Envíe los archivos como multipart/form-data (campo files).');
    let folder: string | null;
    try {
      folder = normalizarCarpeta(payload.form.get('folder'));
    } catch (error) {
      if (error instanceof CarpetaInvalida) return badRequest(error.message);
      throw error;
    }
    const collected = collectChatAttachments(payload.form);
    if (!collected.ok) return badRequest(collected.error);
    if (collected.files.length === 0) return badRequest('No llegó ningún archivo.');

    const actuales = await prisma.chatProjectFile.count({ where: { id_project: guard.project.idProject } });
    if (actuales + collected.files.length > MAX_PROJECT_FILES) {
      return badRequest(`Un proyecto admite máximo ${MAX_PROJECT_FILES} archivos.`);
    }

    let subidos;
    try {
      subidos = await uploadProjectFiles(guard.project.idProject, collected.files);
    } catch (error) {
      console.error('[proyectos] no se pudieron subir los archivos a OneDrive:', error);
      return jsonNoStore({ error: 'No se pudieron guardar los archivos.' }, { status: 502 });
    }

    await asegurarCarpetas(prisma, guard.project.idProject, [folder], guard.user.id);
    await prisma.$transaction([
      prisma.chatProjectFile.createMany({
        data: subidos.map((f) => ({
          id_project: guard.project.idProject,
          file_name: f.file_name,
          content_type: f.content_type,
          size_bytes: f.size_bytes,
          onedrive_item_id: f.onedrive_item_id,
          uploaded_by: guard.user.id,
          folder_path: folder,
        })),
      }),
      // Cambia la "versión" del proyecto: el puente vuelve a sincronizar.
      prisma.chatProject.update({
        where: { id_project: guard.project.idProject },
        data: { updated_at: new Date() },
      }),
    ]);

    return jsonNoStore({ uploaded: subidos.length }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/proyectos/[id]/archivos', error);
  }
}

import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, serverError } from '../../../../../lib/chat/http';
import { archivedProject, guardProject } from '../../../../../lib/chat/projects-guard';
import { capabilitiesFor, canRemoveContribution } from '../../../../../lib/chat/projects-rules';
import { CarpetaInvalida, normalizarCarpeta } from '../../../../../lib/proyectos/carpetas';
import { asegurarCarpetas, carpetaTieneArchivos, carpetasDentro } from '../../../../../lib/proyectos/carpetas-db';

export const dynamic = 'force-dynamic';

/**
 * CARPETAS de los Archivos del proyecto (2026-11-06).
 *   POST   { path } crea la carpeta (y sus carpetas padre). Dueño o editor.
 *   DELETE ?path=   quita una carpeta VACÍA (sin archivos dentro, ni en sus subcarpetas) y sus
 *                   subcarpetas vacías. El dueño, o el editor que la creó.
 */
function rutaDe(raw: unknown): { ruta: string } | { error: string } {
  try {
    const ruta = normalizarCarpeta(raw);
    return ruta ? { ruta } : { error: 'Escriba el nombre de la carpeta.' };
  } catch (error) {
    if (error instanceof CarpetaInvalida) return { error: error.message };
    throw error;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();
    if (!capabilitiesFor(guard.project.role).contribute) return forbidden('Su rol en el proyecto no permite crear carpetas.');
    const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
    const r = rutaDe(body?.path);
    if ('error' in r) return badRequest(r.error);
    const creadas = await asegurarCarpetas(prisma, guard.project.idProject, [r.ruta], guard.user.id);
    if (creadas === 0) return jsonNoStore({ error: 'Esa carpeta ya existe.' }, { status: 409 });
    await prisma.chatProject.update({ where: { id_project: guard.project.idProject }, data: { updated_at: new Date() } });
    return jsonNoStore({ path: r.ruta }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/proyectos/[id]/carpetas', error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();
    const r = rutaDe(new URL(request.url).searchParams.get('path'));
    if ('error' in r) return badRequest(r.error);
    const carpeta = await prisma.chatProjectFolder.findUnique({ where: { id_project_path: { id_project: guard.project.idProject, path: r.ruta } } });
    if (!carpeta) return jsonNoStore({ error: 'Carpeta no encontrada.' }, { status: 404 });
    if (!canRemoveContribution(guard.project.role, guard.user.id, carpeta.created_by)) {
      return forbidden('Solo el dueño del proyecto o quien creó la carpeta la puede quitar.');
    }
    if (await carpetaTieneArchivos(prisma, guard.project.idProject, r.ruta)) {
      return jsonNoStore({ error: 'La carpeta tiene archivos: muévalos o quítelos antes de quitar la carpeta.' }, { status: 409 });
    }
    await prisma.$transaction([
      prisma.chatProjectFolder.deleteMany({ where: { id_project: guard.project.idProject, id_project_folder: { in: await carpetasDentro(prisma, guard.project.idProject, r.ruta) } } }),
      prisma.chatProject.update({ where: { id_project: guard.project.idProject }, data: { updated_at: new Date() } }),
    ]);
    return jsonNoStore({ removed: true });
  } catch (error) {
    return serverError('DELETE /api/proyectos/[id]/carpetas', error);
  }
}

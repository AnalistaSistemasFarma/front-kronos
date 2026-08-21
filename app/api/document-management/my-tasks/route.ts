import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getDocumentManagementAccess } from '../../../../lib/document-management/access';
import {
  getPendingDocumentTasksForUser,
  WorkflowNotSeededError,
} from '../../../../lib/document-management/workflowEngine';

/**
 * Tareas documentales pendientes que el usuario puede accionar: las
 * asignadas directamente a él (dueño en "En elaboración"/"Reelaboración")
 * más las abiertas sin responsable fijo (revisión/aprobación/calidad/
 * divulgación/reasignación) en cualquier empresa donde tenga escritura.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [user, access] = await Promise.all([
      prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }),
      getDocumentManagementAccess(session.user.email),
    ]);
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

    const writableCompanyIds = access.filter((a) => a.canWrite).map((a) => a.idCompany);

    try {
      const tasks = await getPendingDocumentTasksForUser(user.id, writableCompanyIds);
      return NextResponse.json({ tasks });
    } catch (err) {
      if (err instanceof WorkflowNotSeededError) {
        // El flujo aún no se sembró en esta base: no es un error del usuario, solo no hay nada que mostrar.
        return NextResponse.json({ tasks: [], notSeeded: true });
      }
      throw err;
    }
  } catch (error) {
    console.error('Error listando tareas documentales pendientes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

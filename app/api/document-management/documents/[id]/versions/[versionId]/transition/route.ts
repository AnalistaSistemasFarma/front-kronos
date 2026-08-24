import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getDocumentManagementCompanyAccess } from '@/lib/document-management/access';
import {
  transitionDocumentVersion,
  WorkflowTransitionError,
  WorkflowNotSeededError,
} from '@/lib/document-management/workflowEngine';

/**
 * Ejecuta UNA transición del flujo de aprobación sobre una versión del
 * documento (p. ej. "enviar_a_revision", "aprobar", "rechazar",
 * "solicitar_ajustes", "reasignar", "reanudar_asignacion", "publicar_vigente",
 * "anular", "eliminar"). Body: { action: string, reason?: string }.
 *
 * Control de acceso: exige permiso de ESCRITURA
 * (`/process/document-management/manage`) en la empresa del documento — ver
 * la nota de diseño en workflowEngine.ts sobre por qué no hay un gate
 * distinto para el "dueño" del documento.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, versionId } = await params;
    const idDocument = Number(id);
    const idDocumentVersion = Number(versionId);
    if (!idDocument || !idDocumentVersion) {
      return NextResponse.json({ error: 'Id inválido' }, { status: 400 });
    }

    const document = await prisma.document.findUnique({ where: { id_document: idDocument } });
    if (!document) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

    const access = await getDocumentManagementCompanyAccess(session.user.email, document.id_company, 'write');
    if (!access) {
      return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });
    }

    const actor = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!actor) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? '').trim();
    if (!action) return NextResponse.json({ error: 'Falta la acción a ejecutar' }, { status: 400 });
    const reason = body?.reason != null ? String(body.reason) : null;

    const result = await transitionDocumentVersion({
      idDocumentVersion,
      action,
      actorUserId: actor.id,
      actorEmail: session.user.email,
      reason,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof WorkflowTransitionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof WorkflowNotSeededError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error('Error ejecutando transición del flujo documental:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

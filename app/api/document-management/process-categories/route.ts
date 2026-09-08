import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getDocumentManagementAccess } from '../../../../lib/document-management/access';

/**
 * Sprint 9 — Catálogo de CATEGORÍAS DE PROCESO DOCUMENTAL (Auditorías y
 * Autoinspecciones / No Conformidades / Ingeniería Biomédica) y, dentro de
 * cada categoría/sub-proceso, los documentos VIGENTES ya clasificados ahí.
 *
 * Por qué esto NO reusa `document.id_process`: ver el comentario del modelo
 * Document en prisma/schema.prisma y app/api/document-management/generator/
 * route.ts — `id_process` es una referencia blanda al `process_category`
 * del MOTOR de workflow (identifica que el documento pasó por el flujo de
 * aprobación de 14 estados, no a qué proceso de negocio pertenece; todos
 * los documentos que pasan por ese flujo comparten el mismo valor). La
 * clasificación real vive en `document.id_document_process_subprocess`
 * (FK real a DocumentProcessSubprocess, tabla nueva de este sprint).
 *
 * GET -> devuelve las categorías activas con sus sub-procesos activos y,
 *        dentro de cada sub-proceso, los documentos Vigentes ya clasificados
 *        ahí (solo de las empresas donde el usuario tiene acceso de
 *        lectura al módulo) + la lista aparte de documentos Vigentes SIN
 *        clasificar todavía (para poder clasificarlos desde la UI).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getDocumentManagementAccess(session.user.email);
    const readableCompanyIds = access.filter((a) => a.canRead).map((a) => a.idCompany);
    if (readableCompanyIds.length === 0) {
      return NextResponse.json({ categories: [], unclassified: [], companies: access });
    }

    const documentInclude = {
      documentType: true,
      company: true,
      owner: { select: { id: true, name: true, email: true } },
      versions: {
        orderBy: { version_number: 'desc' as const },
        take: 1,
      },
    };

    const categories = await prisma.documentProcessCategory.findMany({
      where: { is_active: true },
      orderBy: { display_order: 'asc' },
      include: {
        subprocesses: {
          where: { is_active: true },
          orderBy: { display_order: 'asc' },
          include: {
            documents: {
              where: {
                current_status: 'Vigente',
                id_company: { in: readableCompanyIds },
              },
              include: documentInclude,
              orderBy: { updated_at: 'desc' },
            },
          },
        },
      },
    });

    const unclassified = await prisma.document.findMany({
      where: {
        current_status: 'Vigente',
        id_document_process_subprocess: null,
        id_company: { in: readableCompanyIds },
      },
      include: documentInclude,
      orderBy: { updated_at: 'desc' },
    });

    return NextResponse.json({ categories, unclassified, companies: access });
  } catch (error) {
    console.error('Error listando categorías de proceso documental:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

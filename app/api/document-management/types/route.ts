import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getDocumentManagementAccess } from '../../../../lib/document-management/access';
import { syncDocumentTypeOption } from '../../../../lib/document-management/genericFields';

/**
 * Catálogo de tipos de documento (DocumentType). Es GLOBAL, no por empresa:
 * la nomenclatura de políticas/procedimientos aplica igual en todo el grupo.
 *
 * GET  -> lista los tipos activos. Sprint 5: cualquier usuario autenticado
 *         puede leerlo (ya no exige acceso de lectura al módulo) porque
 *         ahora también lo consume el flujo ESTÁNDAR de "crear solicitud"
 *         de SynerLink (app/(hub)/process/request-general/create-request/page.tsx)
 *         al seleccionar Gestión Documental, disponible para cualquiera —
 *         es solo una lista de nombres (Procedimiento, Política, ...), sin
 *         nada confidencial.
 * POST -> crea un tipo nuevo (requiere acceso de ESCRITURA en al menos una
 *         empresa: no hay "empresa" en este catálogo, así que se exige el
 *         mismo nivel que para las acciones del flujo de aprobación).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const types = await prisma.documentType.findMany({
      where: { is_active: true },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ types });
  } catch (error) {
    console.error('Error listando tipos de documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getDocumentManagementAccess(session.user.email);
    if (!access.some((a) => a.canWrite)) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en el módulo' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    const codePrefix = String(body.codePrefix ?? '')
      .trim()
      .toUpperCase();
    const ggcProcess = body.ggcProcess ? String(body.ggcProcess).trim() : null;

    if (!name) {
      return NextResponse.json({ error: 'El nombre del tipo de documento es obligatorio' }, { status: 400 });
    }
    if (!codePrefix || !/^[A-Z0-9-]{1,20}$/.test(codePrefix)) {
      return NextResponse.json(
        { error: 'El prefijo debe tener entre 1 y 20 caracteres (letras, números o guion)' },
        { status: 400 }
      );
    }

    const existing = await prisma.documentType.findUnique({ where: { code_prefix: codePrefix } });
    if (existing) {
      return NextResponse.json({ error: `Ya existe un tipo con el prefijo "${codePrefix}"` }, { status: 409 });
    }

    const type = await prisma.documentType.create({
      data: { name, code_prefix: codePrefix, ggc_process: ggcProcess },
    });

    // Parametrización: sincroniza la opción nueva en process_form_field_option para que
    // el selector genérico de "Tipo de documento" (create-request/page.tsx, camino
    // estándar) la vea sin tener que resembrar a mano -- ver genericFields.ts. Best-effort:
    // un fallo aquí no debe tumbar la creación del tipo, que ya quedó confirmada.
    try {
      await syncDocumentTypeOption(type);
    } catch (syncError) {
      console.error('No se pudo sincronizar la opción de "Tipo de documento":', syncError);
    }

    return NextResponse.json({ type }, { status: 201 });
  } catch (error) {
    console.error('Error creando tipo de documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

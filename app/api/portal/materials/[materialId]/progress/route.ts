import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import { marcarMaterialCompletado, recalcularProgresoDeMaterial } from '../../../../../../lib/portal/formacion';
import { MENSAJE_SIN_PERMISO_MANUAL, puedeMarcarManual } from '../../../../../../lib/portal/permisos-formacion';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — marcar (o desmarcar) A MANO un material como completado.
 *
 *   POST   /api/portal/materials/:materialId/progress  — lo marca.
 *   DELETE /api/portal/materials/:materialId/progress  — lo desmarca.
 *
 * Desde 2026-10-08 (Cristian Baldión) SOLO lo pueden hacer quienes estén en
 * las hojas ADMINISTRADORES o FORMADORES del Excel de permisos (ver
 * `lib/portal/permisos-formacion.ts`); a los demás se les responde 403. Para
 * todos, la casilla se marca sola al revisar el material
 * (`POST /api/portal/materials/:materialId/vista[/:token]`).
 *
 * Al marcar, si con eso se llega al 100 % del curso, se emite el certificado
 * en el mismo paso (sin cambios respecto a antes).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const materialId = idDesdeParametro((await params).materialId);
  if (!materialId) return NextResponse.json({ error: 'Material no válido.' }, { status: 400 });

  try {
    if (!(await puedeMarcarManual(quien.correo))) {
      return NextResponse.json({ error: MENSAJE_SIN_PERMISO_MANUAL }, { status: 403 });
    }
    const existe = await prisma.portalCourseMaterial.findFirst({
      where: { id: materialId, eliminado_at: null },
      select: { id: true },
    });
    if (!existe) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });

    await marcarMaterialCompletado({ materialId, correo: quien.correo, origen: 'MANUAL', marcadoPor: quien.correo });

    const resultado = await recalcularProgresoDeMaterial(materialId, quien.correo);
    if (!resultado) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    console.error('[portal] POST .../materials/[materialId]/progress', error);
    return NextResponse.json({ error: 'No se pudo marcar el material.' }, { status: 500 });
  }
}

/**
 * Desmarcarlo NO retira un certificado ya emitido — el certificado congela lo
 * que la persona logró en su momento. Sencillamente ya no vuelve a emitirse
 * otro si vuelve a completar el curso (ver el índice único en
 * `portal_certificate`).
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const materialId = idDesdeParametro((await params).materialId);
  if (!materialId) return NextResponse.json({ error: 'Material no válido.' }, { status: 400 });

  try {
    if (!(await puedeMarcarManual(quien.correo))) {
      return NextResponse.json({ error: MENSAJE_SIN_PERMISO_MANUAL }, { status: 403 });
    }

    await prisma.portalMaterialProgress.deleteMany({
      where: { material_id: materialId, student_email: quien.correo },
    });

    const resultado = await recalcularProgresoDeMaterial(materialId, quien.correo, { emitirCertificado: false });
    if (!resultado) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, porcentaje: resultado.porcentaje });
  } catch (error) {
    console.error('[portal] DELETE .../materials/[materialId]/progress', error);
    return NextResponse.json({ error: 'No se pudo desmarcar el material.' }, { status: 500 });
  }
}

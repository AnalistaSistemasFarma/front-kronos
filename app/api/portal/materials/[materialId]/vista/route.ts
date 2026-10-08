import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../lib/portal/config';
import {
  contarPaginasPdf,
  marcarMaterialCompletado,
  recalcularProgresoDeMaterial,
} from '../../../../../../lib/portal/formacion';
import { reglaDeRevision, tipoDeRevision } from '../../../../../../lib/portal/revision-material';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — el estudiante ABRE un material (Cristian, 2026-10-08).
 *
 *   POST /api/portal/materials/:materialId/vista
 *
 * Registra la apertura con la hora del SERVIDOR y devuelve un `token` y la
 * regla de revisión que aplica (ver `lib/portal/revision-material.ts`). El
 * navegador reporta después lo que vio en `POST .../vista/:token` y es el
 * servidor quien decide si marca el material.
 *
 * Un ENLACE se da por revisado al abrirlo: se marca aquí mismo.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const materialId = idDesdeParametro((await params).materialId);
  if (!materialId) return NextResponse.json({ error: 'Material no válido.' }, { status: 400 });

  try {
    const material = await prisma.portalCourseMaterial.findFirst({
      where: { id: materialId, eliminado_at: null },
      select: {
        id: true,
        type: true,
        mime: true,
        sp_drive_item_id: true,
        file_size: true,
        course: { select: { active: true } },
      },
    });
    if (!material) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    if (!material.course.active && !formadoresDePortal().includes(quien.correo.toLowerCase())) {
      return NextResponse.json({ error: 'Este curso no está disponible.' }, { status: 404 });
    }

    let paginas: number | null = null;
    if (tipoDeRevision(material) === 'pdf') {
      // Solo materiales viejos (antes de SharePoint) tienen los bytes en la base.
      const conBytes = material.sp_drive_item_id
        ? null
        : await prisma.portalCourseMaterial.findUnique({ where: { id: materialId }, select: { contenido: true } });
      paginas = await contarPaginasPdf({ ...material, contenido: conBytes?.contenido ?? null });
    }
    const regla = reglaDeRevision(material, paginas);

    const token = randomUUID();
    await prisma.portalMaterialVista.create({
      data: { token, material_id: materialId, student_email: quien.correo, abierta_at: new Date(), paginas },
    });

    const yaCompletado = await prisma.portalMaterialProgress.findUnique({
      where: { material_id_student_email: { material_id: materialId, student_email: quien.correo } },
      select: { id: true },
    });

    if (regla.tipo === 'enlace') {
      await marcarMaterialCompletado({ materialId, correo: quien.correo, origen: 'AUTO' });
      await prisma.portalMaterialVista.update({
        where: { token },
        data: { reportada_at: new Date(), aceptada: true, segundos_vistos: 0 },
      });
      const resultado = await recalcularProgresoDeMaterial(materialId, quien.correo);
      return NextResponse.json({ token, regla, completado: true, ...(resultado ?? {}) });
    }

    return NextResponse.json({ token, regla, completado: !!yaCompletado, paginas });
  } catch (error) {
    console.error('[portal] POST .../materials/[materialId]/vista', error);
    return NextResponse.json({ error: 'No se pudo abrir el material.' }, { status: 500 });
  }
}

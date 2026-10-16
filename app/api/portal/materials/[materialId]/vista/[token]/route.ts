import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { identificar } from '../../../../../../../lib/portal/acceso';
import { marcarMaterialCompletado, recalcularProgresoDeMaterial } from '../../../../../../../lib/portal/formacion';
import { MENSAJE_FORMULARIO_SE_COMPLETA_AL_ENVIAR } from '../../../../../../../lib/portal/formulario';
import { leerReporte, reglaDeRevision, validarRevision } from '../../../../../../../lib/portal/revision-material';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * FORMACIÓN — el navegador REPORTA que el estudiante revisó el material.
 *
 *   POST /api/portal/materials/:materialId/vista/:token
 *        JSON `{ segundosVistos, duracion?, paginaMaxima?, paginasTotales? }`
 *
 * El servidor valida el reporte contra la regla del material: el video, contra
 * el tiempo REAL transcurrido desde la apertura que él mismo registró; el PDF,
 * contra las páginas que él mismo contó (ver
 * `lib/portal/revision-material.ts`). Si es suficiente y plausible, marca el
 * material (origen AUTO) y recalcula el curso — con certificado si llega al
 * 100 %, igual que antes. Si no, responde 422 con el motivo y no marca nada.
 *
 * El token solo sirve para su material y su estudiante: el de otra persona
 * responde 404.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string; token: string }> }
) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const { materialId: crudo, token } = await params;
  const materialId = idDesdeParametro(crudo);
  if (!materialId || !TOKEN.test(token)) return NextResponse.json({ error: 'Parámetros no válidos.' }, { status: 400 });

  const reporte = leerReporte(await request.json().catch(() => null));
  if (!reporte) return NextResponse.json({ error: 'Reporte de revisión no válido.' }, { status: 400 });

  try {
    const vista = await prisma.portalMaterialVista.findUnique({
      where: { token },
      select: {
        material_id: true,
        student_email: true,
        abierta_at: true,
        paginas: true,
        aceptada: true,
        material: { select: { type: true, mime: true, eliminado_at: true } },
      },
    });
    if (!vista || vista.material_id !== materialId || vista.student_email !== quien.correo || vista.material.eliminado_at) {
      return NextResponse.json({ error: 'Apertura del material no encontrada.' }, { status: 404 });
    }
    if (vista.material.type === 'FORM') {
      return NextResponse.json({ error: MENSAJE_FORMULARIO_SE_COMPLETA_AL_ENVIAR }, { status: 409 });
    }

    if (vista.aceptada !== true) {
      const regla = reglaDeRevision(vista.material, vista.paginas);
      const transcurridos = (Date.now() - vista.abierta_at.getTime()) / 1000;
      const veredicto = validarRevision(regla, reporte, transcurridos);

      await prisma.portalMaterialVista.update({
        where: { token },
        data: {
          reportada_at: new Date(),
          segundos_vistos: Math.round(Math.min(reporte.segundosVistos, 2_000_000_000)),
          duracion_seg: reporte.duracion ? Math.round(Math.min(reporte.duracion, 2_000_000_000)) : null,
          aceptada: veredicto.ok,
        },
      });
      if (!veredicto.ok) return NextResponse.json({ error: veredicto.error }, { status: 422 });

      await marcarMaterialCompletado({ materialId, correo: quien.correo, origen: 'AUTO' });
    }

    const resultado = await recalcularProgresoDeMaterial(materialId, quien.correo);
    if (!resultado) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, completado: true, ...resultado });
  } catch (error) {
    console.error('[portal] POST .../materials/[materialId]/vista/[token]', error);
    return NextResponse.json({ error: 'No se pudo registrar la revisión.' }, { status: 500 });
  }
}

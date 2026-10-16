import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import { MENSAJE_SIN_PERMISO_RESPUESTAS, puedeVerRespuestasFormulario } from '../../../../../../lib/portal/permisos-formacion';

export function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Nada de esto se guarda en cachés intermedias ni del navegador. */
export const SIN_CACHE = { 'Cache-Control': 'no-store, private', Pragma: 'no-cache' };

/**
 * Puerta común de las rutas de RESPUESTAS: sesión (401), permiso del Excel
 * ADMINISTRADORES/FORMADORES validado EN EL SERVIDOR (403) y material FORM
 * existente (404). Devuelve la respuesta de error o los datos del material.
 */
export async function autorizarRespuestas(
  request: NextRequest,
  materialIdCrudo: string
): Promise<
  | { error: NextResponse }
  | { correo: string; material: { id: number; title: string; formulario_id: number; course: { id: number; title: string } } }
> {
  const quien = await identificar(request);
  if (!quien) return { error: NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 }) };
  const materialId = idDesdeParametro(materialIdCrudo);
  if (!materialId) return { error: NextResponse.json({ error: 'Material no válido.' }, { status: 400 }) };
  if (!(await puedeVerRespuestasFormulario(quien.correo))) {
    return { error: NextResponse.json({ error: MENSAJE_SIN_PERMISO_RESPUESTAS }, { status: 403 }) };
  }
  const material = await prisma.portalCourseMaterial.findFirst({
    where: { id: materialId, type: 'FORM' },
    select: { id: true, title: true, formulario_id: true, course: { select: { id: true, title: true } } },
  });
  if (!material || !material.formulario_id) {
    return { error: NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 }) };
  }
  return { correo: quien.correo, material: { ...material, formulario_id: material.formulario_id } };
}

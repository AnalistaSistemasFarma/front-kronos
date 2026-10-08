import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../lib/portal/config';
import { recalcularProgresoDeMaterial, resolverNombreEstudiante } from '../../../../../../lib/portal/formacion';
import { MENSAJE_AUTORIZACION, MENSAJE_YA_ENVIADO, validarRespuestas } from '../../../../../../lib/portal/formulario';
import { leerDefinicion, registrarErrorSinDatos, versionVigente } from '../../../../../../lib/portal/formulario-servidor';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Más que esto no es un formulario de 40 preguntas: es otra cosa. */
const MAX_BYTES_CUERPO = 512 * 1024;

const SIN_CACHE = { 'Cache-Control': 'no-store' };

/** El material FORM vigente y si la persona puede verlo. */
async function materialFormulario(materialId: number, correo: string) {
  const material = await prisma.portalCourseMaterial.findFirst({
    where: { id: materialId, eliminado_at: null },
    select: { id: true, type: true, title: true, formulario_id: true, course: { select: { active: true } } },
  });
  if (!material || material.type !== 'FORM' || !material.formulario_id) return null;
  if (!material.course.active && !formadoresDePortal().includes(correo.toLowerCase())) return null;
  return { ...material, formulario_id: material.formulario_id };
}

/**
 * FORMACIÓN — FORMULARIO PROPIO del curso (Cristian Baldión, 2026-10-08).
 *
 *   GET  /api/portal/materials/:materialId/formulario
 *        La definición VIGENTE, los valores prellenados (correo y nombre de la
 *        sesión) y si la persona ya lo envió. NUNCA devuelve respuestas: ni las
 *        propias ni las de nadie (eso es solo para administradores/formadores,
 *        en `.../respuestas`).
 *
 *   POST /api/portal/materials/:materialId/formulario
 *        JSON `{ versionId, autorizaDatos, respuestas }`. Valida en el servidor
 *        (obligatorias, tipos, opciones y la autorización de tratamiento de
 *        datos), guarda la respuesta y MARCA el material como completado
 *        (origen AUTO) en la misma transacción; recalcula el curso y emite el
 *        certificado si llega al 100 %, igual que los demás materiales.
 *
 * Se envía UNA SOLA VEZ (índice único material + correo): un segundo envío
 * responde 409. No se edita después; para corregir, un administrador/formador
 * reabre la respuesta (`DELETE .../respuestas/:id`) y la persona vuelve a
 * responder. El correo que se guarda es el de la SESIÓN, aunque el campo
 * "CORREO" del formulario diga otra cosa (se fuerza al de la sesión).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  const materialId = idDesdeParametro((await params).materialId);
  if (!materialId) return NextResponse.json({ error: 'Material no válido.' }, { status: 400 });

  try {
    const material = await materialFormulario(materialId, quien.correo);
    if (!material) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });
    const vigente = await versionVigente(material.formulario_id);
    if (!vigente) return NextResponse.json({ error: 'El formulario no está disponible.' }, { status: 404 });

    const enviada = await prisma.portalFormularioRespuesta.findUnique({
      where: { material_id_student_email: { material_id: materialId, student_email: quien.correo } },
      select: { enviada_at: true },
    });
    return NextResponse.json(
      {
        material: { id: material.id, titulo: material.title },
        formulario: { versionId: vigente.versionId, version: vigente.version, definicion: vigente.definicion },
        prellenado: { correo: quien.correo, nombre: await resolverNombreEstudiante(quien.correo) },
        enviadaEl: enviada?.enviada_at ?? null,
      },
      { headers: SIN_CACHE }
    );
  } catch (error) {
    registrarErrorSinDatos('GET .../materials/[materialId]/formulario', error);
    return NextResponse.json({ error: 'No se pudo cargar el formulario.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  const materialId = idDesdeParametro((await params).materialId);
  if (!materialId) return NextResponse.json({ error: 'Material no válido.' }, { status: 400 });

  const crudo = await request.text().catch(() => '');
  if (Buffer.byteLength(crudo, 'utf8') > MAX_BYTES_CUERPO) {
    return NextResponse.json({ error: 'Las respuestas son demasiado largas.' }, { status: 413 });
  }
  let cuerpo: { versionId?: unknown; autorizaDatos?: unknown; respuestas?: unknown } | null = null;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    cuerpo = null;
  }
  if (!cuerpo || typeof cuerpo !== 'object') return NextResponse.json({ error: 'Cuerpo no válido.' }, { status: 400 });
  const versionId = typeof cuerpo.versionId === 'number' && Number.isInteger(cuerpo.versionId) ? cuerpo.versionId : null;
  if (!versionId) return NextResponse.json({ error: 'Falta la versión del formulario.' }, { status: 400 });

  try {
    const material = await materialFormulario(materialId, quien.correo);
    if (!material) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });

    const yaEnviada = await prisma.portalFormularioRespuesta.findUnique({
      where: { material_id_student_email: { material_id: materialId, student_email: quien.correo } },
      select: { id: true },
    });
    if (yaEnviada) return NextResponse.json({ error: MENSAJE_YA_ENVIADO }, { status: 409 });

    // Cualquier versión del MISMO formulario: si el formador publicó una nueva
    // mientras la persona respondía, se guarda con la que vio.
    const version = await prisma.portalFormularioVersion.findFirst({
      where: { id: versionId, formulario_id: material.formulario_id },
      select: { id: true, definicion: true },
    });
    const definicion = version ? leerDefinicion(version.definicion) : null;
    if (!version || !definicion) {
      return NextResponse.json({ error: 'La versión del formulario no corresponde. Recargue la página.' }, { status: 409 });
    }

    if (definicion.autorizacion && cuerpo.autorizaDatos !== true) {
      return NextResponse.json(
        { error: MENSAJE_AUTORIZACION, errores: [{ id: 'autorizacion', mensaje: MENSAJE_AUTORIZACION }] },
        { status: 422 }
      );
    }

    // El correo es el de la sesión: no se puede responder "a nombre de" otro.
    const entrada = { ...((cuerpo.respuestas && typeof cuerpo.respuestas === 'object' ? cuerpo.respuestas : {}) as Record<string, unknown>) };
    for (const p of definicion.preguntas) if (p.prellenar === 'correo') entrada[p.id] = quien.correo;

    const validacion = validarRespuestas(definicion, entrada);
    if (!validacion.ok) {
      return NextResponse.json(
        { error: 'Faltan respuestas obligatorias o hay respuestas no válidas.', errores: validacion.errores },
        { status: 422 }
      );
    }

    const ahora = new Date();
    try {
      await prisma.$transaction([
        prisma.portalFormularioRespuesta.create({
          data: {
            material_id: materialId,
            formulario_version_id: version.id,
            student_email: quien.correo,
            respuestas: JSON.stringify(validacion.respuestas),
            autorizacion_version: definicion.autorizacion?.version ?? null,
            autorizado_at: definicion.autorizacion ? ahora : null,
            enviada_at: ahora,
          },
          select: { id: true },
        }),
        // Completado AUTOMÁTICO al enviar. No pisa una marca existente.
        prisma.portalMaterialProgress.upsert({
          where: { material_id_student_email: { material_id: materialId, student_email: quien.correo } },
          update: {},
          create: { material_id: materialId, student_email: quien.correo, origen: 'AUTO', completed_at: ahora },
          select: { id: true },
        }),
      ]);
    } catch (error) {
      // Dos envíos simultáneos: el índice único deja pasar solo uno.
      if ((error as { code?: string })?.code === 'P2002') {
        return NextResponse.json({ error: MENSAJE_YA_ENVIADO }, { status: 409 });
      }
      throw error;
    }

    const resultado = await recalcularProgresoDeMaterial(materialId, quien.correo);
    return NextResponse.json({ ok: true, completado: true, enviadaEl: ahora, ...(resultado ?? {}) }, { headers: SIN_CACHE });
  } catch (error) {
    registrarErrorSinDatos('POST .../materials/[materialId]/formulario', error);
    return NextResponse.json({ error: 'No se pudieron guardar las respuestas. Intente de nuevo.' }, { status: 500 });
  }
}

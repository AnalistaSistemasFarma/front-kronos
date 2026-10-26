import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { identificar } from '@/lib/portal/acceso';
import { resolverNombreEstudiante } from '@/lib/portal/formacion';
import { accesoAlCurso, esFormadorFormacion } from '@/lib/formacion/servidor';
import { armarHilo, limpiarTexto } from '@/lib/formacion/preguntas';

/**
 * FORMACIÓN — preguntas y respuestas de un material (Nicolás Rivera, 2026-10-26).
 *
 *   GET  /api/portal/materials/:materialId/preguntas
 *   POST /api/portal/materials/:materialId/preguntas   { texto, parentId? }
 *
 * Las ve y las escribe quien puede ver el curso. A nadie se le muestra el
 * correo de los demás: solo el nombre y si es formador.
 */
const SIN_CACHE = { 'Cache-Control': 'no-store' };

function idMaterial(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function materialYAcceso(request: NextRequest, materialIdTxt: string) {
  const quien = await identificar(request);
  if (!quien) return { error: NextResponse.json({ error: 'Sesión no válida.' }, { status: 401, headers: SIN_CACHE }) };
  const materialId = idMaterial(materialIdTxt);
  if (!materialId) return { error: NextResponse.json({ error: 'Material no válido.' }, { status: 400, headers: SIN_CACHE }) };
  const material = await prisma.portalCourseMaterial.findFirst({
    where: { id: materialId, eliminado_at: null },
    select: { id: true, course_id: true },
  });
  if (!material) return { error: NextResponse.json({ error: 'Material no encontrado.' }, { status: 404, headers: SIN_CACHE }) };
  const acceso = await accesoAlCurso(quien.correo, material.course_id);
  if (!acceso.puede) return { error: NextResponse.json({ error: 'Este curso no está disponible.' }, { status: 404, headers: SIN_CACHE }) };
  return { quien, material, acceso };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  try {
    const r = await materialYAcceso(request, (await params).materialId);
    if ('error' in r) return r.error;
    const filas = await prisma.formacionPregunta.findMany({
      where: { material_id: r.material.id },
      orderBy: { id: 'asc' },
      take: 1000,
      select: {
        id: true,
        parent_id: true,
        email: true,
        nombre: true,
        texto: true,
        created_at: true,
        eliminado_at: true,
        _count: { select: { likes: true } },
        likes: { where: { email: r.quien.correo.toLowerCase() }, select: { id: true } },
      },
    });
    const autores = [...new Set(filas.map((f) => f.email.toLowerCase()))];
    const formadores = new Set<string>();
    for (const a of autores) if (await esFormadorFormacion(a)) formadores.add(a);
    const preguntas = armarHilo(
      filas.map((f) => ({
        id: f.id,
        parent_id: f.parent_id,
        email: f.email,
        nombre: f.nombre,
        texto: f.texto,
        created_at: f.created_at,
        eliminado_at: f.eliminado_at,
        likes: f._count.likes,
        meGusta: f.likes.length > 0,
      })),
      r.quien.correo,
      formadores
    );
    const total = filas.filter((f) => !f.eliminado_at).length;
    return NextResponse.json({ preguntas, total, modera: r.acceso.modera }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] GET preguntas', error);
    return NextResponse.json({ error: 'No se pudieron cargar las preguntas.' }, { status: 502, headers: SIN_CACHE });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  try {
    const r = await materialYAcceso(request, (await params).materialId);
    if ('error' in r) return r.error;
    const body = await request.json().catch(() => null);
    const limpio = limpiarTexto(body?.texto);
    if (!limpio.ok) return NextResponse.json({ error: limpio.error }, { status: 400, headers: SIN_CACHE });
    let parentId: number | null = null;
    if (body?.parentId !== undefined && body?.parentId !== null) {
      const padre = await prisma.formacionPregunta.findFirst({
        where: { id: Number(body.parentId), material_id: r.material.id, eliminado_at: null },
        select: { id: true, parent_id: true },
      });
      if (!padre) return NextResponse.json({ error: 'La pregunta que responde ya no existe.' }, { status: 404, headers: SIN_CACHE });
      // Un solo nivel de respuestas: responder a una respuesta cuelga del mismo hilo.
      parentId = padre.parent_id ?? padre.id;
    }
    const creada = await prisma.formacionPregunta.create({
      data: {
        material_id: r.material.id,
        course_id: r.material.course_id,
        parent_id: parentId,
        email: r.quien.correo.toLowerCase(),
        nombre: await resolverNombreEstudiante(r.quien.correo),
        texto: limpio.texto,
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: creada.id }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] POST preguntas', error);
    return NextResponse.json({ error: 'No se pudo publicar.' }, { status: 500, headers: SIN_CACHE });
  }
}

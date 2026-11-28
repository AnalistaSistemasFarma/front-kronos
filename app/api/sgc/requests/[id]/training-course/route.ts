import { prisma } from '@/lib/prisma';
import { companyOfRequest } from '@/lib/sgc/db/requests';
import { availableCourses, linkedCourseOfRequest, setTrainingCourse } from '@/lib/sgc/db/trainingCourse';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * CURSO DE FORMACIÓN de la capacitación (2026-11-26).
 * GET  /api/sgc/requests/<id>/training-course → { linked, courses[] } (cursos activos de la empresa o de GSS).
 * POST /api/sgc/requests/<id>/training-course { courseId | null } → liga (o quita) el curso e inscribe a la divulgación.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const company = await companyOfRequest(prisma, id);
    const access = companyAccess(ctx, company);
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    const [linked, courses] = await Promise.all([linkedCourseOfRequest(prisma, id), availableCourses(prisma, access.idCompany)]);
    return jsonNoStore({ linked: linked?.course ?? null, courses });
  } catch (error) {
    return errorResponse(error, 'requests:capacitacion:curso');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    return jsonNoStore(await setTrainingCourse(prisma, access, id, body.courseId, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:capacitacion:curso');
  }
}

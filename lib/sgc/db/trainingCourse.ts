import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import type { SgcCompanyAccess } from '../permissions';
import type { SgcActor, SgcDb } from './catalogs';
import { assertTrainingManager, openTrainingTask, trainingOfRequest, trainingScopeEmails } from './training';

/**
 * CAPACITACIÓN DEL SGC CON UN CURSO DE FORMACIÓN (2026-11-26; reunión de Nicolás Rivera con Juan Mora del 2026-11-23:
 * «primero configuro el curso en Formación y en la solicitud documental elijo ese curso»). Quien gestiona la capacitación
 * elige un curso ACTIVO de Formación (de la empresa o de GSS); las personas de la divulgación quedan INSCRITAS en el curso
 * (también las que se agreguen después), y su avance y certificado se ven en la capacitación de la solicitud.
 * El vínculo vive en dbo.sgc_training_course: el esquema validado `sgc` no cambia.
 */

type Tx = Prisma.TransactionClient;
type Db = SgcDb | Tx;
const lower = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export interface CourseOption {
  id: number;
  title: string;
}

/** Cursos que se pueden elegir: activos, no eliminados, de la empresa de la solicitud o de GSS (sin empresa dueña). */
export async function availableCourses(db: Db, idCompany: number): Promise<CourseOption[]> {
  const rows = await db.portalCourse.findMany({
    where: { active: true, eliminado_at: null, OR: [{ id_company_owner: idCompany }, { id_company_owner: null }] },
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
    take: 500,
  });
  return rows;
}

export async function linkedCourseOfRequest(db: Db, idRequest: number): Promise<{ idTraining: number; course: CourseOption } | null> {
  const t = await trainingOfRequest(db, idRequest);
  if (!t) return null;
  const link = await db.sgcTrainingCourse.findUnique({ where: { id_training: t.id_training } });
  if (!link) return null;
  const c = await db.portalCourse.findUnique({ where: { id: link.course_id }, select: { id: true, title: true } });
  return c ? { idTraining: t.id_training, course: c } : null;
}

/** Inscribe en el curso ligado a la capacitación de la solicitud (sin repetir inscripciones). Devuelve cuántas creó. */
export async function enrollInLinkedCourse(db: Db, idRequest: number, emails: readonly string[]): Promise<number> {
  const linked = await linkedCourseOfRequest(db, idRequest);
  const list = [...new Set(emails.map(lower).filter((e) => e.includes('@')))];
  if (!linked || !list.length) return 0;
  // SQL Server: Prisma no tiene skipDuplicates; se omiten las inscripciones que ya existen.
  const have = new Set((await db.portalCourseEnrollment.findMany({ where: { course_id: linked.course.id, student_email: { in: list } }, select: { student_email: true } })).map((x) => lower(x.student_email)));
  const nuevos = list.filter((e) => !have.has(e));
  if (!nuevos.length) return 0;
  const r = await db.portalCourseEnrollment.createMany({ data: nuevos.map((e) => ({ course_id: linked.course.id, student_email: e })) });
  return r.count;
}

/** Elige (o quita, con null) el curso de Formación de la capacitación; inscribe a quienes ya están en la divulgación. */
export async function setTrainingCourse(db: SgcDb, access: SgcCompanyAccess, idRequest: number, rawCourseId: unknown, actor: SgcActor) {
  const { request, task } = await openTrainingTask(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  assertTrainingManager(access, task, actor.email, 'elige el curso de Formación');
  if (request.status !== 'abierta' || !task || task.status !== 'abierta') throw new SgcError('La solicitud no está en el paso de capacitación.', 409);
  const t = await trainingOfRequest(db, idRequest);
  if (!t) throw new SgcError('Registre primero la capacitación (título y evaluación) y después elija el curso de Formación.', 409);
  const courseId = rawCourseId === null || rawCourseId === undefined || rawCourseId === '' ? null : Number(rawCourseId);
  const me = lower(actor.email);
  if (courseId === null) {
    await db.sgcTrainingCourse.deleteMany({ where: { id_training: t.id_training } });
    await writeSgcAudit(db, { idCompany: request.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.capacitacionRegistrada, entity: 'training', entityId: t.id_training, before: null, after: { cursoFormacion: null }, ip: actor.ip, userAgent: actor.userAgent });
    return { courseId: null, enrolled: 0 };
  }
  const ok = (await availableCourses(db, request.id_company)).find((c) => c.id === courseId);
  if (!ok) throw new SgcError('El curso no está activo en Formación o no es de esta empresa.', 400);
  await db.sgcTrainingCourse.upsert({ where: { id_training: t.id_training }, create: { id_training: t.id_training, course_id: courseId, linked_by: me }, update: { course_id: courseId, linked_by: me, linked_at: new Date() } });
  const enrolled = await enrollInLinkedCourse(db, idRequest, await trainingScopeEmails(db, idRequest));
  await writeSgcAudit(db, { idCompany: request.id_company, actorEmail: me, action: SGC_AUDIT_ACTIONS.capacitacionRegistrada, entity: 'training', entityId: t.id_training, before: null, after: { cursoFormacion: { id: ok.id, titulo: ok.title }, inscritos: enrolled }, ip: actor.ip, userAgent: actor.userAgent });
  return { courseId, enrolled };
}

/** Avance (% de materiales completados) y certificado de cada persona en el curso ligado. */
export async function courseProgress(db: Db, courseId: number, emails: readonly string[]): Promise<Map<string, { pct: number; certified: boolean }>> {
  const out = new Map<string, { pct: number; certified: boolean }>();
  const list = [...new Set(emails.map(lower))];
  if (!list.length) return out;
  const materials = await db.portalCourseMaterial.findMany({ where: { course_id: courseId }, select: { id: true } });
  const ids = materials.map((m) => m.id);
  const done = ids.length ? await db.portalMaterialProgress.findMany({ where: { material_id: { in: ids }, student_email: { in: list } }, select: { student_email: true } }) : [];
  const certs = await db.portalCertificate.findMany({ where: { course_id: courseId, student_email: { in: list } }, select: { student_email: true } });
  const count = new Map<string, number>();
  for (const d of done) count.set(lower(d.student_email), (count.get(lower(d.student_email)) ?? 0) + 1);
  const certified = new Set(certs.map((c) => lower(c.student_email)));
  for (const e of list) out.set(e, { pct: ids.length ? Math.round(((count.get(e) ?? 0) / ids.length) * 100) : 0, certified: certified.has(e) });
  return out;
}

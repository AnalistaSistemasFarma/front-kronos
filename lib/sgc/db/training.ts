import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import type { SgcCompanyAccess } from '../permissions';
import { toCalendarDate, formatCalendarDate } from '../review';
import { sha256HexOf } from '../signature/record';
import { SGC_TRAINING_MODE_LABELS, evaluateTrainingResults, normalizeTrainingConfig, trainingNeedsJustification, type SgcTrainingEvaluation, type SgcTrainingMode } from '../training/results';
import { readFirstSheetRows } from '../training/xlsx';
import type { SgcActor, SgcDb } from './catalogs';
import type { SgcUploader } from './documents';

/**
 * CAPACITACIÓN del SGC (Sprint 4, paso 5 del flujo documental): registro de
 * la sesión o el video y la evaluación de Microsoft Forms, carga del Excel de
 * resultados (solo inserción: cada carga nueva reemplaza a la anterior como
 * vigente) y vista de quién aprobó, reprobó o falta. La cierra Calidad con la
 * firma «Capacitó» sobre el Excel de resultados (servicio de firma del S3).
 */

type Tx = Prisma.TransactionClient;
type Db = SgcDb | Tx;

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

async function openTrainingTask(db: Db, idRequest: number) {
  const request = await db.sgcRequest.findUnique({ where: { id_request: idRequest }, include: { tasks: { include: { taskDef: true }, orderBy: { id_task: 'asc' } } } });
  if (!request) throw new SgcError('Solicitud no encontrada.', 404);
  const task = request.tasks.filter((t) => t.taskDef.role === 'capacitacion').at(-1) ?? null;
  return { request, task };
}

/** Personas que deben capacitarse: las del alcance de la divulgación que no fueron excluidas. */
export async function trainingScopeEmails(db: Db, idRequest: number): Promise<string[]> {
  const rows = await db.sgcReadRecord.findMany({ where: { id_request: idRequest, status: { not: 'excluido' } }, select: { user_email: true } });
  return [...new Set(rows.map((r) => lower(r.user_email)))].sort();
}

/** Registra o ajusta la capacitación (Calidad, con la tarea de capacitación abierta). */
export async function saveTraining(db: SgcDb, access: SgcCompanyAccess, idRequest: number, raw: unknown, actor: SgcActor) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad registra la capacitación.', 403);
  const cfg = normalizeTrainingConfig(raw);
  const { request, task } = await openTrainingTask(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  if (request.status !== 'abierta' || !task || task.status !== 'abierta') throw new SgcError('La solicitud no está en el paso de capacitación.', 409);
  const now = new Date();
  const me = lower(actor.email);
  return db.$transaction(async (tx) => {
    const prev = await tx.sgcTraining.findUnique({ where: { id_task: task.id_task }, include: { uploads: { select: { id_training_upload: true }, take: 1 } } });
    if (prev && prev.uploads.length && (Number(prev.max_score) !== cfg.maxScore || Number(prev.min_score_pct) !== cfg.minScorePct)) {
      throw new SgcError('Ya hay resultados cargados: para cambiar el puntaje máximo o la nota mínima, cárguelos de nuevo después de guardar (se evalúan con la configuración vigente al cargarlos).', 409);
    }
    const data = {
      mode: cfg.mode,
      title: cfg.title,
      video_url: cfg.videoUrl,
      forms_url: cfg.formsUrl,
      session_date: cfg.sessionDate ? toCalendarDate(cfg.sessionDate) : null,
      instructor: cfg.instructor,
      max_score: cfg.maxScore,
      min_score_pct: cfg.minScorePct,
      notes: cfg.notes,
      updated_by: me,
      updated_at: now,
    };
    const row = prev
      ? await tx.sgcTraining.update({ where: { id_training: prev.id_training }, data })
      : await tx.sgcTraining.create({ data: { ...data, id_request: idRequest, id_task: task.id_task, registered_by: me, registered_at: now } });
    await tx.sgcInteraction.create({
      data: {
        id_request: idRequest,
        id_task: task.id_task,
        kind: 'estado',
        author_email: me,
        body: `${prev ? 'Actualizó' : 'Registró'} la capacitación: ${cfg.title} (${SGC_TRAINING_MODE_LABELS[cfg.mode]}${cfg.sessionDate ? `, sesión ${cfg.sessionDate}` : ''}). Evaluación en Forms; nota mínima ${cfg.minScorePct} % de ${cfg.maxScore} puntos.`,
      },
    });
    await writeSgcAudit(tx, {
      idCompany: request.id_company,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.capacitacionRegistrada,
      entity: 'training',
      entityId: row.id_training,
      before: prev ? { mode: prev.mode, title: prev.title, videoUrl: prev.video_url, formsUrl: prev.forms_url, sessionDate: formatCalendarDate(prev.session_date), maxScore: Number(prev.max_score), minScorePct: Number(prev.min_score_pct) } : null,
      after: cfg,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { idTraining: row.id_training };
  });
}

/**
 * Carga el Excel de resultados de Forms: lo lee, lo evalúa contra el alcance
 * y la nota mínima, lo guarda en <raíz>/_capacitacion/SOL-<n>/ con su SHA-256
 * y deja los resultados por persona (solo inserción).
 */
export async function uploadTrainingResults(
  db: SgcDb,
  upload: SgcUploader,
  access: SgcCompanyAccess,
  idRequest: number,
  file: { fileName: string; bytes: Uint8Array },
  actor: SgcActor
) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad carga los resultados de la capacitación.', 403);
  const { request, task } = await openTrainingTask(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  if (request.status !== 'abierta' || !task || task.status !== 'abierta') throw new SgcError('La solicitud no está en el paso de capacitación.', 409);
  const training = await db.sgcTraining.findUnique({ where: { id_task: task.id_task } });
  if (!training) throw new SgcError('Registre primero la capacitación (modalidad, video o sesión, evaluación y nota mínima).', 409);
  const fileName = file.fileName.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 200) || 'resultados.xlsx';
  if (!/\.xlsx$/i.test(fileName)) throw new SgcError('El archivo de resultados debe ser un Excel (.xlsx) exportado de Microsoft Forms.');
  const rows = await readFirstSheetRows(file.bytes);
  const scope = await trainingScopeEmails(db, idRequest);
  const maxScore = Number(training.max_score);
  const minScorePct = Number(training.min_score_pct);
  const evaluation = evaluateTrainingResults(rows, { maxScore, minScorePct, scopeEmails: scope });
  const config = await db.sgcCompanyConfig.findUniqueOrThrow({ where: { id_company: request.id_company } });
  const segments = [...config.storage_root.split('/').filter(Boolean), '_capacitacion', `SOL-${idRequest}`];
  const sha = sha256HexOf(file.bytes);
  const stamped = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}_${fileName}`;
  const item = await upload(segments, stamped, file.bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const now = new Date();
  const me = lower(actor.email);
  const s = evaluation.summary;
  return db.$transaction(async (tx) => {
    const up = await tx.sgcTrainingUpload.create({
      data: {
        id_training: training.id_training,
        file_name: fileName,
        item_id: item.id,
        storage_path: `${segments.join('/')}/${stamped}`,
        sha256: sha,
        size_bytes: file.bytes.length,
        max_score: maxScore,
        min_score_pct: minScorePct,
        rows_total: s.rows,
        people: s.people,
        in_scope: s.inScope,
        passed: s.passed,
        failed: s.failed,
        out_of_scope: s.outOfScope,
        missing_json: JSON.stringify(s.missing),
        rejected_json: JSON.stringify(s.rejected.slice(0, 500)),
        uploaded_by: me,
        uploaded_at: now,
      },
    });
    if (evaluation.results.length) {
      await tx.sgcTrainingResult.createMany({
        data: evaluation.results.map((r) => ({ id_training_upload: up.id_training_upload, user_email: r.email, full_name: r.name, score: r.score, percent: r.percent, passed: r.passed, attempts: r.attempts, in_scope: r.inScope, completed_at_text: r.completedAt })),
      });
    }
    await tx.sgcInteraction.create({
      data: {
        id_request: idRequest,
        id_task: task.id_task,
        kind: 'adjunto',
        author_email: me,
        body: `Cargó los resultados de la capacitación: ${fileName} (SHA-256 ${sha}).\nDel alcance (${scope.length}): ${s.passed} aprobaron, ${s.failed} reprobaron y ${s.missing.length} sin resultado. Fuera del alcance: ${s.outOfScope}. Filas no leídas: ${s.rejected.length}.`,
        meta_json: JSON.stringify({ idTrainingUpload: up.id_training_upload, sha256: sha }),
      },
    });
    await writeSgcAudit(tx, {
      idCompany: request.id_company,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.capacitacionResultados,
      entity: 'training_upload',
      entityId: up.id_training_upload,
      after: { idRequest, fileName, sha256: sha, maxScore, minScorePct, summary: { ...s, rejected: s.rejected.length } },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { idTrainingUpload: up.id_training_upload, sha256: sha, summary: s };
  }, { maxWait: 10_000, timeout: 60_000 });
}

/** Última carga de resultados de la capacitación de una tarea (la vigente). */
export async function latestTrainingUpload(db: Db, idTask: number) {
  const training = await db.sgcTraining.findUnique({ where: { id_task: idTask } });
  if (!training) return null;
  const up = await db.sgcTrainingUpload.findFirst({ where: { id_training: training.id_training }, orderBy: { id_training_upload: 'desc' } });
  return up ? { training, upload: up } : null;
}

/** Resumen de la última carga (para exigir justificación al cerrar). */
export function uploadSummary(up: { rows_total: number; people: number; in_scope: number; passed: number; failed: number; out_of_scope: number; missing_json: string; rejected_json: string }): SgcTrainingEvaluation['summary'] {
  return {
    rows: up.rows_total,
    people: up.people,
    inScope: up.in_scope,
    passed: up.passed,
    failed: up.failed,
    outOfScope: up.out_of_scope,
    missing: JSON.parse(up.missing_json) as string[],
    rejected: JSON.parse(up.rejected_json) as { row: number; reason: string }[],
  };
}

export { trainingNeedsJustification };

export interface SgcTrainingView {
  idTask: number | null;
  open: boolean;
  canManage: boolean;
  training: {
    id: number;
    mode: SgcTrainingMode;
    modeLabel: string;
    title: string;
    videoUrl: string | null;
    formsUrl: string | null;
    sessionDate: string | null;
    instructor: string | null;
    maxScore: number;
    minScorePct: number;
    notes: string | null;
    registeredBy: string | null;
    registeredAt: string;
  } | null;
  upload: {
    id: number;
    fileName: string;
    sha256: string;
    uploadedBy: string | null;
    uploadedAt: string;
    summary: SgcTrainingEvaluation['summary'];
    needsJustification: boolean;
  } | null;
  uploadsCount: number;
  people: { email: string; name: string | null; status: 'aprobo' | 'reprobo' | 'sin_resultado'; score: number | null; percent: number | null; attempts: number | null }[];
  outOfScope: { email: string; name: string | null; score: number; percent: number }[];
}

export async function getTrainingView(
  db: SgcDb,
  request: { id_request: number; status: string; tasks: { id_task: number; status: string; taskDef: { role: string } }[] },
  viewer: { isQuality: boolean },
  names: (email: string | null) => string | null
): Promise<SgcTrainingView | null> {
  const task = request.tasks.filter((t) => t.taskDef.role === 'capacitacion').at(-1) ?? null;
  if (!task) return null;
  const training = await db.sgcTraining.findUnique({ where: { id_task: task.id_task }, include: { uploads: { orderBy: { id_training_upload: 'desc' }, include: { results: true } } } });
  const up = training?.uploads[0] ?? null;
  const scope = await trainingScopeEmails(db, request.id_request);
  const byEmail = new Map((up?.results ?? []).map((r) => [lower(r.user_email), r]));
  const open = request.status === 'abierta' && task.status === 'abierta';
  const summary = up ? uploadSummary(up) : null;
  return {
    idTask: task.id_task,
    open,
    canManage: open && viewer.isQuality,
    training: training
      ? {
          id: training.id_training,
          mode: training.mode as SgcTrainingMode,
          modeLabel: SGC_TRAINING_MODE_LABELS[training.mode as SgcTrainingMode] ?? training.mode,
          title: training.title,
          videoUrl: training.video_url,
          formsUrl: training.forms_url,
          sessionDate: formatCalendarDate(training.session_date),
          instructor: training.instructor,
          maxScore: Number(training.max_score),
          minScorePct: Number(training.min_score_pct),
          notes: training.notes,
          registeredBy: names(training.registered_by),
          registeredAt: training.registered_at.toISOString(),
        }
      : null,
    upload: up && summary ? { id: up.id_training_upload, fileName: up.file_name, sha256: up.sha256.trim(), uploadedBy: names(up.uploaded_by), uploadedAt: up.uploaded_at.toISOString(), summary, needsJustification: trainingNeedsJustification(summary) } : null,
    uploadsCount: training?.uploads.length ?? 0,
    people: scope.map((email) => {
      const r = byEmail.get(email);
      return {
        email,
        name: r?.full_name ?? names(email),
        status: !r ? ('sin_resultado' as const) : r.passed ? ('aprobo' as const) : ('reprobo' as const),
        score: r ? Number(r.score) : null,
        percent: r ? Number(r.percent) : null,
        attempts: r?.attempts ?? null,
      };
    }),
    outOfScope: (up?.results ?? []).filter((r) => !r.in_scope).map((r) => ({ email: r.user_email, name: r.full_name, score: Number(r.score), percent: Number(r.percent) })),
  };
}

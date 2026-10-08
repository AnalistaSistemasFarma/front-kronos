import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import type { SgcCompanyAccess } from '../permissions';
import { toCalendarDate, formatCalendarDate } from '../review';
import { sha256HexOf } from '../signature/record';
import { SGC_EVALUATION_PROVIDER_LABELS, SGC_TRAINING_MODE_LABELS, evaluateTrainingResults, normalizeTrainingConfig, trainingNeedsJustification, type SgcTrainingEvaluation, type SgcTrainingMode } from '../training/results';
import { readTrainingRows } from '../training/xlsx';
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

/** Sprint 10: pasos de la capacitación (preparación del material antes de la divulgación, y resultados). */
const TRAINING_ROLES = ['material', 'capacitacion'];

async function openTrainingTask(db: Db, idRequest: number) {
  const request = await db.sgcRequest.findUnique({ where: { id_request: idRequest }, include: { tasks: { include: { taskDef: true }, orderBy: { id_task: 'asc' } } } });
  if (!request) throw new SgcError('Solicitud no encontrada.', 404);
  const task = request.tasks.filter((t) => TRAINING_ROLES.includes(t.taskDef.role)).at(-1) ?? null;
  return { request, task };
}

/**
 * Sprint 10: la capacitación de la SOLICITUD (una por solicitud). Desde el
 * flujo con preparación previa queda registrada en la tarea del material y se
 * usa después en la divulgación y en la tarea de resultados.
 */
export async function trainingOfRequest(db: Db, idRequest: number) {
  return db.sgcTraining.findFirst({ where: { id_request: idRequest }, orderBy: { id_training: 'desc' } });
}

/** Capacitación de la solicitud de una tarea (para firmar «Capacitó» sobre sus resultados). */
export async function trainingForTask(db: Db, idTask: number) {
  const task = await db.sgcTask.findUnique({ where: { id_task: idTask }, select: { id_request: true } });
  return task ? trainingOfRequest(db, task.id_request) : null;
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
  if (request.status !== 'abierta' || !task || task.status !== 'abierta') throw new SgcError('La solicitud no está en el paso de capacitación (preparación del material o resultados).', 409);
  const now = new Date();
  const me = lower(actor.email);
  return db.$transaction(async (tx) => {
    const found = await trainingOfRequest(tx, idRequest);
    const prev = found ? await tx.sgcTraining.findUnique({ where: { id_training: found.id_training }, include: { uploads: { select: { id_training_upload: true }, take: 1 } } }) : null;
    if (prev && prev.uploads.length && (Number(prev.max_score) !== cfg.maxScore || Number(prev.min_score_pct) !== cfg.minScorePct || prev.max_attempts !== cfg.maxAttempts)) {
      throw new SgcError('Ya hay resultados cargados: para cambiar el puntaje máximo, la nota mínima o los intentos, cárguelos de nuevo después de guardar (se evalúan con la configuración vigente al cargarlos).', 409);
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
      evaluation_provider: cfg.evaluationProvider,
      max_attempts: cfg.maxAttempts,
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
        body: `${prev ? 'Actualizó' : 'Registró'} la capacitación: ${cfg.title} (${SGC_TRAINING_MODE_LABELS[cfg.mode]}${cfg.sessionDate ? `, sesión ${cfg.sessionDate}` : ''}). Evaluación en ${SGC_EVALUATION_PROVIDER_LABELS[cfg.evaluationProvider]}; nota mínima ${cfg.minScorePct} % de ${cfg.maxScore} puntos; ${cfg.maxAttempts} intento(s).`,
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
  // Sprint 10: los resultados se cargan en la tarea de CAPACITACIÓN (no en la de preparación del material).
  if (request.status !== 'abierta' || !task || task.status !== 'abierta' || task.taskDef.role !== 'capacitacion') throw new SgcError('La solicitud no está en el paso de capacitación.', 409);
  const training = await trainingOfRequest(db, idRequest);
  if (!training) throw new SgcError('Registre primero la capacitación (modalidad, video o sesión, evaluación y nota mínima).', 409);
  const fileName = file.fileName.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 200) || 'resultados.xlsx';
  if (!/\.(xlsx|csv)$/i.test(fileName)) throw new SgcError('El archivo de resultados debe ser un Excel (.xlsx) o un CSV exportado de Microsoft Forms o Google Forms.');
  const rows = await readTrainingRows(file.bytes, fileName);
  const scope = await trainingScopeEmails(db, idRequest);
  const maxScore = Number(training.max_score);
  const minScorePct = Number(training.min_score_pct);
  const evaluation = evaluateTrainingResults(rows, { maxScore, minScorePct, scopeEmails: scope, maxAttempts: training.max_attempts });
  const config = await db.sgcCompanyConfig.findUniqueOrThrow({ where: { id_company: request.id_company } });
  const segments = [...config.storage_root.split('/').filter(Boolean), '_capacitacion', `SOL-${idRequest}`];
  const sha = sha256HexOf(file.bytes);
  const stamped = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}_${fileName}`;
  const item = await upload(segments, stamped, file.bytes, /\.csv$/i.test(fileName) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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
        data: evaluation.results.map((r) => ({ id_training_upload: up.id_training_upload, user_email: r.email, full_name: r.name, score: r.score, percent: r.percent, passed: r.passed, attempts: r.attempts, in_scope: r.inScope, completed_at_text: r.completedAt, attempt_number: r.attemptNumber, extra_attempts: r.extraAttempts, retraining_required: r.retrainingRequired })),
      });
    }
    await tx.sgcInteraction.create({
      data: {
        id_request: idRequest,
        id_task: task.id_task,
        kind: 'adjunto',
        author_email: me,
        body: `Cargó los resultados de la capacitación: ${fileName} (SHA-256 ${sha}).\nDel alcance (${scope.length}): ${s.passed} aprobaron, ${s.failed} reprobaron (${s.retraining ?? 0} quedan en recapacitación) y ${s.missing.length} sin resultado. Fuera del alcance: ${s.outOfScope}. Filas no leídas: ${s.rejected.length}.`,
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
  // Sprint 10: la capacitación es de la solicitud (puede haberse registrado en la tarea del material).
  const training = await trainingForTask(db, idTask);
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
  /** Sprint 10: «material» = preparación antes de la divulgación; «resultados» = carga y cierre. */
  phase: 'material' | 'resultados';
  canManage: boolean;
  /** Sprint 10: Calidad puede cargar resultados (solo en la tarea de capacitación abierta). */
  canUpload: boolean;
  /** Sprint 10: Calidad registra recapacitaciones (también después del cierre). */
  canRetrain: boolean;
  training: {
    id: number;
    mode: SgcTrainingMode;
    modeLabel: string;
    title: string;
    videoUrl: string | null;
    formsUrl: string | null;
    evaluationProvider: string | null;
    evaluationProviderLabel: string | null;
    maxAttempts: number;
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
  people: {
    email: string;
    name: string | null;
    status: 'aprobo' | 'reprobo' | 'recapacitacion' | 'sin_resultado';
    score: number | null;
    percent: number | null;
    attempts: number | null;
    attemptNumber: number | null;
    extraAttempts: number;
    retrainings: { mode: string; sessionDate: string | null; result: string; notes: string | null; registeredBy: string | null; registeredAt: string }[];
  }[];
  outOfScope: { email: string; name: string | null; score: number; percent: number }[];
}

export async function getTrainingView(
  db: SgcDb,
  request: { id_request: number; status: string; tasks: { id_task: number; status: string; taskDef: { role: string } }[] },
  viewer: { isQuality: boolean },
  names: (email: string | null) => string | null
): Promise<SgcTrainingView | null> {
  const task = request.tasks.filter((t) => TRAINING_ROLES.includes(t.taskDef.role)).at(-1) ?? null;
  if (!task) return null;
  const found = await trainingOfRequest(db, request.id_request);
  const training = found ? await db.sgcTraining.findUnique({ where: { id_training: found.id_training }, include: { uploads: { orderBy: { id_training_upload: 'desc' }, include: { results: true } }, retrainings: { orderBy: { id_retraining: 'asc' } } } }) : null;
  const up = training?.uploads[0] ?? null;
  const scope = await trainingScopeEmails(db, request.id_request);
  const byEmail = new Map((up?.results ?? []).map((r) => [lower(r.user_email), r]));
  const open = request.status === 'abierta' && task.status === 'abierta';
  const phase = task.taskDef.role === 'material' ? ('material' as const) : ('resultados' as const);
  const summary = up ? uploadSummary(up) : null;
  const retrainingsOf = (email: string) =>
    (training?.retrainings ?? [])
      .filter((x) => lower(x.user_email) === email)
      .map((x) => ({ mode: x.mode, sessionDate: formatCalendarDate(x.session_date), result: x.result, notes: x.notes, registeredBy: names(x.registered_by), registeredAt: x.registered_at.toISOString() }));
  return {
    idTask: task.id_task,
    open,
    phase,
    canManage: open && viewer.isQuality,
    canUpload: open && viewer.isQuality && phase === 'resultados',
    canRetrain: viewer.isQuality && Boolean(up),
    training: training
      ? {
          id: training.id_training,
          mode: training.mode as SgcTrainingMode,
          modeLabel: SGC_TRAINING_MODE_LABELS[training.mode as SgcTrainingMode] ?? training.mode,
          title: training.title,
          videoUrl: training.video_url,
          formsUrl: training.forms_url,
          evaluationProvider: training.evaluation_provider,
          evaluationProviderLabel: training.evaluation_provider ? (SGC_EVALUATION_PROVIDER_LABELS[training.evaluation_provider as keyof typeof SGC_EVALUATION_PROVIDER_LABELS] ?? training.evaluation_provider) : null,
          maxAttempts: training.max_attempts,
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
        status: !r ? ('sin_resultado' as const) : r.passed ? ('aprobo' as const) : r.retraining_required ? ('recapacitacion' as const) : ('reprobo' as const),
        score: r ? Number(r.score) : null,
        percent: r ? Number(r.percent) : null,
        attempts: r?.attempts ?? null,
        attemptNumber: r?.attempt_number ?? null,
        extraAttempts: r?.extra_attempts ?? 0,
        retrainings: retrainingsOf(email),
      };
    }),
    outOfScope: (up?.results ?? []).filter((r) => !r.in_scope).map((r) => ({ email: r.user_email, name: r.full_name, score: Number(r.score), percent: Number(r.percent) })),
  };
}

export const SGC_RETRAINING_MODES = ['presencial', 'virtual'] as const;
export const SGC_RETRAINING_RESULTS = ['asistio', 'aprobo', 'reprobo'] as const;

/**
 * Sprint 10 — RECAPACITACIÓN: Calidad registra la sesión presencial o virtual
 * de quien no aprobó en los intentos permitidos (decisión D6: reprobar no
 * bloquea la vigencia; tras la recapacitación hay una evaluación nueva).
 * Se puede registrar también después de cerrar la capacitación. Solo inserción.
 */
export async function recordRetraining(db: SgcDb, access: SgcCompanyAccess, idRequest: number, raw: unknown, actor: SgcActor) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad registra la recapacitación.', 403);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const request = await db.sgcRequest.findUnique({ where: { id_request: idRequest } });
  if (!request || request.id_company !== access.idCompany) throw new SgcError('Solicitud no encontrada.', 404);
  const training = await trainingOfRequest(db, idRequest);
  const up = training ? await db.sgcTrainingUpload.findFirst({ where: { id_training: training.id_training }, orderBy: { id_training_upload: 'desc' }, include: { results: true } }) : null;
  if (!training || !up) throw new SgcError('La capacitación aún no tiene resultados cargados.', 409);
  const email = lower(typeof r.email === 'string' ? r.email : '');
  const result = up.results.find((x) => lower(x.user_email) === email && x.in_scope);
  if (!result || !result.retraining_required) throw new SgcError('Esa persona no está en recapacitación (no reprobó en los intentos permitidos).', 409);
  if (!(SGC_RETRAINING_MODES as readonly string[]).includes(String(r.mode))) throw new SgcError('Indique si la recapacitación fue presencial o virtual.');
  if (!(SGC_RETRAINING_RESULTS as readonly string[]).includes(String(r.result))) throw new SgcError('Indique el resultado de la recapacitación: asistió, aprobó o reprobó.');
  const date = typeof r.sessionDate === 'string' ? r.sessionDate.trim().slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new SgcError('La fecha de la recapacitación debe ser AAAA-MM-DD.');
  const notes = typeof r.notes === 'string' && r.notes.trim() ? r.notes.trim().slice(0, 1000) : null;
  const me = lower(actor.email);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const row = await tx.sgcRetraining.create({ data: { id_request: idRequest, id_training: training.id_training, user_email: email, mode: String(r.mode), session_date: toCalendarDate(date), result: String(r.result), notes, registered_by: me, registered_at: now } });
    await tx.sgcInteraction.create({
      data: { id_request: idRequest, kind: 'estado', author_email: me, body: `Registró la recapacitación ${r.mode === 'presencial' ? 'presencial' : 'virtual'} de ${email} del ${date}: ${r.result === 'asistio' ? 'asistió' : r.result === 'aprobo' ? 'aprobó' : 'reprobó'}.${notes ? `\n${notes}` : ''}` },
    });
    await writeSgcAudit(tx, {
      idCompany: request.id_company,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.capacitacionRecapacitacion,
      entity: 'retraining',
      entityId: row.id_retraining,
      after: { idRequest, email, mode: r.mode, sessionDate: date, result: r.result },
      detail: notes,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { idRetraining: row.id_retraining };
  });
}

import ExcelJS from 'exceljs';
import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import type { SgcCompanyAccess } from '../permissions';
import { sha256HexOf } from '../signature/record';
import {
  SGC_EVALUATION_REPORT_HEADERS,
  attemptRecordHash,
  bankHash,
  bankMaxScore,
  consolidateAttempts,
  gradeAttempt,
  nextAttempt,
  normalizeAnswers,
  normalizeQuestionBank,
  publicQuestions,
  reportRows,
  type SgcBankQuestion,
  type SgcPublicQuestion,
  type SgcQuestionKind,
} from '../training/evaluation';
import type { SgcActor, SgcDb } from './catalogs';
import type { SgcUploader } from './documents';
import { withSgcAppLock } from './lock';
import { isTrainingCreator, trainingOfRequest, trainingScopeEmails } from './training';

/**
 * EVALUACIONES PROPIAS EN SYNERLINK (S17–S18, R30). Ver
 * lib/sgc/training/evaluation.ts. Conviven con Microsoft Forms y Google
 * Forms: la capacitación elige su proveedor (evaluation_provider =
 * «synerlink»).
 *   - El creador del documento (o Calidad) arma el banco de preguntas en la
 *     preparación de la capacitación; con intentos presentados, el banco
 *     queda congelado.
 *   - El lector presenta la evaluación DESPUÉS de firmar su lectura
 *     obligatoria; el servidor la califica, aplica los intentos y guarda cada
 *     intento con su huella (solo inserción).
 *   - Al cerrar, el creador consolida los resultados: el SGC genera el Excel
 *     de resultados (reporte para la auditoría) y lo registra como la carga de
 *     resultados de la capacitación, así la recapacitación, la justificación y
 *     la firma «Capacitó» son las mismas que con Forms (sin cargar un Excel).
 */

type Tx = Prisma.TransactionClient;
type Db = SgcDb | Tx;

const lower = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/** Banco de preguntas de la capacitación (con las respuestas correctas: solo para el servidor y quien lo administra). */
export async function loadBank(db: Db, idTraining: number): Promise<SgcBankQuestion[]> {
  const rows = await db.sgcTrainingQuestion.findMany({ where: { id_training: idTraining }, include: { options: true }, orderBy: [{ sort_order: 'asc' }, { id_training_question: 'asc' }] });
  return rows.map((q) => ({
    id: q.id_training_question,
    kind: q.kind as SgcQuestionKind,
    text: q.text,
    points: Number(q.points),
    sortOrder: q.sort_order,
    options: q.options.map((o) => ({ id: o.id_training_option, text: o.text, correct: o.is_correct, sortOrder: o.sort_order })).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
  }));
}

async function trainingContext(db: Db, idRequest: number) {
  const request = await db.sgcRequest.findUnique({ where: { id_request: idRequest }, include: { tasks: { include: { taskDef: true, assignees: true }, orderBy: { id_task: 'asc' } } } });
  if (!request) throw new SgcError('Solicitud no encontrada.', 404);
  const task = request.tasks.filter((t) => t.taskDef.role === 'material' || t.taskDef.role === 'capacitacion').at(-1) ?? null;
  const training = await trainingOfRequest(db, idRequest);
  return { request, task, training };
}

function assertManager(access: SgcCompanyAccess, task: Parameters<typeof isTrainingCreator>[0], email: string) {
  if (access.canQuality || isTrainingCreator(task, email)) return;
  throw new SgcError(`Solo Aseguramiento de Calidad${task?.taskDef.assignment === 'creador' ? ' o el creador del documento' : ''} arma la evaluación.`, 403);
}

/** Banco para el EDITOR (creador o Calidad): incluye las respuestas correctas. */
export async function getEvaluationEditor(db: SgcDb, access: SgcCompanyAccess, idRequest: number, actor: SgcActor) {
  const { request, task, training } = await trainingContext(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  assertManager(access, task, actor.email);
  if (!training) return { training: null, questions: [], attempts: 0, locked: false };
  const attempts = await db.sgcTrainingAttempt.count({ where: { id_training: training.id_training } });
  return { training: { id: training.id_training, provider: training.evaluation_provider }, questions: await loadBank(db, training.id_training), attempts, locked: attempts > 0 };
}

/**
 * Guarda (reemplaza) el banco de preguntas. Solo con la capacitación de
 * proveedor SynerLink, su tarea abierta y SIN intentos presentados. El
 * puntaje máximo de la capacitación pasa a ser la suma de los puntajes.
 */
export async function saveQuestionBank(db: SgcDb, access: SgcCompanyAccess, idRequest: number, raw: { questions?: unknown }, actor: SgcActor) {
  const bank = normalizeQuestionBank(raw?.questions);
  const { request, task, training } = await trainingContext(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  assertManager(access, task, actor.email);
  if (request.status !== 'abierta' || !task || task.status !== 'abierta') throw new SgcError('La solicitud no está en la preparación ni en la capacitación.', 409);
  if (!training) throw new SgcError('Registre primero la capacitación (eligiendo «Evaluación en SynerLink»).', 409);
  if (training.evaluation_provider !== 'synerlink') throw new SgcError('Esta capacitación evalúa con Microsoft Forms o Google Forms: elija «Evaluación en SynerLink» para armar las preguntas aquí.', 409);
  const me = lower(actor.email);
  const now = new Date();
  return db.$transaction(async (tx) => {
    if (await tx.sgcTrainingAttempt.count({ where: { id_training: training.id_training } })) throw new SgcError('Ya hay personas que presentaron la evaluación: el banco de preguntas no se cambia.', 409);
    const before = await loadBank(tx, training.id_training);
    if (before.length) {
      const ids = before.map((q) => q.id);
      await tx.sgcTrainingOption.deleteMany({ where: { id_training_question: { in: ids } } });
      await tx.sgcTrainingQuestion.deleteMany({ where: { id_training_question: { in: ids } } });
    }
    for (const [i, q] of bank.entries()) {
      const row = await tx.sgcTrainingQuestion.create({ data: { id_training: training.id_training, sort_order: i + 1, kind: q.kind, text: q.text, points: q.points, created_by: me, created_at: now } });
      await tx.sgcTrainingOption.createMany({ data: q.options.map((o, j) => ({ id_training_question: row.id_training_question, sort_order: j + 1, text: o.text, is_correct: o.correct })) });
    }
    const maxScore = Math.round(bank.reduce((s, q) => s + q.points, 0) * 100) / 100;
    await tx.sgcTraining.update({ where: { id_training: training.id_training }, data: { max_score: maxScore, updated_by: me, updated_at: now } });
    await tx.sgcInteraction.create({
      data: { id_request: idRequest, id_task: task.id_task, kind: 'estado', author_email: me, body: `${before.length ? 'Actualizó' : 'Armó'} la evaluación en SynerLink: ${bank.length} pregunta(s), ${maxScore} punto(s); nota mínima ${Number(training.min_score_pct)} %; ${training.max_attempts} intento(s).` },
    });
    await writeSgcAudit(tx, {
      idCompany: request.id_company,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.evaluacionBanco,
      entity: 'training',
      entityId: training.id_training,
      before: before.length ? { preguntas: before.length, maxScore: bankMaxScore(before), sha256: bankHash(before) } : null,
      after: { preguntas: bank.length, maxScore },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { questions: bank.length, maxScore };
  });
}

/** Lectura (de la divulgación) y capacitación del lector que presenta la evaluación. */
async function readerContext(db: Db, idAssignee: number, email: string) {
  const rec = await db.sgcReadRecord.findUnique({ where: { id_task_assignee: idAssignee }, include: { request: { include: { tasks: { include: { taskDef: true }, orderBy: { id_task: 'asc' } } } } } });
  if (!rec || lower(rec.user_email) !== lower(email)) throw new SgcError('Lectura no encontrada.', 404);
  const training = await trainingOfRequest(db, rec.id_request);
  if (!training || training.evaluation_provider !== 'synerlink') throw new SgcError('Esta capacitación no tiene evaluación en SynerLink.', 404);
  const trainingTask = rec.request.tasks.filter((t) => t.taskDef.role === 'capacitacion').at(-1) ?? null;
  const closed = rec.request.status !== 'abierta' || (trainingTask !== null && trainingTask.status !== 'abierta');
  return { rec, training, closed };
}

export interface SgcReaderEvaluation {
  title: string;
  minScorePct: number;
  maxAttempts: number;
  maxScore: number;
  questions: SgcPublicQuestion[];
  attempts: { attemptNumber: number; score: number; percent: number; passed: boolean; submittedAt: string }[];
  canAttempt: boolean;
  reason: string | null;
  retrainingRequired: boolean;
}

/** Lo que ve el LECTOR: las preguntas SIN respuestas correctas, sus intentos y si puede presentar. */
export async function getReaderEvaluation(db: SgcDb, idAssignee: number, viewer: { email: string }): Promise<SgcReaderEvaluation> {
  const { rec, training, closed } = await readerContext(db, idAssignee, viewer.email);
  const bank = await loadBank(db, training.id_training);
  const attempts = await db.sgcTrainingAttempt.findMany({ where: { id_training: training.id_training, user_email: lower(viewer.email) }, orderBy: { attempt_number: 'asc' } });
  const next = nextAttempt(attempts.map((a) => ({ attemptNumber: a.attempt_number, passed: a.passed })), training.max_attempts);
  let reason: string | null = next.allowed ? null : next.reason;
  if (rec.status !== 'leido') reason = 'Primero lea el documento hasta el final y firme «Leído»: la evaluación se presenta después de la lectura.';
  else if (closed) reason = 'La capacitación ya se cerró: la evaluación no admite más intentos.';
  else if (!bank.length) reason = 'La evaluación aún no tiene preguntas.';
  return {
    title: training.title,
    minScorePct: Number(training.min_score_pct),
    maxAttempts: training.max_attempts,
    maxScore: bankMaxScore(bank),
    questions: reason && rec.status !== 'leido' ? [] : publicQuestions(bank),
    attempts: attempts.map((a) => ({ attemptNumber: a.attempt_number, score: Number(a.score), percent: Number(a.percent), passed: a.passed, submittedAt: a.submitted_at.toISOString() })),
    canAttempt: reason === null,
    reason,
    retrainingRequired: !next.allowed && next.retrainingRequired,
  };
}

/**
 * Presenta un INTENTO: se califica en el servidor y queda INMUTABLE con su
 * huella. Bloqueo por persona y capacitación: dos envíos a la vez no pueden
 * tomar el mismo número de intento ni saltarse el máximo.
 */
export async function submitEvaluationAttempt(db: SgcDb, idAssignee: number, raw: { answers?: unknown }, viewer: { email: string }, actor: SgcActor) {
  const me = lower(viewer.email);
  const pre = await readerContext(db, idAssignee, me);
  return withSgcAppLock(db, `sgc-evaluacion-${pre.training.id_training}-${me}`, { waitMs: 0, busyMessage: 'Ya hay un envío suyo en curso: espere el resultado.', holdMs: 60_000 }, async (tx) => {
    const { rec, training, closed } = await readerContext(tx, idAssignee, me);
    if (rec.status !== 'leido') throw new SgcError('Primero lea el documento hasta el final y firme «Leído»: la evaluación se presenta después de la lectura.', 409);
    if (closed) throw new SgcError('La capacitación ya se cerró: la evaluación no admite más intentos.', 409);
    const bank = await loadBank(tx, training.id_training);
    if (!bank.length) throw new SgcError('La evaluación aún no tiene preguntas.', 409);
    const previous = await tx.sgcTrainingAttempt.findMany({ where: { id_training: training.id_training, user_email: me }, orderBy: { attempt_number: 'asc' } });
    const next = nextAttempt(previous.map((a) => ({ attemptNumber: a.attempt_number, passed: a.passed })), training.max_attempts);
    if (!next.allowed) throw new SgcError(next.reason, 409);
    const answers = normalizeAnswers(raw?.answers, bank);
    const minPct = Number(training.min_score_pct);
    const graded = gradeAttempt(bank, answers, minPct);
    const now = new Date();
    const bankSha = bankHash(bank);
    const recordSha = attemptRecordHash({ idTraining: training.id_training, email: me, attemptNumber: next.attemptNumber, graded, bankSha256: bankSha, submittedAt: now.toISOString() });
    const attempt = await tx.sgcTrainingAttempt.create({
      data: {
        id_training: training.id_training,
        user_email: me,
        attempt_number: next.attemptNumber,
        score: graded.score,
        max_score: graded.maxScore,
        percent: graded.percent,
        passed: graded.passed,
        min_score_pct: minPct,
        bank_sha256: bankSha,
        record_sha256: recordSha,
        submitted_at: now,
        ip: actor.ip?.slice(0, 64) ?? null,
        user_agent: actor.userAgent?.slice(0, 500) ?? null,
      },
    });
    await tx.sgcTrainingAnswer.createMany({ data: graded.answers.map((a) => ({ id_training_attempt: attempt.id_training_attempt, id_training_question: a.idQuestion, selected_json: JSON.stringify(a.selected), is_correct: a.correct, points: a.points })) });
    const after = nextAttempt([...previous.map((a) => ({ attemptNumber: a.attempt_number, passed: a.passed })), { attemptNumber: next.attemptNumber, passed: graded.passed }], training.max_attempts);
    const retrainingRequired = !after.allowed && after.retrainingRequired;
    await tx.sgcInteraction.create({
      data: { id_request: rec.id_request, kind: 'estado', author_email: me, body: `Presentó la evaluación en SynerLink (intento ${next.attemptNumber} de ${training.max_attempts}): ${graded.score} de ${graded.maxScore} puntos (${graded.percent} %), ${graded.passed ? 'aprobó' : 'no aprobó'}.${retrainingRequired ? ' Agotó los intentos: queda en recapacitación.' : ''}\nHuella del intento: ${recordSha}`, meta_json: JSON.stringify({ idTrainingAttempt: attempt.id_training_attempt, recordSha256: recordSha }) },
    });
    await writeSgcAudit(tx, {
      idCompany: (await tx.sgcRequest.findUniqueOrThrow({ where: { id_request: rec.id_request }, select: { id_company: true } })).id_company,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.evaluacionIntento,
      entity: 'training_attempt',
      entityId: attempt.id_training_attempt,
      after: { attemptNumber: next.attemptNumber, score: graded.score, maxScore: graded.maxScore, percent: graded.percent, passed: graded.passed, recordSha256: recordSha, bankSha256: bankSha },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return {
      attemptNumber: next.attemptNumber,
      score: graded.score,
      maxScore: graded.maxScore,
      percent: graded.percent,
      passed: graded.passed,
      attemptsLeft: graded.passed ? 0 : Math.max(0, training.max_attempts - next.attemptNumber),
      retrainingRequired,
      recordSha256: recordSha,
    };
  });
}

export interface SgcEvaluationProgress {
  questions: number;
  maxScore: number;
  locked: boolean;
  people: { email: string; attempts: number; bestPercent: number | null; passed: boolean; retrainingRequired: boolean }[];
}

/** Avance de la evaluación para el creador y Calidad (antes de consolidar). */
export async function evaluationProgress(db: Db, idTraining: number, maxAttempts: number, scope: readonly string[]): Promise<SgcEvaluationProgress> {
  const [bank, attempts] = await Promise.all([loadBank(db, idTraining), db.sgcTrainingAttempt.findMany({ where: { id_training: idTraining }, orderBy: [{ user_email: 'asc' }, { attempt_number: 'asc' }] })]);
  const byEmail = new Map<string, typeof attempts>();
  for (const a of attempts) byEmail.set(lower(a.user_email), [...(byEmail.get(lower(a.user_email)) ?? []), a]);
  return {
    questions: bank.length,
    maxScore: bankMaxScore(bank),
    locked: attempts.length > 0,
    people: scope.map((email) => {
      const list = byEmail.get(lower(email)) ?? [];
      const passed = list.some((a) => a.passed);
      return { email, attempts: list.length, bestPercent: list.length ? Math.max(...list.map((a) => Number(a.percent))) : null, passed, retrainingRequired: !passed && list.length >= maxAttempts };
    }),
  };
}

/** Excel de resultados (reporte para la auditoría). */
export async function buildEvaluationWorkbook(meta: { company: string; code: string; title: string; idRequest: number; generatedAt: Date; minScorePct: number; maxAttempts: number }, rows: (string | number)[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SynerLink — SGC documental';
  wb.created = meta.generatedAt;
  const ws = wb.addWorksheet('Resultados');
  ws.addRow([...SGC_EVALUATION_REPORT_HEADERS]);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((c, i) => {
    c.width = i === 0 ? 34 : i === 1 ? 28 : 16;
  });
  const info = wb.addWorksheet('Evaluación');
  info.addRows([
    ['Empresa', meta.company],
    ['Documento', `${meta.code} · ${meta.title}`],
    ['Solicitud', `#${meta.idRequest}`],
    ['Nota mínima (%)', meta.minScorePct],
    ['Intentos permitidos', meta.maxAttempts],
    ['Generado', meta.generatedAt.toISOString()],
    ['Origen', 'Evaluación en SynerLink: calificada en el servidor; cada intento con su huella SHA-256.'],
  ]);
  info.getColumn(1).font = { bold: true };
  info.getColumn(1).width = 22;
  info.getColumn(2).width = 80;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/**
 * CONSOLIDAR los resultados de la evaluación en SynerLink (cierre sin cargar
 * un Excel): calcula el intento que cuenta por persona del alcance, genera el
 * Excel de resultados (reporte para la auditoría), lo guarda con su huella y
 * lo registra como la carga de resultados vigente de la capacitación.
 */
export async function consolidateEvaluation(db: SgcDb, upload: SgcUploader, access: SgcCompanyAccess, idRequest: number, actor: SgcActor) {
  const { request, task, training } = await trainingContext(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  assertManager(access, task, actor.email);
  if (request.status !== 'abierta' || !task || task.status !== 'abierta' || task.taskDef.role !== 'capacitacion') throw new SgcError('La solicitud no está en el paso de capacitación.', 409);
  if (!training || training.evaluation_provider !== 'synerlink') throw new SgcError('Esta capacitación no evalúa en SynerLink: cargue el Excel de resultados de Forms.', 409);
  const scope = await trainingScopeEmails(db, idRequest);
  const attempts = await db.sgcTrainingAttempt.findMany({ where: { id_training: training.id_training }, orderBy: [{ user_email: 'asc' }, { attempt_number: 'asc' }] });
  const users = await db.user.findMany({ where: { email: { in: [...new Set(attempts.map((a) => lower(a.user_email)))] } }, select: { email: true, name: true } });
  const nameOf = new Map(users.map((u) => [lower(u.email), u.name]));
  const people = [...new Set(attempts.map((a) => lower(a.user_email)))].map((email) => ({
    email,
    name: nameOf.get(email) ?? null,
    attempts: attempts.filter((a) => lower(a.user_email) === email).map((a) => ({ attemptNumber: a.attempt_number, score: Number(a.score), percent: Number(a.percent), passed: a.passed, submittedAt: a.submitted_at })),
  }));
  const results = consolidateAttempts(people, training.max_attempts);
  const inScope = new Set(scope);
  const counted = results.filter((r) => inScope.has(r.email));
  const outOfScope = results.filter((r) => !inScope.has(r.email));
  const missing = scope.filter((e) => !results.some((r) => r.email === e));
  const maxScore = Number(training.max_score);
  const doc = request.id_document ? await db.sgcDocument.findUnique({ where: { id_document: request.id_document }, select: { code: true, title: true } }) : null;
  const company = await db.sgcCompanyConfig.findUniqueOrThrow({ where: { id_company: request.id_company }, include: { company: { select: { company: true } } } });
  const now = new Date();
  const bytes = await buildEvaluationWorkbook({ company: company.company.company, code: doc?.code ?? `SOL-${idRequest}`, title: doc?.title ?? request.subject, idRequest, generatedAt: now, minScorePct: Number(training.min_score_pct), maxAttempts: training.max_attempts }, reportRows(results, maxScore));
  const sha = sha256HexOf(bytes);
  const fileName = `Resultados evaluación SynerLink SOL-${idRequest}.xlsx`;
  const segments = [...company.storage_root.split('/').filter(Boolean), '_capacitacion', `SOL-${idRequest}`];
  const stamped = `${now.toISOString().slice(0, 19).replace(/[-:T]/g, '')}_${fileName}`;
  const item = await upload(segments, stamped, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const me = lower(actor.email);
  const passed = counted.filter((r) => r.passed).length;
  const failed = counted.length - passed;
  const retraining = counted.filter((r) => r.retrainingRequired).length;
  return db.$transaction(async (tx) => {
    const up = await tx.sgcTrainingUpload.create({
      data: {
        id_training: training.id_training,
        file_name: fileName,
        item_id: item.id,
        storage_path: `${segments.join('/')}/${stamped}`,
        sha256: sha,
        size_bytes: bytes.length,
        max_score: maxScore,
        min_score_pct: Number(training.min_score_pct),
        rows_total: results.length,
        people: results.length,
        in_scope: counted.length,
        passed,
        failed,
        out_of_scope: outOfScope.length,
        missing_json: JSON.stringify(missing),
        rejected_json: '[]',
        uploaded_by: me,
        uploaded_at: now,
      },
    });
    if (results.length) {
      await tx.sgcTrainingResult.createMany({
        data: results.map((r) => ({ id_training_upload: up.id_training_upload, user_email: r.email, full_name: r.name, score: r.score, percent: r.percent, passed: r.passed, attempts: r.attempts, in_scope: inScope.has(r.email), completed_at_text: r.completedAt, attempt_number: r.attemptNumber, extra_attempts: 0, retraining_required: r.retrainingRequired })),
      });
    }
    await tx.sgcInteraction.create({
      data: {
        id_request: idRequest,
        id_task: task.id_task,
        kind: 'adjunto',
        author_email: me,
        body: `Consolidó los resultados de la evaluación en SynerLink: ${fileName} (SHA-256 ${sha}).\nDel alcance (${scope.length}): ${passed} aprobaron, ${failed} no aprobaron (${retraining} quedan en recapacitación) y ${missing.length} sin presentar.`,
        meta_json: JSON.stringify({ idTrainingUpload: up.id_training_upload, sha256: sha, origin: 'synerlink' }),
      },
    });
    await writeSgcAudit(tx, {
      idCompany: request.id_company,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.capacitacionResultados,
      entity: 'training_upload',
      entityId: up.id_training_upload,
      after: { idRequest, origin: 'synerlink', fileName, sha256: sha, summary: { inScope: counted.length, passed, failed, retraining, missing: missing.length, outOfScope: outOfScope.length } },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { idTrainingUpload: up.id_training_upload, sha256: sha, summary: { inScope: counted.length, passed, failed, retraining, missing: missing.length } };
  });
}

/**
 * S18 (R30): REPORTE de resultados de la capacitación para la auditoría (el
 * Excel consolidado de SynerLink o el de Forms que se cargó). Lo ven Calidad
 * y quien gestiona la capacitación (el creador); se muestra en el visor de la
 * app. La descarga del archivo solo con el PERMISO EXCEPCIONAL de descarga del
 * documento (el mismo de «modo=descarga» del visor).
 */
export async function getTrainingReport(db: SgcDb, access: SgcCompanyAccess, idRequest: number, actor: SgcActor) {
  const { request, task, training } = await trainingContext(db, idRequest);
  if (access.idCompany !== request.id_company) throw new SgcError('Solicitud no encontrada.', 404);
  if (!access.canQuality && !isTrainingCreator(task, actor.email)) throw new SgcError('Solo Aseguramiento de Calidad o quien gestiona la capacitación ven el reporte de resultados.', 403);
  const up = training ? await db.sgcTrainingUpload.findFirst({ where: { id_training: training.id_training }, orderBy: { id_training_upload: 'desc' } }) : null;
  if (!up) throw new SgcError('La capacitación aún no tiene resultados.', 404);
  await writeSgcAudit(db, {
    idCompany: request.id_company,
    actorEmail: actor.email,
    action: SGC_AUDIT_ACTIONS.documentoConsulta,
    entity: 'training_upload',
    entityId: up.id_training_upload,
    after: { idRequest, fileName: up.file_name },
    detail: `Consulta del reporte de resultados de la capacitación (solicitud #${idRequest}).`,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { itemId: up.item_id, sha256: up.sha256.trim(), fileName: up.file_name, idDocument: request.id_document, idDocumentVersion: request.id_document_version };
}

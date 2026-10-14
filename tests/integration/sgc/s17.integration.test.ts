import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { addScopeEntry, openReadingFile, recordReadingEvent } from '../../../lib/sgc/db/dissemination';
import type { SgcUploader } from '../../../lib/sgc/db/documents';
import { consolidateEvaluation, getEvaluationEditor, getReaderEvaluation, getTrainingReport, saveQuestionBank, submitEvaluationAttempt } from '../../../lib/sgc/db/evaluation';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { createRequest, decideTask, getRequestDetail, setSigners, setTrainingFlag, uploadAttachment } from '../../../lib/sgc/db/requests';
import { signTask, type SgcSignatureDeps } from '../../../lib/sgc/db/signatures';
import { recordRetraining, saveTraining, uploadTrainingResults } from '../../../lib/sgc/db/training';
import type { SgcNotifier } from '../../../lib/sgc/notifications';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';

/**
 * S17–S18 contra un SQL Server REAL (efímero en CI): EVALUACIÓN PROPIA EN
 * SYNERLINK (R30), que convive con Forms. El banco lo arma quien gestiona la
 * capacitación; el lector la presenta después de firmar «Leído»; el servidor
 * califica (las respuestas correctas nunca llegan al lector), aplica los 2
 * intentos y la recapacitación y guarda cada intento inmutable con su huella;
 * la capacitación se cierra consolidando los resultados (Excel generado por el
 * SGC) sin cargar un Excel. Empresa propia (id 118).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · S17–S18 · evaluaciones propias con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 118;
  const PW = 'Clave-S17-ci#2026';
  const E = {
    sol: 'sol.s17@onelatampharma.com',
    elab: 'elab.s17@onelatampharma.com',
    rev: 'rev.s17@onelatampharma.com',
    apr: 'apr.s17@onelatampharma.com',
    cal: 'calidad.s17@onelatampharma.com',
    otro: 'otro.s17@onelatampharma.com',
    l1: 'lector1.s17@onelatampharma.com',
    l2: 'lector2.s17@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.17.17.17', userAgent: 'vitest-s17' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const notifier: SgcNotifier = async () => undefined;
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const upload: SgcUploader = async (_s, _f, content) => {
    const id = `s17-${++n}`;
    store.set(id, new Uint8Array(content));
    return { id };
  };
  const pdfOf = async (text: string) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText(text, { x: 50, y: 500, size: 11, font });
    return pdf.save();
  };
  const deps: SgcSignatureDeps = {
    verifyPassword: synerlinkPasswordVerifier(prisma),
    upload,
    download: async (id) => store.get(id)!,
    htmlToPdf: async () => pdfOf('Contenido convertido S17'),
    docxToHtml: async () => '<h1>Formato S17</h1><p>Contenido.</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = { fileName: 'Formato.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode('S17')]) };
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: true } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba del S17`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };
  const questions = [
    { kind: 'unica', text: '¿Quién aprueba el formato?', points: 4, options: [{ text: 'El líder del área', correct: true }, { text: 'Cualquier persona', correct: false }] },
    { kind: 'multiple', text: '¿Qué datos lleva el registro?', points: 4, options: [{ text: 'Fecha', correct: true }, { text: 'Lote', correct: true }, { text: 'Color favorito', correct: false }] },
    { kind: 'vf', text: 'El formato vigente se puede modificar a mano.', points: 2, correct: false },
  ];
  let procGC = 0;
  let typeFO = 0;
  let idRequest = 0;
  const reading = async (email: string) => (await taskOf(idRequest, 'divulgacion')).assignees.find((a) => a.user_email === email)!.id_task_assignee;
  const read = async (email: string) => {
    const t = await taskOf(idRequest, 'divulgacion');
    const a = t.assignees.find((x) => x.user_email === email)!;
    await openReadingFile(prisma, a.id_task_assignee, await viewer(email), actor(email));
    await recordReadingEvent(prisma, a.id_task_assignee, { event: 'final', pages: 1 }, { email }, actor(email));
    return signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a.id_task_assignee }), actor(email));
  };
  /** Respuestas por id de pregunta (correctas o no) a partir del banco guardado. */
  const answersFor = async (correct: boolean) => {
    const bank = await prisma.sgcTrainingQuestion.findMany({ where: { training: { id_request: idRequest } }, include: { options: true }, orderBy: { sort_order: 'asc' } });
    return Object.fromEntries(bank.map((q) => [q.id_training_question, q.options.filter((o) => (correct ? o.is_correct : !o.is_correct)).map((o) => o.id_training_option).slice(0, q.kind === 'multiple' ? 9 : 1)]));
  };

  beforeAll(async () => {
    vi.stubEnv('SGC_ASIGNACION_PERMISO', 'tarea_o_calidad');
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S17 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S17', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S17 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[]][] = [
      [E.sol, ['gestion']],
      [E.elab, ['gestion']],
      [E.rev, ['gestion']],
      [E.apr, ['gestion']],
      [E.cal, ['gestion', 'calidad']],
      [E.otro, ['gestion']],
      [E.l1, ['lectura']],
      [E.l2, ['lectura']],
    ];
    for (const [email, perms] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql', '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql', '2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql']) {
      await prisma.$executeRawUnsafe(seed(f));
    }
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typeFO = cat.documentTypes.find((t) => t.code === 'FO')!.id;
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: typeFO, userEmail: E.elab, reason: 'Elaborador de la prueba del S17' }, actor(E.cal));
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba del S17' }, actor('ci@x.co'));
    // Solicitud con capacitación, aprobada hasta la preparación del material.
    idRequest = (await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject: 'Formato con evaluación en SynerLink', description: 'Solicitud de la prueba del S17.', idProcess: procGC, idDocumentType: typeFO, requiresTraining: 'si', formValues: { urgencia: 'Normal' } }, actor(E.sol))).idRequest;
    await setTrainingFlag(prisma, idRequest, { requiresTraining: true }, actor(E.elab), await accessOf(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    for (const email of [E.l1, E.l2]) await addScopeEntry(prisma, notifier, await accessOf(E.elab), idRequest, { entry: { kind: 'persona', email }, reason: 'Lectores de la prueba del S17' }, actor(E.elab));
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...docx }, await viewer(E.elab), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'revision')).id_task, firma('reviso'), actor(E.rev));
    const apr = await taskOf(idRequest, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.apr));
    await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-167] la migración crea el banco y los intentos (solo inserción, protegidos contra TRUNCATE); la capacitación elige «Evaluación en SynerLink» y el banco lo arma quien la gestiona', async () => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgc' AND t.name IN ('training_question','training_option','training_attempt','training_answer')`;
    expect(tables).toHaveLength(4);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261014120000_sgc_s17_evaluaciones/migration.sql'), 'utf8'));
    // Sin capacitación registrada: el editor está vacío y no se arma el banco; no hay reporte ni consolidación.
    expect(await getEvaluationEditor(prisma, await accessOf(E.cal), idRequest, actor(E.cal))).toEqual({ training: null, questions: [], attempts: 0, locked: false });
    await expect(saveQuestionBank(prisma, await accessOf(E.cal), idRequest, { questions }, actor(E.cal))).rejects.toThrow(/Registre primero/);
    await expect(getTrainingReport(prisma, await accessOf(E.cal), idRequest, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(consolidateEvaluation(prisma, upload, await accessOf(E.cal), idRequest, actor(E.cal))).rejects.toThrow(/no está en el paso de capacitación/);
    await expect(getEvaluationEditor(prisma, await accessOf(E.otro), idRequest, actor(E.otro))).rejects.toMatchObject({ status: 403 });
    await expect(saveQuestionBank(prisma, await accessOf(E.cal), 999_999, { questions }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    // Con Forms, el banco no aplica.
    await saveTraining(prisma, await accessOf(E.cal), idRequest, { mode: 'video', title: 'Capacitación del formato S17', videoUrl: 'https://www.youtube.com/watch?v=s17', formsUrl: 'https://forms.office.com/r/s17', maxScore: 10 }, actor(E.cal));
    await expect(saveQuestionBank(prisma, await accessOf(E.cal), idRequest, { questions }, actor(E.cal))).rejects.toThrow(/elija «Evaluación en SynerLink»/);
    await expect(getReaderEvaluation(prisma, 999_999, { email: E.l1 })).rejects.toMatchObject({ status: 404 });
    await saveTraining(prisma, await accessOf(E.cal), idRequest, { mode: 'video', title: 'Capacitación del formato S17', videoUrl: 'https://www.youtube.com/watch?v=s17', evaluationProvider: 'synerlink', minScorePct: 80 }, actor(E.cal));
    await expect(saveQuestionBank(prisma, await accessOf(E.otro), idRequest, { questions }, actor(E.otro))).rejects.toMatchObject({ status: 403 });
    await expect(saveQuestionBank(prisma, await accessOf(E.cal), idRequest, { questions: [{ kind: 'unica', text: 'Sin correcta', options: [{ text: 'A' }, { text: 'B' }] }] }, actor(E.cal))).rejects.toThrow(/exactamente una/);
    expect(await saveQuestionBank(prisma, await accessOf(E.cal), idRequest, { questions: questions.slice(0, 2) }, actor(E.cal))).toEqual({ questions: 2, maxScore: 8 });
    expect(await saveQuestionBank(prisma, await accessOf(E.cal), idRequest, { questions }, actor(E.cal))).toEqual({ questions: 3, maxScore: 10 });
    const editor = await getEvaluationEditor(prisma, await accessOf(E.cal), idRequest, actor(E.cal));
    expect(editor).toMatchObject({ locked: false, attempts: 0, training: { provider: 'synerlink' } });
    expect(editor.questions[0].options.map((o) => o.correct)).toEqual([true, false]);
    expect(Number((await prisma.sgcTraining.findFirstOrThrow({ where: { id_request: idRequest } })).max_score)).toBe(10);
    const view = (await getRequestDetail(prisma, idRequest, await viewer(E.cal))).training!;
    expect(view).toMatchObject({ training: { evaluationProvider: 'synerlink', evaluationProviderLabel: 'Evaluación en SynerLink' }, evaluation: { questions: 3, maxScore: 10, locked: false } });
    expect(await decideTask(prisma, notifier, (await taskOf(idRequest, 'preparacion_capacitacion')).id_task, { decision: 'aprobar', comment: 'Material listo' }, actor(E.cal))).toMatchObject({ next: 'divulgacion' });
  });

  it('[SGC-REQ-168] el lector presenta la evaluación DESPUÉS de firmar «Leído»; las preguntas llegan sin respuestas y el servidor califica', async () => {
    const l1 = await reading(E.l1);
    const before = await getReaderEvaluation(prisma, l1, { email: E.l1 });
    expect(before).toMatchObject({ canAttempt: false, questions: [], reason: expect.stringMatching(/Primero lea/) });
    await expect(submitEvaluationAttempt(prisma, l1, { answers: await answersFor(true) }, { email: E.l1 }, actor(E.l1))).rejects.toMatchObject({ status: 409 });
    await expect(getReaderEvaluation(prisma, l1, { email: E.l2 })).rejects.toMatchObject({ status: 404 });
    await read(E.l1);
    const ev = await getReaderEvaluation(prisma, l1, { email: E.l1 });
    expect(ev).toMatchObject({ canAttempt: true, maxAttempts: 2, maxScore: 10, minScorePct: 80 });
    expect(ev.questions).toHaveLength(3);
    expect(JSON.stringify(ev)).not.toMatch(/correct/i);
    const wrong = await submitEvaluationAttempt(prisma, l1, { answers: await answersFor(false) }, { email: E.l1 }, actor(E.l1));
    expect(wrong).toMatchObject({ attemptNumber: 1, score: 0, passed: false, attemptsLeft: 1, retrainingRequired: false, recordSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const right = await submitEvaluationAttempt(prisma, l1, { answers: await answersFor(true) }, { email: E.l1 }, actor(E.l1));
    expect(right).toMatchObject({ attemptNumber: 2, score: 10, percent: 100, passed: true, attemptsLeft: 0 });
    await expect(submitEvaluationAttempt(prisma, l1, { answers: await answersFor(true) }, { email: E.l1 }, actor(E.l1))).rejects.toThrow(/ya aprobó/);
    await expect(submitEvaluationAttempt(prisma, l1, { answers: {} }, { email: E.l1 }, actor(E.l1))).rejects.toThrow(/ya aprobó/);
    const attempts = await prisma.sgcTrainingAttempt.findMany({ where: { user_email: E.l1 }, include: { answers: true }, orderBy: { attempt_number: 'asc' } });
    expect(attempts.map((a) => [a.attempt_number, Number(a.score), a.passed, a.answers.length])).toEqual([
      [1, 0, false, 3],
      [2, 10, true, 3],
    ]);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'evaluacion.intento', actor_email: E.l1 } })).toBe(2);
  });

  it('[SGC-REQ-169] dos intentos sin aprobar dejan a la persona en recapacitación; los intentos son inmutables y el banco queda congelado', async () => {
    await read(E.l2);
    const l2 = await reading(E.l2);
    expect(await submitEvaluationAttempt(prisma, l2, { answers: await answersFor(false) }, { email: E.l2 }, actor(E.l2))).toMatchObject({ attemptNumber: 1, passed: false });
    expect(await submitEvaluationAttempt(prisma, l2, { answers: await answersFor(false) }, { email: E.l2 }, actor(E.l2))).toMatchObject({ attemptNumber: 2, passed: false, retrainingRequired: true });
    await expect(submitEvaluationAttempt(prisma, l2, { answers: await answersFor(true) }, { email: E.l2 }, actor(E.l2))).rejects.toThrow(/recapacitación/);
    expect(await getReaderEvaluation(prisma, l2, { email: E.l2 })).toMatchObject({ canAttempt: false, retrainingRequired: true });
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[training_attempt] SET passed = 1 WHERE user_email = N'${E.l2}'`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[training_answer]`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE [sgc].[training_attempt]`)).rejects.toThrow();
    await expect(saveQuestionBank(prisma, await accessOf(E.cal), idRequest, { questions }, actor(E.cal))).rejects.toThrow(/congelado|no se cambia/);
    await expect(saveTraining(prisma, await accessOf(E.cal), idRequest, { mode: 'video', title: 'Capacitación del formato S17', videoUrl: 'https://www.youtube.com/watch?v=s17', formsUrl: 'https://forms.office.com/r/s17', maxScore: 10 }, actor(E.cal))).rejects.toThrow(/no se cambia el proveedor/);
  });

  it('[SGC-REQ-170] la capacitación se cierra consolidando los resultados en la app (Excel generado con su huella) y el reporte lo ven Calidad y quien gestiona', async () => {
    expect((await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } })).current_task_key).toBe('capacitacion');
    await expect(uploadTrainingResults(prisma, upload, await accessOf(E.cal), idRequest, { fileName: 'r.csv', bytes: new TextEncoder().encode('x') }, actor(E.cal))).rejects.toThrow(/Consolidar resultados/);
    await expect(consolidateEvaluation(prisma, upload, await accessOf(E.otro), idRequest, actor(E.otro))).rejects.toMatchObject({ status: 403 });
    const res = await consolidateEvaluation(prisma, upload, await accessOf(E.cal), idRequest, actor(E.cal));
    expect(res.summary).toEqual({ inScope: 2, passed: 1, failed: 1, retraining: 1, missing: 0 });
    const up = await prisma.sgcTrainingUpload.findUniqueOrThrow({ where: { id_training_upload: res.idTrainingUpload }, include: { results: { orderBy: { user_email: 'asc' } } } });
    expect(up.results.map((r) => [r.user_email, Number(r.score), r.passed, r.attempts, r.attempt_number, r.retraining_required])).toEqual([
      [E.l1, 10, true, 2, 2, false],
      [E.l2, 0, false, 2, 2, true],
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(store.get(up.item_id)!) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Resultados')!.getRow(1).getCell(1).value).toBe('Correo electrónico');
    expect(wb.getWorksheet('Resultados')!.getRow(2).getCell(6).value).toBe('Aprobó');
    const tv = (await getRequestDetail(prisma, idRequest, await viewer(E.cal))).training!;
    expect(Object.fromEntries(tv.people.map((p) => [p.email, p.status]))).toEqual({ [E.l1]: 'aprobo', [E.l2]: 'recapacitacion' });
    expect(tv.upload).toMatchObject({ needsJustification: true });
    expect(await getTrainingReport(prisma, await accessOf(E.cal), idRequest, actor(E.cal))).toMatchObject({ itemId: up.item_id, fileName: up.file_name });
    await expect(getTrainingReport(prisma, await accessOf(E.otro), idRequest, actor(E.otro))).rejects.toMatchObject({ status: 403 });
    // Recapacitación (mismo motor que Forms) y cierre con «Capacitó» y justificación: queda vigente.
    expect(await recordRetraining(prisma, await accessOf(E.cal), idRequest, { email: E.l2, mode: 'presencial', sessionDate: '2026-10-20', result: 'aprobo' }, actor(E.cal))).toMatchObject({ idRetraining: expect.any(Number) });
    const cap = await taskOf(idRequest, 'capacitacion');
    await expect(signTask(prisma, deps, cap.id_task, firma('capacito'), actor(E.cal))).rejects.toThrow(/justificación/);
    expect(await signTask(prisma, deps, cap.id_task, firma('capacito', { comment: 'Lector 2 recapacitado el 2026-10-20.' }), actor(E.cal))).toMatchObject({ outcome: 'resuelta', next: 'completada', published: { versionNumber: 1 } });
    // Cerrada la capacitación, la evaluación no admite más intentos.
    expect(await getReaderEvaluation(prisma, await reading(E.l1), { email: E.l1 })).toMatchObject({ canAttempt: false, reason: expect.stringMatching(/ya se cerró|ya aprobó/) });
  });
});

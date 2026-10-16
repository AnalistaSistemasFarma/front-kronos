import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { addScopeEntry, getMyReading, openReadingFile, recordReadingEvent } from '../../../lib/sgc/db/dissemination';
import type { SgcUploader } from '../../../lib/sgc/db/documents';
import { getCurrentFlowVersion, loadDefinition } from '../../../lib/sgc/db/flows';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { getMyPendings } from '../../../lib/sgc/db/pendings';
import { confirmSuggestions, createRequest, decideTask, getRequestDetail, setSigners, setTrainingFlag, uploadAttachment } from '../../../lib/sgc/db/requests';
import { signTask, type SgcSignatureDeps } from '../../../lib/sgc/db/signatures';
import { recordRetraining, saveTraining, uploadTrainingResults } from '../../../lib/sgc/db/training';
import type { SgcNotifier } from '../../../lib/sgc/notifications';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';

/**
 * Sprint 10 contra un SQL Server REAL (efímero en CI): capacitación OPCIONAL
 * por solicitud (sugerida por el solicitante y confirmada por quien crea el
 * documento o Calidad), flujo con la PREPARACIÓN del material antes de la
 * divulgación (la lectura muestra el video y la evaluación), evaluación solo
 * en Microsoft Forms o Google Forms, resultados de Google Forms en CSV, 2
 * intentos y recapacitación. Empresa propia (id 101, la misma que usa la CI
 * para probar la reversa del flujo).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 10 con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 101;
  const PW = 'Clave-S10-ci#2026';
  const E = {
    sol: 'sol.s10@onelatampharma.com',
    elab: 'elab.s10@onelatampharma.com',
    rev: 'rev.s10@onelatampharma.com',
    apr: 'apr.s10@onelatampharma.com',
    cal: 'calidad.s10@onelatampharma.com',
    l1: 'lector1.s10@onelatampharma.com',
    l2: 'lector2.s10@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.10.10.10', userAgent: 'vitest-s10' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const notifier: SgcNotifier = async () => undefined;
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const upload: SgcUploader = async (_s, _f, content) => {
    const id = `s10-${++n}`;
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
    htmlToPdf: async () => pdfOf('Contenido convertido'),
    docxToHtml: async () => '<h1>Formato S10</h1><p>Contenido.</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = (text: string) => ({ fileName: 'Formato.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(text)]) });
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: true } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba del S10`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };
  const training = { mode: 'mixta', title: 'Capacitación del formato S10', videoUrl: 'https://www.youtube.com/watch?v=s10', formsUrl: 'https://docs.google.com/forms/d/e/s10/viewform', sessionDate: '2026-10-08', maxScore: 10, minScorePct: 80 };
  let procGC = 0;
  let typeFO = 0;

  async function newRequest(subject: string, requiresTraining: unknown) {
    const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject, description: `Solicitud de la prueba del S10: ${subject}.`, idProcess: procGC, idDocumentType: typeFO, requiresTraining, formValues: { urgencia: 'Normal' } }, actor(E.sol));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'aprobacion', signers: [E.apr], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    for (const email of [E.l1, E.l2]) await addScopeEntry(prisma, notifier, await accessOf(E.elab), idRequest, { entry: { kind: 'persona', email }, reason: 'Lectores de la prueba del S10' }, actor(E.elab));
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...docx(subject) }, await viewer(E.elab), actor(E.elab));
    return idRequest;
  }
  async function approve(idRequest: number) {
    await signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'revision')).id_task, firma('reviso'), actor(E.rev));
    const apr = await taskOf(idRequest, 'aprobacion');
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.apr));
    return signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
  }
  async function read(idRequest: number, email: string) {
    const t = await taskOf(idRequest, 'divulgacion');
    const a = t.assignees.find((x) => x.user_email === email)!;
    await openReadingFile(prisma, a.id_task_assignee, await viewer(email), actor(email));
    await recordReadingEvent(prisma, a.id_task_assignee, { event: 'final', pages: 1 }, { email }, actor(email));
    return signTask(prisma, deps, t.id_task, firma('leyo', { idAssignee: a.id_task_assignee }), actor(email));
  }

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S10 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S10', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S10 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[]][] = [
      [E.sol, ['gestion']],
      [E.elab, ['gestion', 'calidad']],
      [E.rev, ['gestion']],
      [E.apr, ['gestion']],
      [E.cal, ['calidad']],
      [E.l1, ['lectura']],
      [E.l2, ['lectura']],
    ];
    for (const [email, perms] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql', '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql']) {
      await prisma.$executeRawUnsafe(seed(f));
    }
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typeFO = cat.documentTypes.find((t) => t.code === 'FO')!.id;
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: typeFO, userEmail: E.elab, reason: 'Elaborador de la prueba del S10' }, actor(E.cal));
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba del S10' }, actor('ci@x.co'));
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-123] la migración agrega columnas y la tabla de recapacitación; el SQL del flujo publica una versión con la preparación de la capacitación (idempotente)', async () => {
    const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE object_id IN (OBJECT_ID('sgc.request'), OBJECT_ID('sgc.training'), OBJECT_ID('sgc.training_result')) AND name IN ('requires_training_suggested','requires_training','training_confirmed_by','training_confirmed_at','evaluation_provider','max_attempts','attempt_number','extra_attempts','retraining_required')`;
    expect(cols).toHaveLength(9);
    expect(await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name = 'retraining_solo_insercion'`).toHaveLength(1);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261008120000_sgc_s10_capacitacion_opcional/migration.sql'), 'utf8'));
    const before = await getCurrentFlowVersion(prisma, CO, 'DOC');
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql'));
    const after = await getCurrentFlowVersion(prisma, CO, 'DOC');
    expect(after.version.version_number).toBe(before.version.version_number + 1);
    const def = await loadDefinition(prisma, after.version.id_flow_version);
    expect(def.tasks.map((t) => [t.key, t.stepOrder, t.conditionKey])).toEqual([
      ['solicitud', 0, null],
      ['elaboracion', 1, null],
      ['revision', 2, null],
      ['aprobacion', 3, null],
      ['preparacion_capacitacion', 4, 'requiere_capacitacion'],
      ['divulgacion', 5, null],
      ['capacitacion', 6, 'requiere_capacitacion'],
    ]);
    expect(def.transitions.find((t) => t.from === 'aprobacion' && t.action === 'aprobar')?.to).toBe('preparacion_capacitacion');
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, id_flow_version: after.version.id_flow_version, action: 'version.publicada' } })).toBe(1);
  });

  it('[SGC-REQ-122][SGC-REQ-123] SIN capacitación: de la aprobación pasa a la divulgación y de ahí a vigente (sin preparación ni capacitación)', async () => {
    const r = await newRequest('Formato sin capacitación', 'no');
    expect((await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r } })).requires_training_suggested).toBe(false);
    const res = await approve(r);
    expect(res).toMatchObject({ next: 'divulgacion' });
    await expect(setTrainingFlag(prisma, r, { requiresTraining: true }, actor(E.elab), await accessOf(E.elab))).rejects.toMatchObject({ status: 409 });
    await read(r, E.l1);
    const last = await read(r, E.l2);
    expect(last).toMatchObject({ outcome: 'resuelta', next: 'completada', published: { versionNumber: 1 } });
    expect(await prisma.sgcTask.count({ where: { id_request: r, task_key: { in: ['preparacion_capacitacion', 'capacitacion'] } } })).toBe(0);
  });

  it('[SGC-REQ-122] la sugerencia del solicitante la confirma quien crea el documento o Calidad (no el solicitante); con «Confirmar sugerencia» también queda confirmada', async () => {
    const r = await newRequest('Formato con la sugerencia confirmada', 'si');
    await expect(setTrainingFlag(prisma, r, { requiresTraining: false }, actor(E.sol), await accessOf(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(setTrainingFlag(prisma, r, { requiresTraining: 'tal vez' }, actor(E.elab), await accessOf(E.elab))).rejects.toThrow(/sí o no/);
    let detail = await getRequestDetail(prisma, r, await viewer(E.elab));
    expect(detail.request.trainingFlag).toMatchObject({ effective: true, source: 'sugerida', suggested: true, confirmed: null, canChange: true });
    expect(detail.permissions.canConfirmSuggestion).toBe(true);
    expect(await confirmSuggestions(prisma, notifier, r, actor(E.elab), await accessOf(E.elab))).toMatchObject({ confirmedTraining: true });
    detail = await getRequestDetail(prisma, r, await viewer(E.elab));
    expect(detail.request.trainingFlag).toMatchObject({ source: 'confirmada', confirmed: true });
    await expect(confirmSuggestions(prisma, notifier, r, actor(E.elab), await accessOf(E.elab))).rejects.toThrow(/capacitación sugeridos/);
    expect(await setTrainingFlag(prisma, r, { requiresTraining: false, reason: 'Es un formato sin práctica' }, actor(E.elab), await accessOf(E.elab))).toEqual({ requiresTraining: false });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'capacitacion.bandera', entity_id: String(r) } })).toBe(1);
    await expect(setTrainingFlag(prisma, 999_999, { requiresTraining: true }, actor(E.elab), await accessOf(E.elab))).rejects.toMatchObject({ status: 404 });
  });

  it('[SGC-REQ-123][SGC-REQ-124][SGC-REQ-125][SGC-REQ-126] CON capacitación: el material va antes de la divulgación, la lectura lo muestra, cuentan 2 intentos y quien no aprueba queda en recapacitación', async () => {
    const r = await newRequest('Formato con capacitación', 'si');
    await setTrainingFlag(prisma, r, { requiresTraining: true }, actor(E.elab), await accessOf(E.elab));
    expect(await approve(r)).toMatchObject({ next: 'preparacion_capacitacion' });
    // Pendiente de Calidad: la preparación cuenta como capacitación.
    expect((await getMyPendings(prisma, E.cal, await accessOf(E.cal))).counts.capacitaciones).toBeGreaterThanOrEqual(1);
    const prep = await taskOf(r, 'preparacion_capacitacion');
    await expect(decideTask(prisma, notifier, prep.id_task, { decision: 'aprobar' }, actor(E.cal))).rejects.toThrow(/Registre primero el material/);
    await expect(saveTraining(prisma, await accessOf(E.cal), r, { ...training, formsUrl: 'https://kahoot.it/s10' }, actor(E.cal))).rejects.toThrow(/Microsoft Forms o en Google Forms/);
    await saveTraining(prisma, await accessOf(E.cal), r, training, actor(E.cal));
    const view = (await getRequestDetail(prisma, r, await viewer(E.cal))).training!;
    expect(view).toMatchObject({ phase: 'material', canManage: true, canUpload: false, training: { evaluationProvider: 'google', evaluationProviderLabel: 'Google Forms', maxAttempts: 2 } });
    await expect(uploadTrainingResults(prisma, upload, await accessOf(E.cal), r, { fileName: 'r.csv', bytes: new TextEncoder().encode('x') }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    expect(await decideTask(prisma, notifier, prep.id_task, { decision: 'aprobar', comment: 'Material listo' }, actor(E.cal))).toMatchObject({ next: 'divulgacion' });
    // La lectura muestra el video y la evaluación.
    const div = await taskOf(r, 'divulgacion');
    expect((await getMyReading(prisma, div.id_task, E.l1))!.training).toMatchObject({ videoUrl: training.videoUrl, formsUrl: training.formsUrl, evaluationProvider: 'google', maxAttempts: 2 });
    await read(r, E.l1);
    expect(await read(r, E.l2)).toMatchObject({ next: 'capacitacion' });
    // Resultados de Google Forms (CSV): L1 aprueba al segundo intento; L2 reprueba dos veces y su tercer intento no cuenta.
    const csv = [
      'Marca temporal,Dirección de correo electrónico,Puntuación',
      `08/10/2026 10:00:00,${E.l1},6 / 10`,
      `08/10/2026 11:00:00,${E.l1},9 / 10`,
      `08/10/2026 10:05:00,${E.l2},5 / 10`,
      `08/10/2026 10:30:00,${E.l2},7 / 10`,
      `08/10/2026 12:00:00,${E.l2},10 / 10`,
    ].join('\n');
    const up = await uploadTrainingResults(prisma, upload, await accessOf(E.cal), r, { fileName: 'Respuestas Google Forms.csv', bytes: new TextEncoder().encode(csv) }, actor(E.cal));
    expect(up.summary).toMatchObject({ passed: 1, failed: 1, retraining: 1 });
    const results = await prisma.sgcTrainingResult.findMany({ where: { id_training_upload: up.idTrainingUpload }, orderBy: { user_email: 'asc' } });
    expect(results.map((x) => [x.user_email, Number(x.score), x.attempts, x.attempt_number, x.extra_attempts, x.retraining_required])).toEqual([
      [E.l1, 9, 2, 2, 0, false],
      [E.l2, 7, 3, 2, 1, true],
    ]);
    let tv = (await getRequestDetail(prisma, r, await viewer(E.cal))).training!;
    expect(tv).toMatchObject({ phase: 'resultados', canUpload: true, canRetrain: true });
    expect(Object.fromEntries(tv.people.map((p) => [p.email, p.status]))).toEqual({ [E.l1]: 'aprobo', [E.l2]: 'recapacitacion' });
    // Recapacitación (solo Calidad, solo de quien está en recapacitación).
    const cal = await accessOf(E.cal);
    await expect(recordRetraining(prisma, await accessOf(E.sol), r, {}, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(recordRetraining(prisma, cal, 999_999, {}, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(recordRetraining(prisma, cal, r, { email: E.l1, mode: 'virtual', sessionDate: '2026-10-20', result: 'aprobo' }, actor(E.cal))).rejects.toThrow(/no está en recapacitación/);
    await expect(recordRetraining(prisma, cal, r, { email: E.l2, mode: 'correo', sessionDate: '2026-10-20', result: 'aprobo' }, actor(E.cal))).rejects.toThrow(/presencial o virtual/);
    await expect(recordRetraining(prisma, cal, r, { email: E.l2, mode: 'virtual', sessionDate: '2026-10-20', result: 'quizas' }, actor(E.cal))).rejects.toThrow(/asistió, aprobó o reprobó/);
    await expect(recordRetraining(prisma, cal, r, { email: E.l2, mode: 'virtual', sessionDate: '20/10/2026', result: 'aprobo' }, actor(E.cal))).rejects.toThrow(/AAAA-MM-DD/);
    expect(await recordRetraining(prisma, cal, r, { email: E.l2, mode: 'presencial', sessionDate: '2026-10-20', result: 'aprobo', notes: 'Sesión con el jefe del área' }, actor(E.cal))).toMatchObject({ idRetraining: expect.any(Number) });
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[retraining] SET result = N'reprobo' WHERE id_request = ${r}`)).rejects.toThrow(/solo inserción/);
    tv = (await getRequestDetail(prisma, r, await viewer(E.cal))).training!;
    expect(tv.people.find((p) => p.email === E.l2)!.retrainings).toEqual([expect.objectContaining({ mode: 'presencial', sessionDate: '2026-10-20', result: 'aprobo' })]);
    // Cambiar los intentos con resultados cargados exige volver a cargarlos.
    await expect(saveTraining(prisma, cal, r, { ...training, maxAttempts: 3 }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    // Cierre con «Capacitó» (con reprobados, con justificación): queda vigente.
    const cap = await taskOf(r, 'capacitacion');
    const res = await signTask(prisma, deps, cap.id_task, firma('capacito', { comment: 'L2 recapacitado el 2026-10-20; cobertura suficiente.' }), actor(E.cal));
    expect(res).toMatchObject({ outcome: 'resuelta', next: 'completada', published: { versionNumber: 1 } });
    // Después del cierre se sigue pudiendo registrar recapacitaciones.
    await recordRetraining(prisma, cal, r, { email: E.l2, mode: 'virtual', sessionDate: '2026-11-03', result: 'asistio' }, actor(E.cal));
    expect(await prisma.sgcRetraining.count({ where: { id_request: r } })).toBe(2);
  });
});

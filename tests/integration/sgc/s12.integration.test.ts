import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import {
  assertApproversAuthorized,
  canApprove,
  getApproverPolicy,
  grantApproverAuthorization,
  isSubstituteAssigner,
  listApproverAuthorizations,
  listApproverOptions,
  revokeApproverAuthorization,
} from '../../../lib/sgc/db/approvers';
import { grantAuthorizationTypeUser, listAuthorizationTypes } from '../../../lib/sgc/db/authorizations';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { getCompanySettings, saveCompanySettings } from '../../../lib/sgc/db/companySettings';
import type { SgcUploader } from '../../../lib/sgc/db/documents';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { assignSubstitute, confirmSuggestions, createRequest, getRequestDetail, listTaskInbox, setSigners, uploadAttachment } from '../../../lib/sgc/db/requests';
import { signTask, verifyCompanySignatureChain, type SgcSignatureDeps } from '../../../lib/sgc/db/signatures';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';
import { readManifest } from '../../../lib/sgc/pdf/controlledPdf';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';

/**
 * Sprint 12 contra un SQL Server REAL (efímero en CI): APROBADORES
 * AUTORIZADOS (lista por persona y proceso con vigencia; solo Calidad la
 * administra; con la lista cargada el servidor rechaza a un aprobador no
 * autorizado al asignar, sugerir, confirmar y firmar) y FIRMANTE SUSTITUTO
 * (solo el grupo exclusivo SGC-SUSTITUTOS, mismas reglas que un firmante, la
 * firma queda «en sustitución de» en el registro, la cadena y el PDF).
 * Empresa propia (id 112).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 12 con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 112;
  const PW = 'Clave-S12-ci#2026';
  const E = {
    sol: 'sol.s12@onelatampharma.com',
    elab: 'elab.s12@onelatampharma.com',
    rev: 'rev.s12@onelatampharma.com',
    jefe: 'jefe.s12@onelatampharma.com',
    titular: 'titular.s12@onelatampharma.com',
    analista: 'analista.s12@onelatampharma.com',
    sust: 'sust.s12@onelatampharma.com',
    mc: 'mariacamila.s12@onelatampharma.com',
    cal: 'calidad.s12@onelatampharma.com',
    lector: 'lector.s12@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.12.12.12', userAgent: 'vitest-s12' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string, extra: [string, string][] = []) => {
    let sql = fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
    for (const [a, b] of extra) sql = sql.replace(a, b);
    return sql;
  };
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const upload: SgcUploader = async (_s, _f, content) => {
    const id = `s12-${++n}`;
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
    docxToHtml: async () => '<h1>Procedimiento S12</h1><p>Contenido.</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = (text: string) => ({ fileName: 'Procedimiento.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(text)]) });
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: true } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba del S12`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };
  let procGC = 0;
  let procOther = 0;
  let typePR = 0;

  async function newRequest(subject: string) {
    const { idRequest } = await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject, description: `Solicitud de la prueba del S12: ${subject}.`, idProcess: procGC, idDocumentType: typePR, requiresTraining: 'no', formValues: { urgencia: 'Normal' } }, actor(E.sol));
    await setSigners(prisma, notifier, idRequest, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    return idRequest;
  }
  async function toApproval(idRequest: number) {
    await uploadAttachment(prisma, upload, idRequest, { purpose: 'borrador', ...docx(`borrador ${idRequest}`) }, await viewer(E.elab), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(idRequest, 'revision')).id_task, firma('reviso'), actor(E.rev));
    return taskOf(idRequest, 'aprobacion');
  }

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S12 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S12', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S12 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[]][] = [
      [E.sol, ['gestion']],
      [E.elab, ['gestion', 'calidad']],
      [E.rev, ['gestion']],
      [E.jefe, ['gestion']],
      [E.titular, ['gestion']],
      [E.analista, ['gestion']],
      [E.sust, ['gestion']],
      [E.mc, ['calidad']],
      [E.cal, ['calidad']],
      [E.lector, ['lectura']],
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
    procOther = cat.processes.find((p) => p.code !== 'GC')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: typePR, userEmail: E.elab, reason: 'Elaborador de la prueba del S12' }, actor(E.cal));
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba del S12' }, actor('ci@x.co'));
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-135] la migración y el SQL del S12: tablas, columnas, triggers y grupo exclusivo con sus integrantes (idempotente)', async () => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgc' AND t.name IN ('approver_authorization','signer_substitution')`;
    expect(tables).toHaveLength(2);
    const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE (object_id = OBJECT_ID('sgc.task_assignee') AND name = 'on_behalf_of') OR (object_id = OBJECT_ID('sgc.signature') AND name = 'on_behalf_of') OR (object_id = OBJECT_ID('sgc.company_config') AND name = 'approver_list_enforced')`;
    expect(cols).toHaveLength(3);
    expect(await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name IN ('approver_authorization_sin_borrado','signer_substitution_solo_insercion')`).toHaveLength(2);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261008140000_sgc_s12_aprobadores_sustitutos/migration.sql'), 'utf8'));
    const extra: [string, string][] = [["DECLARE @Integrante1 NVARCHAR(255) = NULL;", `DECLARE @Integrante1 NVARCHAR(255) = N'${E.mc}';`]];
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s12-sustitutos-olp.sql', extra));
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s12-sustitutos-olp.sql', extra));
    expect(await prisma.sgcAuthorizationTypeUser.count({ where: { user_email: E.mc, type: { id_company: CO, code: 'SGC-SUSTITUTOS' } } })).toBe(1);
    expect(await isSubstituteAssigner(prisma, CO, E.mc)).toBe(true);
    expect(await isSubstituteAssigner(prisma, CO, E.elab)).toBe(false);
    expect((await getCompanySettings(prisma, CO)).approverListEnforced).toBe(true);
    // Sin nadie en la lista, no se restringe.
    expect((await getApproverPolicy(prisma, CO)).applies).toBe(false);
    expect(await canApprove(prisma, CO, E.analista, procGC, new Date())).toBe(true);
    expect((await listApproverOptions(prisma, CO, procGC, new Date())).restricted).toBe(false);
  });

  let pendingSugg = 0;

  it('[SGC-REQ-132][SGC-REQ-133][SGC-REQ-134] Calidad administra la lista; con ella cargada un analista no queda como aprobador (asignar, sugerir ni confirmar)', async () => {
    // Antes de la lista: el solicitante SUGIERE a un analista como aprobador.
    pendingSugg = await newRequest('Procedimiento con sugerencia previa a la lista');
    expect(await setSigners(prisma, notifier, pendingSugg, { stepKey: 'aprobacion', signers: [E.analista], mode: 'orden' }, actor(E.sol), await accessOf(E.sol))).toMatchObject({ suggested: true });

    await expect(grantApproverAuthorization(prisma, await accessOf(E.sol), { email: E.jefe, reason: 'Jefe del área' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(grantApproverAuthorization(prisma, await accessOf(E.cal), { email: E.lector, reason: 'Solo lectura' }, actor(E.cal))).rejects.toThrow(/gestión documental/);
    await expect(grantApproverAuthorization(prisma, await accessOf(E.cal), { email: E.jefe, idProcessMap: 999_999, reason: 'Proceso inexistente' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    const g1 = await grantApproverAuthorization(prisma, await accessOf(E.cal), { email: E.jefe, idProcessMap: procGC, reason: 'Jefe del área de Gestión de Calidad' }, actor(E.cal));
    await expect(grantApproverAuthorization(prisma, await accessOf(E.cal), { email: E.jefe, idProcessMap: procGC, reason: 'Otra vez' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await grantApproverAuthorization(prisma, await accessOf(E.cal), { email: E.titular, idProcessMap: procGC, reason: 'Titular de la aprobación' }, actor(E.cal));
    await grantApproverAuthorization(prisma, await accessOf(E.cal), { email: E.sust, reason: 'Directora técnica: todos los procesos' }, actor(E.cal));
    await grantApproverAuthorization(prisma, await accessOf(E.cal), { email: E.analista, idProcessMap: procOther, reason: 'Aprueba solo en otro proceso' }, actor(E.cal));
    const future = await grantApproverAuthorization(prisma, await accessOf(E.cal), { email: E.rev, idProcessMap: procGC, validFrom: '2099-01-01', reason: 'Aprobará desde 2099' }, actor(E.cal));

    const list = await listApproverAuthorizations(prisma, await accessOf(E.cal));
    expect(list).toMatchObject({ enforced: true, applies: true });
    expect(list.items.find((i) => i.id === future.id)?.status).toBe('programada');
    expect(list.items.find((i) => i.email === E.sust)?.process).toBe('Todos los procesos');
    await expect(listApproverAuthorizations(prisma, await accessOf(E.sol))).rejects.toMatchObject({ status: 403 });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'aprobador.autorizado' } })).toBe(5);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[approver_authorization] WHERE id_approver_authorization = ${g1.id}`)).rejects.toThrow(/no se borra/);

    const opts = await listApproverOptions(prisma, CO, procGC, new Date());
    expect(opts.restricted).toBe(true);
    expect(opts.users.map((u) => u.email).sort()).toEqual([E.jefe, E.sust, E.titular].sort());

    const r = await newRequest('Procedimiento con aprobador autorizado');
    await expect(setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.analista], mode: 'orden' }, actor(E.elab), await accessOf(E.elab))).rejects.toThrow(/no está en la lista de aprobadores autorizados/);
    await expect(setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.jefe, E.analista], mode: 'orden' }, actor(E.elab), await accessOf(E.elab))).rejects.toMatchObject({ status: 409 });
    await expect(setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.analista], mode: 'orden' }, actor(E.sol), await accessOf(E.sol))).rejects.toMatchObject({ status: 409 });
    // La revisión no se restringe: el analista sí revisa.
    expect(await setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.analista], mode: 'orden', reason: 'El analista revisa' }, actor(E.elab), await accessOf(E.elab))).toMatchObject({ changed: true });
    expect(await setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.jefe], mode: 'orden' }, actor(E.elab), await accessOf(E.elab))).toMatchObject({ changed: true });
    // Lo sugerido ANTES de la lista se vuelve a validar al confirmarlo.
    await expect(confirmSuggestions(prisma, notifier, pendingSugg, actor(E.elab), await accessOf(E.elab))).rejects.toThrow(/no está en la lista de aprobadores autorizados/);
    await expect(assertApproversAuthorized(prisma, { id_company: CO, id_process_map: procGC }, { assignment: 'firmantes', signatureMeaning: 'reviso', name: 'Revisión' }, [E.analista], new Date())).resolves.toBeUndefined();

    // Revocar: con motivo, una sola vez, y deja de contar.
    await expect(revokeApproverAuthorization(prisma, await accessOf(E.cal), future.id, { reason: 'no' }, actor(E.cal))).rejects.toThrow(/mínimo 5/);
    await expect(revokeApproverAuthorization(prisma, await accessOf(E.cal), 999_999, { reason: 'No existe esta' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    expect(await revokeApproverAuthorization(prisma, await accessOf(E.cal), future.id, { reason: 'Ya no aprobará' }, actor(E.cal))).toEqual({ revoked: true });
    await expect(revokeApproverAuthorization(prisma, await accessOf(E.cal), future.id, { reason: 'Ya no aprobará' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(revokeApproverAuthorization(prisma, await accessOf(E.sol), future.id, { reason: 'Ya no aprobará' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });

    // La empresa puede desactivar la lista (configurable y reversible), con motivo.
    await saveCompanySettings(prisma, CO, { approverListEnforced: false, reason: 'Prueba: lista desactivada temporalmente' }, actor(E.cal));
    expect(await canApprove(prisma, CO, E.analista, procGC, new Date())).toBe(true);
    await saveCompanySettings(prisma, CO, { approverListEnforced: true, reason: 'Prueba: lista activa de nuevo' }, actor(E.cal));
    expect(await canApprove(prisma, CO, E.analista, procGC, new Date())).toBe(false);
  });

  it('[SGC-REQ-134][SGC-REQ-135][SGC-REQ-136][SGC-REQ-137][SGC-REQ-138] titular sin autorización vigente: no firma; María Camila asigna un sustituto autorizado y la firma queda «en sustitución de»', async () => {
    const r = await newRequest('Procedimiento con titular de vacaciones');
    await setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.titular], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    const apr = await toApproval(r);
    const slot = apr.assignees.find((a) => a.user_email === E.titular)!;

    // El titular deja de estar autorizado (cambió de cargo): ya no aprueba.
    const tit = await prisma.sgcApproverAuthorization.findFirstOrThrow({ where: { id_company: CO, user_email: E.titular } });
    await revokeApproverAuthorization(prisma, await accessOf(E.cal), tit.id_approver_authorization, { reason: 'Titular de vacaciones y luego cambio de cargo' }, actor(E.cal));
    await expect(signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.titular))).rejects.toThrow(/aprobadores autorizados/);

    const body = { idAssignee: slot.id_task_assignee, toEmail: E.sust, reason: 'Vacaciones del titular', absenceFrom: '2026-11-12', absenceTo: '2026-11-20' };
    // Solo el grupo exclusivo (ni Calidad ni el elaborador).
    await expect(assignSubstitute(prisma, notifier, apr.id_task, body, actor(E.cal))).rejects.toMatchObject({ status: 403 });
    await expect(assignSubstitute(prisma, notifier, apr.id_task, body, actor(E.elab))).rejects.toMatchObject({ status: 403 });
    await expect(assignSubstitute(prisma, notifier, apr.id_task + 999, body, actor(E.mc))).rejects.toMatchObject({ status: 404 });
    await expect(assignSubstitute(prisma, notifier, apr.id_task, { ...body, idAssignee: undefined }, actor(E.mc))).rejects.toThrow(/cupo/);
    // Mismas reglas: autorizado, ni solicitante ni elaborador, distinto del titular.
    await expect(assignSubstitute(prisma, notifier, apr.id_task, { ...body, toEmail: E.analista }, actor(E.mc))).rejects.toThrow(/sustituto de un aprobador también debe estarlo/);
    await expect(assignSubstitute(prisma, notifier, apr.id_task, { ...body, toEmail: E.sol }, actor(E.mc))).rejects.toThrow(/solicitud no puede firmarla/);
    await expect(assignSubstitute(prisma, notifier, apr.id_task, { ...body, toEmail: E.elab }, actor(E.mc))).rejects.toThrow(/elaborador/);
    await expect(assignSubstitute(prisma, notifier, apr.id_task, { ...body, toEmail: E.titular }, actor(E.mc))).rejects.toThrow(/distinta del titular/);
    // El cupo de GRUPO (verificación de Calidad) no se sustituye.
    const pool = apr.assignees.find((a) => !a.user_email)!;
    await expect(assignSubstitute(prisma, notifier, apr.id_task, { ...body, idAssignee: pool.id_task_assignee }, actor(E.mc))).rejects.toThrow(/PENDIENTE/);

    // María Camila ve la acción en el expediente; el elaborador, no.
    expect((await getRequestDetail(prisma, r, await viewer(E.mc))).permissions.canSubstitute).toBe(true);
    expect((await getRequestDetail(prisma, r, await viewer(E.elab))).permissions.canSubstitute).toBe(false);

    sent.length = 0;
    const res = await assignSubstitute(prisma, notifier, apr.id_task, body, actor(E.mc));
    expect(sent.flatMap((x) => x.emails)).toContain(E.sust);
    const old = await prisma.sgcTaskAssignee.findUniqueOrThrow({ where: { id_task_assignee: slot.id_task_assignee } });
    expect(old.status).toBe('reemplazado');
    const fresh = await prisma.sgcTaskAssignee.findUniqueOrThrow({ where: { id_task_assignee: res.idAssignee } });
    expect(fresh).toMatchObject({ user_email: E.sust, on_behalf_of: E.titular, status: 'pendiente', sign_order: slot.sign_order });
    const subs = await prisma.sgcSignerSubstitution.findMany({ where: { id_request: r } });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ original_email: E.titular, substitute_email: E.sust, assigned_by: E.mc, reason: 'Vacaciones del titular' });
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[signer_substitution] SET reason = N'otra' WHERE id_signer_substitution = ${subs[0].id_signer_substitution}`)).rejects.toThrow(/solo inserción/);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'firmante.sustituido', entity_id: String(res.idAssignee) } })).toBe(1);
    // No se duplica: el mismo sustituto ya firma en el paso.
    await expect(assignSubstitute(prisma, notifier, apr.id_task, { ...body, idAssignee: res.idAssignee, toEmail: E.sust }, actor(E.mc))).rejects.toThrow(/ya firma en este paso/);

    const detail = await getRequestDetail(prisma, r, await viewer(E.sust));
    expect(detail.substitutions).toMatchObject([{ original: E.titular, substitute: E.sust, absenceFrom: '2026-11-12', absenceTo: '2026-11-20' }]);
    expect(detail.tasks.find((t) => t.key === 'aprobacion')?.assignedLabel).toContain('en sustitución de');
    expect((await listTaskInbox(prisma, E.sust, await getSgcAccessForUser(prisma, E.sust))).some((x) => x.idTask === apr.id_task)).toBe(true);

    // El sustituto firma; Calidad verifica; el PDF y el manifiesto lo muestran.
    await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(E.sust));
    const res2 = await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
    expect(res2).toMatchObject({ next: 'divulgacion' });
    const sg = await prisma.sgcSignature.findFirstOrThrow({ where: { id_request: r, meaning: 'aprobo', signer_email: E.sust } });
    expect(sg.on_behalf_of).toBe(E.titular);
    expect(await verifyCompanySignatureChain(prisma, CO)).toMatchObject({ ok: true });
    const req = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r } });
    const version = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: req.id_document_version! } });
    const manifest = (await readManifest(store.get(version.pdf_item_id)!))!;
    expect(manifest.signatures.find((s) => s.meaning === 'aprobo' && s.signerEmail === E.sust)?.onBehalfOf).toBe(E.titular);
    expect(manifest.signatures.filter((s) => s.onBehalfOf)).toHaveLength(1);
    // La evidencia JSON también lo lleva.
    const evidence = JSON.parse(new TextDecoder().decode(store.get(sg.evidence_item_id)!));
    expect(evidence.onBehalfOf).toBe(E.titular);
  });

  it('[SGC-REQ-136] en revisión (sin lista) el sustituto solo cumple la segregación; quitar al titular de los firmantes anula el cupo del sustituto', async () => {
    const r = await newRequest('Procedimiento con revisor ausente');
    await setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.jefe], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await uploadAttachment(prisma, upload, r, { purpose: 'borrador', ...docx('revisión') }, await viewer(E.elab), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(r, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    const rev = await taskOf(r, 'revision');
    const slot = rev.assignees.find((a) => a.user_email === E.rev)!;
    // Un analista (no aprobador) SÍ puede sustituir a un revisor.
    const res = await assignSubstitute(prisma, notifier, rev.id_task, { idAssignee: slot.id_task_assignee, toEmail: E.analista, reason: 'Incapacidad del revisor' }, actor(E.mc));
    expect((await prisma.sgcSignerSubstitution.findFirstOrThrow({ where: { id_request: r } })).absence_from).toBeNull();
    // El elaborador cambia los revisores: quitar al titular también anula el cupo de su sustituto.
    await setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.jefe], mode: 'orden', reason: 'Cambio de revisor' }, actor(E.elab), await accessOf(E.elab));
    expect((await prisma.sgcTaskAssignee.findUniqueOrThrow({ where: { id_task_assignee: res.idAssignee } })).status).toBe('reemplazado');
    expect((await taskOf(r, 'revision')).assignees.filter((a) => a.status === 'pendiente').map((a) => a.user_email)).toContain(E.jefe);
  });
});

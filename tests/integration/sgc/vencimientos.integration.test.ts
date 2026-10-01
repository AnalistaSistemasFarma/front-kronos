import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { cancelAccessRequest, createAccessRequest, decideAccessRequest, listAccessRequests, listRequestableDocuments } from '../../../lib/sgc/db/accessRequests';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { canViewDocument, createInitialDocument, getAccessSubject, type SgcUploader } from '../../../lib/sgc/db/documents';
import { getCurrentFlowVersion } from '../../../lib/sgc/db/flows';
import { createIcalToken, getIcalFeed, getIcalStatus, revokeIcalToken } from '../../../lib/sgc/db/ical';
import { addDocumentRelation, getRelationGraph, listDocumentRelations, removeDocumentRelation, saveGraphLayout } from '../../../lib/sgc/db/relations';
import { getAlertSchedulerStatus, listAlertConfigs, listAlertLog, listReviewCalendar, runDailySgcJob, runReadingReminders, runReviewAlerts, saveAlertConfig } from '../../../lib/sgc/db/reviewAlerts';
import type { SgcEmailMessage, SgcMailer } from '../../../lib/sgc/email';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';

/**
 * Sprint 5 contra un SQL Server REAL (efímero en CI), con RELOJ CONTROLADO:
 *   - avisos anticipados de vencimiento: cada aviso sale el día configurado,
 *     UNA sola vez (aunque el programador corra varias veces), queda en
 *     sgc.review_alert y en sgc.audit_log (a quién, cuándo y por qué canal) y
 *     un vencido sigue vigente y se escala a Calidad;
 *   - configuración por tipo documental y por documento; recordatorios
 *     automáticos de lectura; calendario con estados y «Mis vencimientos»;
 *   - mapa de relaciones que respeta permisos; iCal privado; solicitudes de
 *     acceso a documentos de otra área.
 * Empresa PROPIA (id 75) sembrada con los SQL del pase (S1 a S5).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 5 · relaciones, vencimientos y accesos con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 75;
  const E = {
    cal: 'calidad.s5@onelatampharma.com',
    dueno: 'dueno.s5@onelatampharma.com',
    elab: 'elab.s5@onelatampharma.com',
    lector: 'lector.s5@onelatampharma.com',
    otra: 'otra.area.s5@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.5.5.5', userAgent: 'vitest-s5' });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  const mails: SgcEmailMessage[] = [];
  const mailer: SgcMailer = async (msgs) => {
    mails.push(...msgs);
    return msgs.map((m) => (m.to === E.lector ? { to: m.to, ok: false as const, error: 'buzón lleno' } : { to: m.to, ok: true as const }));
  };
  const deps = { notifier, mailer, appUrl: 'https://synerlink.test/' };
  const upload: SgcUploader = async (_s, fileName) => ({ id: `s5-${fileName}-${Math.random().toString(36).slice(2)}` });
  const pdf = async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage([595, 842]).drawText('S5', { x: 50, y: 750, size: 11, font: f });
    return d.save();
  };
  /** 6:00 a. m. de Colombia del día dado (11:00 UTC), como corre el programador. */
  const at6 = (day: string) => new Date(`${day}T11:00:00Z`);
  const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  let procGC = 0;
  let typePR = 0;
  let typeFO = 0;
  let deptA = 0;
  let deptB = 0;
  let doc1 = 0; // pública, vence 2026-12-31
  let doc2 = 0; // confidencial
  let doc3 = 0; // por departamento de OTRA área
  let doc4 = 0; // formato con aviso por tipo documental

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S5 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    // El programador central (dbo.scheduled_job) no tiene modelo Prisma: en CI se crea su tabla mínima.
    await prisma.$executeRawUnsafe(`
      IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NULL
        CREATE TABLE [dbo].[scheduled_job] (id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(255) NOT NULL, job_type NVARCHAR(50) NOT NULL, payload NVARCHAR(MAX) NULL,
          cron_expression NVARCHAR(100) NOT NULL, next_run_date DATETIME NOT NULL, last_run_date DATETIME NULL, last_status NVARCHAR(20) NULL, active BIT NOT NULL,
          source_module NVARCHAR(50) NULL, created_by NVARCHAR(1000) NULL, created_at DATETIME NOT NULL DEFAULT GETDATE());`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S5', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S5 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    deptA = (await prisma.department.create({ data: { department: `Garantía S5 CI ${Date.now()}` } })).id_department;
    deptB = (await prisma.department.create({ data: { department: `Producción S5 CI ${Date.now()}` } })).id_department;
    const grants: [string, string[], number | null][] = [
      [E.cal, ['calidad'], null],
      [E.dueno, ['gestion'], deptA],
      [E.elab, ['gestion'], null],
      [E.lector, ['lectura'], deptA],
      [E.otra, ['lectura'], deptB],
    ];
    for (const [email, perms, dept] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: 'x' } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
      if (dept) await prisma.departmentUser.create({ data: { id_user: user.id, id_department: dept } });
    }
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s1-maestros-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s2-flujo-documental-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-09-30-sgc-s3-firma-calidad-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql'));
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    typeFO = cat.documentTypes.find((t) => t.code === 'FO')!.id;
    await prisma.sgcProcessMap.update({ where: { id_process_map: procGC }, data: { id_department: deptA } });
    const load = async (title: string, confidentiality: string, effectiveDate: string, extra: Record<string, unknown> = {}) =>
      (await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procGC, idDocumentType: typePR, title, confidentiality, versionNumber: 1, effectiveDate, pdf: { bytes: await pdf(), fileName: 'v1.pdf' }, ...extra }, actor(E.cal), new Date('2026-10-01T12:00:00Z'))).idDocument;
    doc1 = await load('Control de documentos S5', 'publica', '2023-12-31');
    doc2 = await load('Plan confidencial S5', 'confidencial', '2024-06-30');
    doc3 = await load('Instructivo de producción S5', 'departamento', '2025-01-15', { idOwnerDepartment: deptB });
    doc4 = await load('Formato de control S5', 'publica', '2023-12-31', { idDocumentType: typeFO });
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-066] las 6 tablas del S5 viven en `sgc` con sus triggers; el SQL del pase deja la configuración general y el job del programador (idempotente)', async () => {
    const rows = await prisma.$queryRaw<{ tabla: string; esquema: string }[]>`
      SELECT t.name AS tabla, s.name AS esquema FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name IN ('document_relation','graph_layout','review_alert_config','review_alert','ical_token','access_request')`;
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.esquema))).toEqual(new Set(['sgc']));
    const trg = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name IN ('document_relation_sin_borrado','review_alert_config_sin_borrado','review_alert_inmodificable','ical_token_sin_borrado','access_request_sin_borrado')`;
    expect(trg).toHaveLength(5);
    expect(await getAlertSchedulerStatus(prisma)).toBeNull();
    await prisma.$executeRawUnsafe(seed('2026-10-01-sgc-s5-vencimientos-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-01-sgc-s5-vencimientos-olp.sql'));
    const configs = await listAlertConfigs(prisma, CO);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ scope: 'empresa', offsets: [60, 30, 15, 7, 0], overdueEveryDays: 7, readingReminderDays: 7, emailEnabled: true, isActive: true });
    const jobs = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*) AS n FROM dbo.scheduled_job WHERE job_type = 'sgc_review_alerts'`;
    expect(Number(jobs[0].n)).toBe(1);
    expect(await getAlertSchedulerStatus(prisma)).toMatchObject({ active: true, cron: '0 6 * * *' });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'vencimiento.configurado' } })).toBe(1);
  });

  it('[SGC-REQ-068] configuración por tipo documental y por documento (solo Calidad, con motivo, auditada); valida días y alcance', async () => {
    const cal = await accessOf(E.cal);
    await expect(saveAlertConfig(prisma, await accessOf(E.dueno), { scope: 'tipo', idDocumentType: typeFO, offsets: [10], reason: 'Formatos con aviso corto' }, actor(E.dueno))).rejects.toMatchObject({ status: 403 });
    await expect(saveAlertConfig(prisma, cal, { scope: 'x', reason: 'Alcance que no existe' }, actor(E.cal))).rejects.toThrow(/Alcance/);
    await expect(saveAlertConfig(prisma, cal, { scope: 'tipo', idDocumentType: typeFO, offsets: [10], reason: 'corto' }, actor(E.cal))).rejects.toThrow(/motivo/);
    await expect(saveAlertConfig(prisma, cal, { scope: 'tipo', idDocumentType: 999999, offsets: [10], reason: 'Tipo que no existe' }, actor(E.cal))).rejects.toThrow(/tipo documental/);
    await expect(saveAlertConfig(prisma, cal, { scope: 'documento', idDocument: 999999, offsets: [10], reason: 'Documento que no existe' }, actor(E.cal))).rejects.toThrow(/documento/);
    await expect(saveAlertConfig(prisma, cal, { scope: 'tipo', idDocumentType: typeFO, offsets: [400], reason: 'Días fuera de rango' }, actor(E.cal))).rejects.toThrow(/entre 0 y 365/);
    await expect(saveAlertConfig(prisma, cal, { scope: 'tipo', idDocumentType: typeFO, offsets: [10], overdueEveryDays: 0, reason: 'Repetición inválida' }, actor(E.cal))).rejects.toThrow(/1 y 90/);
    await expect(saveAlertConfig(prisma, cal, { scope: 'empresa', offsets: [10], readingReminderDays: 99, reason: 'Recordatorio inválido' }, actor(E.cal))).rejects.toThrow(/0 \(apagado\) y 60/);
    await expect(saveAlertConfig(prisma, cal, { scope: 'tipo', idDocumentType: typeFO, offsets: [10], extraEmails: 'no-es-correo', reason: 'Correo inválido' }, actor(E.cal))).rejects.toThrow(/Correo inválido/);
    await expect(saveAlertConfig(prisma, cal, { scope: 'empresa', offsets: [10], isActive: false, reason: 'Apagar la general' }, actor(E.cal))).rejects.toThrow(/no se desactiva/);
    const t = await saveAlertConfig(prisma, cal, { scope: 'tipo', idDocumentType: typeFO, offsets: '10', overdueEveryDays: 15, extraEmails: 'jefe.formatos@onelatampharma.com', reason: 'Los formatos se revisan con aviso corto' }, actor(E.cal));
    expect(t).toMatchObject({ scope: 'tipo', scopeKey: `tipo:${typeFO}`, offsets: [10], overdueEveryDays: 15, extraEmails: ['jefe.formatos@onelatampharma.com'] });
    // Excepción por documento, y luego se desactiva (gana de nuevo el tipo / la empresa).
    await saveAlertConfig(prisma, cal, { scope: 'documento', idDocument: doc2, offsets: [5], reason: 'Excepción del plan confidencial' }, actor(E.cal));
    const off = await saveAlertConfig(prisma, cal, { scope: 'documento', idDocument: doc2, offsets: [5], isActive: false, reason: 'Se retira la excepción del plan' }, actor(E.cal));
    expect(off.isActive).toBe(false);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'vencimiento.configurado' } })).toBe(4);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[review_alert_config] WHERE id_company = ${CO}`)).rejects.toThrow(/no se borra/);
  });

  it('[SGC-REQ-068][SGC-REQ-069][SGC-REQ-070] RELOJ CONTROLADO: cada aviso sale el día configurado, una sola vez, queda registrado con destinatarios y canales; el vencido sigue vigente y se escala a Calidad', async () => {
    // Un elaborador «real» del documento: la solicitud que produjo la versión vigente.
    const { process, version } = await getCurrentFlowVersion(prisma, CO, 'DOC');
    const d1 = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: doc1 } });
    await prisma.sgcRequest.create({ data: { id_company: CO, id_flow_process: process.id_flow_process, id_flow_version: version.id_flow_version, request_type: 'nueva_version', subject: 'Versión vigente S5', description: 'Solicitud que produjo la V1', id_document: doc1, requester_email: E.elab, elaborator_email: E.elab, status: 'completada', id_document_version: d1.current_version_id } });
    sent.length = 0;
    mails.length = 0;
    const byDay: Record<string, string[]> = {};
    for (let day = '2026-10-25'; day <= '2027-01-16'; day = nextDay(day)) {
      const s = await runReviewAlerts(prisma, deps, { now: at6(day), idCompany: CO });
      // Segunda corrida el mismo día (programador y «Ejecutar ahora»): no repite nada.
      const again = await runReviewAlerts(prisma, deps, { now: new Date(at6(day).getTime() + 3 * 3600_000), idCompany: CO, source: 'manual' });
      expect(again.sent).toBe(0);
      if (s.sent) byDay[day] = (await prisma.sgcReviewAlert.findMany({ where: { id_company: CO, run_date: new Date(`${day}T00:00:00Z`), status: 'enviado' }, include: { document: { select: { code: true } } } })).map((a) => `${a.document.code.split('-').at(-2)}:${a.kind}:${a.offset_days}`).sort();
    }
    // doc1 (PR) y doc4 (FO, aviso a 10 días) vencen el 2026-12-31; doc2 (2027-06-30) y doc3 (2028-01-15) no avisan en la ventana.
    expect(byDay).toEqual({
      '2026-11-01': ['PR:anticipado:60'],
      '2026-12-01': ['PR:anticipado:30'],
      '2026-12-16': ['PR:anticipado:15'],
      '2026-12-21': ['FO:anticipado:10'],
      '2026-12-24': ['PR:anticipado:7'],
      '2026-12-31': ['PR:vencimiento:0'],
      // FO no tiene aviso «el día»: al día siguiente de vencer igual se escala.
      '2027-01-01': ['FO:vencimiento:0'],
      '2027-01-07': ['PR:vencido:7'],
      '2027-01-14': ['PR:vencido:14'],
      '2027-01-15': ['FO:vencido:15'],
    });
    // FO: vencido escala cada 15 días (su configuración por tipo).
    const rows = await prisma.sgcReviewAlert.findMany({ where: { id_document: doc1 }, orderBy: { id_review_alert: 'asc' } });
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.alert_key)).size).toBe(7);
    const first = rows[0];
    expect(JSON.parse(first.recipients_json)).toEqual(
      expect.arrayContaining([
        { email: E.dueno, roles: ['dueno'] },
        { email: E.elab, roles: ['elaborador'] },
        { email: E.cal, roles: ['calidad'] },
      ])
    );
    expect(JSON.parse(first.channels_json)).toEqual(expect.arrayContaining([{ email: E.dueno, campana: 'enviado', correo: 'enviado' }]));
    expect(first.sent_at).not.toBeNull();
    // Cada aviso queda en la auditoría: a quién, cuándo y por qué canal.
    const audits = await prisma.sgcAuditLog.findMany({ where: { id_company: CO, action: 'vencimiento.aviso', entity_id: String(first.id_review_alert) } });
    expect(audits.map((a) => JSON.parse(a.after_json!).to).sort()).toEqual([E.cal, E.dueno, E.elab].sort());
    expect(audits[0].detail).toMatch(/por campana\/push y correo/);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'vencimiento.escalado', entity_id: String(doc1) } })).toBe(3);
    // El vencido SIGUE VIGENTE y visible.
    expect(await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: doc1 } })).toMatchObject({ status: 'vigente' });
    // Notificaciones (campana/push) con el título de escalado, y correo con destinatario adicional del tipo FO.
    expect(sent.some((n) => n.payload.title.includes('escalado a Calidad') && n.emails.includes(E.cal))).toBe(true);
    expect(mails.some((m) => m.to === 'jefe.formatos@onelatampharma.com')).toBe(true);
    // El registro de avisos no se modifica ni se borra.
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[review_alert] SET alert_key = N'x' WHERE id_review_alert = ${first.id_review_alert}`)).rejects.toThrow(/no cambia/);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[review_alert] SET channels_json = N'[]' WHERE id_review_alert = ${first.id_review_alert}`)).rejects.toThrow(/no cambia/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[review_alert] WHERE id_review_alert = ${first.id_review_alert}`)).rejects.toThrow(/no se borra/);
    // Registro para Calidad.
    const log = await listAlertLog(prisma, await accessOf(E.cal), { idDocument: doc1 });
    expect(log).toHaveLength(7);
    expect(log[0]).toMatchObject({ kind: 'vencido', offsetDays: 14, status: 'enviado' });
    await expect(listAlertLog(prisma, await accessOf(E.dueno))).rejects.toMatchObject({ status: 403 });
  });

  it('[SGC-REQ-068] si el programador no corrió en su día, al correr sale solo el más urgente y los atrasados quedan omitidos (constancia), y un correo fallido queda registrado', async () => {
    // doc2 vence el 2027-06-30. Primera corrida a 10 días: sale el de 15 y se omiten 60 y 30.
    sent.length = 0;
    await saveAlertConfig(prisma, await accessOf(E.cal), { scope: 'documento', idDocument: doc2, offsets: [60, 30, 15, 7, 0], extraEmails: [E.lector], isActive: true, reason: 'Excepción del plan confidencial con lector' }, actor(E.cal));
    const s = await runReviewAlerts(prisma, deps, { now: at6('2027-06-20'), idCompany: CO });
    // (doc1 y doc4, vencidos desde diciembre, también reciben su escalado de ese ciclo.)
    expect(s).toMatchObject({ sent: 3, omitted: 2 });
    const rows = await prisma.sgcReviewAlert.findMany({ where: { id_document: doc2 }, orderBy: { offset_days: 'desc' } });
    expect(rows.map((r) => `${r.status}:${r.offset_days}`)).toEqual(['omitido:60', 'omitido:30', 'enviado:15']);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'vencimiento.aviso_omitido' } })).toBe(2);
    expect(JSON.parse(rows[2].channels_json)).toEqual(expect.arrayContaining([{ email: E.lector, campana: 'enviado', correo: 'error: buzón lleno' }]));
    expect(s.emailErrors).toBe(1);
    // Con el correo apagado por la empresa, solo campana/push.
    await saveAlertConfig(prisma, await accessOf(E.cal), { scope: 'empresa', offsets: [60, 30, 15, 7, 0], emailEnabled: false, reason: 'Pruebas: se apaga el correo' }, actor(E.cal));
    const s2 = await runReviewAlerts(prisma, deps, { now: at6('2027-06-23'), idCompany: CO });
    expect(s2).toMatchObject({ sent: 1, emails: 0 });
    const r7 = await prisma.sgcReviewAlert.findFirstOrThrow({ where: { id_document: doc2, offset_days: 7 } });
    expect(JSON.parse(r7.channels_json).every((c: { correo: string }) => c.correo === 'apagado')).toBe(true);
    await saveAlertConfig(prisma, await accessOf(E.cal), { scope: 'empresa', offsets: [60, 30, 15, 7, 0], emailEnabled: true, reason: 'Pruebas: se vuelve a encender' }, actor(E.cal));
  });

  it('[SGC-REQ-067] el calendario muestra la próxima fecha de vencimiento correcta, el estado y «Mis vencimientos»; respeta permisos', async () => {
    const { process, version } = await getCurrentFlowVersion(prisma, CO, 'DOC');
    await prisma.sgcRequest.create({ data: { id_company: CO, id_flow_process: process.id_flow_process, id_flow_version: version.id_flow_version, request_type: 'nueva_version', subject: 'Revisión del formato', description: 'Nueva versión en curso', id_document: doc4, requester_email: E.elab, elaborator_email: E.elab, status: 'abierta' } });
    const cal = await listReviewCalendar(prisma, await accessOf(E.cal), await getAccessSubject(prisma, E.cal), at6('2026-12-10'));
    expect(cal.today).toBe('2026-12-10');
    const by = Object.fromEntries(cal.items.map((i) => [i.idDocument, i]));
    expect(by[doc1]).toMatchObject({ dueDate: '2026-12-31', state: 'proximo', lastElaborator: E.elab, owners: [E.dueno], isMine: false, offsets: [60, 30, 15, 7, 0] });
    expect(by[doc2]).toMatchObject({ dueDate: '2027-06-30', state: 'al_dia' });
    expect(by[doc3]).toMatchObject({ dueDate: '2028-01-15', state: 'al_dia', owners: [] });
    expect(by[doc4]).toMatchObject({ state: 'en_revision', offsets: [10] });
    expect(by[doc4].openRequestId).toBeGreaterThan(0);
    const late = await listReviewCalendar(prisma, await accessOf(E.cal), await getAccessSubject(prisma, E.cal), at6('2027-01-02'));
    expect(late.items.find((i) => i.idDocument === doc1)!.state).toBe('vencido');
    // El dueño del proceso: «Mis vencimientos» marca sus documentos.
    const own = await listReviewCalendar(prisma, await accessOf(E.dueno), await getAccessSubject(prisma, E.dueno), at6('2026-12-10'));
    expect(own.items.filter((i) => i.isMine).map((i) => i.idDocument).sort()).toEqual([doc1, doc4].sort());
    // El lector no ve el confidencial ni el de otra área.
    const lector = await listReviewCalendar(prisma, await accessOf(E.lector), await getAccessSubject(prisma, E.lector), at6('2026-12-10'));
    expect(lector.items.map((i) => i.idDocument).sort()).toEqual([doc1, doc4].sort());
  });

  it('[SGC-REQ-069] recordatorios AUTOMÁTICOS de lectura (lo que el S4 dejó manual): cada N días desde el último, una sola vez', async () => {
    const { process, version } = await getCurrentFlowVersion(prisma, CO, 'DOC');
    const def = await prisma.sgcFlowTaskDef.findFirstOrThrow({ where: { id_flow_version: version.id_flow_version, task_key: 'divulgacion' } });
    const r = await prisma.sgcRequest.create({ data: { id_company: CO, id_flow_process: process.id_flow_process, id_flow_version: version.id_flow_version, request_type: 'nuevo', subject: 'Divulgación S5', description: 'Lectura pendiente', requester_email: E.elab, elaborator_email: E.elab, status: 'abierta', current_task_key: 'divulgacion' } });
    const t = await prisma.sgcTask.create({ data: { id_request: r.id_request, id_flow_task_def: def.id_flow_task_def, task_key: 'divulgacion', name: 'Divulgación', step_order: def.step_order, status: 'abierta', started_at: new Date('2026-12-01T15:00:00Z') } });
    const a = await prisma.sgcTaskAssignee.create({ data: { id_task: t.id_task, user_email: E.lector, signature_status: 'pendiente', signature_meaning: 'leyo' } });
    await prisma.sgcReadRecord.create({ data: { id_request: r.id_request, id_task: t.id_task, id_task_assignee: a.id_task_assignee, user_email: E.lector, sources_json: '["persona"]', assigned_at: new Date('2026-12-01T15:00:00Z') } });
    sent.length = 0;
    expect(await runReadingReminders(prisma, notifier, { now: at6('2026-12-07'), idCompany: CO })).toBe(0);
    expect(await runReadingReminders(prisma, notifier, { now: at6('2026-12-08'), idCompany: CO })).toBe(1);
    expect(await runReadingReminders(prisma, notifier, { now: at6('2026-12-08'), idCompany: CO })).toBe(0);
    expect(await runReadingReminders(prisma, notifier, { now: at6('2026-12-14'), idCompany: CO })).toBe(0);
    expect(await runReadingReminders(prisma, notifier, { now: at6('2026-12-15'), idCompany: CO })).toBe(1);
    expect(await prisma.sgcReadRecord.findFirstOrThrow({ where: { id_task: t.id_task } })).toMatchObject({ reminders_sent: 2 });
    expect(sent.filter((n) => n.payload.title.includes('Recordatorio')).flatMap((n) => n.emails)).toEqual([E.lector, E.lector]);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'divulgacion.recordatorio_automatico' } })).toBe(2);
    // Apagado (0) desde la configuración de la empresa: no recuerda.
    await saveAlertConfig(prisma, await accessOf(E.cal), { scope: 'empresa', offsets: [60, 30, 15, 7, 0], readingReminderDays: 0, reason: 'Pruebas: sin recordatorio de lectura' }, actor(E.cal));
    expect(await runReadingReminders(prisma, notifier, { now: at6('2026-12-30'), idCompany: CO })).toBe(0);
    await saveAlertConfig(prisma, await accessOf(E.cal), { scope: 'empresa', offsets: [60, 30, 15, 7, 0], readingReminderDays: 7, reason: 'Pruebas: recordatorio de lectura de nuevo' }, actor(E.cal));
    // La corrida del día completa (manual de Calidad) queda en la auditoría.
    const s = await runDailySgcJob(prisma, deps, { now: at6('2026-12-30'), idCompany: CO, source: 'manual', actorEmail: E.cal });
    expect(s.readingReminders).toBe(1);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'vencimiento.ejecucion' } })).toBe(1);
  });

  it('[SGC-REQ-071][SGC-REQ-072][SGC-REQ-075] relaciones tipadas (solo Calidad, con motivo, sin duplicados ni borrado) y un mapa que respeta permisos', async () => {
    const cal = await getSgcAccessForUser(prisma, E.cal);
    const d1 = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: doc1 } });
    const d2 = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: doc2 } });
    await expect(addDocumentRelation(prisma, await getSgcAccessForUser(prisma, E.dueno), { idSource: doc4, idTarget: doc1, type: 'formato', reason: 'Formato del procedimiento' }, actor(E.dueno))).rejects.toMatchObject({ status: 403 });
    await expect(addDocumentRelation(prisma, cal, { idSource: 999999, idTarget: doc1, type: 'formato', reason: 'No existe el origen' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(addDocumentRelation(prisma, cal, { idSource: doc4, idTarget: doc1, type: 'modulo', reason: 'Tipo que no existe' }, actor(E.cal))).rejects.toThrow(/Tipo de relación/);
    await expect(addDocumentRelation(prisma, cal, { idSource: doc4, targetCode: 'NO-EXISTE', type: 'formato', reason: 'Código inexistente' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    await expect(addDocumentRelation(prisma, cal, { idSource: doc1, idTarget: doc1, type: 'referencia', reason: 'Consigo mismo no' }, actor(E.cal))).rejects.toThrow(/consigo mismo/);
    await expect(addDocumentRelation(prisma, cal, { idSource: doc4, idTarget: doc1, type: 'formato', reason: 'corto' }, actor(E.cal))).rejects.toThrow(/motivo/);
    const r1 = await addDocumentRelation(prisma, cal, { idSource: doc4, idTarget: doc1, type: 'formato', note: 'Registro del control', reason: 'Formato del procedimiento de control' }, actor(E.cal));
    await expect(addDocumentRelation(prisma, cal, { idSource: doc4, targetCode: d1.code.toLowerCase(), type: 'formato', reason: 'Repetida a propósito' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await addDocumentRelation(prisma, cal, { idSource: doc1, targetCode: d2.code, type: 'referencia', reason: 'Referencia al plan confidencial' }, actor(E.cal));
    await addDocumentRelation(prisma, cal, { idSource: doc3, idTarget: doc1, type: 'anexo', reason: 'Anexo de producción' }, actor(E.cal));
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'relacion.agregada' } })).toBe(3);
    // Calidad ve todo el grafo.
    const gCal = await getRelationGraph(prisma, cal.find((a) => a.idCompany === CO)!, await getAccessSubject(prisma, E.cal));
    expect(gCal.nodes.map((n) => n.id).sort()).toEqual([doc1, doc2, doc3, doc4].sort());
    expect(gCal.edges).toHaveLength(3);
    // El lector (departamento A) no ve el confidencial ni el de otra área, ni las relaciones hacia ellos.
    const gLec = await getRelationGraph(prisma, await accessOf(E.lector), await getAccessSubject(prisma, E.lector));
    expect(gLec.nodes.map((n) => n.id).sort()).toEqual([doc1, doc4].sort());
    expect(gLec.edges.map((e) => [e.source, e.target, e.type])).toEqual([[doc4, doc1, 'formato']]);
    const relLec = await listDocumentRelations(prisma, await getSgcAccessForUser(prisma, E.lector), await getAccessSubject(prisma, E.lector), doc1);
    expect(relLec!.map((r) => [r.direction, r.other.idDocument, r.type])).toEqual([['entra', doc4, 'formato']]);
    expect(await listDocumentRelations(prisma, await getSgcAccessForUser(prisma, E.lector), await getAccessSubject(prisma, E.lector), doc2)).toBeNull();
    // Posiciones guardadas por persona.
    await saveGraphLayout(prisma, await accessOf(E.lector), E.lector, { [doc1]: { x: 10.4, y: 20 } });
    await saveGraphLayout(prisma, await accessOf(E.lector), E.lector, { [doc1]: { x: 15, y: 25 }, [doc4]: { x: 300, y: 0 } });
    expect((await getRelationGraph(prisma, await accessOf(E.lector), await getAccessSubject(prisma, E.lector))).layout).toEqual({ [doc1]: { x: 15, y: 25 }, [doc4]: { x: 300, y: 0 } });
    await expect(saveGraphLayout(prisma, await accessOf(E.lector), E.lector, 'basura')).rejects.toThrow(/inválido/);
    // Retirar: no se borra.
    await expect(removeDocumentRelation(prisma, await getSgcAccessForUser(prisma, E.dueno), r1.id_document_relation, 'No me corresponde', actor(E.dueno))).rejects.toMatchObject({ status: 403 });
    await removeDocumentRelation(prisma, cal, r1.id_document_relation, 'El formato ya no aplica', actor(E.cal));
    await expect(removeDocumentRelation(prisma, cal, r1.id_document_relation, 'Otra vez retirada', actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(removeDocumentRelation(prisma, cal, 999999, 'No existe la relación', actor(E.cal))).rejects.toMatchObject({ status: 404 });
    expect((await getRelationGraph(prisma, await accessOf(E.lector), await getAccessSubject(prisma, E.lector))).edges).toHaveLength(0);
    // Se puede volver a registrar la misma relación una vez retirada.
    await addDocumentRelation(prisma, cal, { idSource: doc4, idTarget: doc1, type: 'formato', reason: 'Vuelve a aplicar el formato' }, actor(E.cal));
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[document_relation] WHERE id_company = ${CO}`)).rejects.toThrow(/no se borra/);
    // Con un documento anulado no se relaciona.
    await prisma.sgcDocument.update({ where: { id_document: doc3 }, data: { status: 'anulado' } });
    await expect(addDocumentRelation(prisma, cal, { idSource: doc3, idTarget: doc4, type: 'referencia', reason: 'Documento anulado' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await prisma.sgcDocument.update({ where: { id_document: doc3 }, data: { status: 'vigente' } });
  });

  it('[SGC-REQ-076] iCal privado: el enlace muestra los vencimientos con los permisos actuales; confidencial sin título; revocado o sin acceso → nada; cada consulta se audita', async () => {
    const lecAccess = await accessOf(E.lector);
    const { token, path: p } = await createIcalToken(prisma, lecAccess, actor(E.lector), at6('2026-12-10'));
    expect(p).toBe(`/api/sgc/ical/${token}`);
    expect((await prisma.sgcIcalToken.findFirstOrThrow({ where: { user_email: E.lector, revoked_at: null } })).token_sha256).not.toContain(token);
    const ics = await getIcalFeed(prisma, token, { ip: '10.0.0.1', userAgent: 'Outlook', appUrl: 'https://synerlink.test/' }, at6('2026-12-10'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ics).toContain('Control de documentos S5');
    expect(ics).not.toContain('Plan confidencial S5');
    expect(await getIcalStatus(prisma, lecAccess, E.lector)).toMatchObject({ active: true, useCount: 1 });
    // Calidad sí ve el confidencial, pero solo con su código.
    const calTok = await createIcalToken(prisma, await accessOf(E.cal), actor(E.cal));
    const calIcs = await getIcalFeed(prisma, calTok.token, { appUrl: 'https://synerlink.test' });
    const d2 = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: doc2 } });
    expect(calIcs).toContain(`Vence revisión: ${d2.code} V1\r\n`);
    expect(calIcs).not.toContain('Plan confidencial S5');
    // Un enlace nuevo revoca el anterior; revocar deja sin datos.
    const again = await createIcalToken(prisma, lecAccess, actor(E.lector));
    expect(await getIcalFeed(prisma, token, { appUrl: 'x' })).toBeNull();
    expect(await getIcalFeed(prisma, again.token, { appUrl: 'x' })).toContain('BEGIN:VCALENDAR');
    await revokeIcalToken(prisma, lecAccess, actor(E.lector));
    await expect(revokeIcalToken(prisma, lecAccess, actor(E.lector))).rejects.toMatchObject({ status: 404 });
    expect(await getIcalFeed(prisma, again.token, { appUrl: 'x' })).toBeNull();
    expect(await getIcalFeed(prisma, 'no-es-un-token', { appUrl: 'x' })).toBeNull();
    expect(await getIcalFeed(prisma, 'A'.repeat(43), { appUrl: 'x' })).toBeNull();
    expect(await getIcalStatus(prisma, lecAccess, E.lector)).toMatchObject({ active: false });
    // Si la persona pierde el acceso al SGC, el enlace deja de entregar datos.
    const otraTok = await createIcalToken(prisma, await accessOf(E.otra), actor(E.otra));
    await prisma.user.update({ where: { email: E.otra }, data: { isActive: false } });
    expect(await getIcalFeed(prisma, otraTok.token, { appUrl: 'x' })).toBeNull();
    await prisma.user.update({ where: { email: E.otra }, data: { isActive: true } });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'ical.consulta' } })).toBe(3);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'ical.creado' } })).toBe(4);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[ical_token] WHERE id_company = ${CO}`)).rejects.toThrow(/no se borra/);
  });

  it('[SGC-REQ-077][SGC-REQ-078] solicitud de acceso a un documento de otra área: no revela confidenciales; Calidad aprueba (crea el acceso) o rechaza con motivo; se cancela', async () => {
    const otra = await accessOf(E.otra);
    const subOtra = await getAccessSubject(prisma, E.otra);
    const cal = await getSgcAccessForUser(prisma, E.cal);
    const d1 = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: doc1 } });
    const d2 = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: doc2 } });
    // Mover doc1 a «por departamento» del área A para que la otra área no lo vea.
    await prisma.sgcDocument.update({ where: { id_document: doc1 }, data: { confidentiality: 'departamento', id_owner_department: deptA } });
    expect((await listRequestableDocuments(prisma, otra, subOtra)).map((d) => d.idDocument)).toEqual([doc1]);
    sent.length = 0;
    await expect(createAccessRequest(prisma, notifier, otra, subOtra, { code: d1.code, justification: 'corta' }, actor(E.otra))).rejects.toThrow(/justificación/);
    await expect(createAccessRequest(prisma, notifier, otra, subOtra, { justification: 'Sin documento ni código' }, actor(E.otra))).rejects.toThrow(/código/);
    await expect(createAccessRequest(prisma, notifier, otra, subOtra, { idDocument: doc2, justification: 'Por id un confidencial' }, actor(E.otra))).rejects.toThrow(/lista/);
    const a = await createAccessRequest(prisma, notifier, otra, subOtra, { idDocument: doc1, justification: 'Necesito el procedimiento para auditoría interna' }, actor(E.otra));
    const b = await createAccessRequest(prisma, notifier, otra, subOtra, { code: d2.code.toLowerCase(), justification: 'Necesito el plan para el comité' }, actor(E.otra));
    const c = await createAccessRequest(prisma, notifier, otra, subOtra, { code: 'OLP-NO-EXISTE-999', justification: 'Código que no existe en la empresa' }, actor(E.otra));
    // La misma respuesta exista o no el documento.
    expect(new Set([a.message, b.message, c.message]).size).toBe(1);
    await expect(createAccessRequest(prisma, notifier, otra, subOtra, { code: d2.code, justification: 'Repetida mientras está pendiente' }, actor(E.otra))).rejects.toMatchObject({ status: 409 });
    expect(sent.filter((n) => n.payload.title.includes('Solicitud de acceso')).every((n) => n.emails.includes(E.cal))).toBe(true);
    const mine = await listAccessRequests(prisma, otra, E.otra);
    expect(mine.all).toBeNull();
    expect(mine.mine.every((r) => r.document === null)).toBe(true);
    const all = (await listAccessRequests(prisma, cal.find((x) => x.idCompany === CO)!, E.cal)).all!;
    expect(all.find((r) => r.id === c.idAccessRequest)!.document).toBeNull();
    expect(all.find((r) => r.id === b.idAccessRequest)!.document).toMatchObject({ idDocument: doc2, confidentiality: 'confidencial' });
    // Solo Calidad decide, nunca la propia; aprobar exige documento vigente y un motivo.
    await expect(decideAccessRequest(prisma, notifier, await getSgcAccessForUser(prisma, E.otra), a.idAccessRequest, { decision: 'aprobar', reason: 'Me lo apruebo yo' }, actor(E.otra))).rejects.toMatchObject({ status: 403 });
    await expect(decideAccessRequest(prisma, notifier, cal, a.idAccessRequest, { decision: 'tal_vez', reason: 'Decisión inválida' }, actor(E.cal))).rejects.toThrow(/Decisión/);
    await expect(decideAccessRequest(prisma, notifier, cal, a.idAccessRequest, { decision: 'aprobar', reason: 'corto' }, actor(E.cal))).rejects.toThrow(/motivo/);
    await expect(decideAccessRequest(prisma, notifier, cal, a.idAccessRequest, { decision: 'aprobar', reason: 'Vence en el pasado', expiresAt: '2020-01-01' }, actor(E.cal))).rejects.toThrow(/futura/);
    await expect(decideAccessRequest(prisma, notifier, cal, c.idAccessRequest, { decision: 'aprobar', reason: 'No hay documento que aprobar' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    expect(await canViewDocument(prisma, [otra], subOtra, doc1)).toBe(false);
    const ok = await decideAccessRequest(prisma, notifier, cal, a.idAccessRequest, { decision: 'aprobar', reason: 'Justificación suficiente para auditoría', expiresAt: '2099-12-31T23:59:59-05:00' }, actor(E.cal));
    expect(ok.status).toBe('aprobada');
    expect(await canViewDocument(prisma, [otra], subOtra, doc1)).toBe(true);
    expect(await prisma.sgcDocumentAccess.findUniqueOrThrow({ where: { id_document_access: ok.idDocumentAccess! } })).toMatchObject({ user_email: E.otra, can_view: true, can_download: false, can_print: false });
    await expect(decideAccessRequest(prisma, notifier, cal, a.idAccessRequest, { decision: 'rechazar', reason: 'Ya estaba decidida' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    expect((await decideAccessRequest(prisma, notifier, cal, c.idAccessRequest, { decision: 'rechazar', reason: 'El código no existe en la empresa' }, actor(E.cal))).status).toBe('rechazada');
    expect(sent.some((n) => n.payload.title.includes('aprobada') && n.emails.includes(E.otra))).toBe(true);
    await expect(decideAccessRequest(prisma, notifier, cal, 999999, { decision: 'rechazar', reason: 'No existe la solicitud' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    // Quien pidió cancela la suya (nadie más).
    await expect(cancelAccessRequest(prisma, cal, b.idAccessRequest, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    expect((await cancelAccessRequest(prisma, await getSgcAccessForUser(prisma, E.otra), b.idAccessRequest, actor(E.otra))).status).toBe('cancelada');
    await expect(cancelAccessRequest(prisma, await getSgcAccessForUser(prisma, E.otra), b.idAccessRequest, actor(E.otra))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: { in: ['acceso.solicitado', 'acceso.solicitud_decidida', 'acceso.solicitud_cancelada'] } } })).toBe(6);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[access_request] WHERE id_company = ${CO}`)).rejects.toThrow(/no se borra/);
    // Ya con acceso, ese documento deja de aparecer para pedir.
    expect(await listRequestableDocuments(prisma, otra, subOtra)).toEqual([]);
  });
});

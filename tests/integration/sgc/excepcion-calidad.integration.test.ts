import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { SGC_QUALITY_SELF_REVIEW_ACTION, getCompanySettings, isQualitySelfReviewEnabled, saveCompanySettings } from '../../../lib/sgc/db/companySettings';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { createRequest, getRequestDetail, reassignTask, setSigners } from '../../../lib/sgc/db/requests';
import type { SgcNotifier } from '../../../lib/sgc/notifications';

/**
 * EXCEPCIÓN PARA CALIDAD a la segregación de funciones (RN de Nicolás,
 * 2026-10-13, solicitud #1 de OLP) contra un SQL Server REAL (efímero en CI):
 * (1) el solicitante de Calidad elabora; (2) el solicitante de Calidad revisa;
 * (3) el elaborador de Calidad revisa solo con el ajuste de la empresa
 * encendido (apagado por defecto, se guarda en sgc.config_change_log, sin
 * migración). La aprobación no cambia. Para quien no es de Calidad, igual
 * que el 2026-10-05. También prueba el SQL que lo enciende en OLP y su reversa.
 * Empresa propia (id 114).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('[SGC-REQ-146][SGC-REQ-147] SGC · excepción de Calidad con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 114;
  const E = {
    sol: 'sol.exc@onelatampharma.com',
    juan: 'juan.exc@onelatampharma.com',
    mc: 'mariacamila.exc@onelatampharma.com',
    elab: 'elab.exc@onelatampharma.com',
    rev: 'rev.exc@onelatampharma.com',
    jefe: 'jefe.exc@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.14.14.14', userAgent: 'vitest-excepcion-calidad' });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const notifier: SgcNotifier = async () => undefined;
  const sql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const ENCENDER = '2026-10-13-sgc-excepcion-calidad-revisa-lo-que-elabora-olp.sql';
  const REVERSA = '2026-10-13-sgc-excepcion-calidad-revisa-lo-que-elabora-reversa.sql';
  let procGC = 0;
  let typePR = 0;

  const newRequest = async (requester: string, subject: string) =>
    (await createRequest(prisma, notifier, await accessOf(requester), { idCompany: CO, requestType: 'nuevo', subject, description: `Solicitud de la prueba de la excepción de Calidad: ${subject}.`, idProcess: procGC, idDocumentType: typePR, requiresTraining: 'no', formValues: { urgencia: 'Normal' } }, actor(requester))).idRequest;
  const elaborationTask = (idRequest: number) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: 'elaboracion', status: 'abierta' } });
  const requestOf = (idRequest: number) => prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: idRequest } });
  const changeRows = () => prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: SGC_QUALITY_SELF_REVIEW_ACTION } });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA EXCEPCION CALIDAD CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/EXC', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (excepción Calidad CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync('Clave-Exc-ci#2026', 4);
    const grants: [string, string[]][] = [
      [E.sol, ['gestion']],
      [E.juan, ['gestion', 'calidad']],
      [E.mc, ['gestion', 'calidad']],
      [E.elab, ['gestion']],
      [E.rev, ['gestion']],
      [E.jefe, ['gestion']],
    ];
    for (const [email, perms] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql', '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql']) {
      await prisma.$executeRawUnsafe(sql(f));
    }
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: typePR, userEmail: E.elab, reason: 'Elaborador de la prueba de la excepción de Calidad' }, actor(E.mc));
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('el ajuste «Calidad revisa lo que elabora» nace APAGADO', async () => {
    expect(await isQualitySelfReviewEnabled(prisma, CO)).toBe(false);
    expect((await getCompanySettings(prisma, CO)).qualitySelfReview).toBe(false);
  });

  it('(1) el solicitante de Calidad puede quedar como elaborador (reasignación); el que no es de Calidad, no', async () => {
    const r = await newRequest(E.juan, 'Procedimiento pedido por Calidad');
    // No se le obliga: la matriz decide (elab) y luego se reasigna.
    expect((await requestOf(r)).elaborator_email).toBe(E.elab);
    await reassignTask(prisma, notifier, await accessOf(E.elab), (await elaborationTask(r)).id_task, { toEmail: E.juan, reason: 'Calidad elabora su propia solicitud' }, actor(E.elab));
    expect((await requestOf(r)).elaborator_email).toBe(E.juan);

    const s = await newRequest(E.sol, 'Procedimiento pedido por otra área');
    await expect(reassignTask(prisma, notifier, await accessOf(E.elab), (await elaborationTask(s)).id_task, { toEmail: E.sol, reason: 'Que la haga quien pidió' }, actor(E.elab))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/no puede quedar como elaborador/) });
    expect((await requestOf(s)).elaborator_email).toBe(E.elab);
  });

  it('(2) el solicitante de Calidad queda como REVISOR (y la pantalla lo ofrece); como aprobador, no', async () => {
    const r = await newRequest(E.juan, 'Calidad revisa lo que pidió');
    expect(await setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.rev, E.juan], mode: 'paralelo' }, actor(E.elab), await accessOf(E.elab))).toMatchObject({ changed: true });
    await expect(setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.juan], mode: 'orden' }, actor(E.elab), await accessOf(E.elab))).rejects.toThrow(/Quien hizo la solicitud no puede ser firmante de Aprobación/);
    expect((await getRequestDetail(prisma, r, await viewer(E.elab))).segregation.reviewExempt).toEqual([E.juan]);

    const s = await newRequest(E.sol, 'Otra área no revisa lo que pidió');
    await expect(setSigners(prisma, notifier, s, { stepKey: 'revision', signers: [E.sol], mode: 'paralelo' }, actor(E.elab), await accessOf(E.elab))).rejects.toThrow(/Quien hizo la solicitud no puede ser firmante/);
    expect((await getRequestDetail(prisma, s, await viewer(E.elab))).segregation.reviewExempt).toEqual([]);
  });

  it('(3) el elaborador de Calidad: rechazado como revisor con el ajuste apagado; Calidad lo enciende (control de cambios y auditoría) y queda; nunca aprobador', async () => {
    const r = await newRequest(E.sol, 'Calidad revisa lo que elabora');
    await reassignTask(prisma, notifier, await accessOf(E.elab), (await elaborationTask(r)).id_task, { toEmail: E.mc, reason: 'Calidad elabora' }, actor(E.elab));
    await expect(setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.mc], mode: 'paralelo' }, actor(E.mc), await accessOf(E.mc))).rejects.toThrow(/El elaborador no puede ser firmante de Revisión/);

    // Solo Calidad lo cambia (la ruta exige canQuality); con motivo; sin cambios no guarda.
    await expect(saveCompanySettings(prisma, CO, { qualitySelfReview: true, reason: 'corto' }, actor(E.mc))).rejects.toThrow(/motivo/);
    const before = await changeRows();
    const saved = await saveCompanySettings(prisma, CO, { qualitySelfReview: true, reason: 'Prueba: Calidad revisa el documento que elaboró' }, actor(E.mc));
    expect(saved.qualitySelfReview).toBe(true);
    expect(await changeRows()).toBe(before + 1);
    await expect(saveCompanySettings(prisma, CO, { qualitySelfReview: true, reason: 'Prueba: otra vez lo mismo, sin cambio' }, actor(E.mc))).rejects.toThrow(/No hay cambios/);
    const audit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { id_company: CO, action: 'configuracion.empresa' }, orderBy: { id_audit_log: 'desc' } });
    expect(JSON.parse(audit.before_json!)).toMatchObject({ qualitySelfReview: false });
    expect(JSON.parse(audit.after_json!)).toMatchObject({ qualitySelfReview: true });

    expect(await setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.mc], mode: 'paralelo' }, actor(E.mc), await accessOf(E.mc))).toMatchObject({ changed: true });
    await expect(setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.mc], mode: 'orden' }, actor(E.mc), await accessOf(E.mc))).rejects.toThrow(/El elaborador no puede ser firmante de Aprobación/);
    expect((await getRequestDetail(prisma, r, await viewer(E.mc))).segregation).toEqual({ reviewExempt: [E.mc], qualitySelfReview: true });

    // Quien no es de Calidad sigue sin revisar lo que elabora, aunque el ajuste esté encendido.
    const s = await newRequest(E.juan, 'Elaborador de otra área');
    await expect(setSigners(prisma, notifier, s, { stepKey: 'revision', signers: [E.elab], mode: 'paralelo' }, actor(E.mc), await accessOf(E.mc))).rejects.toThrow(/El elaborador no puede ser firmante/);
  });

  it('el SQL de OLP y su reversa: idempotentes, insertan en el control de cambios y la auditoría, y no borran nada', async () => {
    await prisma.$executeRawUnsafe(sql(REVERSA));
    expect(await isQualitySelfReviewEnabled(prisma, CO)).toBe(false);
    const rows = await changeRows();
    await prisma.$executeRawUnsafe(sql(REVERSA));
    expect(await changeRows()).toBe(rows);

    await prisma.$executeRawUnsafe(sql(ENCENDER));
    await prisma.$executeRawUnsafe(sql(ENCENDER));
    expect(await changeRows()).toBe(rows + 1);
    expect(await isQualitySelfReviewEnabled(prisma, CO)).toBe(true);
    const last = await prisma.sgcConfigChangeLog.findFirstOrThrow({ where: { id_company: CO, action: SGC_QUALITY_SELF_REVIEW_ACTION }, orderBy: { id_config_change: 'desc' } });
    expect(last).toMatchObject({ actor_email: 'nicolas.rivera@gsslatam.com', entity: 'company_config', entity_id: String(CO) });
    expect(last.reason).toMatch(/autorizado por nicolas\.rivera@gsslatam\.com/i);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'configuracion.empresa', actor_email: 'nicolas.rivera@gsslatam.com' } })).toBe(2);
    await expect(prisma.$executeRawUnsafe(sql(ENCENDER).replace(`DECLARE @IdCompany INT = ${CO};`, 'DECLARE @IdCompany INT = 999999;'))).rejects.toThrow(/no tiene el SGC/);
  });
});

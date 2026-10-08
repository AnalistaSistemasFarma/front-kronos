import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { getCompanySettings, isViewerProtected, saveCompanySettings } from '../../../lib/sgc/db/companySettings';
import { createInitialDocument, getAccessSubject, type SgcUploader } from '../../../lib/sgc/db/documents';
import { getMyPendings } from '../../../lib/sgc/db/pendings';
import { cancelUncontrolledCopy, consumeUncontrolledCopy, countCopiesToDecide, decideUncontrolledCopy, getCopyConfig, isCopyDecider, listCopiesForQuality, listMyCopies, requestUncontrolledCopy } from '../../../lib/sgc/db/uncontrolledCopies';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';

/**
 * Sprint 11 contra un SQL Server REAL (efímero en CI): COPIAS NO CONTROLADAS
 * (solo formatos por defecto, decide solo el grupo exclusivo SGC-COPIA-NC con
 * motivo, nadie decide la suya, impresión con vencimiento, descarga solo para
 * un tercero, eventos de solo inserción) y la configuración de la protección
 * del visor. Empresa propia (id 111).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 11 con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 111;
  const E = {
    ana: 'ana.s11@onelatampharma.com',
    jefe: 'jefe.s11@onelatampharma.com',
    mc: 'mariacamila.s11@onelatampharma.com',
    cal: 'calidad.s11@onelatampharma.com',
    otro: 'otro.s11@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.11.11.11', userAgent: 'vitest-s11' });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const subjectOf = (email: string) => getAccessSubject(prisma, email);
  const seed = (file: string, extra: [string, string][] = []) => {
    let sql = fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
    for (const [a, b] of extra) sql = sql.replace(a, b);
    return sql;
  };
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  let k = 0;
  const upload: SgcUploader = async () => ({ id: `s11-${++k}` });
  const pdf = async () => {
    const d = await PDFDocument.create();
    d.addPage();
    return d.save();
  };
  let fo = 0;
  let pr = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S11 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S11', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S11 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const grants: [string, string[]][] = [
      [E.ana, ['lectura']],
      [E.jefe, ['gestion']],
      [E.mc, ['calidad']],
      [E.cal, ['calidad']],
      [E.otro, ['lectura']],
    ];
    for (const [email, perms] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: 'x' } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql']) await prisma.$executeRawUnsafe(seed(f));
    const extra: [string, string][] = [["DECLARE @Integrante NVARCHAR(255) = NULL;", `DECLARE @Integrante NVARCHAR(255) = N'${E.mc}';`]];
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s11-copias-no-controladas-olp.sql', extra));
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s11-copias-no-controladas-olp.sql', extra));
    const cat = await getCatalogs(prisma, CO);
    const gc = cat.processes.find((p) => p.code === 'GC')!.id;
    fo = (await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: gc, idDocumentType: cat.documentTypes.find((t) => t.code === 'FO')!.id, title: 'Formato de devoluciones', code: 'OLP-GC-02-FO01', confidentiality: 'publica', versionNumber: 2, effectiveDate: '2025-01-10', pdf: { bytes: await pdf(), fileName: 'f.pdf' } }, actor(E.cal))).idDocument;
    pr = (await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: gc, idDocumentType: cat.documentTypes.find((t) => t.code === 'PR')!.id, title: 'Procedimiento de devoluciones', code: 'OLP-GC-02', confidentiality: 'publica', versionNumber: 1, effectiveDate: '2025-01-10', pdf: { bytes: await pdf(), fileName: 'p.pdf' } }, actor(E.cal))).idDocument;
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-127] la migración y el SQL del S11: tablas, configuración por defecto y grupo exclusivo con su integrante (idempotente)', async () => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgc' AND t.name IN ('uncontrolled_copy_request','uncontrolled_copy_event')`;
    expect(tables).toHaveLength(2);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261008130000_sgc_s11_copias_no_controladas/migration.sql'), 'utf8'));
    expect(await getCopyConfig(prisma, CO)).toEqual({ types: ['FO', 'FR'], days: 30, maxDays: 90 });
    expect(await prisma.sgcAuthorizationTypeUser.count({ where: { user_email: E.mc, type: { id_company: CO, code: 'SGC-COPIA-NC' } } })).toBe(1);
    expect(await isCopyDecider(prisma, CO, E.mc)).toBe(true);
    expect(await isCopyDecider(prisma, CO, E.cal)).toBe(false);
    expect(await isViewerProtected(prisma, CO)).toBe(true);
    expect(await isViewerProtected(prisma, null)).toBe(true);
    expect(await isViewerProtected(prisma, 999_999)).toBe(true);
  });

  it('[SGC-REQ-127] cualquiera con acceso pide la copia de un FORMATO vigente, con justificación; los procedimientos no admiten copia', async () => {
    const ana = await accessOf(E.ana);
    await expect(requestUncontrolledCopy(prisma, notifier, ana, await subjectOf(E.ana), { idDocument: pr, justification: 'Lo necesito impreso para la bodega', destination: 'interno' }, actor(E.ana))).rejects.toThrow(/no admiten copia no controlada/);
    await expect(requestUncontrolledCopy(prisma, notifier, ana, await subjectOf(E.ana), { idDocument: 999_999, justification: 'Lo necesito impreso para la bodega', destination: 'interno' }, actor(E.ana))).rejects.toMatchObject({ status: 404 });
    await expect(requestUncontrolledCopy(prisma, notifier, ana, await subjectOf(E.ana), { idDocument: fo, justification: 'corto', destination: 'interno' }, actor(E.ana))).rejects.toThrow(/mínimo 10/);
    sent.length = 0;
    const r1 = await requestUncontrolledCopy(prisma, notifier, ana, await subjectOf(E.ana), { idDocument: fo, justification: 'Lo voy a diligenciar a mano en la bodega', destination: 'interno', days: 10 }, actor(E.ana));
    expect(r1.notified).toBe(1);
    // Llega solo al grupo exclusivo (no al jefe del área).
    expect(sent.flatMap((n) => n.emails)).toEqual([E.mc]);
    await expect(requestUncontrolledCopy(prisma, notifier, ana, await subjectOf(E.ana), { idDocument: fo, justification: 'Otra copia del mismo formato', destination: 'interno' }, actor(E.ana))).rejects.toMatchObject({ status: 409 });
    expect(await countCopiesToDecide(prisma, CO, E.mc)).toBe(1);
    expect((await getMyPendings(prisma, E.mc, await accessOf(E.mc))).counts.copias).toBe(1);
    expect(await countCopiesToDecide(prisma, CO, E.jefe)).toBe(0);
  });

  it('[SGC-REQ-128] decide SOLO el grupo exclusivo, con motivo; el jefe del área ni ve ni decide; nadie decide su propia solicitud', async () => {
    const [mine] = await listMyCopies(prisma, CO, E.ana);
    expect(mine).toMatchObject({ code: 'OLP-GC-02-FO01', versionNumber: 2, status: 'pendiente', canPrint: false });
    await expect(listCopiesForQuality(prisma, await accessOf(E.jefe), E.jefe)).rejects.toMatchObject({ status: 403 });
    expect((await listCopiesForQuality(prisma, await accessOf(E.cal), E.cal)).canDecide).toBe(false);
    const q = await listCopiesForQuality(prisma, await accessOf(E.mc), E.mc, { status: 'pendiente' });
    expect(q.canDecide).toBe(true);
    expect(q.copies.map((c) => c.id)).toEqual([mine.id]);
    await expect(decideUncontrolledCopy(prisma, notifier, await accessOf(E.jefe), mine.id, { decision: 'autorizar', reason: 'Autorizo como jefe del área' }, actor(E.jefe))).rejects.toMatchObject({ status: 403 });
    await expect(decideUncontrolledCopy(prisma, notifier, await accessOf(E.cal), mine.id, { decision: 'autorizar', reason: 'Autorizo como Calidad' }, actor(E.cal))).rejects.toMatchObject({ status: 403 });
    const mc = await accessOf(E.mc);
    await expect(decideUncontrolledCopy(prisma, notifier, mc, mine.id, { decision: 'tal vez', reason: 'Motivo suficiente' }, actor(E.mc))).rejects.toThrow(/autorizar o rechazar/);
    await expect(decideUncontrolledCopy(prisma, notifier, mc, mine.id, { decision: 'autorizar', reason: 'corto' }, actor(E.mc))).rejects.toThrow(/mínimo 10/);
    await expect(decideUncontrolledCopy(prisma, notifier, mc, 999_999, { decision: 'autorizar', reason: 'Motivo suficiente' }, actor(E.mc))).rejects.toMatchObject({ status: 404 });
    await expect(decideUncontrolledCopy(prisma, notifier, mc, mine.id, { decision: 'autorizar', reason: 'Motivo suficiente', days: 200 }, actor(E.mc))).rejects.toThrow(/entre 1 y 90/);
    // María Camila no decide su propia solicitud.
    const own = await requestUncontrolledCopy(prisma, notifier, mc, await subjectOf(E.mc), { idDocument: fo, justification: 'Copia para la auditoría interna', destination: 'interno' }, actor(E.mc));
    await expect(decideUncontrolledCopy(prisma, notifier, mc, own.idCopyRequest, { decision: 'autorizar', reason: 'Me la autorizo yo misma' }, actor(E.mc))).rejects.toThrow(/su propia solicitud/);
    expect(await countCopiesToDecide(prisma, CO, E.mc)).toBe(1);
    sent.length = 0;
    // Se decide «en el pasado» (fecha inyectada) para probar después el vencimiento.
    const at = new Date('2026-09-01T15:00:00Z');
    expect(await decideUncontrolledCopy(prisma, notifier, mc, mine.id, { decision: 'autorizar', reason: 'Formato para diligenciar a mano en bodega' }, actor(E.mc), at)).toEqual({ status: 'autorizada', expiresAt: '2026-09-12T04:59:59.000Z' });
    expect(sent[0].emails).toEqual([E.ana]);
    await expect(decideUncontrolledCopy(prisma, notifier, mc, mine.id, { decision: 'rechazar', reason: 'Decisión repetida' }, actor(E.mc))).rejects.toMatchObject({ status: 409 });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: { in: ['copia_no_controlada.solicitada', 'copia_no_controlada.decidida'] } } })).toBe(3);
  });

  it('[SGC-REQ-129] autorizada se imprime (con evento de solo inserción) hasta su vencimiento; la descarga solo para un tercero; si cambia la versión, se pide otra', async () => {
    const [copy] = await listMyCopies(prisma, CO, E.ana);
    const during = new Date('2026-09-05T15:00:00Z');
    await expect(consumeUncontrolledCopy(prisma, copy.id, 'impresion', actor(E.otro), during)).rejects.toMatchObject({ status: 404 });
    await expect(consumeUncontrolledCopy(prisma, copy.id, 'descarga', actor(E.ana), during)).rejects.toThrow(/solo se imprime/);
    const printed = await consumeUncontrolledCopy(prisma, copy.id, 'impresion', actor(E.ana), during);
    expect(printed).toMatchObject({ code: 'OLP-GC-02-FO01', versionNumber: 2, requesterEmail: E.ana, authorizedBy: E.mc, destination: null });
    expect(await prisma.sgcUncontrolledCopyEvent.count({ where: { id_copy_request: copy.id, event: 'impresion' } })).toBe(1);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[uncontrolled_copy_event] SET event = N'descarga' WHERE id_copy_request = ${copy.id}`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[uncontrolled_copy_request] WHERE id_copy_request = ${copy.id}`)).rejects.toThrow(/no se borra/);
    await expect(consumeUncontrolledCopy(prisma, copy.id, 'impresion', actor(E.ana), new Date('2026-09-20T15:00:00Z'))).rejects.toThrow(/venció/);
    const view = (await listMyCopies(prisma, CO, E.ana, new Date('2026-09-20T15:00:00Z')))[0];
    expect(view).toMatchObject({ status: 'vencida', canPrint: false, events: [expect.objectContaining({ event: 'impresion', by: E.ana })] });
    // Para un tercero: se puede bajar el PDF marcado.
    const ana = await accessOf(E.ana);
    const t = await requestUncontrolledCopy(prisma, notifier, ana, await subjectOf(E.ana), { idDocument: fo, justification: 'Se envía al cliente para recoger devoluciones', destination: 'tercero', destinationDetail: 'Droguería Central' }, actor(E.ana));
    await decideUncontrolledCopy(prisma, notifier, await accessOf(E.mc), t.idCopyRequest, { decision: 'autorizar', reason: 'Formato para el cliente de devoluciones', days: 5 }, actor(E.mc));
    expect(await consumeUncontrolledCopy(prisma, t.idCopyRequest, 'descarga', actor(E.ana))).toMatchObject({ destination: 'Droguería Central' });
    // Un documento que cambia de versión deja sin efecto la copia de la versión anterior.
    await prisma.sgcDocument.update({ where: { id_document: fo }, data: { status: 'obsoleto' } });
    await expect(consumeUncontrolledCopy(prisma, t.idCopyRequest, 'impresion', actor(E.ana))).rejects.toMatchObject({ status: 409 });
    await expect(requestUncontrolledCopy(prisma, notifier, ana, await subjectOf(E.ana), { idDocument: fo, justification: 'Copia de un formato obsoleto', destination: 'interno' }, actor(E.ana))).rejects.toThrow(/VIGENTE/);
    await prisma.sgcDocument.update({ where: { id_document: fo }, data: { status: 'vigente' } });
    // Rechazada: no se imprime.
    const otroCopy = await requestUncontrolledCopy(prisma, notifier, await accessOf(E.otro), await subjectOf(E.otro), { idDocument: fo, justification: 'Copia para la reunión con el proveedor', destination: 'interno' }, actor(E.otro));
    await decideUncontrolledCopy(prisma, notifier, await accessOf(E.mc), otroCopy.idCopyRequest, { decision: 'rechazar', reason: 'Debe usar la versión en pantalla' }, actor(E.mc));
    await expect(consumeUncontrolledCopy(prisma, otroCopy.idCopyRequest, 'impresion', actor(E.otro))).rejects.toThrow(/no está autorizada/);
  });

  it('[SGC-REQ-127] el solicitante cancela su solicitud pendiente; Calidad ajusta tipos, días y la protección del visor con motivo', async () => {
    const r = await requestUncontrolledCopy(prisma, notifier, await accessOf(E.otro), await subjectOf(E.otro), { idDocument: fo, justification: 'Copia que al final no se necesita', destination: 'interno' }, actor(E.otro));
    await expect(cancelUncontrolledCopy(prisma, await accessOf(E.ana), r.idCopyRequest, actor(E.ana))).rejects.toMatchObject({ status: 404 });
    expect(await cancelUncontrolledCopy(prisma, await accessOf(E.otro), r.idCopyRequest, actor(E.otro))).toEqual({ status: 'cancelada' });
    await expect(cancelUncontrolledCopy(prisma, await accessOf(E.otro), r.idCopyRequest, actor(E.otro))).rejects.toMatchObject({ status: 409 });
    await expect(saveCompanySettings(prisma, CO, { uncontrolledCopyTypes: 'FO-1', reason: 'Tipos de la prueba del S11' }, actor(E.cal))).rejects.toThrow(/códigos/);
    await expect(saveCompanySettings(prisma, CO, { uncontrolledCopyDays: 120, reason: 'Días de la prueba del S11' }, actor(E.cal))).rejects.toThrow(/entre 1 y el máximo/);
    await expect(saveCompanySettings(prisma, CO, { uncontrolledCopyMaxDays: 400, reason: 'Máximo de la prueba del S11' }, actor(E.cal))).rejects.toThrow(/entre 1 y 365/);
    await saveCompanySettings(prisma, CO, { uncontrolledCopyTypes: 'fo, fr, an', uncontrolledCopyDays: 15, uncontrolledCopyMaxDays: 60, viewerProtection: false, reason: 'Ajuste de copias y visor de la prueba del S11' }, actor(E.cal));
    const s = await getCompanySettings(prisma, CO);
    expect(s).toMatchObject({ uncontrolledCopies: { types: ['FO', 'FR', 'AN'], days: 15, maxDays: 60 }, viewerProtection: false });
    expect(await isViewerProtected(prisma, CO)).toBe(false);
    await saveCompanySettings(prisma, CO, { viewerProtection: true, reason: 'Se vuelve a proteger el visor' }, actor(E.cal));
    expect(await isViewerProtected(prisma, CO)).toBe(true);
  });
});

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
import type { SgcUploader } from '../../../lib/sgc/db/documents';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { createRequest, setSigners, uploadAttachment } from '../../../lib/sgc/db/requests';
import {
  getMySignature,
  isSelfSignatureEnabled,
  listSignatureMasters,
  registerOwnSignature,
  registerSignatureMaster,
  revokeSignatureMaster,
  signTask,
  validateSignatureMaster,
  verifyCompanySignatureChain,
  type SgcSignatureDeps,
} from '../../../lib/sgc/db/signatures';
import type { SgcNotifier } from '../../../lib/sgc/notifications';
import { readManifest } from '../../../lib/sgc/pdf/controlledPdf';
import { synerlinkPasswordVerifier } from '../../../lib/sgc/signature/reauth';

/**
 * Sprint 13 contra un SQL Server REAL (efímero en CI): FIRMA PROPIA detrás
 * de la bandera (apagada por defecto; se enciende solo con la referencia del
 * aval de Adriana Cárdenas), registro por la persona de la sesión, pendiente
 * de validación (no firma), validación de Calidad una vez y nunca la propia,
 * rechazo; y el REGISTRO DE FIRMAS cuando hay 3 o más aprobadores.
 * Empresa propia (id 113).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 13 con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 113;
  const PW = 'Clave-S13-ci#2026';
  const E = {
    sol: 'sol.s13@onelatampharma.com',
    elab: 'elab.s13@onelatampharma.com',
    rev: 'rev.s13@onelatampharma.com',
    a1: 'apr1.s13@onelatampharma.com',
    a2: 'apr2.s13@onelatampharma.com',
    a3: 'apr3.s13@onelatampharma.com',
    cal: 'calidad.s13@onelatampharma.com',
    cal2: 'calidad2.s13@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.13.13.13', userAgent: 'vitest-s13' });
  const viewer = async (email: string) => ({ email, access: await getSgcAccessForUser(prisma, email) });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string, extra: [string, string][] = []) => {
    let sql = fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
    for (const [a, b] of extra) sql = sql.replace(a, b);
    return sql;
  };
  const notifier: SgcNotifier = async () => undefined;
  const store = new Map<string, Uint8Array>();
  let n = 0;
  const upload: SgcUploader = async (_s, _f, content) => {
    const id = `s13-${++n}`;
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
    docxToHtml: async () => '<h1>Procedimiento S13</h1><p>Contenido.</p>',
    notifier,
    appUrl: 'https://synerlink.test/',
  };
  const docx = (text: string) => ({ fileName: 'Procedimiento.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(text)]) });
  const taskOf = async (idRequest: number, key: string) => prisma.sgcTask.findFirstOrThrow({ where: { id_request: idRequest, task_key: key }, orderBy: { id_task: 'desc' }, include: { assignees: true } });
  const firma = (meaning: string, extra: Record<string, unknown> = {}) => ({ meaning, reason: `Firma ${meaning} de la prueba del S13`, consentAccepted: true, password: PW, ...extra });
  const checklistOk = { chk_codificacion: { answer: 'cumple' }, chk_formato: { answer: 'cumple' }, chk_anexos: { answer: 'no_aplica' } };
  let ink = '';
  let blank = '';
  let procGC = 0;
  let typePR = 0;

  beforeAll(async () => {
    const UPNG = ((await import('@pdf-lib/upng')) as unknown as { default: { encode: (b: ArrayBuffer[], w: number, h: number, c: number) => ArrayBuffer } }).default;
    const w = 120;
    const h = 40;
    const white = new Uint8Array(w * h * 4).fill(255);
    const px = white.slice();
    for (let x = 20; x < 100; x++) for (let y = 15; y < 22; y++) px.set([15, 25, 90, 255], (y * w + x) * 4);
    ink = `data:image/png;base64,${Buffer.from(UPNG.encode([px.buffer], w, h, 0)).toString('base64')}`;
    blank = `data:image/png;base64,${Buffer.from(UPNG.encode([white.buffer], w, h, 0)).toString('base64')}`;

    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S13 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S13', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S13 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync(PW, 4);
    const grants: [string, string[]][] = [
      [E.sol, ['gestion']],
      [E.elab, ['gestion', 'calidad']],
      [E.rev, ['gestion']],
      [E.a1, ['gestion']],
      [E.a2, ['gestion']],
      [E.a3, ['gestion']],
      [E.cal, ['calidad']],
      [E.cal2, ['calidad']],
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
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: typePR, userEmail: E.elab, reason: 'Elaborador de la prueba del S13' }, actor(E.cal));
    const calType = (await listAuthorizationTypes(prisma, CO)).find((t) => t.code === 'SGC-VERIF-CALIDAD')!;
    await grantAuthorizationTypeUser(prisma, CO, calType.id, { email: E.cal, reason: 'Calidad de la prueba del S13' }, actor('ci@x.co'));
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011][SGC-REQ-144] la migración agrega columnas y trigger; la firma propia nace APAGADA y solo se enciende con la referencia del aval de Adriana Cárdenas', async () => {
    const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE (object_id = OBJECT_ID('sgc.signature_master') AND name IN ('origin','capture_method','validation_status','validated_by','validated_at')) OR (object_id = OBJECT_ID('sgc.company_config') AND name = 'self_signature_enabled')`;
    expect(cols).toHaveLength(6);
    expect(await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sys.triggers WHERE name = 'signature_master_validacion_una_vez'`).toHaveLength(1);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261008150000_sgc_s13_firma_propia_registro/migration.sql'), 'utf8'));
    expect(await isSelfSignatureEnabled(prisma, CO)).toBe(false);
    // Apagada: Calidad registra en la inducción (como antes) y queda validada.
    await registerSignatureMaster(prisma, CO, { email: E.a3, imagePng: ink, reason: 'Inducción del S13' }, actor(E.cal));
    expect((await listSignatureMasters(prisma, CO)).find((m) => m.email === E.a3)).toMatchObject({ origin: 'calidad', status: 'validada' });
    await expect(registerOwnSignature(prisma, CO, { imagePng: ink, method: 'dibujada' }, actor(E.a1))).rejects.toThrow(/Adriana Cárdenas/);
    // Sin la referencia del aval, el script no enciende nada.
    await expect(prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s13-firma-propia-encender-olp.sql'))).rejects.toThrow(/aval de la Dra. Adriana Cárdenas/);
    expect(await isSelfSignatureEnabled(prisma, CO)).toBe(false);
    const aval: [string, string][] = [["DECLARE @AvalAdriana NVARCHAR(1000) = NULL;", "DECLARE @AvalAdriana NVARCHAR(1000) = N'Prueba de CI: aval simulado de la Dra. Adriana Cárdenas';"]];
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s13-firma-propia-encender-olp.sql', aval));
    await prisma.$executeRawUnsafe(seed('2026-10-08-sgc-s13-firma-propia-encender-olp.sql', aval));
    expect(await isSelfSignatureEnabled(prisma, CO)).toBe(true);
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: 'empresa.firma_propia' } })).toBe(1);
  });

  it('[SGC-REQ-140][SGC-REQ-141] cada persona registra SU firma (pendiente); Calidad ya no registra las de otros, valida una vez y nunca la suya, o la rechaza', async () => {
    await expect(registerOwnSignature(prisma, CO, { imagePng: ink, method: 'dibujada', email: E.a2 }, actor(E.a1))).rejects.toMatchObject({ status: 403 });
    await expect(registerOwnSignature(prisma, CO, { imagePng: blank, method: 'imagen' }, actor(E.a1))).rejects.toThrow(/no tiene trazo/);
    await expect(registerOwnSignature(prisma, CO, { imagePng: 'data:image/png;base64,AAAA', method: 'imagen' }, actor(E.a1))).rejects.toThrow(/PNG/);
    await expect(registerOwnSignature(prisma, CO, { imagePng: ink, method: 'dibujada' }, actor('nadie.s13@onelatampharma.com'))).rejects.toMatchObject({ status: 403 });
    const r1 = await registerOwnSignature(prisma, CO, { imagePng: ink, method: 'dibujada' }, actor(E.a1));
    expect(r1.status).toBe('pendiente');
    expect(await getMySignature(prisma, CO, E.a1)).toMatchObject({ enabled: true, active: null, pending: { id: r1.id, status: 'pendiente', captureMethod: 'dibujada' } });
    await expect(registerSignatureMaster(prisma, CO, { email: E.a2, imagePng: ink, reason: 'Inducción' }, actor(E.cal))).rejects.toThrow(/cada persona registra la suya/);

    // Una nueva pendiente reemplaza a la anterior (queda «rechazada» con motivo).
    const r2 = await registerOwnSignature(prisma, CO, { imagePng: ink, method: 'imagen' }, actor(E.a2));
    const r2b = await registerOwnSignature(prisma, CO, { imagePng: ink, method: 'imagen' }, actor(E.a2));
    const listed = await listSignatureMasters(prisma, CO);
    expect(listed.find((m) => m.id === r2.id)).toMatchObject({ status: 'rechazada', origin: 'propia' });
    expect(listed.find((m) => m.id === r2b.id)).toMatchObject({ status: 'pendiente', captureMethod: 'imagen' });

    // Calidad registra la SUYA y otra persona de Calidad la valida (nadie valida la propia).
    const rc = await registerOwnSignature(prisma, CO, { imagePng: ink, method: 'dibujada' }, actor(E.cal));
    await expect(validateSignatureMaster(prisma, CO, rc.id, { reason: 'Me valido a mí misma' }, actor(E.cal))).rejects.toMatchObject({ status: 403 });
    await expect(validateSignatureMaster(prisma, CO, rc.id, { reason: 'no' }, actor(E.cal2))).rejects.toThrow(/mínimo 5/);
    await expect(validateSignatureMaster(prisma, CO, 999_999, { reason: 'No existe esta' }, actor(E.cal2))).rejects.toMatchObject({ status: 404 });
    expect(await validateSignatureMaster(prisma, CO, rc.id, { reason: 'Comparada con la cédula en la inducción' }, actor(E.cal2))).toEqual({ ok: true, status: 'validada' });
    await expect(validateSignatureMaster(prisma, CO, rc.id, { reason: 'Otra vez la misma' }, actor(E.cal2))).rejects.toMatchObject({ status: 409 });
    // El trigger impide volver a validar o cambiar el origen por SQL.
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[signature_master] SET validated_by = N'otra@x.co' WHERE id_signature_master = ${rc.id}`)).rejects.toThrow(/solo una firma PENDIENTE se valida/);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[signature_master] SET origin = N'calidad' WHERE id_signature_master = ${r2b.id}`)).rejects.toThrow(/el origen y el método no cambian/);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: { in: ['firma.propia_registrada', 'firma.propia_validada'] } } })).toBe(5);

    // Rechazo de una pendiente: se revoca con motivo.
    await revokeSignatureMaster(prisma, CO, r2b.id, { reason: 'El trazo no coincide con la cédula' }, actor(E.cal));
    expect((await getMySignature(prisma, CO, E.a2)).pending).toBeNull();
    await expect(validateSignatureMaster(prisma, CO, r2b.id, { reason: 'Validar una rechazada' }, actor(E.cal2))).rejects.toMatchObject({ status: 409 });
    // a2 registra otra y Calidad la valida.
    const r2c = await registerOwnSignature(prisma, CO, { imagePng: ink, method: 'dibujada' }, actor(E.a2));
    await validateSignatureMaster(prisma, CO, r2c.id, { reason: 'Comparada con la cédula' }, actor(E.cal));
    expect((await getMySignature(prisma, CO, E.a2)).active).toMatchObject({ id: r2c.id, validatedBy: E.cal });
  });

  it('[SGC-REQ-141][SGC-REQ-142][SGC-REQ-143] una firma pendiente no se estampa; con 3 aprobadores (y Calidad) el PDF lleva el registro de firmas', async () => {
    const { idRequest: r } = await createRequest(prisma, notifier, await accessOf(E.sol), { idCompany: CO, requestType: 'nuevo', subject: 'Procedimiento con muchos aprobadores', description: 'Solicitud de la prueba del S13.', idProcess: procGC, idDocumentType: typePR, requiresTraining: 'no', formValues: { urgencia: 'Normal' } }, actor(E.sol));
    await setSigners(prisma, notifier, r, { stepKey: 'revision', signers: [E.rev], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await setSigners(prisma, notifier, r, { stepKey: 'aprobacion', signers: [E.a1, E.a2, E.a3], mode: 'orden' }, actor(E.elab), await accessOf(E.elab));
    await uploadAttachment(prisma, upload, r, { purpose: 'borrador', ...docx('borrador s13') }, await viewer(E.elab), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(r, 'elaboracion')).id_task, firma('elaboro'), actor(E.elab));
    await signTask(prisma, deps, (await taskOf(r, 'revision')).id_task, firma('reviso'), actor(E.rev));
    const apr = await taskOf(r, 'aprobacion');
    for (const who of [E.a1, E.a2, E.a3]) await signTask(prisma, deps, apr.id_task, firma('aprobo'), actor(who));
    const res = await signTask(prisma, deps, apr.id_task, firma('aprobo', { checklist: checklistOk }), actor(E.cal));
    expect(res).toMatchObject({ next: 'divulgacion' });
    const sigs = await prisma.sgcSignature.findMany({ where: { id_request: r, meaning: 'aprobo' }, orderBy: { id_signature: 'asc' } });
    // a1 solo tiene una firma PENDIENTE: firma sin trazo. a2 (propia validada) y a3 (de Calidad) sí lo llevan.
    expect(sigs.find((s) => s.signer_email === E.a1)?.master_sha256).toBeNull();
    expect(sigs.find((s) => s.signer_email === E.a2)?.master_sha256).toBeTruthy();
    expect(sigs.find((s) => s.signer_email === E.a3)?.master_sha256).toBeTruthy();
    expect(await verifyCompanySignatureChain(prisma, CO)).toMatchObject({ ok: true });
    const req = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: r } });
    const version = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: req.id_document_version! } });
    const manifest = (await readManifest(store.get(version.pdf_item_id)!))!;
    expect(manifest.signatureRegister).toEqual(sigs.map((s) => s.signature_uid.trim()));
    const pages = (await PDFDocument.load(store.get(version.pdf_item_id)!)).getPageCount();
    expect(pages).toBeGreaterThanOrEqual(4);
  });
});

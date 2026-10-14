import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { getCatalogs, saveCatalogEntry } from '../../../lib/sgc/db/catalogs';
import { createInitialDocument, getAccessSubject, type SgcUploader } from '../../../lib/sgc/db/documents';
import {
  annulGenerated,
  decideTemplateVersion,
  generateFromTemplate,
  getGeneratedForViewer,
  getTemplateForGeneration,
  getTemplateSource,
  isGeneratorEnabled,
  listAvailableTemplates,
  listGeneratedForQuality,
  listMyGenerated,
  listTemplateSources,
  listTemplatesForManagement,
  proposeTemplateVersion,
  qualityEmails,
  retireTemplate,
} from '../../../lib/sgc/db/generator';
import type { SgcNotification, SgcNotifier } from '../../../lib/sgc/notifications';
import { sha256Hex } from '../../../lib/sgc/storage';

/**
 * GENERADOR DE DOCUMENTOS desde plantillas aprobadas por Calidad contra un
 * SQL Server REAL (efímero en CI): migración y SQL de datos (idempotentes),
 * plantilla desde un vigente en Word (nunca solo PDF), propuesta por gestión,
 * aprobación SOLO de Calidad y nunca la propia (también en la base), versiones
 * inmutables y «desactualizada» al cambiar el origen, solo campos permitidos,
 * registro numerado bajo bloqueo e inmutable, visor solo para quien lo generó
 * y Calidad, anulación y retiro. Empresa propia (id 119; la 114 es de la integración de la excepción de Calidad).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Generador de documentos con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 119;
  const E = {
    ana: 'ana.gen@onelatampharma.com',
    gest: 'gestion.gen@onelatampharma.com',
    mc: 'mariacamila.gen@onelatampharma.com',
    cal: 'calidad.gen@onelatampharma.com',
    otro: 'otro.gen@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.12.12.12', userAgent: 'vitest-generador' });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const subjectOf = (email: string) => getAccessSubject(prisma, email);
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const sent: SgcNotification[] = [];
  const notifier: SgcNotifier = async (n) => {
    sent.push(...n);
  };
  // OneDrive simulado: guarda lo que se sube para poder descargarlo.
  const store = new Map<string, Uint8Array>();
  const uploads: { segments: string[]; fileName: string }[] = [];
  let k = 0;
  const upload: SgcUploader = async (segments, fileName, content) => {
    const id = `gen-${++k}`;
    store.set(id, content);
    uploads.push({ segments, fileName });
    return { id };
  };
  const download = async (id: string) => store.get(id) ?? new Uint8Array();
  // «Word» de prueba: firma ZIP + el HTML que devuelve el convertidor simulado.
  const word = (html: string) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(html)]);
  const docxToHtml = async (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(4));
  const printed: string[] = [];
  const htmlToPdf = async (html: string) => {
    printed.push(html);
    const d = await PDFDocument.create();
    d.addPage();
    return d.save();
  };
  const pdf = async () => {
    const d = await PDFDocument.create();
    d.addPage();
    return d.save();
  };
  const deps = { download, docxToHtml, htmlToPdf, upload };
  const CARTA = '<p>Carta {{CODIGO}} V{{VERSION}}</p><p>Señor(a) {{CAMPO:Destinatario}}</p><p>Fecha: {{CAMPO:Fecha|fecha}}</p><p>{{CAMPO:Cuerpo|parrafo}}</p><p>Texto fijo aprobado por Calidad.</p><p>{{HISTORIAL_CAMBIOS}}</p>';
  let carta = 0;
  let soloPdf = 0;
  let confidencial = 0;
  let politica = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA GENERADOR CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/GEN', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (Generador CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const grants: [string, string[]][] = [
      [E.ana, ['lectura']],
      [E.gest, ['gestion']],
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
    const cat = await getCatalogs(prisma, CO);
    const gc = cat.processes.find((p) => p.code === 'GC')!.id;
    const fo = cat.documentTypes.find((t) => t.code === 'FO')!.id;
    const base = { idCompany: CO, idProcess: gc, idDocumentType: fo, confidentiality: 'publica', versionNumber: 1, effectiveDate: '2026-01-15' };
    carta = (await createInitialDocument(prisma, upload, { ...base, title: 'Carta de certificación', code: 'GEN-GC-FO01', pdf: { bytes: await pdf(), fileName: 'c.pdf' }, source: { bytes: word(CARTA), fileName: 'c.docx', contentType: 'application/octet-stream' } }, actor(E.cal))).idDocument;
    soloPdf = (await createInitialDocument(prisma, upload, { ...base, title: 'Formato solo en PDF', code: 'GEN-GC-FO02', pdf: { bytes: await pdf(), fileName: 'p.pdf' } }, actor(E.cal))).idDocument;
    confidencial = (await createInitialDocument(prisma, upload, { ...base, title: 'Formato confidencial', code: 'GEN-GC-FO03', confidentiality: 'confidencial', pdf: { bytes: await pdf(), fileName: 'k.pdf' }, source: { bytes: word('<p>{{CAMPO:Dato}}</p>'), fileName: 'k.docx', contentType: 'application/octet-stream' } }, actor(E.cal))).idDocument;
    politica = (await createInitialDocument(prisma, upload, { ...base, title: 'Política de ejemplo', code: 'GEN-GC-FO04', pdf: { bytes: await pdf(), fileName: 'q.pdf' }, source: { bytes: word('<p>Política para {{CAMPO:Área}}</p>'), fileName: 'q.docx', contentType: 'application/octet-stream' } }, actor(E.cal))).idDocument;
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-177] la migración y el SQL de PRUEBAS: tablas, apagado por defecto, encendido idempotente con registro del cambio', async () => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgc' AND t.name IN ('generator_template','generator_template_version','generated_document')`;
    expect(tables).toHaveLength(3);
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261010100000_sgc_generador_plantillas/migration.sql'), 'utf8'));
    expect(await isGeneratorEnabled(prisma, CO)).toBe(false);
    await expect(getTemplateSource(prisma, deps, await accessOf(E.gest), await subjectOf(E.gest), carta)).rejects.toMatchObject({ status: 403 });
    await prisma.$executeRawUnsafe(seed('2026-10-10-sgc-generador-plantillas-pruebas.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-10-sgc-generador-plantillas-pruebas.sql'));
    expect(await isGeneratorEnabled(prisma, CO)).toBe(true);
    expect(await isGeneratorEnabled(prisma, 999_999)).toBe(false);
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, entity: 'company_config', after_json: { contains: 'generator_enabled' } } })).toBe(1);
    expect((await qualityEmails(prisma, CO)).sort()).toEqual([E.cal, E.mc].sort());
  });

  it('[SGC-REQ-179] S19 (R34): el Generador es solo para documentos sin codificación; un tipo codificado no es origen hasta que Calidad lo marca como plantilla guía (con motivo)', async () => {
    const gest = await accessOf(E.gest);
    const subj = await subjectOf(E.gest);
    // La migración del S19 es idempotente y deja todos los tipos SIN marcar.
    await prisma.$executeRawUnsafe(fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261014130000_sgc_s19_generador_sin_codificacion/migration.sql'), 'utf8'));
    expect(await prisma.sgcDocumentType.count({ where: { id_company: CO, generator_guide: true } })).toBe(0);
    await expect(getTemplateSource(prisma, deps, gest, subj, carta)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/solo para documentos sin codificación/) });
    await expect(proposeTemplateVersion(prisma, deps, notifier, gest, subj, { idDocument: carta, reason: 'Plantilla desde un formato codificado' }, actor(E.gest))).rejects.toMatchObject({ status: 409 });
    expect(await listTemplateSources(prisma, gest, subj)).toEqual({ guideTypes: [], documents: [] });
    await expect(listTemplateSources(prisma, await accessOf(E.ana), await subjectOf(E.ana))).rejects.toMatchObject({ status: 403 });
    // Calidad marca el tipo como plantilla guía: queda en el control de cambios con su motivo.
    const fo = (await getCatalogs(prisma, CO)).documentTypes.find((t) => t.code === 'FO')!;
    expect(fo.generatorGuide).toBe(false);
    const { id, code, name, pluralName, requiresTraining, reviewMonths, alertMonths, sortOrder, isActive } = fo;
    await saveCatalogEntry(prisma, CO, 'document-types', { id, code, name, pluralName, requiresTraining, reviewMonths, alertMonths, sortOrder, isActive, generatorGuide: true, reason: 'Plantillas guía sin codificación para el Generador (R34)' }, actor(E.cal));
    await saveCatalogEntry(prisma, CO, 'document-types', { id, code, name, pluralName, requiresTraining, reviewMonths, alertMonths, sortOrder, isActive, generatorGuide: true, reason: 'Se guarda de nuevo sin cambiar la marca' }, actor(E.cal));
    expect((await getCatalogs(prisma, CO)).documentTypes.find((t) => t.code === 'FO')!.generatorGuide).toBe(true);
    const log = await prisma.sgcConfigChangeLog.findMany({ where: { id_company: CO, action: 'tipo_documental.generador_guia' } });
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0].after_json!)).toEqual({ generatorGuide: true });
    const sources = await listTemplateSources(prisma, gest, subj);
    expect(sources.guideTypes).toEqual([fo.name]);
    // Los vigentes del tipo marcado que la persona puede consultar (el confidencial no aparece).
    expect(sources.documents.map((d) => d.code).sort()).toEqual(['GEN-GC-FO01', 'GEN-GC-FO02', 'GEN-GC-FO04']);
    expect(sources.documents.find((d) => d.code === 'GEN-GC-FO01')).toMatchObject({ idDocument: carta, versionNumber: 1, documentType: fo.name });
    // SQL del pase (OLP): sin el tipo PLT no marca nada; con él lo marca una sola vez (idempotente) y su reversa lo desmarca.
    const pltGuide = async () => (await prisma.sgcDocumentType.findFirst({ where: { id_company: CO, code: 'PLT' }, select: { generator_guide: true } }))?.generator_guide ?? null;
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s19-generador-guia-olp.sql'));
    expect(await pltGuide()).toBeNull();
    await prisma.$executeRawUnsafe(seed('2026-10-03-sgc-tipo-plantilla-olp.sql'));
    expect(await pltGuide()).toBe(false);
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s19-generador-guia-olp.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s19-generador-guia-olp.sql'));
    expect(await pltGuide()).toBe(true);
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: 'tipo_documental.generador_guia' } })).toBe(2);
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s19-generador-guia-olp-reversa.sql'));
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s19-generador-guia-olp-reversa.sql'));
    expect(await pltGuide()).toBe(false);
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: 'tipo_documental.generador_guia' } })).toBe(3);
    // FO sigue marcado (la reversa de OLP solo toca PLT).
    expect((await getCatalogs(prisma, CO)).documentTypes.find((t) => t.code === 'FO')!.generatorGuide).toBe(true);
  });

  it('[SGC-REQ-171] la plantilla parte de un vigente en Word con sus campos detectados; solo PDF, sin permiso o no consultable no sirven', async () => {
    await expect(getTemplateSource(prisma, deps, await accessOf(E.ana), await subjectOf(E.ana), carta)).rejects.toMatchObject({ status: 403 });
    const src = await getTemplateSource(prisma, deps, await accessOf(E.gest), await subjectOf(E.gest), carta);
    expect(src).toMatchObject({ document: { code: 'GEN-GC-FO01', versionNumber: 1 }, sourceFormat: 'docx', template: null });
    expect(src.fields.map((f) => [f.key, f.type])).toEqual([
      ['destinatario', 'texto'],
      ['fecha', 'fecha'],
      ['cuerpo', 'parrafo'],
    ]);
    await expect(getTemplateSource(prisma, deps, await accessOf(E.gest), await subjectOf(E.gest), soloPdf)).rejects.toThrow(/solo tiene el PDF controlado/);
    await expect(getTemplateSource(prisma, deps, await accessOf(E.gest), await subjectOf(E.gest), confidencial)).rejects.toMatchObject({ status: 404 });
    await expect(getTemplateSource(prisma, deps, await accessOf(E.gest), await subjectOf(E.gest), 999_999)).rejects.toMatchObject({ status: 404 });
    await expect(getTemplateSource(prisma, deps, await accessOf(E.gest), await subjectOf(E.gest), 0)).rejects.toMatchObject({ status: 404 });
  });

  it('[SGC-REQ-172][SGC-REQ-178] gestión propone (con motivo y solo campos detectados); Calidad recibe el aviso; una pendiente a la vez', async () => {
    const gest = await accessOf(E.gest);
    const subj = await subjectOf(E.gest);
    await expect(proposeTemplateVersion(prisma, deps, notifier, await accessOf(E.ana), await subjectOf(E.ana), { idDocument: carta, reason: 'Carta de certificación laboral' }, actor(E.ana))).rejects.toMatchObject({ status: 403 });
    await expect(proposeTemplateVersion(prisma, deps, notifier, gest, subj, { idDocument: carta, reason: 'corto' }, actor(E.gest))).rejects.toThrow(/mínimo 10/);
    await expect(proposeTemplateVersion(prisma, deps, notifier, gest, subj, { idDocument: carta, reason: 'Carta de certificación laboral', fields: [{ key: 'titulo' }] }, actor(E.gest))).rejects.toThrow(/no existe en el contenido/);
    await expect(proposeTemplateVersion(prisma, deps, notifier, gest, subj, { idDocument: soloPdf, reason: 'Formato que solo está en PDF' }, actor(E.gest))).rejects.toMatchObject({ status: 409 });
    sent.length = 0;
    const p = await proposeTemplateVersion(prisma, deps, notifier, gest, subj, { idDocument: carta, name: 'Carta de certificación laboral', description: 'Para empleados', reason: 'Carta de certificación laboral para empleados', fields: [{ key: 'destinatario', maxLength: 60, help: 'Nombre completo' }, { key: 'cuerpo', required: false }] }, actor(E.gest));
    expect(p).toMatchObject({ versionNumber: 1, notified: 2 });
    expect(p.fields.find((f) => f.key === 'destinatario')).toMatchObject({ maxLength: 60, help: 'Nombre completo' });
    expect(sent.flatMap((n) => n.emails).sort()).toEqual([E.cal, E.mc].sort());
    await expect(proposeTemplateVersion(prisma, deps, notifier, gest, subj, { idDocument: carta, reason: 'Otra propuesta de la misma carta' }, actor(E.gest))).rejects.toMatchObject({ status: 409 });
    const v = await prisma.sgcGeneratorTemplateVersion.findUniqueOrThrow({ where: { id_template_version: p.idTemplateVersion } });
    expect(v).toMatchObject({ status: 'pendiente', proposed_by: E.gest, body_sha256: sha256Hex(new TextEncoder().encode(v.body_html)) });
    expect(v.body_html).toContain('{{CAMPO:Destinatario}}');
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'generador.plantilla_propuesta' } })).toBe(1);
    // Mientras no la apruebe Calidad, nadie genera desde ella.
    expect(await listAvailableTemplates(prisma, await accessOf(E.ana), await subjectOf(E.ana))).toEqual([]);
    await expect(generateFromTemplate(prisma, deps, await accessOf(E.ana), await subjectOf(E.ana), p.idTemplate, { modo: 'vista', values: {} }, actor(E.ana))).rejects.toThrow(/aún no tiene una versión aprobada/);
  });

  it('[SGC-REQ-172][SGC-REQ-173] aprueba SOLO Calidad, con motivo y nunca lo propio (también en la base); la versión es inmutable', async () => {
    const { templates } = await listTemplatesForManagement(prisma, await accessOf(E.gest), await subjectOf(E.gest));
    const t = templates.find((x) => x.document.idDocument === carta)!;
    const pending = t.versions[0];
    expect(t).toMatchObject({ state: 'sin_aprobar', name: 'Carta de certificación laboral' });
    await expect(listTemplatesForManagement(prisma, await accessOf(E.ana), await subjectOf(E.ana))).rejects.toMatchObject({ status: 403 });
    expect((await listTemplatesForManagement(prisma, await accessOf(E.mc), await subjectOf(E.mc))).canApprove).toBe(true);
    await expect(decideTemplateVersion(prisma, notifier, await accessOf(E.gest), pending.id, { decision: 'aprobar', reason: 'Apruebo como gestión' }, actor(E.gest))).rejects.toMatchObject({ status: 403 });
    const mc = await accessOf(E.mc);
    await expect(decideTemplateVersion(prisma, notifier, mc, pending.id, { decision: 'quizá', reason: 'Motivo suficiente' }, actor(E.mc))).rejects.toThrow(/aprobar o rechazar/);
    await expect(decideTemplateVersion(prisma, notifier, mc, pending.id, { decision: 'aprobar', reason: 'corto' }, actor(E.mc))).rejects.toThrow(/mínimo 10/);
    await expect(decideTemplateVersion(prisma, notifier, mc, 999_999, { decision: 'aprobar', reason: 'Motivo suficiente' }, actor(E.mc))).rejects.toMatchObject({ status: 404 });
    // Calidad no aprueba su propia propuesta.
    const own = await proposeTemplateVersion(prisma, deps, notifier, await accessOf(E.cal), await subjectOf(E.cal), { idDocument: politica, reason: 'Política de ejemplo de Calidad' }, actor(E.cal));
    await expect(decideTemplateVersion(prisma, notifier, await accessOf(E.cal), own.idTemplateVersion, { decision: 'aprobar', reason: 'Me la apruebo yo misma' }, actor(E.cal))).rejects.toThrow(/su propia plantilla/);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[generator_template_version] SET status = N'aprobada', decided_by = proposed_by, decided_at = SYSUTCDATETIME() WHERE id_template_version = ${own.idTemplateVersion}`)).rejects.toThrow();
    expect(await decideTemplateVersion(prisma, notifier, mc, own.idTemplateVersion, { decision: 'rechazar', reason: 'Falta el texto de la política' }, actor(E.mc))).toEqual({ status: 'rechazada' });
    sent.length = 0;
    expect(await decideTemplateVersion(prisma, notifier, mc, pending.id, { decision: 'aprobar', reason: 'Texto y campos revisados por Calidad' }, actor(E.mc))).toEqual({ status: 'aprobada' });
    expect(sent[0].emails).toEqual([E.gest]);
    await expect(decideTemplateVersion(prisma, notifier, mc, pending.id, { decision: 'rechazar', reason: 'Decisión repetida' }, actor(E.mc))).rejects.toMatchObject({ status: 409 });
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[generator_template_version] SET body_html = N'<p>otro</p>' WHERE id_template_version = ${pending.id}`)).rejects.toThrow(/inmutables/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[generator_template_version] WHERE id_template_version = ${pending.id}`)).rejects.toThrow(/no se borra/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[generator_template] WHERE id_template = ${t.id}`)).rejects.toThrow(/no se borra/);
  });

  it('[SGC-REQ-174] la persona solo llena los campos permitidos; la vista previa es efímera y no se numera', async () => {
    const ana = await accessOf(E.ana);
    const subj = await subjectOf(E.ana);
    const [t] = await listAvailableTemplates(prisma, ana, subj);
    expect(t).toMatchObject({ name: 'Carta de certificación laboral', approvedVersion: { versionNumber: 1, decidedBy: E.mc } });
    const g = await getTemplateForGeneration(prisma, ana, subj, t.id);
    expect(g).toMatchObject({ state: 'disponible', document: { code: 'GEN-GC-FO01' } });
    expect(g.approvedVersion!.fields.map((f) => f.key)).toEqual(['destinatario', 'fecha', 'cuerpo']);
    await expect(getTemplateForGeneration(prisma, ana, subj, 999_999)).rejects.toMatchObject({ status: 404 });
    await expect(generateFromTemplate(prisma, deps, ana, subj, t.id, { modo: 'descarga', values: {} }, actor(E.ana))).rejects.toThrow(/Modo inválido/);
    await expect(generateFromTemplate(prisma, deps, ana, subj, t.id, { modo: 'vista', values: { destinatario: 'Ana', fecha: '2026-10-10', texto_fijo: 'lo cambio' } }, actor(E.ana))).rejects.toThrow(/no es un campo editable/);
    await expect(generateFromTemplate(prisma, deps, ana, subj, t.id, { modo: 'vista', values: { destinatario: 'x'.repeat(61), fecha: '2026-10-10' } }, actor(E.ana))).rejects.toThrow(/máximo 60/);
    await expect(generateFromTemplate(prisma, deps, ana, subj, 999_999, { modo: 'vista', values: {} }, actor(E.ana))).rejects.toMatchObject({ status: 404 });
    printed.length = 0;
    const before = await prisma.sgcGeneratedDocument.count({ where: { id_company: CO } });
    const out = await generateFromTemplate(prisma, deps, ana, subj, t.id, { modo: 'vista', values: { destinatario: '<b>Ana</b> & Cía', fecha: '2026-10-10', cuerpo: 'Uno\nDos' } }, actor(E.ana));
    expect(out.record).toBeNull();
    expect(out.bytes!.length).toBeGreaterThan(100);
    expect(printed[0]).toContain('Señor(a) &lt;b&gt;Ana&lt;/b&gt; &amp; Cía');
    expect(printed[0]).toContain('Uno<br>Dos');
    expect(printed[0]).toContain('Texto fijo aprobado por Calidad.');
    // S19 (R34): lo generado no lleva el código documental del origen.
    expect(printed[0]).toContain('Carta Sin codificación V—');
    expect(printed[0]).not.toContain('Carta GEN-GC-FO01');
    expect(printed[0]).not.toContain('{{HISTORIAL_CAMBIOS}}');
    expect(await prisma.sgcGeneratedDocument.count({ where: { id_company: CO } })).toBe(before);
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'generador.vista_previa', actor_email: E.ana } })).toBe(1);
  });

  it('[SGC-REQ-175][SGC-REQ-178] emitir crea el REGISTRO numerado bajo bloqueo, con su PDF y huella; es inmutable', async () => {
    const ana = await accessOf(E.ana);
    const subj = await subjectOf(E.ana);
    const [t] = await listAvailableTemplates(prisma, ana, subj);
    const values = { destinatario: 'Ana Pérez', fecha: '2026-10-10' };
    const first = await generateFromTemplate(prisma, deps, ana, subj, t.id, { modo: 'emitir', values }, actor(E.ana));
    // S19 (R34): consecutivo de REGISTRO, sin el código documental del origen.
    const pre = `GEN-${String(t.id).padStart(3, '0')}`;
    expect(first.record).toMatchObject({ code: `${pre}-0001` });
    expect(uploads.at(-1)).toEqual({ segments: ['SGC', 'GEN', 'GENERADOS', 'GEN-GC-FO01'], fileName: `${pre}-0001.pdf` });
    // Dos emisiones a la vez no toman el mismo número.
    const [a, b] = await Promise.all([
      generateFromTemplate(prisma, deps, ana, subj, t.id, { modo: 'emitir', values }, actor(E.ana)),
      generateFromTemplate(prisma, deps, await accessOf(E.otro), await subjectOf(E.otro), t.id, { modo: 'emitir', values }, actor(E.otro)),
    ]);
    expect([a.record!.code, b.record!.code].sort()).toEqual([`${pre}-0002`, `${pre}-0003`]);
    const row = await prisma.sgcGeneratedDocument.findUniqueOrThrow({ where: { id_generated: first.record!.id } });
    expect(row).toMatchObject({ status: 'emitido', generated_by: E.ana, sequence_number: 1, ip: '10.12.12.12' });
    expect(row.pdf_sha256).toBe(sha256Hex(store.get(row.pdf_item_id)!));
    expect(JSON.parse(row.values_json)).toEqual({ destinatario: 'Ana Pérez', fecha: '2026-10-10', cuerpo: '' });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'generador.documento_generado' } })).toBe(3);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[generated_document] SET values_json = N'{}' WHERE id_generated = ${row.id_generated}`)).rejects.toThrow(/inmutable/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[generated_document] WHERE id_generated = ${row.id_generated}`)).rejects.toThrow(/no se borra/);
  });

  it('[SGC-REQ-176] el registro lo ven quien lo generó y Calidad; los demás no (ni en las listas)', async () => {
    const mine = await listMyGenerated(prisma, CO, E.ana);
    expect(mine.map((g) => g.code)).toHaveLength(2);
    expect(mine[0]).toMatchObject({ templateName: 'Carta de certificación laboral', templateVersion: 1, document: { code: 'GEN-GC-FO01', versionNumber: 1 }, status: 'emitido' });
    await expect(listGeneratedForQuality(prisma, await accessOf(E.ana))).rejects.toMatchObject({ status: 403 });
    expect(await listGeneratedForQuality(prisma, await accessOf(E.mc))).toHaveLength(3);
    const id = mine[0].id;
    const all = await getSgcAccessForUser(prisma, E.ana);
    expect(await getGeneratedForViewer(prisma, all, E.ana, id)).toMatchObject({ idCompany: CO, status: 'emitido', idGenerated: id });
    expect(await getGeneratedForViewer(prisma, await getSgcAccessForUser(prisma, E.mc), E.mc, id)).not.toBeNull();
    expect(await getGeneratedForViewer(prisma, await getSgcAccessForUser(prisma, E.otro), E.otro, id)).toBeNull();
    expect(await getGeneratedForViewer(prisma, await getSgcAccessForUser(prisma, E.gest), E.gest, id)).toBeNull();
    expect(await getGeneratedForViewer(prisma, [], E.ana, id)).toBeNull();
    expect(await getGeneratedForViewer(prisma, all, E.ana, 999_999)).toBeNull();
  });

  it('[SGC-REQ-175] quien lo generó o Calidad lo anulan con motivo; su número no se reutiliza', async () => {
    const [g] = await listMyGenerated(prisma, CO, E.ana);
    await expect(annulGenerated(prisma, await accessOf(E.otro), g.id, { reason: 'Lo anulo sin ser el dueño' }, actor(E.otro))).rejects.toMatchObject({ status: 404 });
    await expect(annulGenerated(prisma, await accessOf(E.ana), g.id, { reason: 'corto' }, actor(E.ana))).rejects.toThrow(/mínimo 10/);
    expect(await annulGenerated(prisma, await accessOf(E.ana), g.id, { reason: 'Error en el nombre del destinatario' }, actor(E.ana))).toEqual({ status: 'anulado' });
    await expect(annulGenerated(prisma, await accessOf(E.mc), g.id, { reason: 'Anulación repetida por Calidad' }, actor(E.mc))).rejects.toMatchObject({ status: 409 });
    const otros = await listMyGenerated(prisma, CO, E.otro);
    expect(await annulGenerated(prisma, await accessOf(E.mc), otros[0].id, { reason: 'Calidad anula el documento de prueba' }, actor(E.mc))).toEqual({ status: 'anulado' });
    expect((await listMyGenerated(prisma, CO, E.ana)).find((x) => x.id === g.id)).toMatchObject({ status: 'anulado', annulledBy: E.ana, annulReason: 'Error en el nombre del destinatario' });
    expect(await getGeneratedForViewer(prisma, await getSgcAccessForUser(prisma, E.ana), E.ana, g.id)).toMatchObject({ status: 'anulado' });
  });

  it('[SGC-REQ-173] si el origen cambia de versión la plantilla queda desactualizada hasta que Calidad apruebe la nueva (que reemplaza a la anterior)', async () => {
    const doc = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: carta } });
    const v1 = await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: doc.current_version_id! } });
    // Versión 2 del documento de origen (encabezado institucional y nuevo texto), como si viniera del flujo.
    const src = await upload(['SGC', 'GEN', 'FO', 'GEN-GC-FO01', 'v2'], 'GEN-GC-FO01 V2.docx', word('<p>Nueva carta para {{CAMPO:Destinatario}}</p>'), 'x');
    const manifest = JSON.stringify({ institutionalHeader: true, signatures: [{ meaning: 'elaboro', signerName: 'Gestión', signerEmail: E.gest }, { meaning: 'aprobo', signerName: null, signerEmail: E.mc }] });
    const v2 = await prisma.sgcDocumentVersion.create({ data: { id_document: carta, version_number: 2, status: 'vigente', pdf_item_id: v1.pdf_item_id, pdf_path: v1.pdf_path, pdf_file_name: 'GEN-GC-FO01 V2.pdf', pdf_sha256: v1.pdf_sha256, pdf_size: v1.pdf_size, source_item_id: src.id, source_path: 'SGC/GEN/FO/GEN-GC-FO01/v2/GEN-GC-FO01 V2.docx', source_file_name: 'GEN-GC-FO01 V2.docx', effective_date: new Date('2026-10-01'), created_by: E.cal, manifest_json: manifest } });
    await prisma.sgcDocumentVersion.update({ where: { id_document_version: v1.id_document_version }, data: { status: 'obsoleto' } });
    await prisma.sgcDocument.update({ where: { id_document: carta }, data: { current_version_id: v2.id_document_version } });
    const ana = await accessOf(E.ana);
    const subj = await subjectOf(E.ana);
    const { templates } = await listTemplatesForManagement(prisma, await accessOf(E.mc), await subjectOf(E.mc));
    const t = templates.find((x) => x.document.idDocument === carta)!;
    expect(t).toMatchObject({ state: 'desactualizada', document: { currentVersionNumber: 2 }, approvedVersion: { documentVersionNumber: 1 } });
    expect(await listAvailableTemplates(prisma, ana, subj)).toEqual([]);
    await expect(generateFromTemplate(prisma, deps, ana, subj, t.id, { modo: 'emitir', values: { destinatario: 'X', fecha: '2026-10-10' } }, actor(E.ana))).rejects.toThrow(/versión nueva/);
    const p2 = await proposeTemplateVersion(prisma, deps, notifier, await accessOf(E.gest), await subjectOf(E.gest), { idDocument: carta, reason: 'Actualización a la versión 2 del documento' }, actor(E.gest));
    expect(p2.versionNumber).toBe(2);
    await decideTemplateVersion(prisma, notifier, await accessOf(E.cal), p2.idTemplateVersion, { decision: 'aprobar', reason: 'Revisada la versión 2 de la carta' }, actor(E.cal));
    const after = (await listTemplatesForManagement(prisma, await accessOf(E.mc), await subjectOf(E.mc))).templates.find((x) => x.id === t.id)!;
    expect(after.versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [2, 'aprobada'],
      [1, 'reemplazada'],
    ]);
    expect(after.state).toBe('disponible');
    printed.length = 0;
    const r = await generateFromTemplate(prisma, deps, ana, subj, t.id, { modo: 'emitir', values: { destinatario: 'Luis' } }, actor(E.ana));
    // El consecutivo sigue (no se reinicia con la versión nueva de la plantilla).
    expect(r.record!.code).toBe(`GEN-${String(t.id).padStart(3, '0')}-0004`);
    expect(printed[0]).toContain('Nueva carta para Luis');
    const row = await prisma.sgcGeneratedDocument.findUniqueOrThrow({ where: { id_generated: r.record!.id } });
    expect(row.id_document_version).toBe(v2.id_document_version);
    // Origen ya no vigente: no se genera.
    await prisma.sgcDocument.update({ where: { id_document: carta }, data: { status: 'obsoleto' } });
    await expect(generateFromTemplate(prisma, deps, await accessOf(E.mc), await subjectOf(E.mc), t.id, { modo: 'vista', values: { destinatario: 'X' } }, actor(E.mc))).rejects.toThrow(/ya no está vigente/);
    await prisma.sgcDocument.update({ where: { id_document: carta }, data: { status: 'vigente' } });
  });

  it('[SGC-REQ-172] solo Calidad retira la plantilla (con motivo); retirada no se genera y una versión nueva aprobada la reactiva', async () => {
    const t = (await listAvailableTemplates(prisma, await accessOf(E.ana), await subjectOf(E.ana)))[0];
    await expect(retireTemplate(prisma, await accessOf(E.gest), t.id, { reason: 'Gestión la quiere retirar' }, actor(E.gest))).rejects.toMatchObject({ status: 403 });
    const mc = await accessOf(E.mc);
    await expect(retireTemplate(prisma, mc, t.id, { reason: 'corto' }, actor(E.mc))).rejects.toThrow(/mínimo 10/);
    await expect(retireTemplate(prisma, mc, 999_999, { reason: 'Plantilla que no existe' }, actor(E.mc))).rejects.toMatchObject({ status: 404 });
    expect(await retireTemplate(prisma, mc, t.id, { reason: 'La carta se reemplaza por otra' }, actor(E.mc))).toEqual({ status: 'retirada' });
    await expect(retireTemplate(prisma, mc, t.id, { reason: 'Retiro repetido de la carta' }, actor(E.mc))).rejects.toMatchObject({ status: 409 });
    await expect(generateFromTemplate(prisma, deps, await accessOf(E.ana), await subjectOf(E.ana), t.id, { modo: 'vista', values: { destinatario: 'X' } }, actor(E.ana))).rejects.toThrow(/retirada/);
    const p3 = await proposeTemplateVersion(prisma, deps, notifier, await accessOf(E.gest), await subjectOf(E.gest), { idDocument: carta, reason: 'Se vuelve a usar la carta' }, actor(E.gest));
    await decideTemplateVersion(prisma, notifier, mc, p3.idTemplateVersion, { decision: 'aprobar', reason: 'Calidad reactiva la carta' }, actor(E.mc));
    expect((await getTemplateForGeneration(prisma, await accessOf(E.ana), await subjectOf(E.ana), t.id)).state).toBe('disponible');
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: { in: ['generador.plantilla_retirada', 'generador.plantilla_decidida', 'generador.documento_anulado'] } } })).toBeGreaterThanOrEqual(6);
  });

  it('[SGC-REQ-175] sin carpeta raíz no se emite; con el generador apagado no se configura ni se genera', async () => {
    const t = (await listAvailableTemplates(prisma, await accessOf(E.ana), await subjectOf(E.ana)))[0];
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { storage_root: '///' } });
    try {
      await expect(generateFromTemplate(prisma, deps, await accessOf(E.ana), await subjectOf(E.ana), t.id, { modo: 'emitir', values: { destinatario: 'X' } }, actor(E.ana))).rejects.toThrow(/carpeta raíz/);
    } finally {
      await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { storage_root: 'SGC/GEN' } });
    }
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { generator_enabled: false } });
    await expect(getTemplateForGeneration(prisma, await accessOf(E.ana), await subjectOf(E.ana), t.id)).rejects.toMatchObject({ status: 403 });
    await expect(proposeTemplateVersion(prisma, deps, notifier, await accessOf(E.gest), await subjectOf(E.gest), { idDocument: politica, reason: 'Con el generador apagado' }, actor(E.gest))).rejects.toMatchObject({ status: 403 });
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { generator_enabled: true } });
  });
});

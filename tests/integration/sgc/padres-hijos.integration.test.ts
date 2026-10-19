import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { getCatalogs, saveCatalogEntry } from '../../../lib/sgc/db/catalogs';
import { addMatrixEntry } from '../../../lib/sgc/db/matrix';
import { createInitialDocument, getAccessSubject, type SgcUploader } from '../../../lib/sgc/db/documents';
import { buildHeaderTemplatePreview, headerTemplateForType, saveHeaderTemplate } from '../../../lib/sgc/db/headerTemplates';
import { addDocumentRelation, decideRelationProposals, getParentOptions, getRelationGraph, removeDocumentRelation, setDocumentParent } from '../../../lib/sgc/db/relations';
import { createRequest } from '../../../lib/sgc/db/requests';
import { SGC_DEFAULT_HEADER_GRID } from '../../../lib/sgc/headerGrid';
import { buildDocumentTree } from '../../../lib/sgc/hierarchy';
import type { SgcNotifier } from '../../../lib/sgc/notifications';

/**
 * DOCUMENTOS PADRE E HIJOS y ENCABEZADO CON GRILLA (reunión con Calidad OLP
 * del 2026-10-19) contra un SQL Server REAL (efímero en CI): la migración y su
 * reversa, el tipo padre configurable, las reglas (el padre no tiene padre, un
 * hijo tiene un solo padre) en todas las vías, «Relacionar con padre» (arrastre
 * o botón) solo para Calidad y con auditoría, el árbol del auditor y la grilla
 * del encabezado en la vista previa real. Empresa propia (id 120). Datos de
 * EJEMPLO con la nomenclatura del listado de Calidad (OLP-GGC-01-PR…).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · documentos padre e hijos con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 120;
  const E = { sol: 'sol.ph@onelatampharma.com', cal: 'calidad.ph@onelatampharma.com', lec: 'lector.ph@onelatampharma.com' };
  const actor = (email: string) => ({ email, ip: '10.20.20.20', userAgent: 'vitest-padres-hijos' });
  const accessOf = async (email: string) => (await getSgcAccessForUser(prisma, email)).find((a) => a.idCompany === CO)!;
  const seed = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  const migration = () => fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/20261019100000_sgc_padres_hijos/migration.sql'), 'utf8');
  const notifier: SgcNotifier = async () => undefined;
  let n = 0;
  const upload: SgcUploader = async () => ({ id: `ph-${++n}` });
  const pdfOf = async (text: string) => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595.28, 841.89]).drawText(text, { x: 50, y: 500, size: 11, font });
    return pdf.save();
  };
  const pdfText = async (bytes: Uint8Array, page: number) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
    return ((await (await doc.getPage(page)).getTextContent()).items as { str: string }[]).map((i) => i.str).join(' ');
  };
  const D: Record<string, number> = {};
  let types: Record<string, number> = {};
  let procGC = 0;

  beforeAll(async () => {
    // Política vigente (RN 2026-10-05), como en el S16: la matriz asigna al elaborador.
    vi.stubEnv('SGC_ASIGNACION_PERMISO', 'tarea_o_calidad');
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA PADRES E HIJOS CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/PH', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (padres e hijos CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    const hash = bcrypt.hashSync('Clave-PH-ci#2026', 4);
    for (const [email, perms] of [[E.sol, ['gestion']], [E.cal, ['gestion', 'calidad']], [E.lec, ['lectura']]] as [string, string[]][]) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase(), password: hash } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
    }
    for (const f of ['2026-09-30-sgc-s1-maestros-olp.sql', '2026-09-30-sgc-s2-flujo-documental-olp.sql', '2026-09-30-sgc-s3-firma-calidad-olp.sql', '2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql']) {
      await prisma.$executeRawUnsafe(seed(f));
    }
    const cat = await getCatalogs(prisma, CO);
    procGC = cat.processes.find((p) => p.code === 'GC')!.id;
    types = Object.fromEntries(cat.documentTypes.map((t) => [t.code, t.id]));
    const load = async (code: string, type: string, extra: Record<string, unknown> = {}) =>
      (await createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procGC, idDocumentType: types[type], title: `Documento ${code}`, code, confidentiality: 'publica', versionNumber: 1, effectiveDate: '2025-01-15', pdf: { bytes: await pdfOf(code), fileName: 'v1.pdf' }, ...extra }, actor(E.cal))).idDocument;
    D.pr01 = await load('OLP-GGC-01-PR', 'PR');
    D.pr02 = await load('OLP-GGC-02-PR', 'PR');
    D.fr001 = await load('OLP-GGC-01-FR-001', 'FO');
    D.in001 = await load('OLP-GGC-01-IN-001', 'IN');
    D.mn = await load('OLP-SEM-02-MN', 'MA');
    D.an = await load('OLP-GGC-01-AN-001', 'AN');
    await addMatrixEntry(prisma, CO, { role: 'elaborador', idProcess: procGC, idDocumentType: types.AN, userEmail: E.cal, reason: 'Elaborador de la prueba de padres e hijos' }, actor(E.cal));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[SGC-REQ-186] la migración agrega document_type.is_parent_type (en 0) y los orígenes «solicitud» y «carga» (idempotente)', async () => {
    await prisma.$executeRawUnsafe(migration());
    await prisma.$executeRawUnsafe(migration());
    const cols = await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE object_id = OBJECT_ID('sgc.document_type') AND name = 'is_parent_type'`;
    expect(cols).toHaveLength(1);
    const ck = await prisma.$queryRaw<{ d: string }[]>`SELECT definition AS d FROM sys.check_constraints WHERE name = 'document_relation_origen_estado_ck'`;
    expect(ck[0].d).toMatch(/solicitud/);
    expect(ck[0].d).toMatch(/carga/);
    expect(await prisma.sgcDocumentType.count({ where: { id_company: CO, is_parent_type: true } })).toBe(0);
    await expect(prisma.sgcDocumentRelation.create({ data: { id_company: CO, id_source_document: D.pr01, id_target_document: D.pr02, relation_type: 'referencia', created_by: 'ci', change_reason: 'Origen que no existe', origin: 'otro' } })).rejects.toThrow(/document_relation_origen_estado_ck|CHECK/);
  });

  it('[SGC-REQ-180] sin tipos marcados, el padre es el procedimiento; Calidad marca un tipo padre con motivo (control de cambios) y no si sus documentos ya cuelgan de un padre', async () => {
    let cat = await getCatalogs(prisma, CO);
    expect(cat.parentTypeCodes).toEqual(['PR']);
    const ma = cat.documentTypes.find((t) => t.code === 'MA')!;
    const body = { id: ma.id, code: ma.code, name: ma.name, pluralName: ma.pluralName, requiresTraining: ma.requiresTraining, reviewMonths: ma.reviewMonths, alertMonths: ma.alertMonths, sortOrder: ma.sortOrder, isActive: true, isParentType: true, reason: 'El manual también es documento padre' };
    await saveCatalogEntry(prisma, CO, 'document-types', body, actor(E.cal));
    cat = await getCatalogs(prisma, CO);
    // Con un tipo marcado, solo valen los marcados: el procedimiento también se marca.
    expect(cat.parentTypeCodes).toEqual(['MA']);
    const pr = cat.documentTypes.find((t) => t.code === 'PR')!;
    await saveCatalogEntry(prisma, CO, 'document-types', { id: pr.id, code: pr.code, name: pr.name, pluralName: pr.pluralName, requiresTraining: pr.requiresTraining, reviewMonths: pr.reviewMonths, alertMonths: pr.alertMonths, sortOrder: pr.sortOrder, isActive: true, isParentType: true, reason: 'El procedimiento es documento padre' }, actor(E.cal));
    cat = await getCatalogs(prisma, CO);
    expect(cat.parentTypeCodes.sort()).toEqual(['MA', 'PR']);
    expect(await prisma.sgcConfigChangeLog.count({ where: { id_company: CO, action: 'tipo_documental.tipo_padre' } })).toBe(2);
    // Se desmarca el manual (queda solo el procedimiento, como pide Calidad).
    await saveCatalogEntry(prisma, CO, 'document-types', { ...body, isParentType: false, reason: 'Solo el procedimiento es padre' }, actor(E.cal));
    expect((await getCatalogs(prisma, CO)).parentTypeCodes).toEqual(['PR']);
  });

  it('[SGC-REQ-183] «Relacionar con padre»: solo Calidad, con motivo; queda confirmada y en la auditoría (arrastre o botón)', async () => {
    const calAll = await getSgcAccessForUser(prisma, E.cal);
    await expect(setDocumentParent(prisma, await getSgcAccessForUser(prisma, E.sol), { idChild: D.fr001, idParent: D.pr01, reason: 'Formato del procedimiento 01', via: 'arrastre' }, actor(E.sol))).rejects.toMatchObject({ status: 403 });
    await expect(setDocumentParent(prisma, calAll, { idChild: D.fr001, idParent: D.pr01, reason: 'corto' }, actor(E.cal))).rejects.toThrow(/mínimo 10/);
    await expect(setDocumentParent(prisma, calAll, { idChild: 999_999, idParent: D.pr01, reason: 'Documento que no existe' }, actor(E.cal))).rejects.toMatchObject({ status: 404 });
    const opts = await getParentOptions(prisma, calAll, D.fr001);
    expect(opts).toMatchObject({ isParentType: false, parent: null, parentTypeCodes: ['PR'] });
    expect(opts.candidates.map((c) => c.code)).toEqual(['OLP-GGC-01-PR', 'OLP-GGC-02-PR']);
    await expect(getParentOptions(prisma, await getSgcAccessForUser(prisma, E.lec), D.fr001)).rejects.toMatchObject({ status: 403 });
    const saved = await setDocumentParent(prisma, calAll, { idChild: D.fr001, idParent: D.pr01, reason: 'Formato del procedimiento de control documental', via: 'arrastre' }, actor(E.cal));
    expect(saved).toMatchObject({ id_source_document: D.fr001, id_target_document: D.pr01, relation_type: 'formato', origin: 'manual', status: 'confirmada', confirmed_by: E.cal });
    const audit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { id_company: CO, action: 'relacion.padre_asignado', entity_id: String(saved.id_document_relation) } });
    expect(audit.detail).toContain('OLP-GGC-01-FR-001 queda como hijo de OLP-GGC-01-PR (Formato, arrastre en el mapa)');
    const ins = await setDocumentParent(prisma, calAll, { idChild: D.in001, idParent: D.pr01, reason: 'Instructivo del procedimiento 01', via: 'boton' }, actor(E.cal));
    expect(ins).toMatchObject({ id_source_document: D.pr01, id_target_document: D.in001, relation_type: 'procedimiento_padre' });
    expect((await getParentOptions(prisma, calAll, D.fr001)).parent).toMatchObject({ code: 'OLP-GGC-01-PR' });
    expect((await getParentOptions(prisma, calAll, D.pr01)).isParentType).toBe(true);
  });

  it('[SGC-REQ-180][SGC-REQ-181] el padre no tiene padre, un hijo tiene un solo padre y el padre es de un tipo padre, en todas las vías', async () => {
    const calAll = await getSgcAccessForUser(prisma, E.cal);
    // Botón / arrastre.
    await expect(setDocumentParent(prisma, calAll, { idChild: D.pr02, idParent: D.pr01, reason: 'Procedimiento bajo otro procedimiento' }, actor(E.cal))).rejects.toThrow(/documento padre no tiene padre/);
    await expect(setDocumentParent(prisma, calAll, { idChild: D.fr001, idParent: D.pr02, reason: 'Segundo padre para el formato' }, actor(E.cal))).rejects.toThrow(/un solo padre/);
    await expect(setDocumentParent(prisma, calAll, { idChild: D.an, idParent: D.in001, reason: 'Anexo colgado de un instructivo' }, actor(E.cal))).rejects.toThrow(/no es de un tipo documental padre/);
    await expect(setDocumentParent(prisma, calAll, { idChild: D.an, idParent: D.mn, reason: 'Anexo colgado del manual' }, actor(E.cal))).rejects.toThrow(/no es de un tipo documental padre/);
    // Formulario genérico de relaciones: las jerárquicas aplican la regla; la referencia no.
    await expect(addDocumentRelation(prisma, calAll, { idSource: D.pr01, idTarget: D.pr02, type: 'procedimiento_padre', reason: 'Procedimiento padre de otro' }, actor(E.cal))).rejects.toMatchObject({ status: 409 });
    await expect(addDocumentRelation(prisma, calAll, { idSource: D.fr001, idTarget: D.pr02, type: 'formato', reason: 'Formato de otro procedimiento' }, actor(E.cal))).rejects.toThrow(/un solo padre/);
    await addDocumentRelation(prisma, calAll, { idSource: D.pr01, idTarget: D.pr02, type: 'referencia', reason: 'El 01 hace referencia al 02' }, actor(E.cal));
    // Confirmar una propuesta que le daría un segundo padre: se niega.
    const prop = await prisma.sgcDocumentRelation.create({ data: { id_company: CO, id_source_document: D.pr02, id_target_document: D.in001, relation_type: 'procedimiento_padre', created_by: 'ci', change_reason: 'Propuesta vieja por código', origin: 'codigo', status: 'propuesta' } });
    await expect(decideRelationProposals(prisma, await accessOf(E.cal), { ids: [prop.id_document_relation], action: 'confirmar' }, actor(E.cal))).rejects.toThrow(/un solo padre/);
    await decideRelationProposals(prisma, await accessOf(E.cal), { ids: [prop.id_document_relation], action: 'descartar', reason: 'El instructivo ya tiene su padre' }, actor(E.cal));
    // Una solicitud nueva de procedimiento con padre se rechaza; la de un anexo con padre (sin herencia) se acepta.
    const base = { idCompany: CO, requestType: 'nuevo', description: 'Solicitud de la prueba de padres e hijos.', idProcess: procGC, formValues: { urgencia: 'Normal' } };
    await expect(createRequest(prisma, notifier, await accessOf(E.sol), { ...base, subject: 'Procedimiento nuevo', idDocumentType: types.PR, idParentDocument: D.pr01 }, actor(E.sol))).rejects.toThrow(/no tiene padre/);
    await expect(createRequest(prisma, notifier, await accessOf(E.sol), { ...base, subject: 'Anexo con padre manual', idDocumentType: types.AN, idParentDocument: D.mn }, actor(E.sol))).rejects.toThrow(/tipo padre/);
    const ok = await createRequest(prisma, notifier, await accessOf(E.sol), { ...base, subject: 'Anexo nuevo del procedimiento', idDocumentType: types.AN, idParentDocument: D.pr02 }, actor(E.sol));
    expect((await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: ok.idRequest } })).id_parent_document).toBe(D.pr02);
    // Carga individual: un procedimiento con padre se rechaza; un anexo con su padre deja la relación creada sola.
    const loadWith = async (code: string, type: string, idParentDocument: number) =>
      createInitialDocument(prisma, upload, { idCompany: CO, idProcess: procGC, idDocumentType: types[type], title: `Documento ${code}`, code, confidentiality: 'publica', versionNumber: 1, effectiveDate: '2025-01-15', idParentDocument, pdf: { bytes: await pdfOf(code), fileName: 'v1.pdf' } }, actor(E.cal));
    await expect(loadWith('OLP-GGC-03-PR', 'PR', D.pr01)).rejects.toThrow(/no tiene padre/);
    const an2 = await loadWith('OLP-GGC-02-AN-001', 'AN', D.pr02);
    const rel = await prisma.sgcDocumentRelation.findFirstOrThrow({ where: { id_company: CO, id_source_document: an2.idDocument, is_active: true } });
    expect(rel).toMatchObject({ relation_type: 'anexo', id_target_document: D.pr02, origin: 'carga', status: 'confirmada' });
    expect(await prisma.sgcAuditLog.count({ where: { id_company: CO, action: 'relacion.automatica', entity_id: String(rel.id_document_relation) } })).toBe(1);
    D.an2 = an2.idDocument;
    // Marcar como padre un tipo cuyos documentos ya cuelgan de un padre: se niega.
    const cat = await getCatalogs(prisma, CO);
    const fo = cat.documentTypes.find((t) => t.code === 'FO')!;
    await expect(saveCatalogEntry(prisma, CO, 'document-types', { id: fo.id, code: fo.code, name: fo.name, pluralName: fo.pluralName, requiresTraining: fo.requiresTraining, reviewMonths: fo.reviewMonths, alertMonths: fo.alertMonths, sortOrder: fo.sortOrder, isActive: true, isParentType: true, reason: 'Formato como padre (no debe)' }, actor(E.cal))).rejects.toThrow(/ya tienen documento padre/);
  });

  it('[SGC-REQ-184] el árbol del auditor: cada procedimiento con lo que se desprende de él, con la versión vigente; respeta lo que cada quien puede ver', async () => {
    const graph = await getRelationGraph(prisma, await accessOf(E.cal), await getAccessSubject(prisma, E.cal));
    expect(graph.parentTypeCodes).toEqual(['PR']);
    expect(graph.nodes.every((nd) => typeof nd.currentVersionId === 'number')).toBe(true);
    const tree = buildDocumentTree(graph.nodes.map((nd) => ({ ...nd, currentVersionId: nd.currentVersionId ?? null })), graph.edges, graph.parentTypeCodes);
    expect(tree.roots.map((r) => [r.doc.code, r.children.map((c) => c.doc.code)])).toEqual([
      ['OLP-GGC-01-PR', ['OLP-GGC-01-FR-001', 'OLP-GGC-01-IN-001']],
      ['OLP-GGC-02-PR', ['OLP-GGC-02-AN-001']],
    ]);
    expect(tree.orphans.map((o) => o.code)).toEqual(['OLP-GGC-01-AN-001', 'OLP-SEM-02-MN']);
    // Retirar la relación devuelve el hijo a «sin padre» y se puede volver a relacionar con otro padre.
    const calAll = await getSgcAccessForUser(prisma, E.cal);
    const current = await getParentOptions(prisma, calAll, D.in001);
    await removeDocumentRelation(prisma, calAll, current.parent!.idRelation, 'El instructivo pasa al procedimiento 02', actor(E.cal));
    await setDocumentParent(prisma, calAll, { idChild: D.in001, idParent: D.pr02, reason: 'El instructivo es del procedimiento 02' }, actor(E.cal));
    expect((await getParentOptions(prisma, calAll, D.in001)).parent?.code).toBe('OLP-GGC-02-PR');
  });

  it('[SGC-REQ-185] una plantilla con GRILLA se guarda con motivo y su vista previa es el PDF real; una grilla inválida se rechaza', async () => {
    await prisma.$executeRawUnsafe(seed('2026-10-14-sgc-s16-encabezados-excel-olp.sql'));
    const grid = { ...SGC_DEFAULT_HEADER_GRID, cells: SGC_DEFAULT_HEADER_GRID.cells.map((c) => (c.field === 'texto' ? { ...c, text: 'EMITIDO EL:' } : c)) };
    await expect(saveHeaderTemplate(prisma, CO, { code: 'MALA', name: 'Grilla inválida', config: { grid: { ...grid, rows: [80, 80, 44, 18] } }, reason: 'Grilla de prueba' }, actor(E.cal))).rejects.toThrow(/máximo es 142/);
    const created = await saveHeaderTemplate(prisma, CO, { code: 'PROC-GRILLA', name: 'Procedimientos con grilla', config: { grid }, reason: 'Encabezado de procedimientos con grilla' }, actor(E.cal));
    const log = await prisma.sgcConfigChangeLog.findFirstOrThrow({ where: { id_company: CO, action: 'encabezado.plantilla_creada', entity_id: String(created.id) } });
    expect(JSON.parse(log.after_json!).config.grid.cells).toHaveLength(12);
    const pr = (await getCatalogs(prisma, CO)).documentTypes.find((t) => t.code === 'PR')!;
    await saveCatalogEntry(prisma, CO, 'document-types', { id: pr.id, code: pr.code, name: pr.name, pluralName: pr.pluralName, requiresTraining: pr.requiresTraining, reviewMonths: pr.reviewMonths, alertMonths: pr.alertMonths, sortOrder: pr.sortOrder, isActive: true, idHeaderTemplate: created.id, reason: 'Procedimientos con su grilla' }, actor(E.cal));
    expect((await headerTemplateForType(prisma, CO, pr.id)).config.grid?.cells).toHaveLength(12);
    const text = await pdfText(await buildHeaderTemplatePreview(prisma, CO, { idTemplate: created.id }), 1);
    for (const t of ['EMITIDO EL:', 'NOMBRE DEL DOCUMENTO', 'CÓDIGO: XXX-PR-001', 'ELABORÓ:', 'Firma']) expect(text).toContain(t);
  });

  it('[SGC-REQ-186] la reversa se niega con datos sin la bandera; con ella vuelve atrás sin borrar relaciones, y la migración se puede volver a aplicar', async () => {
    const reversa = fs.readFileSync(path.join(process.cwd(), 'prisma/manual/2026-10-19-sgc-padres-hijos-reversa.sql'), 'utf8');
    const before = await prisma.sgcDocumentRelation.count({ where: { id_company: CO } });
    await expect(prisma.$executeRawUnsafe(reversa)).rejects.toThrow(/sgc_reversa_padres_hijos/);
    await prisma.$executeRawUnsafe(`EXEC sp_set_session_context N'sgc_reversa_padres_hijos', 1;\n${reversa}\nEXEC sp_set_session_context N'sgc_reversa_padres_hijos', NULL;`);
    expect(await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE object_id = OBJECT_ID('sgc.document_type') AND name = 'is_parent_type'`).toHaveLength(0);
    expect(await prisma.sgcDocumentRelation.count({ where: { id_company: CO } })).toBe(before);
    expect(await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*) AS n FROM sgc.document_relation WHERE origin IN (N'solicitud', N'carga')`).toEqual([{ n: 0 }]);
    await prisma.$executeRawUnsafe(migration());
    expect(await prisma.$queryRaw<{ c: string }[]>`SELECT name AS c FROM sys.columns WHERE object_id = OBJECT_ID('sgc.document_type') AND name = 'is_parent_type'`).toHaveLength(1);
    // Se deja otra vez el procedimiento marcado como padre: la reversa de la CI (sin bandera) debe encontrar datos y negarse.
    const pr = (await getCatalogs(prisma, CO)).documentTypes.find((t) => t.code === 'PR')!;
    await saveCatalogEntry(prisma, CO, 'document-types', { id: pr.id, code: pr.code, name: pr.name, pluralName: pr.pluralName, requiresTraining: pr.requiresTraining, reviewMonths: pr.reviewMonths, alertMonths: pr.alertMonths, sortOrder: pr.sortOrder, isActive: true, isParentType: true, reason: 'El procedimiento vuelve a ser tipo padre' }, actor(E.cal));
    expect((await getCatalogs(prisma, CO)).parentTypeCodes).toEqual(['PR']);
  });
});

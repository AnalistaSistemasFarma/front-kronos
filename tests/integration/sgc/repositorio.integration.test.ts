import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getCatalogs, saveCatalogEntry } from '../../../lib/sgc/db/catalogs';
import {
  annulDocument,
  createInitialDocument,
  getAccessSubject,
  getDocumentDetail,
  getVersionForViewer,
  grantDocumentAccess,
  listMasterDocuments,
  revokeDocumentAccess,
  updateDocumentMetadata,
  type SgcUploader,
} from '../../../lib/sgc/db/documents';
import type { SgcCompanyAccess } from '../../../lib/sgc/permissions';

/**
 * Sprint 1 — repositorio y listado maestro contra un SQL Server REAL (efímero
 * en CI): esquema `sgc`, maestros de OLP (el mismo SQL del pase manual), carga
 * inicial de vigentes, listado maestro con permisos por departamento y
 * confidencialidad, visor, anulación, accesos y auditoría inmodificable.
 * OneDrive se reemplaza por un cargador de prueba (no hay red en CI).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · Sprint 1 · integración con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const OLP = 3;
  const FARMA = 1;
  const CALIDAD = 'calidad.s1@onelatampharma.com';
  const LECTOR = 'logistica.s1@onelatampharma.com';
  const actor = { email: CALIDAD, ip: '10.0.0.5', userAgent: 'vitest' };
  const lectura: SgcCompanyAccess = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
  const calidad: SgcCompanyAccess = { ...lectura, canQuality: true };
  const uploads: { segments: string[]; fileName: string; size: number }[] = [];
  const upload: SgcUploader = async (segments, fileName, content) => {
    uploads.push({ segments, fileName, size: content.length });
    return { id: `item-${uploads.length}` };
  };
  const pdf = (text = 'contenido') => ({ bytes: new TextEncoder().encode(`%PDF-1.7\n${text}`), fileName: 'original.pdf' });
  const seedSql = fs.readFileSync(path.join(process.cwd(), 'prisma/manual/2026-09-30-sgc-s1-maestros-olp.sql'), 'utf8');

  let deptCalidad = 0;
  let deptLogistica = 0;
  let procGC = 0;
  let procLO = 0;
  let typePR = 0;
  let typeMA = 0;
  const base = () => ({
    idCompany: OLP,
    idProcess: procGC,
    idDocumentType: typePR,
    title: 'Control de documentos',
    confidentiality: 'publica',
    versionNumber: 1,
    effectiveDate: '2026-01-15',
    pdf: pdf(),
  });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${FARMA}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${FARMA}, N'FARMALOGICA S.A.');
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${OLP}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${OLP}, N'ONELATAMPHARMA');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    for (const cfg of [
      { id_company: OLP, is_active: true, storage_root: 'SGC/OLP', activated_by: 'ci', activated_at: new Date() },
      { id_company: FARMA, is_active: false, storage_root: 'SGC/FARMALOGICA' },
    ]) {
      await prisma.sgcCompanyConfig.upsert({ where: { id_company: cfg.id_company }, create: cfg, update: {} });
    }
    deptCalidad = (await prisma.department.create({ data: { department: 'GARANTÍA DE CALIDAD' } })).id_department;
    deptLogistica = (await prisma.department.create({ data: { department: 'LOGÍSTICA' } })).id_department;
    const lector = await prisma.user.create({ data: { email: LECTOR, name: 'Lectora Logística' } });
    await prisma.departmentUser.create({ data: { id_user: lector.id, id_department: deptLogistica } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011] las tablas del Sprint 1 viven en el esquema `sgc` y el trigger de auditoría existe', async () => {
    const rows = await prisma.$queryRaw<{ tabla: string; esquema: string }[]>`
      SELECT t.name AS tabla, s.name AS esquema FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name IN ('coding_guide','process_type','process_map','document_type','document','document_version','document_access','audit_log')`;
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.esquema))).toEqual(new Set(['sgc']));
    const trg = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*) AS n FROM sys.triggers WHERE name = 'audit_log_solo_insercion'`;
    expect(Number(trg[0].n)).toBe(1);
  });

  it('[SGC-REQ-012] los maestros de OLP se siembran con el SQL del pase, de forma idempotente y auditada', async () => {
    await prisma.$executeRawUnsafe(seedSql);
    await prisma.$executeRawUnsafe(seedSql);
    const cat = await getCatalogs(prisma, OLP);
    expect(cat.storageRoot).toBe('SGC/OLP');
    expect(cat.codingGuide).toMatchObject({ prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}', sequenceDigits: 3 });
    expect(cat.processTypes.map((t) => t.code)).toEqual(['E', 'M', 'S', 'F']);
    expect(cat.processes).toHaveLength(15);
    expect(cat.documentTypes.map((t) => t.code)).toEqual(['MA', 'PR', 'IN', 'FO', 'PT', 'PL', 'ES', 'AN']);
    expect(cat.documentTypes.every((t) => t.reviewMonths === 36 && t.alertMonths === 2 && t.requiresTraining)).toBe(true);
    const gc = cat.processes.find((p) => p.code === 'GC')!;
    expect(gc.idDepartment).toBe(deptCalidad);
    expect(cat.processes.find((p) => p.code === 'SI')!.idDepartment).toBeNull();
    procGC = gc.id;
    procLO = cat.processes.find((p) => p.code === 'LO')!.id;
    typePR = cat.documentTypes.find((t) => t.code === 'PR')!.id;
    typeMA = cat.documentTypes.find((t) => t.code === 'MA')!.id;
    const audits = await prisma.sgcAuditLog.count({ where: { id_company: OLP, action: { in: ['maestro.creado', 'guia_codificacion.editada'] } } });
    expect(audits).toBe(1 + 4 + 15 + 8);
    await expect(getCatalogs(prisma, 999)).rejects.toMatchObject({ status: 404 });
  });

  it('[SGC-REQ-013][SGC-REQ-014] la carga inicial genera el código con la guía y guarda el PDF en la carpeta propia por versión', async () => {
    const r1 = await createInitialDocument(prisma, upload, base(), actor);
    expect(r1.code).toBe('OLP-GC-PR-001');
    expect(r1.storagePath).toBe('SGC/OLP/PR/OLP-GC-PR-001/v1');
    expect(uploads.at(-1)).toMatchObject({ segments: ['SGC', 'OLP', 'PR', 'OLP-GC-PR-001', 'v1'], fileName: 'OLP-GC-PR-001 V1.pdf' });
    const r2 = await createInitialDocument(
      prisma,
      upload,
      { ...base(), title: 'Auditorías internas', versionNumber: 3, source: { bytes: new Uint8Array([0x50, 0x4b, 3, 4, 9]), fileName: 'aud.docx', contentType: 'application/octet-stream' } },
      actor
    );
    expect(r2.code).toBe('OLP-GC-PR-002');
    expect(uploads.at(-1)!.fileName).toBe('OLP-GC-PR-002 V3.docx');
    const v = await prisma.sgcDocumentVersion.findFirstOrThrow({ where: { id_document: r2.idDocument } });
    expect(v).toMatchObject({ version_number: 3, status: 'vigente', pdf_sha256: r2.pdfSha256, source_file_name: 'OLP-GC-PR-002 V3.docx' });
    expect(v.review_due_date?.toISOString().slice(0, 10)).toBe('2029-01-15');
    const doc = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: r2.idDocument } });
    expect(doc).toMatchObject({ status: 'vigente', current_version_id: v.id_document_version, sequence_number: 2, id_owner_department: deptCalidad });
    const audit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { action: 'documento.carga', entity_id: String(r2.idDocument) } });
    expect(audit).toMatchObject({ actor_email: CALIDAD, ip: '10.0.0.5', id_company: OLP });
    expect(audit.detail).toContain(r2.pdfSha256);
  });

  it('[SGC-REQ-013] un código existente se respeta y el consecutivo continúa después de él; no se duplica', async () => {
    const manual = await createInitialDocument(prisma, upload, { ...base(), title: 'Gestión de cambios', code: 'olp-gc-pr-010' }, actor);
    expect(manual.code).toBe('OLP-GC-PR-010');
    const next = await createInitialDocument(prisma, upload, { ...base(), title: 'Desviaciones' }, actor);
    expect(next.code).toBe('OLP-GC-PR-011');
    const before = uploads.length;
    await expect(createInitialDocument(prisma, upload, { ...base(), code: 'OLP-GC-PR-010' }, actor)).rejects.toMatchObject({ status: 409 });
    expect(uploads.length).toBe(before);
  });

  it('[SGC-REQ-014] valida todo ANTES de subir: PDF real, fecha no futura, proceso y tipo de la empresa, empresa activa', async () => {
    const before = uploads.length;
    await expect(createInitialDocument(prisma, upload, { ...base(), pdf: { bytes: new TextEncoder().encode('no soy pdf'), fileName: 'x.pdf' } }, actor)).rejects.toThrow('PDF');
    await expect(createInitialDocument(prisma, upload, { ...base(), effectiveDate: '2999-01-01' }, actor)).rejects.toThrow('futura');
    await expect(createInitialDocument(prisma, upload, { ...base(), effectiveDate: 'ayer' }, actor)).rejects.toThrow('fecha');
    await expect(createInitialDocument(prisma, upload, { ...base(), idProcess: 999999 }, actor)).rejects.toThrow('proceso');
    await expect(createInitialDocument(prisma, upload, { ...base(), idDocumentType: 999999 }, actor)).rejects.toThrow('tipo documental');
    await expect(createInitialDocument(prisma, upload, { ...base(), idCompany: FARMA }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(createInitialDocument(prisma, upload, { ...base(), title: 'x' }, actor)).rejects.toThrow('título');
    await expect(createInitialDocument(prisma, upload, { ...base(), confidentiality: 'secreta' }, actor)).rejects.toThrow('Confidencialidad');
    await expect(createInitialDocument(prisma, upload, { ...base(), versionNumber: 0 }, actor)).rejects.toThrow('versión');
    await expect(createInitialDocument(prisma, upload, { ...base(), code: 'CON' }, actor)).rejects.toThrow('reservado');
    await expect(createInitialDocument(prisma, upload, { ...base(), source: { bytes: new TextEncoder().encode('%PDF-'), fileName: 'x.docx', contentType: '' } }, actor)).rejects.toThrow('Word');
    const sinDueno = await prisma.sgcProcessMap.findFirstOrThrow({ where: { id_company: OLP, code: 'SI' } });
    await expect(createInitialDocument(prisma, upload, { ...base(), idProcess: sinDueno.id_process_map, confidentiality: 'departamento' }, actor)).rejects.toThrow('departamento dueño');
    expect(uploads.length).toBe(before);
  });

  it('[SGC-REQ-015][SGC-REQ-018] el listado maestro respeta confidencialidad y departamento; Calidad ve todo', async () => {
    const pub = await createInitialDocument(prisma, upload, { ...base(), idProcess: procLO, idDocumentType: typeMA, title: 'Manual de logística' }, actor);
    const deptLog = await createInitialDocument(prisma, upload, { ...base(), idProcess: procLO, title: 'Recepción técnica', confidentiality: 'departamento' }, actor);
    const deptCal = await createInitialDocument(prisma, upload, { ...base(), title: 'Liberación de lotes', confidentiality: 'departamento' }, actor);
    const conf = await createInitialDocument(prisma, upload, { ...base(), idProcess: procLO, title: 'Plan de contingencia', confidentiality: 'confidencial' }, actor);

    const subject = await getAccessSubject(prisma, LECTOR);
    expect(subject.departmentIds).toEqual([deptLogistica]);
    const visibles = (await listMasterDocuments(prisma, lectura, subject)).map((d) => d.code);
    expect(visibles).toContain(pub.code);
    expect(visibles).toContain(deptLog.code);
    expect(visibles).not.toContain(deptCal.code);
    expect(visibles).not.toContain(conf.code);
    expect(pub.code).toBe('OLP-LO-MA-001');

    await grantDocumentAccess(prisma, [calidad], conf.idDocument, { idDepartment: deptLogistica, reason: 'Contingencia del área de logística' }, actor);
    expect((await listMasterDocuments(prisma, lectura, subject)).map((d) => d.code)).toContain(conf.code);

    const item = (await listMasterDocuments(prisma, lectura, subject)).find((d) => d.code === pub.code)!;
    expect(item).toMatchObject({ versionNumber: 1, effectiveDate: '2026-01-15', reviewDueDate: '2029-01-15', processType: { code: 'M' }, documentType: { code: 'MA' } });

    const todos = await listMasterDocuments(prisma, calidad, { email: CALIDAD, departmentIds: [] }, { status: 'todos' });
    expect(todos.map((d) => d.code)).toEqual(expect.arrayContaining([pub.code, deptLog.code, deptCal.code, conf.code]));
  });

  it('[SGC-REQ-017][SGC-REQ-018] visor: solo la versión vigente de lo que se puede consultar; la ficha oculta rutas y accesos a quien no es de Calidad', async () => {
    const d = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: OLP, code: 'OLP-LO-MA-001' } });
    const subject = await getAccessSubject(prisma, LECTOR);
    const ok = await getVersionForViewer(prisma, [lectura], subject, d.id_document, d.current_version_id!);
    expect(ok?.permissions).toEqual({ canView: true, canDownload: false, canPrint: false, canAdminister: false });
    expect(await getVersionForViewer(prisma, [lectura], subject, d.id_document, 999999)).toBeNull();
    expect(await getVersionForViewer(prisma, [], subject, d.id_document, d.current_version_id!)).toBeNull();
    expect(await getVersionForViewer(prisma, [calidad], subject, d.id_document, 999999)).toBeNull();
    expect(await getVersionForViewer(prisma, [calidad], subject, 999999, 1)).toBeNull();
    const oculto = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: OLP, title: 'Liberación de lotes' } });
    expect(await getVersionForViewer(prisma, [lectura], subject, oculto.id_document, oculto.current_version_id!)).toBeNull();

    const fichaLector = await getDocumentDetail(prisma, [lectura], subject, d.id_document);
    expect(fichaLector?.versions[0].storagePath).toBeNull();
    expect(fichaLector?.accesses).toBeNull();
    const fichaCalidad = await getDocumentDetail(prisma, [calidad], subject, d.id_document);
    expect(fichaCalidad?.versions[0].storagePath).toBe('SGC/OLP/MA/OLP-LO-MA-001/v1/OLP-LO-MA-001 V1.pdf');
    expect(fichaCalidad?.accesses).toEqual([]);
    expect(await getDocumentDetail(prisma, [lectura], subject, oculto.id_document)).toBeNull();
    expect(await getDocumentDetail(prisma, [], subject, d.id_document)).toBeNull();
    expect(await getDocumentDetail(prisma, [lectura], subject, 0)).toBeNull();
  });

  it('[SGC-REQ-017] permisos excepcionales de descarga/impresión: vencen, se revocan y la fila no se borra', async () => {
    const d = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: OLP, code: 'OLP-LO-MA-001' } });
    const subject = await getAccessSubject(prisma, LECTOR);
    await expect(grantDocumentAccess(prisma, [calidad], d.id_document, { userEmail: LECTOR, canDownload: true, reason: 'Visita del INVIMA' }, actor)).rejects.toThrow('vencimiento');
    await expect(grantDocumentAccess(prisma, [lectura], d.id_document, { userEmail: LECTOR, reason: 'Visita del INVIMA' }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(grantDocumentAccess(prisma, [calidad], d.id_document, { idDepartment: 999999, reason: 'Visita del INVIMA' }, actor)).rejects.toThrow('no existe');
    await expect(grantDocumentAccess(prisma, [calidad], d.id_document, { userEmail: LECTOR, canPrint: true, expiresAt: 'mañana', reason: 'Visita del INVIMA' }, actor)).rejects.toThrow('vencimiento');
    const g = await grantDocumentAccess(
      prisma,
      [calidad],
      d.id_document,
      { userEmail: LECTOR.toUpperCase(), canDownload: true, canPrint: true, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), reason: 'Visita del INVIMA' },
      actor
    );
    expect(g.user_email).toBe(LECTOR);
    const conPermiso = await getVersionForViewer(prisma, [lectura], subject, d.id_document, d.current_version_id!);
    expect(conPermiso?.permissions).toMatchObject({ canDownload: true, canPrint: true });
    await expect(revokeDocumentAccess(prisma, [calidad], d.id_document, g.id_document_access, 'corto', actor)).rejects.toThrow('motivo');
    await revokeDocumentAccess(prisma, [calidad], d.id_document, g.id_document_access, 'Terminó la visita del INVIMA', actor);
    await expect(revokeDocumentAccess(prisma, [calidad], d.id_document, g.id_document_access, 'Terminó la visita del INVIMA', actor)).rejects.toMatchObject({ status: 409 });
    await expect(revokeDocumentAccess(prisma, [calidad], d.id_document, 999999, 'Terminó la visita del INVIMA', actor)).rejects.toMatchObject({ status: 404 });
    const sinPermiso = await getVersionForViewer(prisma, [lectura], subject, d.id_document, d.current_version_id!);
    expect(sinPermiso?.permissions).toMatchObject({ canDownload: false, canPrint: false });
    const fila = await prisma.sgcDocumentAccess.findUniqueOrThrow({ where: { id_document_access: g.id_document_access } });
    expect(fila.revoked_by).toBe(CALIDAD);
    const acciones = await prisma.sgcAuditLog.findMany({ where: { entity: 'document_access', entity_id: String(g.id_document_access) }, select: { action: true } });
    expect(acciones.map((a) => a.action).sort()).toEqual(['acceso.otorgado', 'acceso.revocado']);
  });

  it('[SGC-REQ-022] editar exige motivo y queda con antes/después; anular saca el documento del listado sin borrarlo', async () => {
    const d = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: OLP, title: 'Desviaciones' } });
    await expect(updateDocumentMetadata(prisma, [calidad], d.id_document, { title: 'Desviaciones y CAPA' }, actor)).rejects.toThrow('motivo');
    await expect(updateDocumentMetadata(prisma, [calidad], d.id_document, { reason: 'Nada que cambiar aquí' }, actor)).rejects.toThrow('No hay cambios');
    await expect(updateDocumentMetadata(prisma, [lectura], d.id_document, { title: 'x', reason: 'Corrección del título' }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(updateDocumentMetadata(prisma, [calidad], 999999, { title: 'x', reason: 'Corrección del título' }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(updateDocumentMetadata(prisma, [calidad], d.id_document, { title: 'x', reason: 'Corrección del título' }, actor)).rejects.toThrow('título');
    await expect(updateDocumentMetadata(prisma, [calidad], d.id_document, { confidentiality: 'secreta', reason: 'Corrección del título' }, actor)).rejects.toThrow('Confidencialidad');
    await expect(updateDocumentMetadata(prisma, [calidad], d.id_document, { idOwnerDepartment: 999999, reason: 'Corrección del dueño' }, actor)).rejects.toThrow('no existe');
    await expect(updateDocumentMetadata(prisma, [calidad], d.id_document, { confidentiality: 'departamento', idOwnerDepartment: null, reason: 'Corrección del dueño' }, actor)).rejects.toThrow('dueño');
    const saved = await updateDocumentMetadata(
      prisma,
      [calidad],
      d.id_document,
      { title: 'Desviaciones y CAPA', confidentiality: 'departamento', idOwnerDepartment: deptCalidad, reason: 'Ajuste pedido por Calidad' },
      actor
    );
    expect(saved).toMatchObject({ title: 'Desviaciones y CAPA', confidentiality: 'departamento' });
    const edit = await prisma.sgcAuditLog.findFirstOrThrow({ where: { action: 'documento.edicion', entity_id: String(d.id_document) } });
    expect(JSON.parse(edit.before_json!)).toMatchObject({ title: 'Desviaciones' });
    expect(JSON.parse(edit.after_json!)).toMatchObject({ title: 'Desviaciones y CAPA' });

    const pub = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: OLP, code: 'OLP-LO-MA-001' } });
    const subject = await getAccessSubject(prisma, LECTOR);
    await expect(annulDocument(prisma, [calidad], pub.id_document, 'x', actor)).rejects.toThrow('motivo');
    await annulDocument(prisma, [calidad], pub.id_document, 'Reemplazado por el manual integrado', actor);
    await expect(annulDocument(prisma, [calidad], pub.id_document, 'Reemplazado por el manual integrado', actor)).rejects.toMatchObject({ status: 409 });
    await expect(updateDocumentMetadata(prisma, [calidad], pub.id_document, { title: 'Otro título', reason: 'Intento sobre anulado' }, actor)).rejects.toMatchObject({ status: 409 });
    expect((await listMasterDocuments(prisma, lectura, subject)).map((x) => x.code)).not.toContain('OLP-LO-MA-001');
    const anulado = await prisma.sgcDocument.findUniqueOrThrow({ where: { id_document: pub.id_document } });
    expect(anulado).toMatchObject({ status: 'anulado', annulled_by: CALIDAD, annul_reason: 'Reemplazado por el manual integrado' });
    expect((await prisma.sgcDocumentVersion.findUniqueOrThrow({ where: { id_document_version: anulado.current_version_id! } })).status).toBe('anulado');
    const anulados = await listMasterDocuments(prisma, calidad, { email: CALIDAD, departmentIds: [] }, { status: 'anulado' });
    expect(anulados.map((x) => x.code)).toEqual(['OLP-LO-MA-001']);
  });

  it('[SGC-REQ-020] la auditoría es de solo inserción: UPDATE y DELETE los rechaza la base', async () => {
    const n = await prisma.sgcAuditLog.count();
    expect(n).toBeGreaterThan(0);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[audit_log] SET detail = N'alterado'`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM [sgc].[audit_log]`)).rejects.toThrow(/solo inserción/);
    await expect(prisma.sgcAuditLog.deleteMany({})).rejects.toThrow();
    expect(await prisma.sgcAuditLog.count()).toBe(n);
    const alterado = await prisma.sgcAuditLog.count({ where: { detail: 'alterado' } });
    expect(alterado).toBe(0);
  });

  it('[SGC-REQ-022] la base rechaza estados y confidencialidades fuera de la lista (no existe "eliminado")', async () => {
    const d = await prisma.sgcDocument.findFirstOrThrow({ where: { id_company: OLP } });
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[document] SET status = N'eliminado' WHERE id_document = ${d.id_document}`)).rejects.toThrow(/document_status_ck/);
    await expect(prisma.$executeRawUnsafe(`UPDATE [sgc].[document] SET confidentiality = N'secreta' WHERE id_document = ${d.id_document}`)).rejects.toThrow(/document_confidentiality_ck/);
  });

  it('[SGC-REQ-012][SGC-REQ-013] Calidad configura maestros y guía con motivo; lo que ya usan documentos no se recodifica', async () => {
    const noReason = saveCatalogEntry(prisma, OLP, 'process-types', { code: 'X', name: 'X' }, actor);
    await expect(noReason).rejects.toThrow('motivo');
    const reason = 'Ajuste de la estructura de procesos';
    const tipo = (await saveCatalogEntry(prisma, OLP, 'process-types', { code: 'EV', name: 'Evaluación', color: 'rojo-no-valido', reason }, actor)) as { id_process_type: number; color: string };
    expect(tipo.color).toBe('blue');
    await expect(saveCatalogEntry(prisma, OLP, 'process-types', { code: 'EV', name: 'Duplicado', reason }, actor)).rejects.toMatchObject({ status: 409 });
    await saveCatalogEntry(prisma, OLP, 'process-types', { id: tipo.id_process_type, code: 'EV', name: 'Evaluación y mejora', isActive: false, reason }, actor);
    await expect(saveCatalogEntry(prisma, OLP, 'process-types', { id: 999999, code: 'ZZ', name: 'x', reason }, actor)).rejects.toMatchObject({ status: 404 });
    expect((await getCatalogs(prisma, OLP)).processTypes.map((t) => t.code)).not.toContain('EV');
    expect((await getCatalogs(prisma, OLP, true)).processTypes.map((t) => t.code)).toContain('EV');

    const proc = (await saveCatalogEntry(prisma, OLP, 'processes', { idProcessType: tipo.id_process_type, code: 'AI', name: 'Auditoría interna', idDepartment: deptCalidad, reason }, actor)) as { id_process_map: number };
    await expect(saveCatalogEntry(prisma, OLP, 'processes', { idProcessType: 999999, code: 'AJ', name: 'x', reason }, actor)).rejects.toThrow('tipo de proceso');
    await expect(saveCatalogEntry(prisma, OLP, 'processes', { idProcessType: tipo.id_process_type, code: 'AJ', name: 'x', idDepartment: 999999, reason }, actor)).rejects.toThrow('departamento');
    await expect(saveCatalogEntry(prisma, OLP, 'processes', { idProcessType: tipo.id_process_type, code: 'aj-1', name: 'x', reason }, actor)).rejects.toThrow('Código');
    await expect(saveCatalogEntry(prisma, OLP, 'processes', { idProcessType: tipo.id_process_type, code: 'AJ', name: '', reason }, actor)).rejects.toThrow('nombre');
    await expect(saveCatalogEntry(prisma, OLP, 'processes', { idProcessType: tipo.id_process_type, code: 'AJ', name: 'x', sortOrder: -1, reason }, actor)).rejects.toThrow('orden');
    await saveCatalogEntry(prisma, OLP, 'processes', { id: proc.id_process_map, idProcessType: tipo.id_process_type, code: 'AU', name: 'Auditoría interna', reason }, actor);
    await expect(saveCatalogEntry(prisma, OLP, 'processes', { id: 999999, idProcessType: tipo.id_process_type, code: 'AU', name: 'x', reason }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(saveCatalogEntry(prisma, OLP, 'processes', { id: procGC, idProcessType: tipo.id_process_type, code: 'GQ', name: 'Gestión de calidad', reason }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(saveCatalogEntry(prisma, OLP, 'processes', { id: 'x', code: 'GQ', reason }, actor)).rejects.toThrow('Identificador');

    const dt = (await saveCatalogEntry(prisma, OLP, 'document-types', { code: 'GU', name: 'Guía', pluralName: 'Guías', reason }, actor)) as { id_document_type: number; review_months: number };
    expect(dt.review_months).toBe(36);
    await expect(saveCatalogEntry(prisma, OLP, 'document-types', { code: 'GV', name: 'x', pluralName: 'x', reviewMonths: 2, alertMonths: 2, reason }, actor)).rejects.toThrow('alerta');
    await saveCatalogEntry(prisma, OLP, 'document-types', { id: dt.id_document_type, code: 'GU', name: 'Guía técnica', pluralName: 'Guías técnicas', reviewMonths: 24, reason }, actor);
    await expect(saveCatalogEntry(prisma, OLP, 'document-types', { id: typePR, code: 'PX', name: 'Procedimiento', pluralName: 'Procedimientos', reason }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(saveCatalogEntry(prisma, OLP, 'document-types', { id: 999999, code: 'PX', name: 'x', pluralName: 'x', reason }, actor)).rejects.toMatchObject({ status: 404 });

    await expect(saveCatalogEntry(prisma, OLP, 'coding-guide', { prefix: 'OLP', pattern: '{PREFIJO}-{TIPO}', sequenceDigits: 3, reason }, actor)).rejects.toThrow('CONSECUTIVO');
    await saveCatalogEntry(prisma, OLP, 'coding-guide', { prefix: 'olp', pattern: '{PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}', sequenceDigits: 4, reason }, actor);
    const guide = (await getCatalogs(prisma, OLP)).codingGuide!;
    expect(guide).toMatchObject({ prefix: 'OLP', sequenceDigits: 4, updatedBy: CALIDAD });
    const r = await createInitialDocument(prisma, upload, { ...base(), title: 'Con guía de 4 dígitos' }, actor);
    expect(r.code).toBe('OLP-GC-PR-0012');
    const cambios = await prisma.sgcAuditLog.count({ where: { action: { in: ['maestro.creado', 'maestro.editado', 'guia_codificacion.editada'] }, actor_email: CALIDAD } });
    expect(cambios).toBe(7);
  });

  it('[SGC-REQ-013] sin guía de codificación hay que indicar el código', async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: FARMA }, data: { is_active: true } });
    await prisma.$executeRawUnsafe(seedSql.replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${FARMA};`));
    await prisma.$executeRawUnsafe(`DELETE FROM [sgc].[coding_guide] WHERE id_company = ${FARMA}`);
    const cat = await getCatalogs(prisma, FARMA);
    const input = { ...base(), idCompany: FARMA, idProcess: cat.processes[0].id, idDocumentType: cat.documentTypes[0].id };
    await expect(createInitialDocument(prisma, upload, input, actor)).rejects.toThrow('guía de codificación');
    const r = await createInitialDocument(prisma, upload, { ...input, code: 'FAR-GE-MA-001' }, actor);
    expect(r.storagePath).toBe('SGC/FARMALOGICA/MA/FAR-GE-MA-001/v1');
    await prisma.sgcCompanyConfig.update({ where: { id_company: FARMA }, data: { is_active: false } });
  });
});

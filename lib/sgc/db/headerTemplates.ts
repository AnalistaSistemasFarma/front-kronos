import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError, isUniqueViolation } from '../errors';
import {
  SGC_DEFAULT_HEADER_TEMPLATE,
  describeHeaderTemplateChanges,
  normalizeHeaderTemplateCode,
  normalizeHeaderTemplateConfig,
  parseHeaderTemplateConfig,
  resolveHeaderTemplate,
  type SgcHeaderTemplateConfig,
} from '../headerTemplates';
import { decodeLogoDataUrl, drawInstitutionalHeaders } from '../pdf/institutional';
import type { SgcActor, SgcDb } from './catalogs';
import { requireReason, writeConfigChange } from './flows';

/**
 * PLANTILLAS DE ENCABEZADO (S16, R31; D20). Ver lib/sgc/headerTemplates.ts.
 * Solo Aseguramiento de Calidad las administra (la ruta lo verifica). Cada
 * cambio pide motivo y queda en sgc.config_change_log (antes y después) y en
 * sgc.audit_log. Las plantillas no se borran: se desactivan. Los documentos
 * vigentes no cambian: su encabezado ya quedó compuesto en el PDF controlado.
 */

type Tx = Prisma.TransactionClient;
type Db = SgcDb | Tx;

export interface SgcHeaderTemplateRow {
  id: number;
  code: string;
  name: string;
  config: SgcHeaderTemplateConfig;
  isDefault: boolean;
  isActive: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
  documentTypes: { id: number; code: string; name: string }[];
}

export async function listHeaderTemplates(db: Db, idCompany: number): Promise<SgcHeaderTemplateRow[]> {
  const rows = await db.sgcHeaderTemplate.findMany({ where: { id_company: idCompany }, include: { documentTypes: { select: { id_document_type: true, code: true, name: true } } }, orderBy: [{ is_default: 'desc' }, { name: 'asc' }] });
  return rows.map((r) => ({
    id: r.id_header_template,
    code: r.code,
    name: r.name,
    config: parseHeaderTemplateConfig(r.config_json),
    isDefault: r.is_default,
    isActive: r.is_active,
    version: r.version,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at.toISOString(),
    documentTypes: r.documentTypes.map((t) => ({ id: t.id_document_type, code: t.code, name: t.name })),
  }));
}

/** Plantilla que usa un tipo documental (la suya, la por defecto o la institucional de siempre). */
export async function headerTemplateForType(db: Db, idCompany: number, idDocumentType: number | null): Promise<{ config: SgcHeaderTemplateConfig; ref: { id: number; code: string; version: number } | null }> {
  const [templates, type] = await Promise.all([
    db.sgcHeaderTemplate.findMany({ where: { id_company: idCompany }, select: { id_header_template: true, code: true, version: true, is_active: true, is_default: true, config_json: true } }),
    idDocumentType ? db.sgcDocumentType.findFirst({ where: { id_document_type: idDocumentType, id_company: idCompany }, select: { id_header_template: true } }) : null,
  ]);
  const chosen = resolveHeaderTemplate(
    templates.map((t) => ({ id: t.id_header_template, isActive: t.is_active, isDefault: t.is_default, row: t })),
    type?.id_header_template ?? null
  );
  if (!chosen) return { config: { ...SGC_DEFAULT_HEADER_TEMPLATE }, ref: null };
  return { config: parseHeaderTemplateConfig(chosen.row.config_json), ref: { id: chosen.row.id_header_template, code: chosen.row.code, version: chosen.row.version } };
}

export interface SgcHeaderTemplateInput {
  id?: unknown;
  code?: unknown;
  name?: unknown;
  config?: unknown;
  isActive?: unknown;
  isDefault?: unknown;
  reason?: unknown;
}

/** Crea o edita una plantilla (con motivo). Editar sube la versión. */
export async function saveHeaderTemplate(db: SgcDb, idCompany: number, input: SgcHeaderTemplateInput, actor: SgcActor) {
  const reason = requireReason(input.reason);
  const config = normalizeHeaderTemplateConfig(input.config);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 3 || name.length > 150) throw new SgcError('El nombre de la plantilla es obligatorio (3 a 150 caracteres).');
  const id = input.id === undefined || input.id === null || input.id === '' ? null : Number(input.id);
  const now = new Date();
  try {
    return await db.$transaction(async (tx) => {
      if (id === null) {
        const code = normalizeHeaderTemplateCode(input.code);
        const isDefault = input.isDefault === true || (await tx.sgcHeaderTemplate.count({ where: { id_company: idCompany, is_default: true } })) === 0;
        if (isDefault) await tx.sgcHeaderTemplate.updateMany({ where: { id_company: idCompany, is_default: true }, data: { is_default: false, updated_by: actor.email, updated_at: now } });
        const row = await tx.sgcHeaderTemplate.create({ data: { id_company: idCompany, code, name, config_json: JSON.stringify(config), is_default: isDefault, is_active: true, version: 1, created_by: actor.email, updated_by: actor.email, updated_at: now } });
        await writeConfigChange(tx, { idCompany, entity: 'header_template', entityId: row.id_header_template, action: 'encabezado.plantilla_creada', reason, after: { code, name, config, isDefault } }, actor);
        await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.encabezadoPlantilla, entity: 'header_template', entityId: row.id_header_template, after: { code, name, isDefault, version: 1 }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
        return { id: row.id_header_template, version: 1 };
      }
      const current = await tx.sgcHeaderTemplate.findFirst({ where: { id_header_template: id, id_company: idCompany } });
      if (!current) throw new SgcError('Plantilla no encontrada.', 404);
      const before = parseHeaderTemplateConfig(current.config_json);
      const isActive = input.isActive === undefined ? current.is_active : Boolean(input.isActive);
      if (!isActive && current.is_default) throw new SgcError('La plantilla por defecto no se desactiva: marque otra como por defecto primero.', 409);
      const changes = describeHeaderTemplateChanges(before, config);
      const configChanged = JSON.stringify(before) !== JSON.stringify(config);
      if (!configChanged && name === current.name && isActive === current.is_active) throw new SgcError('No hay cambios para guardar.');
      const version = configChanged ? current.version + 1 : current.version;
      await tx.sgcHeaderTemplate.update({ where: { id_header_template: id }, data: { name, config_json: JSON.stringify(config), is_active: isActive, version, updated_by: actor.email, updated_at: now } });
      await writeConfigChange(
        tx,
        { idCompany, entity: 'header_template', entityId: id, action: 'encabezado.plantilla_editada', reason, before: { name: current.name, config: before, isActive: current.is_active, version: current.version }, after: { name, config, isActive, version, cambios: changes } },
        actor
      );
      await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.encabezadoPlantilla, entity: 'header_template', entityId: id, before: { version: current.version, isActive: current.is_active }, after: { version, isActive, cambios: changes }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
      return { id, version };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SgcError('Ya existe una plantilla con ese código en la empresa.', 409);
    throw error;
  }
}

/** Marca la plantilla por defecto de la empresa (la usan los tipos sin plantilla propia). */
export async function setDefaultHeaderTemplate(db: SgcDb, idCompany: number, idTemplate: number, input: { reason?: unknown }, actor: SgcActor) {
  const reason = requireReason(input.reason);
  return db.$transaction(async (tx) => {
    const row = await tx.sgcHeaderTemplate.findFirst({ where: { id_header_template: idTemplate, id_company: idCompany } });
    if (!row) throw new SgcError('Plantilla no encontrada.', 404);
    if (!row.is_active) throw new SgcError('Active la plantilla antes de marcarla por defecto.', 409);
    if (row.is_default) throw new SgcError('Esa plantilla ya es la por defecto.', 409);
    const previous = await tx.sgcHeaderTemplate.findFirst({ where: { id_company: idCompany, is_default: true } });
    const now = new Date();
    await tx.sgcHeaderTemplate.updateMany({ where: { id_company: idCompany, is_default: true }, data: { is_default: false, updated_by: actor.email, updated_at: now } });
    await tx.sgcHeaderTemplate.update({ where: { id_header_template: idTemplate }, data: { is_default: true, updated_by: actor.email, updated_at: now } });
    await writeConfigChange(tx, { idCompany, entity: 'header_template', entityId: idTemplate, action: 'encabezado.plantilla_por_defecto', reason, before: { porDefecto: previous?.code ?? null }, after: { porDefecto: row.code } }, actor);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.encabezadoPlantilla, entity: 'header_template', entityId: idTemplate, before: { porDefecto: previous?.code ?? null }, after: { porDefecto: row.code }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { default: row.code };
  });
}

/** Datos de ejemplo de la vista previa (no corresponden a ningún documento real). */
const SAMPLE = {
  title: 'Nombre del documento de ejemplo',
  code: 'XXX-PR-001',
  versionLabel: '1',
  process: 'XX · Proceso de ejemplo',
  documentType: 'Procedimiento',
  elaboro: ['Persona que elabora'],
  reviso: ['Persona que revisa'],
  aprobo: ['Líder que aprueba'],
  emissionText: 'AAAA-MM-DD',
};

/** VISTA PREVIA de una plantilla (guardada o en edición) sobre dos páginas de ejemplo, con el logo de la empresa. */
export async function buildHeaderTemplatePreview(db: Db, idCompany: number, input: { idTemplate?: number | null; config?: unknown }): Promise<Uint8Array> {
  let config: SgcHeaderTemplateConfig = { ...SGC_DEFAULT_HEADER_TEMPLATE };
  if (input.config !== undefined && input.config !== null) config = normalizeHeaderTemplateConfig(input.config);
  else if (input.idTemplate) {
    const row = await db.sgcHeaderTemplate.findFirst({ where: { id_header_template: input.idTemplate, id_company: idCompany } });
    if (!row) throw new SgcError('Plantilla no encontrada.', 404);
    config = parseHeaderTemplateConfig(row.config_json);
  }
  const company = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { logo_data_url: true, company: { select: { company: true } } } });
  if (!company) throw new SgcError('La empresa no tiene el SGC activo.', 404);
  const pdf = await PDFDocument.create();
  const pages = [pdf.addPage([595.28, 841.89]), pdf.addPage([595.28, 841.89])];
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  await drawInstitutionalHeaders(pdf, pages, { ...SAMPLE, company: company.company.company, logo: decodeLogoDataUrl(company.logo_data_url), template: config }, fonts);
  pages.forEach((p) => p.drawText('Vista previa del encabezado (datos de ejemplo) · SynerLink', { x: 60, y: 420, size: 10, font: fonts.regular }));
  return pdf.save();
}

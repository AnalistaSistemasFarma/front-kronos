import type { PrismaClient } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { getMasterCodeError, parseChildTypeCodes, validateCodingGuide } from '../coding';
import { parentTypeCodesOf } from '../hierarchy';
import { SgcError, isUniqueViolation } from '../errors';
import { normalizeDraftExtensions, parseDraftExtensions } from '../headerTemplates';

/**
 * Maestros del SGC por empresa (lectura y configuración por Calidad):
 * guía de codificación, tipos de proceso, procesos y tipos documentales.
 *
 * Cada cambio exige motivo y queda en sgc.audit_log con el antes/después
 * (control de cambios). Nada se borra: los maestros se desactivan.
 */

export type SgcDb = PrismaClient;

export interface SgcActor {
  email: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface SgcCatalogs {
  idCompany: number;
  storageRoot: string;
  codingGuide: {
    prefix: string;
    pattern: string;
    sequenceDigits: number;
    /** Sprint 8: herencia del número del documento padre (null = sin herencia). */
    childPattern: string | null;
    childTypeCodes: string[];
    childSequenceDigits: number | null;
    updatedBy: string | null;
    updatedAt: string;
  } | null;
  processTypes: { id: number; code: string; name: string; color: string; sortOrder: number; isActive: boolean }[];
  processes: {
    id: number;
    idProcessType: number;
    code: string;
    name: string;
    idDepartment: number | null;
    department: string | null;
    sortOrder: number;
    isActive: boolean;
  }[];
  documentTypes: {
    id: number;
    code: string;
    name: string;
    pluralName: string;
    requiresTraining: boolean;
    reviewMonths: number;
    alertMonths: number;
    sortOrder: number;
    isActive: boolean;
    /** S16 (R31): plantilla de encabezado del tipo (null = la por defecto de la empresa). */
    idHeaderTemplate: number | null;
    /** S16 (R32): formatos admitidos para el borrador («docx», «xlsx»). */
    draftExtensions: string[];
    generatorGuide: boolean;
    /** 2026-10-19: tipo «padre» marcado en Configuración (sus documentos no tienen padre). */
    isParentType: boolean;
  }[];
  /** 2026-10-19: códigos de los tipos padre en efecto (los marcados o, sin marca, el procedimiento). */
  parentTypeCodes: string[];
  departments: { id: number; name: string }[];
}

/** Maestros de la empresa. Sin `includeInactive` solo trae los activos. */
export async function getCatalogs(db: SgcDb, idCompany: number, includeInactive = false): Promise<SgcCatalogs> {
  const active = includeInactive ? {} : { is_active: true };
  const [config, guide, types, processes, docTypes, departments] = await Promise.all([
    db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany } }),
    db.sgcCodingGuide.findUnique({ where: { id_company: idCompany } }),
    db.sgcProcessType.findMany({ where: { id_company: idCompany, ...active }, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] }),
    db.sgcProcessMap.findMany({
      where: { id_company: idCompany, ...active },
      include: { department: { select: { department: true } } },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    }),
    db.sgcDocumentType.findMany({ where: { id_company: idCompany, ...active }, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] }),
    db.department.findMany({ select: { id_department: true, department: true }, orderBy: { department: 'asc' } }),
  ]);
  if (!config) throw new SgcError('La empresa no está configurada en el SGC.', 404);

  return {
    idCompany,
    storageRoot: config.storage_root,
    codingGuide: guide
      ? {
          prefix: guide.prefix,
          pattern: guide.pattern,
          sequenceDigits: guide.sequence_digits,
          childPattern: guide.child_pattern ?? null,
          childTypeCodes: parseChildTypeCodes(guide.child_type_codes ?? ''),
          childSequenceDigits: guide.child_sequence_digits ?? null,
          updatedBy: guide.updated_by,
          updatedAt: guide.updated_at.toISOString(),
        }
      : null,
    processTypes: types.map((t) => ({
      id: t.id_process_type,
      code: t.code,
      name: t.name,
      color: t.color,
      sortOrder: t.sort_order,
      isActive: t.is_active,
    })),
    processes: processes.map((p) => ({
      id: p.id_process_map,
      idProcessType: p.id_process_type,
      code: p.code,
      name: p.name,
      idDepartment: p.id_department,
      department: p.department?.department ?? null,
      sortOrder: p.sort_order,
      isActive: p.is_active,
    })),
    documentTypes: docTypes.map((d) => ({
      id: d.id_document_type,
      code: d.code,
      name: d.name,
      pluralName: d.plural_name,
      requiresTraining: d.requires_training,
      reviewMonths: d.review_months,
      alertMonths: d.alert_months,
      sortOrder: d.sort_order,
      isActive: d.is_active,
      idHeaderTemplate: d.id_header_template,
      draftExtensions: parseDraftExtensions(d.draft_extensions),
      generatorGuide: d.generator_guide,
      isParentType: d.is_parent_type,
    })),
    parentTypeCodes: parentTypeCodesOf(docTypes.filter((d) => d.is_active).map((d) => ({ code: d.code, name: d.name, isParentType: d.is_parent_type }))),
    departments: departments.map((d) => ({ id: d.id_department, name: d.department })),
  };
}

// ---------------------------------------------------------------------------
// Configuración (solo Calidad; la ruta verifica el permiso).
// ---------------------------------------------------------------------------

export type SgcCatalogEntity = 'coding-guide' | 'process-types' | 'processes' | 'document-types';

export const SGC_CATALOG_ENTITIES: readonly SgcCatalogEntity[] = ['coding-guide', 'process-types', 'processes', 'document-types'];

const COLORS = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'grape', 'violet', 'indigo', 'cyan', 'gray'] as const;

function reqText(value: unknown, label: string, max: number): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new SgcError(`${label} es obligatorio.`);
  if (s.length > max) throw new SgcError(`${label} admite máximo ${max} caracteres.`);
  return s;
}

function intOr(value: unknown, fallback: number, label: string, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new SgcError(`${label} debe ser un entero entre ${min} y ${max}.`);
  return n;
}

function masterCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const error = getMasterCodeError(code);
  if (error) throw new SgcError(`Código: ${error}`);
  return code;
}

function reasonOf(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 10) throw new SgcError('Explique el motivo del cambio (mínimo 10 caracteres): queda en el control de cambios.');
  return reason.slice(0, 1000);
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Crea (sin `id`) o edita (con `id`) un maestro de la empresa. Devuelve el
 * registro guardado. Toda edición exige `reason` y queda auditada.
 */
export async function saveCatalogEntry(
  db: SgcDb,
  idCompany: number,
  entity: SgcCatalogEntity,
  body: Record<string, unknown>,
  actor: SgcActor
): Promise<unknown> {
  const reason = reasonOf(body.reason);
  const id = body.id === undefined || body.id === null ? null : Number(body.id);
  if (id !== null && (!Number.isInteger(id) || id < 1)) throw new SgcError('Identificador inválido.');

  try {
    return await db.$transaction(async (tx) => {
      const audit = (action: (typeof SGC_AUDIT_ACTIONS)[keyof typeof SGC_AUDIT_ACTIONS], entityName: string, entityId: number | string, before: unknown, after: unknown) =>
        writeSgcAudit(tx, {
          idCompany,
          actorEmail: actor.email,
          action,
          entity: entityName,
          entityId,
          before,
          after,
          detail: reason,
          ip: actor.ip,
          userAgent: actor.userAgent,
        });

      if (entity === 'coding-guide') {
        // Sprint 8: herencia del número del padre (opcional; patrón vacío = sin herencia).
        const childPattern = typeof body.childPattern === 'string' && body.childPattern.trim() ? body.childPattern.trim() : null;
        const guide = {
          prefix: typeof body.prefix === 'string' ? body.prefix.trim().toUpperCase() : '',
          pattern: typeof body.pattern === 'string' ? body.pattern.trim() : '',
          sequenceDigits: Number(body.sequenceDigits),
          childPattern,
          childTypeCodes: childPattern ? parseChildTypeCodes(body.childTypeCodes as string | string[] | null) : [],
          childSequenceDigits: childPattern ? Number(body.childSequenceDigits ?? 2) : null,
        };
        const errors = validateCodingGuide(guide);
        if (errors.length) throw new SgcError(errors.join(' '));
        const before = await tx.sgcCodingGuide.findUnique({ where: { id_company: idCompany } });
        const data = {
          prefix: guide.prefix,
          pattern: guide.pattern,
          sequence_digits: guide.sequenceDigits,
          child_pattern: guide.childPattern,
          child_type_codes: guide.childPattern ? guide.childTypeCodes.join(',') : null,
          child_sequence_digits: guide.childSequenceDigits,
          updated_by: actor.email,
          change_reason: reason,
        };
        const saved = await tx.sgcCodingGuide.upsert({
          where: { id_company: idCompany },
          create: { id_company: idCompany, ...data },
          update: data,
        });
        await audit(SGC_AUDIT_ACTIONS.guiaCodificacionEditada, 'coding_guide', idCompany, before, saved);
        return saved;
      }

      if (entity === 'process-types') {
        const data = {
          code: masterCode(body.code),
          name: reqText(body.name, 'El nombre', 150),
          color: COLORS.includes(body.color as (typeof COLORS)[number]) ? (body.color as string) : 'blue',
          sort_order: intOr(body.sortOrder, 0, 'El orden', 0, 999),
          is_active: boolOr(body.isActive, true),
        };
        if (id === null) {
          const saved = await tx.sgcProcessType.create({ data: { id_company: idCompany, ...data } });
          await audit(SGC_AUDIT_ACTIONS.maestroCreado, 'process_type', saved.id_process_type, null, saved);
          return saved;
        }
        const before = await tx.sgcProcessType.findFirst({ where: { id_process_type: id, id_company: idCompany } });
        if (!before) throw new SgcError('Tipo de proceso no encontrado.', 404);
        const saved = await tx.sgcProcessType.update({ where: { id_process_type: id }, data });
        await audit(SGC_AUDIT_ACTIONS.maestroEditado, 'process_type', id, before, saved);
        return saved;
      }

      if (entity === 'processes') {
        const idProcessType = Number(body.idProcessType);
        const type = await tx.sgcProcessType.findFirst({ where: { id_process_type: idProcessType, id_company: idCompany } });
        if (!type) throw new SgcError('Seleccione un tipo de proceso de la empresa.');
        const idDepartment = body.idDepartment === undefined || body.idDepartment === null || body.idDepartment === '' ? null : Number(body.idDepartment);
        if (idDepartment !== null) {
          const dept = await tx.department.findUnique({ where: { id_department: idDepartment } });
          if (!dept) throw new SgcError('El departamento no existe.');
        }
        const data = {
          id_process_type: idProcessType,
          code: masterCode(body.code),
          name: reqText(body.name, 'El nombre', 200),
          id_department: idDepartment,
          sort_order: intOr(body.sortOrder, 0, 'El orden', 0, 999),
          is_active: boolOr(body.isActive, true),
        };
        if (id === null) {
          const saved = await tx.sgcProcessMap.create({ data: { id_company: idCompany, ...data } });
          await audit(SGC_AUDIT_ACTIONS.maestroCreado, 'process_map', saved.id_process_map, null, saved);
          return saved;
        }
        const before = await tx.sgcProcessMap.findFirst({ where: { id_process_map: id, id_company: idCompany } });
        if (!before) throw new SgcError('Proceso no encontrado.', 404);
        if (before.code !== data.code) await assertCodeUnused(tx, idCompany, 'process', id);
        const saved = await tx.sgcProcessMap.update({ where: { id_process_map: id }, data });
        await audit(SGC_AUDIT_ACTIONS.maestroEditado, 'process_map', id, before, saved);
        return saved;
      }

      // document-types
      const data = {
        code: masterCode(body.code),
        name: reqText(body.name, 'El nombre', 100),
        plural_name: reqText(body.pluralName, 'El nombre en plural', 100),
        requires_training: boolOr(body.requiresTraining, true),
        review_months: intOr(body.reviewMonths, 36, 'Los meses de revisión', 1, 120),
        alert_months: intOr(body.alertMonths, 2, 'Los meses de alerta', 0, 24),
        sort_order: intOr(body.sortOrder, 0, 'El orden', 0, 999),
        is_active: boolOr(body.isActive, true),
      };
      if (data.alert_months >= data.review_months) throw new SgcError('La alerta debe ser menor que el periodo de revisión.');
      // S16 (R31 y R32): plantilla de encabezado y formatos del borrador del tipo (si llegan).
      const extra: { id_header_template?: number | null; draft_extensions?: string | null; generator_guide?: boolean; is_parent_type?: boolean } = {};
      if (body.idHeaderTemplate !== undefined) {
        const idTemplate = body.idHeaderTemplate === null || body.idHeaderTemplate === '' ? null : Number(body.idHeaderTemplate);
        if (idTemplate !== null) {
          const tpl = Number.isInteger(idTemplate) ? await tx.sgcHeaderTemplate.findFirst({ where: { id_header_template: idTemplate, id_company: idCompany } }) : null;
          if (!tpl) throw new SgcError('Plantilla de encabezado no encontrada.', 404);
          if (!tpl.is_active) throw new SgcError('Esa plantilla de encabezado está inactiva.', 409);
        }
        extra.id_header_template = idTemplate;
      }
      if (body.draftExtensions !== undefined) extra.draft_extensions = normalizeDraftExtensions(body.draftExtensions);
      // S19 (R34): tipo de plantillas guía del Generador (sin codificación).
      if (body.generatorGuide !== undefined) extra.generator_guide = boolOr(body.generatorGuide, false);
      // 2026-10-19: tipo «padre» (procedimiento): sus documentos no tienen padre.
      if (body.isParentType !== undefined) extra.is_parent_type = boolOr(body.isParentType, false);
      if (id === null) {
        const saved = await tx.sgcDocumentType.create({ data: { id_company: idCompany, ...data, ...extra } });
        await audit(SGC_AUDIT_ACTIONS.maestroCreado, 'document_type', saved.id_document_type, null, saved);
        return saved;
      }
      const before = await tx.sgcDocumentType.findFirst({ where: { id_document_type: id, id_company: idCompany } });
      if (!before) throw new SgcError('Tipo documental no encontrado.', 404);
      if (before.code !== data.code) await assertCodeUnused(tx, idCompany, 'documentType', id);
      const saved = await tx.sgcDocumentType.update({ where: { id_document_type: id }, data: { ...data, ...extra } });
      await audit(SGC_AUDIT_ACTIONS.maestroEditado, 'document_type', id, before, saved);
      // S16: el cambio de plantilla o de formatos del borrador queda también en el control de cambios (con motivo).
      if (('id_header_template' in extra && extra.id_header_template !== before.id_header_template) || ('draft_extensions' in extra && extra.draft_extensions !== before.draft_extensions)) {
        await tx.sgcConfigChangeLog.create({
          data: {
            id_company: idCompany,
            actor_email: actor.email,
            entity: 'document_type',
            entity_id: String(id),
            action: 'tipo_documental.encabezado_formatos',
            reason,
            before_json: JSON.stringify({ idHeaderTemplate: before.id_header_template, draftExtensions: before.draft_extensions }),
            after_json: JSON.stringify({ idHeaderTemplate: saved.id_header_template, draftExtensions: saved.draft_extensions }),
            ip: actor.ip ?? null,
            user_agent: actor.userAgent ?? null,
          },
        });
      }
      // S19 (R34): marcar o desmarcar un tipo como plantilla guía del Generador queda en el control de cambios (con motivo).
      if ('generator_guide' in extra && extra.generator_guide !== before.generator_guide) {
        await tx.sgcConfigChangeLog.create({
          data: {
            id_company: idCompany,
            actor_email: actor.email,
            entity: 'document_type',
            entity_id: String(id),
            action: 'tipo_documental.generador_guia',
            reason,
            before_json: JSON.stringify({ generatorGuide: before.generator_guide }),
            after_json: JSON.stringify({ generatorGuide: saved.generator_guide }),
            ip: actor.ip ?? null,
            user_agent: actor.userAgent ?? null,
          },
        });
      }
      // 2026-10-19: marcar o desmarcar un tipo como «padre» queda en el control de cambios (con motivo).
      if ('is_parent_type' in extra && extra.is_parent_type !== before.is_parent_type) {
        if (extra.is_parent_type) {
          // Un tipo cuyos documentos ya cuelgan de un padre no puede volverse padre (el padre no tiene padre).
          const conPadre = await tx.sgcDocumentRelation.count({
            where: {
              id_company: idCompany,
              is_active: true,
              OR: [
                { relation_type: 'procedimiento_padre', target: { id_document_type: id } },
                { relation_type: { in: ['formato', 'anexo'] }, source: { id_document_type: id } },
              ],
            },
          });
          if (conPadre > 0) throw new SgcError(`Hay ${conPadre} documento(s) de este tipo que ya tienen documento padre: retire esas relaciones antes de marcarlo como tipo padre (el documento padre no tiene padre).`, 409);
        }
        await tx.sgcConfigChangeLog.create({
          data: {
            id_company: idCompany,
            actor_email: actor.email,
            entity: 'document_type',
            entity_id: String(id),
            action: 'tipo_documental.tipo_padre',
            reason,
            before_json: JSON.stringify({ isParentType: before.is_parent_type }),
            after_json: JSON.stringify({ isParentType: saved.is_parent_type }),
            ip: actor.ip ?? null,
            user_agent: actor.userAgent ?? null,
          },
        });
      }
      return saved;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SgcError('Ya existe un registro con ese código en la empresa.', 409);
    throw error;
  }
}

/**
 * El código de un proceso o tipo documental hace parte de los códigos de los
 * documentos: si ya tiene documentos, cambiarlo los dejaría inconsistentes.
 */
async function assertCodeUnused(
  tx: Pick<SgcDb, 'sgcDocument'>,
  idCompany: number,
  kind: 'process' | 'documentType',
  id: number
): Promise<void> {
  const where = kind === 'process' ? { id_company: idCompany, id_process_map: id } : { id_company: idCompany, id_document_type: id };
  const count = await tx.sgcDocument.count({ where });
  if (count > 0) {
    throw new SgcError('No se puede cambiar el código: ya hay documentos que lo usan. Cree uno nuevo y desactive este.', 409);
  }
}

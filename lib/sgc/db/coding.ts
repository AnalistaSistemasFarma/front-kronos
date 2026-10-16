import type { Prisma } from '../../../app/generated/prisma';
import {
  buildChildCode,
  buildChildCodeRoot,
  buildCodeRoot,
  buildDocumentCode,
  inheritsParentNumber,
  nextChildSequence,
  nextSequence,
  parseChildTypeCodes,
  type SgcCodingGuideInput,
  type SgcParentCode,
} from '../coding';
import { SgcError } from '../errors';
import type { SgcDb } from './catalogs';

/**
 * CÓDIGO DE UN DOCUMENTO NUEVO (Sprint 8): con la guía de codificación de la
 * empresa y, si el tipo documental HEREDA el número del documento padre
 * (formatos e instructivos de un procedimiento, codificación de OLP), con el
 * patrón de herencia. Una sola regla para la carga inicial, la vista previa y
 * la aprobación final.
 */

type Db = SgcDb | Prisma.TransactionClient;

/** Guía de la base → entrada de las funciones puras. */
export function guideInputOf(guide: { prefix: string; pattern: string; sequence_digits: number; child_pattern?: string | null; child_type_codes?: string | null; child_sequence_digits?: number | null }): SgcCodingGuideInput {
  return {
    prefix: guide.prefix,
    pattern: guide.pattern,
    sequenceDigits: guide.sequence_digits,
    childPattern: guide.child_pattern ?? null,
    childTypeCodes: parseChildTypeCodes(guide.child_type_codes ?? ''),
    childSequenceDigits: guide.child_sequence_digits ?? null,
  };
}

export interface SgcNewCodeInput {
  idCompany: number;
  processTypeCode: string;
  processCode: string;
  documentTypeCode: string;
  /** Documento padre (si el tipo hereda su número). */
  idParentDocument?: number | null;
}

/** Documento padre válido de la empresa (vigente o pendiente de archivo) con lo necesario para heredar su número. */
export async function loadParentDocument(db: Db, idCompany: number, idParentDocument: number): Promise<SgcParentCode & { idDocument: number }> {
  const parent = Number.isInteger(idParentDocument)
    ? await db.sgcDocument.findFirst({
        where: { id_document: idParentDocument, id_company: idCompany, status: { in: ['vigente', 'pendiente_archivo'] } },
        include: { process: { include: { processType: true } }, documentType: true },
      })
    : null;
  if (!parent) throw new SgcError('El documento padre debe ser un documento vigente (o pendiente de archivo) de la empresa.');
  return {
    idDocument: parent.id_document,
    code: parent.code,
    sequence: parent.sequence_number,
    parts: { processTypeCode: parent.process.processType.code, processCode: parent.process.code, documentTypeCode: parent.documentType.code },
  };
}

/**
 * Siguiente código libre. Devuelve también el consecutivo (null si el código
 * es de un hijo: su consecutivo es propio del padre, no de la serie).
 */
export async function resolveNewDocumentCode(db: Db, input: SgcNewCodeInput): Promise<{ code: string; sequence: number | null; inherited: boolean }> {
  const row = await db.sgcCodingGuide.findUnique({ where: { id_company: input.idCompany } });
  if (!row) throw new SgcError('La empresa no tiene guía de codificación: configúrela para generar el código del documento nuevo.', 409);
  const g = guideInputOf(row);
  const parts = { processTypeCode: input.processTypeCode, processCode: input.processCode, documentTypeCode: input.documentTypeCode };
  if (inheritsParentNumber(g, input.documentTypeCode)) {
    if (!input.idParentDocument) {
      throw new SgcError(`El tipo documental ${input.documentTypeCode} hereda el número de su documento padre (guía de codificación): indique el documento padre.`, 409);
    }
    const parent = await loadParentDocument(db, input.idCompany, input.idParentDocument);
    let root: string;
    try {
      root = buildChildCodeRoot(g, parts, parent);
    } catch (e) {
      throw new SgcError(e instanceof Error ? e.message : String(e), 409);
    }
    const existing = await db.sgcDocument.findMany({ where: { id_company: input.idCompany, code: { startsWith: root } }, select: { code: true } });
    const sequence = nextChildSequence(g, parts, parent, existing.map((e) => e.code));
    return { code: buildChildCode(g, parts, parent, sequence), sequence: null, inherited: true };
  }
  const existing = await db.sgcDocument.findMany({ where: { id_company: input.idCompany, code: { startsWith: buildCodeRoot(g, parts) } }, select: { code: true } });
  const sequence = nextSequence(g, parts, existing.map((e) => e.code));
  return { code: buildDocumentCode(g, parts, sequence), sequence, inherited: false };
}

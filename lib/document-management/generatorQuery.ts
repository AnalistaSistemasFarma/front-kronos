/**
 * Construcción del `where` de Prisma para el listado del Generador de
 * Documentos (GET /api/document-management/generator).
 *
 * Regla de negocio VIGENTE (aclaración definitiva de Nicolás, 2026-09-04):
 * "todos los documentos, sean de procedimiento o no, deben pasar por el
 * flujo [de 14 estados]" + "en el generador de documentos, debes mostrar
 * todos los documentos vigentes, ya sean de procedimiento o no". El
 * Generador debe listar TODO documento en estado "Vigente", sin importar
 * `id_process` (null o no) ni `id_document_type`.
 *
 * NOTA HISTÓRICA (regla anterior, ya NO vigente): entre 2026-09-02 y
 * 2026-09-04 este filtro exigía además `id_process: { not: null }`, para
 * excluir la carga histórica de Fase 1 (documentos que nunca pasaron por el
 * flujo de aprobación). Se retiró ese filtro porque Nicolás confirmó
 * explícitamente que esos documentos históricos también deben aparecer en
 * el Generador -- ver el comentario de `Document.id_process` en
 * prisma/schema.prisma: ese campo identifica si un documento pasó por el
 * flujo de aprobación (motor interno de Gestión Documental), NO una
 * categoría de negocio ni el tipo de documento ("procedimiento" en el
 * sentido de `id_document_type`/`DocumentType.code_prefix` es un concepto
 * completamente distinto y siempre estuvo fuera de este filtro).
 *
 * Se mantiene esta construcción en una función PURA (antes vivía inline en
 * el route.ts) para poder probar por separado, sin BD, que el ÚNICO filtro
 * de estado es `current_status: 'Vigente'` sin importar la combinación de
 * los demás filtros.
 */
export interface GeneratorDocumentsFilterInput {
  companyId: number | null;
  readableCompanyIds: number[];
  documentTypeId: number | null;
}

export interface GeneratorDocumentsWhere {
  id_company: number | { in: number[] };
  current_status: 'Vigente';
  id_document_type: number | undefined;
}

export function buildGeneratorDocumentsWhere(
  input: GeneratorDocumentsFilterInput
): GeneratorDocumentsWhere {
  const { companyId, readableCompanyIds, documentTypeId } = input;
  return {
    id_company: companyId ? companyId : { in: readableCompanyIds },
    current_status: 'Vigente',
    id_document_type: documentTypeId ? documentTypeId : undefined,
  };
}

/**
 * Construcción del `where` de Prisma para el listado del Generador de
 * Documentos (GET /api/document-management/generator).
 *
 * Regla de negocio (pedido de Nicolás, 2026-09-02): el Generador SOLO debe
 * listar documentos que YA pasaron por el flujo de aprobación de 14
 * estados. `id_process IS NULL` = carga histórica de Fase 1, nunca pasó por
 * aprobación -- se excluye aunque esté marcado "Vigente".
 *
 * Se extrae esta construcción a una función PURA (antes vivía inline en el
 * route.ts) para poder probar por separado, sin BD, que el filtro
 * `id_process: { not: null }` SIEMPRE está presente sin importar la
 * combinación de los demás filtros -- así un cambio futuro que lo quite por
 * accidente rompe un test, no solo se descubre en producción.
 */
export interface GeneratorDocumentsFilterInput {
  companyId: number | null;
  readableCompanyIds: number[];
  documentTypeId: number | null;
}

export interface GeneratorDocumentsWhere {
  id_company: number | { in: number[] };
  current_status: 'Vigente';
  id_process: { not: null };
  id_document_type: number | undefined;
}

export function buildGeneratorDocumentsWhere(
  input: GeneratorDocumentsFilterInput
): GeneratorDocumentsWhere {
  const { companyId, readableCompanyIds, documentTypeId } = input;
  return {
    id_company: companyId ? companyId : { in: readableCompanyIds },
    current_status: 'Vigente',
    id_process: { not: null },
    id_document_type: documentTypeId ? documentTypeId : undefined,
  };
}

import { getPool, sql } from '../mssqlPool';
import { prisma } from '../prisma';
import { CreateDocumentValidationError } from './documents';
import { DOCUMENT_WORKFLOW_PROCESS_NAME } from './workflowStates';

/**
 * Puente entre el mecanismo GENÉRICO de campos de proceso (process_form_field /
 * process_form_field_option / request_form_value -- el mismo que usa CUALQUIER otro
 * proceso de SynerLink, ver app/api/requests-general/process-fields/route.js y
 * lib/requests-general/createGeneralRequest.js) y los parámetros CONCRETOS que sigue
 * necesitando createDocumentAndStartWorkflow (workflowEngine.ts): documentTypeId, code,
 * dueReviewDate, isRestricted.
 *
 * Por qué existe esta capa (y no un mecanismo aparte): Nicolás pidió, tras revisar el
 * Sprint 5, que "tipo de documento", "código", etc. dejen de estar hardcodeados en un
 * formulario propio y se lean del MISMO catálogo `process_form_field` que usa todo el
 * resto de procesos (sembrado para id_process_category=86 por
 * prisma/seeds/document-management-generic-fields.sql). El front ahora los renderiza con
 * el bloque genérico "Información adicional" de create-request/page.tsx -- sin JSX nuevo,
 * ya sabía renderizar select/text/date. Lo único que sigue siendo específico de Gestión
 * Documental es esta traducción de "el usuario eligió la opción de select con id X" a "el
 * id_document_type real es Y": el catálogo document_type es una tabla Prisma propia del
 * módulo (ver el comentario de modelado en prisma/schema.prisma), no algo que el motor
 * genérico conozca.
 *
 * Resolución de "Tipo de documento": la opción elegida (process_form_field_option) guarda
 * como etiqueta "Nombre (PREFIJO)" (el mismo texto que ya mostraba el Select hardcodeado
 * del Sprint 5 -- ver CreateDocumentModal.tsx). Se extrae el PREFIJO (document_type.code_prefix,
 * columna @@unique en el schema) y se resuelve el documentType real por ese prefijo. Evita
 * depender de que process_form_field_option.id coincida con document_type.id_document_type
 * (son secuencias independientes) sin necesitar una columna de referencia nueva en una
 * tabla genérica que comparten todos los procesos.
 */

export interface SubmittedFormValue {
  id_field: number;
  id_option?: number | null;
  value_text?: string | null;
}

export interface ResolvedDocumentFields {
  documentTypeId: number;
  code: string;
  dueReviewDate: string | null;
  isRestricted: boolean;
}

export const DOCUMENT_FIELD_LABELS = {
  DOCUMENT_TYPE: 'Tipo de documento',
  CODE: 'Código del documento',
  DUE_REVIEW_DATE: 'Próxima fecha de revisión',
  IS_RESTRICTED: 'Documento restringido',
} as const;

const RESTRICTED_YES_LABEL = 'Sí';

/** Mismo formato que ya usaba el Select hardcodeado del Sprint 5 y CreateDocumentModal.tsx. */
export function documentTypeOptionLabel(type: { name: string; code_prefix: string }): string {
  return `${type.name} (${type.code_prefix})`;
}

function extractCodePrefixFromOptionLabel(label: string): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(label.trim());
  return m ? m[1] : null;
}

/**
 * Resuelve los 4 campos genéricos sembrados para id_process_category=86 (ver el seed) a
 * partir de lo que el usuario envió (formValues, misma forma que le pide el resto del
 * motor genérico: [{ id_field, id_option?, value_text? }]). Lanza
 * CreateDocumentValidationError (400/404) si falta el seed o si el valor enviado no es
 * válido -- mismos códigos de error que ya maneja el route.ts.
 */
export async function resolveDocumentFieldsFromFormValues(
  pool: Awaited<ReturnType<typeof getPool>>,
  processId: number,
  formValues: SubmittedFormValue[]
): Promise<ResolvedDocumentFields> {
  const fieldsResult = await pool
    .request()
    .input('idProcess', sql.Int, processId)
    .query(
      `SELECT id, field_label FROM process_form_field WHERE active = 1 AND id_process_category = @idProcess`
    );

  const fieldIdByLabel = new Map<string, number>();
  for (const row of fieldsResult.recordset as Array<{ id: number; field_label: string }>) {
    fieldIdByLabel.set(row.field_label, row.id);
  }

  const requireFieldId = (label: string): number => {
    const id = fieldIdByLabel.get(label);
    if (!id) {
      throw new CreateDocumentValidationError(
        `Falta sembrar el campo "${label}" en process_form_field para Gestión Documental. ` +
          'Corra prisma/seeds/document-management-generic-fields.sql.',
        500
      );
    }
    return id;
  };

  const valueFor = (idField: number): SubmittedFormValue | undefined =>
    formValues.find((fv) => fv && fv.id_field === idField);

  const optionLabelById = async (idOption: number): Promise<string | undefined> => {
    const result = await pool
      .request()
      .input('idOption', sql.Int, idOption)
      .query(`SELECT option_label FROM process_form_field_option WHERE id = @idOption`);
    return result.recordset[0]?.option_label;
  };

  // Tipo de documento
  const typeFieldId = requireFieldId(DOCUMENT_FIELD_LABELS.DOCUMENT_TYPE);
  const typeValue = valueFor(typeFieldId);
  if (!typeValue?.id_option) {
    throw new CreateDocumentValidationError('Seleccione el tipo de documento');
  }
  const typeOptionLabel = await optionLabelById(typeValue.id_option);
  const codePrefix = typeOptionLabel ? extractCodePrefixFromOptionLabel(typeOptionLabel) : null;
  if (!codePrefix) {
    throw new CreateDocumentValidationError('Tipo de documento inválido');
  }
  const documentType = await prisma.documentType.findUnique({ where: { code_prefix: codePrefix } });
  if (!documentType || !documentType.is_active) {
    throw new CreateDocumentValidationError('Tipo de documento no encontrado o inactivo', 404);
  }

  // Código del documento
  const codeFieldId = requireFieldId(DOCUMENT_FIELD_LABELS.CODE);
  const code = String(valueFor(codeFieldId)?.value_text ?? '').trim();
  if (!code) {
    throw new CreateDocumentValidationError('El código del documento es obligatorio');
  }

  // Próxima fecha de revisión (opcional)
  const dueFieldId = requireFieldId(DOCUMENT_FIELD_LABELS.DUE_REVIEW_DATE);
  const dueRaw = valueFor(dueFieldId)?.value_text;
  const dueReviewDate = dueRaw ? String(dueRaw) : null;

  // Documento restringido (opcional -- sin respuesta = No)
  const restrictedFieldId = requireFieldId(DOCUMENT_FIELD_LABELS.IS_RESTRICTED);
  const restrictedValue = valueFor(restrictedFieldId);
  let isRestricted = false;
  if (restrictedValue?.id_option) {
    const restrictedLabel = await optionLabelById(restrictedValue.id_option);
    isRestricted = restrictedLabel === RESTRICTED_YES_LABEL;
  }

  return { documentTypeId: documentType.id_document_type, code, dueReviewDate, isRestricted };
}

/**
 * Sincroniza una opción nueva de "Tipo de documento" en process_form_field_option cuando
 * se crea un DocumentType (ver POST /api/document-management/types). Sin esto, un tipo
 * de documento creado después de correr el seed no aparecería en el selector genérico del
 * camino estándar hasta volver a correr
 * prisma/seeds/document-management-generic-fields.sql a mano. Best-effort: si falla, NO
 * bloquea la creación del tipo (que ya quedó confirmada en document_type) -- el peor caso
 * es tener que resembrar manualmente.
 */
export async function syncDocumentTypeOption(type: { name: string; code_prefix: string }): Promise<void> {
  const pool = await getPool();
  const label = documentTypeOptionLabel(type);
  await pool
    .request()
    .input('processName', sql.NVarChar(1000), DOCUMENT_WORKFLOW_PROCESS_NAME)
    .input('fieldLabel', sql.NVarChar(255), DOCUMENT_FIELD_LABELS.DOCUMENT_TYPE)
    .input('optionLabel', sql.NVarChar(255), label)
    .query(`
      INSERT INTO process_form_field_option (id_form_field, option_label, active, display_order)
      SELECT ff.id, @optionLabel, 1,
             ISNULL((SELECT MAX(o2.display_order) FROM process_form_field_option o2 WHERE o2.id_form_field = ff.id), 0) + 1
      FROM process_form_field ff
      INNER JOIN process_category pc ON pc.id = ff.id_process_category
      WHERE pc.process = @processName AND ff.field_label = @fieldLabel AND ff.active = 1
        AND NOT EXISTS (
          SELECT 1 FROM process_form_field_option o
          WHERE o.id_form_field = ff.id AND o.option_label = @optionLabel
        );
    `);
}

/**
 * Construccion y validacion PURA del borrador (Draft oPurchaseRequest) de una
 * solicitud de compra. Espeja el payload de SAPSEND
 * (ModalCreatePurchaseRequest.jsx:977-1002) para que SAPSEND vea y opere las
 * solicitudes creadas desde SynerLink exactamente igual que las suyas.
 *
 * Diferencias deliberadas frente a SAPSEND (defectos que NO se replican):
 *  - En la edicion, U_SEND_Dep se conserva; SAPSEND lo pisaba con RequesterName
 *    (ModalCreatePurchaseRequest.jsx:1047).
 *  - Validaciones en servidor (en SAPSEND solo existian en la UI).
 */

import { DOC_OBJECT_CODE } from './fields';

/** Campos de linea que acepta el modulo (los mismos que arma SAPSEND, l.180-199). */
export const LINE_FIELDS = [
  'ItemCode',
  'ItemDescription',
  'LineVendor',
  'U_NombreProveedor',
  'RequiredDate',
  'Quantity',
  'UnitPrice',
  'TaxCode',
  'AccountCode',
  'Currency',
  'CostingCode',
  'ProjectCode',
  'U_Dest_compra',
  'WarehouseCode',
  'U_version',
  'U_HBT_UndMedida',
] as const;

export type LineField = (typeof LINE_FIELDS)[number];
export type DraftLine = Partial<Record<LineField, string | number | null>>;

/** Limites de longitud de SAPSEND (maxLength de los inputs). */
const MAX_LEN: Partial<Record<LineField | 'Comments', number>> = {
  Comments: 254,
  ItemDescription: 199,
  U_version: 15,
  U_Dest_compra: 100,
  U_HBT_UndMedida: 30,
};

/** Obligatorios por linea (SAPSEND los marca requeridos en el formulario). */
const REQUIRED_LINE: LineField[] = ['ItemDescription', 'Quantity', 'TaxCode', 'AccountCode', 'CostingCode'];

export interface DraftHeaderInput {
  Comments?: string;
  RequriedDate?: string;
  U_SEND_Ane?: string | null;
}

/** Solicitante ya resuelto en el servidor (nunca viene del navegador). */
export interface Requester {
  /** ID de perfil SAPSEND (User.id_user_sapsend) -> U_SEND_UserId. */
  sapsendUserId: number;
  name: string;
  email: string;
  /** ID de departamento SAPSEND, texto (U_SEND_Dep). */
  departmentId: string;
}

export interface ValidationError {
  field: string;
  error: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de hoy en Colombia (YYYY-MM-DD), como la usa SAPSEND para DocDate. */
export function todayBogota(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Deja solo los campos permitidos, recorta textos y pasa la descripcion a mayusculas. */
export function sanitizeLine(raw: Record<string, unknown>): DraftLine {
  const line: DraftLine = {};
  for (const f of LINE_FIELDS) {
    const v = raw[f];
    if (v === undefined || v === null || v === '') continue;
    if (f === 'Quantity' || f === 'UnitPrice') {
      line[f] = toNumber(v);
    } else {
      line[f] = String(v).trim();
    }
  }
  if (typeof line.ItemDescription === 'string') {
    line.ItemDescription = line.ItemDescription.toUpperCase();
  }
  return line;
}

/** Valida cabecera y lineas. Devuelve la lista de errores (vacia = valido). */
export function validateDraft(header: DraftHeaderInput, lines: DraftLine[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const comments = (header.Comments ?? '').trim();
  if (!comments) errors.push({ field: 'Comments', error: 'El comentario es obligatorio.' });
  if (comments.length > MAX_LEN.Comments!) {
    errors.push({ field: 'Comments', error: `Maximo ${MAX_LEN.Comments} caracteres.` });
  }
  if (header.RequriedDate && !DATE_RE.test(header.RequriedDate)) {
    errors.push({ field: 'RequriedDate', error: 'Fecha invalida (YYYY-MM-DD).' });
  }
  if (lines.length === 0) errors.push({ field: 'DocumentLines', error: 'Agregue al menos una linea.' });

  lines.forEach((line, i) => {
    for (const f of REQUIRED_LINE) {
      if (line[f] === undefined || line[f] === null || line[f] === '') {
        errors.push({ field: `DocumentLines[${i}].${f}`, error: `${f} es obligatorio.` });
      }
    }
    const qty = line.Quantity as number | undefined;
    if (qty !== undefined && !(qty > 0)) {
      errors.push({ field: `DocumentLines[${i}].Quantity`, error: 'La cantidad debe ser mayor a 0.' });
    }
    const price = line.UnitPrice as number | undefined;
    if (price !== undefined && (Number.isNaN(price) || price < 0)) {
      errors.push({ field: `DocumentLines[${i}].UnitPrice`, error: 'El precio no puede ser negativo.' });
    }
    for (const [f, max] of Object.entries(MAX_LEN)) {
      const v = line[f as LineField];
      if (typeof v === 'string' && v.length > max) {
        errors.push({ field: `DocumentLines[${i}].${f}`, error: `Maximo ${max} caracteres.` });
      }
    }
    if (typeof line.RequiredDate === 'string' && !DATE_RE.test(line.RequiredDate)) {
      errors.push({ field: `DocumentLines[${i}].RequiredDate`, error: 'Fecha invalida (YYYY-MM-DD).' });
    }
  });
  return errors;
}

/** Lineas tal como las envia SAPSEND: Rate y LineTotal en null (los calcula SAP). */
function toSapLines(lines: DraftLine[]) {
  return lines.map((l) => ({ ...l, Rate: null, LineTotal: null }));
}

/** Payload del POST Drafts para crear la solicitud en estado B. */
export function buildCreatePayload(
  header: DraftHeaderInput,
  lines: DraftLine[],
  requester: Requester,
  today: string = todayBogota()
) {
  return {
    Comments: (header.Comments ?? '').trim(),
    U_SEND_Ane: header.U_SEND_Ane ?? null,
    RequriedDate: header.RequriedDate || today,
    DocDate: today,
    CardCode: (lines[0]?.LineVendor as string) || null,
    CardName: (lines[0]?.U_NombreProveedor as string) || null,
    DocDueDate: today,
    U_SEND_UserId: requester.sapsendUserId,
    U_SEND_UserName: requester.name,
    U_SEND_UserEmail: requester.email,
    RequesterName: requester.name,
    U_SEND_State: 'B',
    U_SEND_Dep: requester.departmentId,
    DocObjectCode: DOC_OBJECT_CODE.solicitudes,
    DocumentLines: toSapLines(lines),
  };
}

/**
 * Payload del PATCH Drafts(id) al editar (con B1S-ReplaceCollectionsOnPatch).
 * NO toca solicitante, departamento ni estado: esos campos los fija la creacion
 * y las transiciones.
 */
export function buildUpdatePayload(header: DraftHeaderInput, lines: DraftLine[]) {
  return {
    Comments: (header.Comments ?? '').trim(),
    ...(header.RequriedDate ? { RequriedDate: header.RequriedDate } : {}),
    ...(header.U_SEND_Ane !== undefined ? { U_SEND_Ane: header.U_SEND_Ane } : {}),
    CardCode: (lines[0]?.LineVendor as string) || null,
    CardName: (lines[0]?.U_NombreProveedor as string) || null,
    DocumentLines: toSapLines(lines),
  };
}

/** Estados en los que SAPSEND permite editar (boton "Actualizar": B o ENC). */
export const EDITABLE_STATES = ['B', 'ENC'] as const;

/**
 * Escapa un literal para un filtro OData ('O''Brien'). Corrige la inyeccion de
 * SAPSEND, que interpolaba el texto del usuario sin escapar.
 */
export function odataString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

import { sapGet, sapPost, sapPatch, sapDelete, type SapSession } from '../sap/serviceLayer';
import type { CompanySapEndpoint } from './access';

/**
 * Logica de negocio de registros sanitarios (UDO de SAP B1), compartida por las
 * rutas de creacion individual y cargue masivo. Todo server-side.
 */

/** Campos U_* permitidos del registro (whitelist; se ignora cualquier otro). */
export const HEALTH_RECORD_FIELDS = [
  'U_Referencia',
  'U_Descripcion',
  'U_Fecha_Creacion',
  'U_Fecha_Actualizacion',
  'U_Pais',
  'U_Titular',
  'U_Fabricante',
  'U_Registro_Sanitario',
  'U_Fecha_Vencimiento',
  'U_Codigo_CUM',
  'U_Codigo_IUM',
  'U_Vida_Util',
  'U_Estado_Entrada',
  'U_Estado_Comercializacion',
  'U_Obsoleto',
  'U_SEND_Link',
] as const;

export type HealthRecordInput = Partial<Record<(typeof HEALTH_RECORD_FIELDS)[number], string>>;

/** Escapa comillas simples para literales OData. */
export function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/** Toma solo los campos permitidos, como strings recortados. Descarta vacios. */
export function sanitizeRecord(input: Record<string, unknown>): HealthRecordInput {
  const out: HealthRecordInput = {};
  for (const field of HEALTH_RECORD_FIELDS) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value === '') continue;
    out[field] = value;
  }
  return out;
}

/** Fecha de hoy en formato YYYY-MM-DD (para el log). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ¿Ya existe un registro con ese U_Registro_Sanitario en la base?
 * Replica la validacion de duplicados de SAPSEND.
 */
export async function registroExiste(
  session: SapSession,
  entity: string,
  registroSanitario: string
): Promise<boolean> {
  const filter = encodeURIComponent(`U_Registro_Sanitario eq '${escapeOData(registroSanitario)}'`);
  const data = await sapGet<{ value?: unknown[] }>(
    session,
    `${entity}?$filter=${filter}&$select=DocEntry,U_Registro_Sanitario`
  );
  return (data.value?.length ?? 0) > 0;
}

/**
 * ¿Existe el articulo (maestra de articulos de SAP, OITM) con ese ItemCode?
 * Se valida antes de asignarle un registro sanitario: no debe crearse un RS
 * para un articulo que no existe en SAP.
 */
export async function articuloExiste(session: SapSession, itemCode: string): Promise<boolean> {
  const filter = encodeURIComponent(`ItemCode eq '${escapeOData(itemCode)}'`);
  const data = await sapGet<{ value?: unknown[] }>(
    session,
    `Items?$filter=${filter}&$select=ItemCode&$top=1`
  );
  return (data.value?.length ?? 0) > 0;
}

/** Elimina un registro sanitario por su clave (DocEntry). */
export async function eliminarRegistro(
  session: SapSession,
  entity: string,
  docEntry: number
): Promise<void> {
  await sapDelete(session, `${entity}(${docEntry})`);
}

/**
 * Agrega una linea a la bitacora (colección hija). Append: sin
 * B1S-ReplaceCollectionsOnPatch. El nombre de la colección varia por empresa.
 */
export async function agregarLog(
  session: SapSession,
  entity: string,
  logCollection: string,
  docNum: number,
  userName: string,
  comentario: string
): Promise<void> {
  await sapPatch(session, `${entity}(${docNum})`, {
    [logCollection]: [
      { U_RegSan_Fec: today(), U_RegSan_Nom: userName, U_RegSan_Com: comentario },
    ],
  });
}

/**
 * Crea un registro sanitario (POST) y, si hay colección de logs configurada,
 * agrega la primera linea de bitacora. Devuelve el DocNum creado.
 */
export async function crearRegistro(
  session: SapSession,
  endpoint: CompanySapEndpoint,
  record: HealthRecordInput,
  userName: string,
  comentario: string
): Promise<number> {
  const entity = endpoint.healthRecordsEntity!;
  const created = await sapPost<{ DocNum?: number }>(session, entity, record);
  const docNum = created?.DocNum;

  if (docNum != null && endpoint.healthRecordsLogCollection) {
    await agregarLog(
      session,
      entity,
      endpoint.healthRecordsLogCollection,
      docNum,
      userName,
      comentario || 'Creado desde SynerLink'
    );
  }

  return docNum ?? -1;
}

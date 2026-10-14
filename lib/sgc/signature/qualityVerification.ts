import { SGC_AUTH_TYPE_QUALITY } from '../flows/documentFlow';

/**
 * S14 (R20, RN 2026-10-13 — `rn-sgc-solicitante-elabora-y-asigna-firmantes`,
 * punto 6): la VERIFICACIÓN de Aseguramiento de Calidad en la aprobación es
 * una LISTA DE CHEQUEO que queda en el sistema, no una firma del documento.
 * Es el cupo de GRUPO `SGC-VERIF-CALIDAD` del paso de aprobación (significado
 * «aprobo», sin persona nombrada). Ese cupo conserva su registro electrónico
 * (contraseña, motivo, sello de tiempo, huella y cadena), su lista de chequeo
 * y la auditoría, pero NO se compone en el PDF controlado: ni caja, ni nombre
 * en «Aprobó», ni fila en el registro de trazabilidad.
 * Una persona de Calidad nombrada como aprobadora sí firma el documento.
 */
export function isQualityVerificationSlot(slot: { user_email: string | null; pool_type_code: string | null; signature_meaning?: string | null }): boolean {
  if (slot.user_email) return false;
  if ((slot.pool_type_code ?? '').trim() !== SGC_AUTH_TYPE_QUALITY) return false;
  return slot.signature_meaning === undefined || slot.signature_meaning === null || slot.signature_meaning === 'aprobo';
}

/** Mismo criterio para un paso del flujo (la composición): el cupo de grupo de Calidad de un paso «Aprobó». */
export function isQualityVerificationPool(meaning: string | null | undefined, poolTypeCode: string | null | undefined): boolean {
  return meaning === 'aprobo' && (poolTypeCode ?? '').trim() === SGC_AUTH_TYPE_QUALITY;
}

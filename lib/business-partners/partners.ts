import { sapPatch, type SapSession } from '../sap/serviceLayer';
import { EDITABLE_ON_UPDATE, INT_FIELDS } from './fields';

/**
 * Logica de negocio de Socios de Negocio (entidad estandar BusinessPartners /
 * OCRD de SAP B1). Todo server-side. Espejo de lib/articles/articles.ts.
 *
 * Clave de negocio = CardCode (string). El GET/PATCH se hace por
 * BusinessPartners('CODIGO') con la cadena entre comillas simples
 * (no BusinessPartners(123)).
 */

export type PartnerInput = Record<string, string | number>;

/** Escapa comillas simples para literales OData (las duplica). */
export function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Whitelist de campos aceptados al editar un socio:
 *   - los campos estandar EDITABLES del encabezado (EDITABLE_ON_UPDATE),
 *   - y CUALQUIER campo cuyo nombre empiece por `U_` (campos de usuario / UDF).
 *
 * Descarta cualquier otro campo (incluidos los de sistema como CardCode,
 * CurrentAccountBalance, y las colecciones hijas BPAddresses / ContactEmployees
 * / BPBankAccounts, que no se editan por esta via) y los vacios. Los campos
 * enteros (GroupCode, PayTermsGrpCode) se convierten a numero.
 */
export function sanitizeBusinessPartner(input: Record<string, unknown>): PartnerInput {
  const allowed = new Set<string>(EDITABLE_ON_UPDATE);

  const out: PartnerInput = {};
  for (const [key, raw] of Object.entries(input)) {
    // Se acepta si esta en la whitelist estandar editable O es un campo U_*.
    if (!allowed.has(key) && !/^U_/.test(key)) continue;
    if (raw === undefined || raw === null) continue;

    if (INT_FIELDS.includes(key)) {
      const n = Number(raw);
      if (!Number.isNaN(n)) out[key] = n;
      continue;
    }

    const value = String(raw).trim();
    if (value === '') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Actualiza un socio por CardCode (PATCH BusinessPartners('code')) con solo los
 * cambios. SAP responde 204 No Content en exito; si algo falla, sapPatch lanza
 * SapError con el mensaje real de SAP incluido.
 */
export async function actualizarSocio(
  session: SapSession,
  cardCode: string,
  changes: PartnerInput
): Promise<void> {
  await sapPatch(session, `BusinessPartners('${escapeOData(cardCode)}')`, changes);
}

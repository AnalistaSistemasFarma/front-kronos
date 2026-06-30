import { sapGet, sapPost, sapPatch, type SapSession } from '../sap/serviceLayer';
import {
  STANDARD_FIELD_NAMES,
  INT_FIELDS,
  getCompanyCustomFields,
} from './fields';

/**
 * Logica de negocio de Articulos (entidad estandar Items / OITM de SAP B1),
 * compartida por las rutas de creacion individual, edicion y cargue masivo.
 * Todo server-side.
 *
 * Clave de negocio = ItemCode (string). El GET/PATCH se hace por
 * Items('CODIGO') con la cadena entre comillas simples (no Items(123)).
 */

export type ItemInput = Record<string, string | number>;

/** Escapa comillas simples para literales OData (las duplica). */
export function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Whitelist de campos aceptados al crear/editar un articulo:
 *   - los campos estandar gestionados (STANDARD_FIELD_NAMES),
 *   - los custom U_* del mapa de ESA empresa,
 *   - y, en general, CUALQUIER campo cuyo nombre empiece por `U_` (campos de
 *     usuario / UDF de SAP). Esto permite editar todos los campos
 *     personalizados que tenga el articulo, no solo los del mapa curado, sin
 *     abrir la puerta a campos de sistema arbitrarios.
 *
 * Descarta cualquier otro campo y los vacios. Los campos enteros
 * (ItemsGroupCode) se convierten a numero.
 */
export function sanitizeItem(input: Record<string, unknown>, companyName: string): ItemInput {
  const allowed = new Set<string>([
    ...STANDARD_FIELD_NAMES,
    ...getCompanyCustomFields(companyName).map((c) => c.field),
  ]);

  const out: ItemInput = {};
  for (const [key, raw] of Object.entries(input)) {
    // Se acepta si esta en la whitelist estandar/mapa O es un campo de usuario U_*.
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

/** ¿Ya existe un articulo con ese ItemCode en la base? */
export async function itemExiste(session: SapSession, itemCode: string): Promise<boolean> {
  // GET directo por clave: si existe responde 200, si no, SAP responde 404.
  try {
    await sapGet(session, `Items('${escapeOData(itemCode)}')?$select=ItemCode`);
    return true;
  } catch (err) {
    // 404 -> no existe. Cualquier otro error se propaga.
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * Crea un articulo (POST Items). El item ya debe venir saneado (whitelist).
 * Devuelve el ItemCode creado.
 */
export async function crearArticulo(session: SapSession, item: ItemInput): Promise<string> {
  const created = await sapPost<{ ItemCode?: string }>(session, 'Items', item);
  return created?.ItemCode ?? String(item.ItemCode ?? '');
}

/** Actualiza un articulo por ItemCode (PATCH Items('code')) con solo los cambios. */
export async function actualizarArticulo(
  session: SapSession,
  itemCode: string,
  changes: ItemInput
): Promise<void> {
  await sapPatch(session, `Items('${escapeOData(itemCode)}')`, changes);
}

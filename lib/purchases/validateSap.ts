import { sapGet, SapError, type SapSession } from '../sap/serviceLayer';
import { odataString, type DraftLine, type ValidationError } from './drafts';

/**
 * Validacion previa contra SAP de los campos tipo lista obligatorios de cada
 * linea: cuenta de mayor, norma de reparto e indicador de IVA. Espeja
 * validateRequiredListFields de SAPSEND (ModalCreatePurchaseRequest.jsx:915-971),
 * que evita el error de SAP "No existen registros coincidentes (ODBC -2028)"
 * cuando se digita un codigo inexistente.
 *
 * Diferencias frente a SAPSEND:
 *  - Corre en el servidor (SAPSEND lo hacia solo en la UI).
 *  - Escapa los codigos en el filtro OData (SAPSEND los interpolaba sin escapar).
 *  - Consulta cada codigo distinto una sola vez, no una vez por linea.
 *  - Un error de SAP distinto de "no existe" se propaga (SAPSEND lo tomaba como
 *    "no existe" y mostraba un mensaje enganoso).
 *  - Norma de reparto: DistributionRulesService_GetDistributionRuleList IGNORA
 *    $filter y $top (verificado en Farmalogica el 2026-10-21: con un FactorCode
 *    inexistente devuelve la lista completa). En SAPSEND esa validacion nunca
 *    fallaba. Aqui se trae la lista una vez y se verifica la pertenencia.
 */

type Kind = 'AccountCode' | 'CostingCode' | 'TaxCode';
type QueryKind = Exclude<Kind, 'CostingCode'>;

const QUERIES: Record<QueryKind, (code: string) => string> = {
  AccountCode: (c) => `ChartOfAccounts?$top=1&$select=Code&$filter=Code eq ${odataString(c)}`,
  TaxCode: (c) => `SalesTaxCodes?$top=1&$select=Code&$filter=Code eq ${odataString(c)}`,
};

const DISTRIBUTION_RULES_PATH = 'DistributionRulesService_GetDistributionRuleList';

const MESSAGES: Record<Kind, string> = {
  AccountCode: 'La cuenta no existe en SAP. Seleccione un valor valido de la lista.',
  CostingCode: 'La norma de reparto no existe en SAP. Seleccione un valor valido de la lista.',
  TaxCode: 'El indicador de IVA no existe en SAP. Seleccione un valor valido de la lista.',
};

/** Accesos a SAP que usa la validacion. Inyectables para tests. */
export interface SapLookups {
  /** true si la consulta trae al menos una fila. */
  exists: (path: string) => Promise<boolean>;
  /** Codigos (FactorCode) de las normas de reparto de la empresa. */
  distributionRuleCodes: () => Promise<Set<string>>;
}

export function sapLookups(sap: SapSession): SapLookups {
  return {
    exists: async (path) => {
      try {
        const data = await sapGet<{ value?: unknown[] }>(sap, path);
        return Array.isArray(data.value) && data.value.length > 0;
      } catch (error) {
        // 404 = no existe; cualquier otro error (sesion, red, 500) se propaga.
        if (error instanceof SapError && error.status === 404) return false;
        throw error;
      }
    },
    distributionRuleCodes: async () => {
      const data = await sapGet<{ value?: Array<{ FactorCode?: string }> }>(sap, DISTRIBUTION_RULES_PATH);
      return new Set((data.value ?? []).map((r) => String(r.FactorCode ?? '').trim()).filter(Boolean));
    },
  };
}

/**
 * Valida contra SAP las lineas ya saneadas. Los campos vacios no se revisan aqui
 * (de eso se encarga validateDraft). Devuelve la lista de errores (vacia = valido).
 */
export async function validateLinesInSap(lines: DraftLine[], sap: SapLookups): Promise<ValidationError[]> {
  const queryKinds = Object.keys(QUERIES) as QueryKind[];
  const kinds: Kind[] = ['AccountCode', 'CostingCode', 'TaxCode'];
  const key = (kind: Kind, code: string) => `${kind}|${code}`;
  const codeOf = (line: DraftLine, kind: Kind) => String(line[kind] ?? '').trim();

  // Cuenta e IVA: una consulta por codigo distinto.
  const pending = new Map<string, Promise<boolean>>();
  for (const line of lines) {
    for (const kind of queryKinds) {
      const code = codeOf(line, kind);
      if (code && !pending.has(key(kind, code))) {
        pending.set(key(kind, code), sap.exists(QUERIES[kind](code)));
      }
    }
  }

  // Norma de reparto: la lista se trae una sola vez, y solo si hace falta.
  const needsRules = lines.some((l) => codeOf(l, 'CostingCode'));
  const rulesPromise = needsRules ? sap.distributionRuleCodes() : Promise.resolve(new Set<string>());

  // Las consultas ya estan en vuelo en paralelo; aqui solo se recogen.
  const results = new Map<string, boolean>();
  const entries = [...pending];
  const [values, ruleCodes] = await Promise.all([Promise.all(entries.map(([, p]) => p)), rulesPromise]);
  entries.forEach(([k], i) => results.set(k, values[i]));
  for (const line of lines) {
    const code = codeOf(line, 'CostingCode');
    if (code) results.set(key('CostingCode', code), ruleCodes.has(code));
  }

  const errors: ValidationError[] = [];
  lines.forEach((line, i) => {
    for (const kind of kinds) {
      const code = codeOf(line, kind);
      if (code && results.get(key(kind, code)) === false) {
        errors.push({ field: `DocumentLines[${i}].${kind}`, error: MESSAGES[kind] });
      }
    }
  });
  return errors;
}

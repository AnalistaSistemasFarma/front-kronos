import { DEFAULT_FARMADOSIS_FIELD_MAP, isFarmadosisFormKey } from './forms';

/**
 * Configuración de la integración Farmadosis → SynerLink.
 *
 *   FARMADOSIS_COMPANY_ID=1
 *   FARMADOSIS_REQUESTER_USER_ID=<cuid del usuario sistema>
 *   FARMADOSIS_PROCESS_MAP={"contacto":12,"calidad":13,"farmacovigilancia":14}
 *   FARMADOSIS_FIELD_MAP={"email":"Correo electrónico"}  // opcional; ya hay mapa por defecto
 *
 * Si no hay PROCESS_MAP, se busca el proceso por nombre:
 *   Contacto web | Calidad web | Farmacovigilancia web
 */

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseProcessMap(raw: string | undefined): Record<string, number> {
  const obj = parseJsonObject(raw);
  const map: Record<string, number> = {};
  for (const [key, value] of Object.entries(obj)) {
    const n = typeof value === 'number' ? value : Number(value);
    if (key.trim() && Number.isInteger(n) && n > 0) {
      map[key.trim()] = n;
    }
  }
  return map;
}

function parseFieldMap(raw: string | undefined): Record<string, string> {
  const obj = parseJsonObject(raw);
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.trim() && typeof value === 'string' && value.trim()) {
      map[key.trim()] = value.trim();
    }
  }
  return map;
}

export type FarmadosisConfig = {
  companyId: number | null;
  requesterUserId: string | null;
  defaultProcessId: number | null;
  processMap: Record<string, number>;
  fieldMap: Record<string, string>;
};

export function getFarmadosisConfig(): FarmadosisConfig {
  return {
    companyId: parsePositiveInt(process.env.FARMADOSIS_COMPANY_ID),
    requesterUserId: process.env.FARMADOSIS_REQUESTER_USER_ID?.trim() || null,
    defaultProcessId: parsePositiveInt(process.env.FARMADOSIS_PROCESS_ID),
    processMap: parseProcessMap(process.env.FARMADOSIS_PROCESS_MAP),
    fieldMap: { ...DEFAULT_FARMADOSIS_FIELD_MAP, ...parseFieldMap(process.env.FARMADOSIS_FIELD_MAP) },
  };
}

export function resolveProcessId(
  formKey: string | undefined,
  config: FarmadosisConfig
): number | null {
  const key = formKey?.trim();
  if (key && config.processMap[key]) return config.processMap[key];
  // Los 3 formularios conocidos no caen al PROCESS_ID genérico (evita mezclar calidad en contacto).
  if (isFarmadosisFormKey(key)) return null;
  if (config.processMap.default) return config.processMap.default;
  return config.defaultProcessId;
}

export function buildExternalUrl(formKey: string, externalId: string): string {
  return `farmadosis://${formKey}/${externalId}`.slice(0, 1000);
}

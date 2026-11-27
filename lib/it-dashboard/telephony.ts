/**
 * Dashboard TI - «Telefonía» in the Proveedores window: telephone service of
 * each company, typed in by hand (table company_telephony, one per company).
 */

export const TELEPHONY_SERVICES = [
  { value: 'fija', label: 'Telefonía fija' },
  { value: 'ip', label: 'Telefonía IP / troncal SIP' },
  { value: 'celular', label: 'Plan celular' },
  { value: 'pbx_nube', label: 'Planta en la nube' },
] as const;

export type TelephonyService = (typeof TELEPHONY_SERVICES)[number]['value'];

export interface CompanyTelephonyInput {
  /** Name shown on the button (optional; falls back to the provider). */
  label: string;
  provider: string;
  serviceType: TelephonyService | '';
  mainNumber: string;
  lines: number | null;
  extensions: number | null;
  plan: string;
  monthlyCost: number | null;
  contractNumber: string;
  supportContact: string;
  notes: string;
}

export interface CompanyTelephony extends CompanyTelephonyInput {
  id: number;
  companyId: number;
  company: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const EMPTY_TELEPHONY_INPUT: CompanyTelephonyInput = {
  label: '',
  provider: '',
  serviceType: '',
  mainNumber: '',
  lines: null,
  extensions: null,
  plan: '',
  monthlyCost: null,
  contractNumber: '',
  supportContact: '',
  notes: '',
};

export const TELEPHONY_TEXT_LIMITS = {
  label: 100,
  provider: 100,
  mainNumber: 50,
  plan: 100,
  contractNumber: 50,
  supportContact: 150,
  notes: 1000,
} as const;

export const telephonyServiceLabel = (v: string | null | undefined) =>
  TELEPHONY_SERVICES.find((s) => s.value === v)?.label ?? '';

/** Text of the button of a telephone service. */
export function telephonyButtonLabel(item: Pick<CompanyTelephonyInput, 'label' | 'provider' | 'serviceType'>, index: number): string {
  if (item.label.trim()) return item.label.trim();
  const name = item.provider.trim() || `Servicio ${index + 1}`;
  const kind = telephonyServiceLabel(item.serviceType);
  return kind ? `${name} · ${kind}` : name;
}

export type TelephonyValidation =
  | { ok: true; value: CompanyTelephonyInput }
  | { ok: false; errors: Partial<Record<keyof CompanyTelephonyInput, string>> };

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

function asNumber(v: unknown): number | null | 'bad' {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 'bad';
}

/** Validates the body of PUT /api/it-dashboard/telephony/[companyId]. Every field is optional. */
export function validateTelephonyInput(body: unknown): TelephonyValidation {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: Partial<Record<keyof CompanyTelephonyInput, string>> = {};

  const text = {
    label: asText(src.label),
    provider: asText(src.provider),
    mainNumber: asText(src.mainNumber),
    plan: asText(src.plan),
    contractNumber: asText(src.contractNumber),
    supportContact: asText(src.supportContact),
    notes: asText(src.notes),
  };
  for (const key of Object.keys(TELEPHONY_TEXT_LIMITS) as Array<keyof typeof TELEPHONY_TEXT_LIMITS>) {
    if (text[key].length > TELEPHONY_TEXT_LIMITS[key]) errors[key] = `Máximo ${TELEPHONY_TEXT_LIMITS[key]} caracteres`;
  }
  if (!text.label && !text.provider) errors.provider = 'Escriba el proveedor o un nombre para el servicio';
  if (text.mainNumber && !errors.mainNumber && !/^[0-9+()\-\s.ext]+$/i.test(text.mainNumber)) {
    errors.mainNumber = 'Solo números, espacios, +, guiones y paréntesis';
  }

  const serviceType = asText(src.serviceType);
  if (serviceType && !TELEPHONY_SERVICES.some((s) => s.value === serviceType)) errors.serviceType = 'Tipo de servicio no válido';

  const whole = (key: 'lines' | 'extensions') => {
    const n = asNumber(src[key]);
    if (n === 'bad' || (typeof n === 'number' && (!Number.isInteger(n) || n < 0 || n > 100_000))) {
      errors[key] = 'Número entero de 0 en adelante';
      return null;
    }
    return n;
  };
  const lines = whole('lines');
  const extensions = whole('extensions');

  const costRaw = asNumber(src.monthlyCost);
  if (costRaw === 'bad' || (typeof costRaw === 'number' && (costRaw < 0 || costRaw > 1e12))) errors.monthlyCost = 'Valor no válido';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...text,
      serviceType: serviceType as TelephonyService | '',
      lines,
      extensions,
      monthlyCost: costRaw === null ? null : Math.round((costRaw as number) * 100) / 100,
    },
  };
}

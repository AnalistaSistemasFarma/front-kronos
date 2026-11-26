/**
 * Dashboard TI - «Internet» card: internet channel of each company, typed in
 * by hand (table company_internet, one row per company). Pure helpers.
 */
import { CIDR, IPV4, isIpAddress } from './server';

export const CHANNEL_TYPES = [
  { value: 'dedicado', label: 'Dedicado' },
  { value: 'banda_ancha', label: 'Banda ancha' },
] as const;

export const CONNECTION_TYPES = [
  { value: 'fibra', label: 'Fibra' },
  { value: 'coaxial', label: 'Coaxial' },
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number]['value'];
export type ConnectionType = (typeof CONNECTION_TYPES)[number]['value'];

export interface CompanyInternetInput {
  provider: string;
  publicIp: string;
  subnetMask: string;
  gateway: string;
  dnsServers: string;
  bandwidth: string;
  channelType: ChannelType | '';
  connectionType: ConnectionType | '';
  notes: string;
}

export interface CompanyInternet extends CompanyInternetInput {
  companyId: number;
  company: string;
  /** False when nothing was registered yet for the company. */
  registered: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const EMPTY_INTERNET_INPUT: CompanyInternetInput = {
  provider: '',
  publicIp: '',
  subnetMask: '',
  gateway: '',
  dnsServers: '',
  bandwidth: '',
  channelType: '',
  connectionType: '',
  notes: '',
};

export const INTERNET_FIELD_LIMITS: Record<keyof CompanyInternetInput, number> = {
  provider: 100,
  publicIp: 45,
  subnetMask: 45,
  gateway: 45,
  dnsServers: 200,
  bandwidth: 50,
  channelType: 20,
  connectionType: 20,
  notes: 1000,
};

export const channelLabel = (v: string | null | undefined) =>
  CHANNEL_TYPES.find((c) => c.value === v)?.label ?? '';
export const connectionLabel = (v: string | null | undefined) =>
  CONNECTION_TYPES.find((c) => c.value === v)?.label ?? '';

export type InternetValidation =
  | { ok: true; value: CompanyInternetInput }
  | { ok: false; errors: Partial<Record<keyof CompanyInternetInput, string>> };

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Validates the body of PUT /api/it-dashboard/internet/[companyId]. Empty fields are allowed. */
export function validateInternetInput(body: unknown): InternetValidation {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const raw = {
    provider: asText(src.provider),
    publicIp: asText(src.publicIp),
    subnetMask: asText(src.subnetMask),
    gateway: asText(src.gateway),
    dnsServers: asText(src.dnsServers),
    bandwidth: asText(src.bandwidth),
    channelType: asText(src.channelType),
    connectionType: asText(src.connectionType),
    notes: asText(src.notes),
  };
  const errors: Partial<Record<keyof CompanyInternetInput, string>> = {};

  for (const key of Object.keys(INTERNET_FIELD_LIMITS) as Array<keyof CompanyInternetInput>) {
    if (raw[key].length > INTERNET_FIELD_LIMITS[key]) errors[key] = `Máximo ${INTERNET_FIELD_LIMITS[key]} caracteres`;
  }
  if (raw.publicIp && !errors.publicIp && !isIpAddress(raw.publicIp)) errors.publicIp = 'Dirección IP no válida';
  if (raw.subnetMask && !errors.subnetMask && !IPV4.test(raw.subnetMask) && !CIDR.test(raw.subnetMask)) {
    errors.subnetMask = 'Use 255.255.255.248 o /29';
  }
  if (raw.gateway && !errors.gateway && !isIpAddress(raw.gateway)) errors.gateway = 'Dirección IP no válida';
  if (raw.dnsServers && !errors.dnsServers) {
    const bad = raw.dnsServers
      .split(/[,;\s]+/)
      .filter(Boolean)
      .some((ip) => !isIpAddress(ip));
    if (bad) errors.dnsServers = 'Separe las IP con comas';
  }
  if (raw.channelType && !CHANNEL_TYPES.some((c) => c.value === raw.channelType)) {
    errors.channelType = 'Elija Dedicado o Banda ancha';
  }
  if (raw.connectionType && !CONNECTION_TYPES.some((c) => c.value === raw.connectionType)) {
    errors.connectionType = 'Elija Fibra o Coaxial';
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...raw,
      channelType: raw.channelType as ChannelType | '',
      connectionType: raw.connectionType as ConnectionType | '',
    },
  };
}

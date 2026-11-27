/**
 * Dashboard TI - Proveedores → Internet: internet channels of each company,
 * typed in by hand (table company_internet, SEVERAL rows per company since
 * 2026-11-27). Pure helpers.
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
  /** Name shown on the button, e.g. «Canal principal» (optional; falls back to the provider). */
  label: string;
  provider: string;
  publicIp: string;
  subnetMask: string;
  gateway: string;
  /** DNS 1 (column dns_servers). */
  dnsServers: string;
  /** DNS 2 (column dns_secondary). */
  dns2: string;
  bandwidth: string;
  channelType: ChannelType | '';
  connectionType: ConnectionType | '';
  notes: string;
}

export interface CompanyInternet extends CompanyInternetInput {
  id: number;
  companyId: number;
  company: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const EMPTY_INTERNET_INPUT: CompanyInternetInput = {
  label: '',
  provider: '',
  publicIp: '',
  subnetMask: '',
  gateway: '',
  dnsServers: '',
  dns2: '',
  bandwidth: '',
  channelType: '',
  connectionType: '',
  notes: '',
};

export const INTERNET_FIELD_LIMITS: Record<keyof CompanyInternetInput, number> = {
  label: 100,
  provider: 100,
  publicIp: 45,
  subnetMask: 45,
  gateway: 45,
  dnsServers: 45,
  dns2: 45,
  bandwidth: 50,
  channelType: 20,
  connectionType: 20,
  notes: 1000,
};

export const channelLabel = (v: string | null | undefined) => CHANNEL_TYPES.find((c) => c.value === v)?.label ?? '';
export const connectionLabel = (v: string | null | undefined) =>
  CONNECTION_TYPES.find((c) => c.value === v)?.label ?? '';

/** Text of the button of a channel. */
export function internetButtonLabel(item: Pick<CompanyInternetInput, 'label' | 'provider' | 'bandwidth'>, index: number): string {
  const name = item.label.trim() || item.provider.trim() || `Canal ${index + 1}`;
  return item.bandwidth.trim() && !item.label.trim() ? `${name} · ${item.bandwidth.trim()}` : name;
}

export type InternetValidation =
  | { ok: true; value: CompanyInternetInput }
  | { ok: false; errors: Partial<Record<keyof CompanyInternetInput, string>> };

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Validates the body of POST / PUT internet. At least the name or the provider is required. */
export function validateInternetInput(body: unknown): InternetValidation {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const raw = {
    label: asText(src.label),
    provider: asText(src.provider),
    publicIp: asText(src.publicIp),
    subnetMask: asText(src.subnetMask),
    gateway: asText(src.gateway),
    dnsServers: asText(src.dnsServers),
    dns2: asText(src.dns2),
    bandwidth: asText(src.bandwidth),
    channelType: asText(src.channelType),
    connectionType: asText(src.connectionType),
    notes: asText(src.notes),
  };
  const errors: Partial<Record<keyof CompanyInternetInput, string>> = {};

  for (const key of Object.keys(INTERNET_FIELD_LIMITS) as Array<keyof CompanyInternetInput>) {
    if (raw[key].length > INTERNET_FIELD_LIMITS[key]) errors[key] = `Máximo ${INTERNET_FIELD_LIMITS[key]} caracteres`;
  }
  if (!raw.label && !raw.provider) errors.provider = 'Escriba el proveedor o un nombre para el canal';
  if (raw.publicIp && !errors.publicIp && !isIpAddress(raw.publicIp)) errors.publicIp = 'Dirección IP no válida';
  if (raw.subnetMask && !errors.subnetMask && !IPV4.test(raw.subnetMask) && !CIDR.test(raw.subnetMask)) {
    errors.subnetMask = 'Use 255.255.255.248 o /29';
  }
  if (raw.gateway && !errors.gateway && !isIpAddress(raw.gateway)) errors.gateway = 'Dirección IP no válida';
  if (raw.dnsServers && !errors.dnsServers && !isIpAddress(raw.dnsServers)) errors.dnsServers = 'Dirección IP no válida';
  if (raw.dns2 && !errors.dns2 && !isIpAddress(raw.dns2)) errors.dns2 = 'Dirección IP no válida';
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

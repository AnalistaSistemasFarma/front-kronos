'use client';

import type { ReactNode } from 'react';
import { Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconWorld } from '@tabler/icons-react';
import {
  CHANNEL_TYPES,
  CONNECTION_TYPES,
  EMPTY_INTERNET_INPUT,
  INTERNET_FIELD_LIMITS,
  channelLabel,
  connectionLabel,
  internetButtonLabel,
  type CompanyInternet,
  type CompanyInternetInput,
} from '../../lib/it-dashboard/internet';
import { text } from './assetFormat';
import ProviderRecords, { type ProviderRecordsConfig } from './ProviderRecords';

const TEXT_FIELDS: Array<{ key: keyof CompanyInternetInput; label: string; placeholder: string }> = [
  { key: 'provider', label: 'Proveedor de internet', placeholder: 'Claro, Movistar, ETB…' },
  { key: 'publicIp', label: 'IP pública', placeholder: '190.0.0.10' },
  { key: 'subnetMask', label: 'Máscara', placeholder: '255.255.255.248' },
  { key: 'gateway', label: 'Gateway', placeholder: '190.0.0.9' },
  { key: 'dnsServers', label: 'DNS 1', placeholder: '8.8.8.8' },
  { key: 'dns2', label: 'DNS 2', placeholder: '1.1.1.1' },
  { key: 'bandwidth', label: 'Ancho de banda', placeholder: '300 Mbps' },
];

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
        {label}
      </Text>
      <Text size='sm' style={{ wordBreak: 'break-word' }} component='div'>
        {value}
      </Text>
    </Stack>
  );
}

const config: ProviderRecordsConfig<CompanyInternet, CompanyInternetInput> = {
  endpoint: '/api/it-dashboard/internet',
  noun: 'ningún canal de internet',
  addLabel: 'Agregar canal',
  icon: <IconWorld size={16} />,
  buttonLabel: internetButtonLabel,
  summary: (i) => [i.label || i.provider, i.bandwidth].filter(Boolean).join(' · '),
  emptyForm: () => ({ ...EMPTY_INTERNET_INPUT }),
  toForm: (i) => ({
    label: i.label,
    provider: i.provider,
    publicIp: i.publicIp,
    subnetMask: i.subnetMask,
    gateway: i.gateway,
    dnsServers: i.dnsServers,
    dns2: i.dns2,
    bandwidth: i.bandwidth,
    channelType: i.channelType,
    connectionType: i.connectionType,
    notes: i.notes,
  }),
  toBody: (f) => ({ ...f }),
  renderView: (i) => (
    <Stack gap='md'>
      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing='md' verticalSpacing='sm'>
        {i.label ? <KeyValue label='Nombre del canal' value={i.label} /> : null}
        {TEXT_FIELDS.map((f) => (
          <KeyValue key={f.key} label={f.label} value={text(i[f.key])} />
        ))}
        <KeyValue label='Tipo de canal' value={channelLabel(i.channelType) || '—'} />
        <KeyValue label='Conexión' value={connectionLabel(i.connectionType) || '—'} />
      </SimpleGrid>
      <KeyValue label='Observaciones' value={text(i.notes)} />
    </Stack>
  ),
  renderForm: (form, set, errors) => (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
        <TextInput
          label='Nombre del canal'
          description='Texto del botón (opcional)'
          placeholder='Canal principal, respaldo, sede Funza…'
          value={form.label}
          maxLength={INTERNET_FIELD_LIMITS.label}
          error={errors.label}
          onChange={(e) => set({ label: e.currentTarget.value })}
          style={{ gridColumn: '1 / -1' }}
        />
        {TEXT_FIELDS.map((f) => (
          <TextInput
            key={f.key}
            label={f.label}
            placeholder={f.placeholder}
            value={form[f.key]}
            maxLength={INTERNET_FIELD_LIMITS[f.key]}
            error={errors[f.key]}
            onChange={(e) => set({ [f.key]: e.currentTarget.value } as Partial<CompanyInternetInput>)}
          />
        ))}
        <Select
          label='Tipo de canal'
          placeholder='Elija'
          data={[...CHANNEL_TYPES]}
          value={form.channelType || null}
          onChange={(v) => set({ channelType: (v ?? '') as CompanyInternetInput['channelType'] })}
          error={errors.channelType}
          clearable
          comboboxProps={{ zIndex: 500, withinPortal: true }}
        />
        <Select
          label='Conexión'
          placeholder='Elija'
          data={[...CONNECTION_TYPES]}
          value={form.connectionType || null}
          onChange={(v) => set({ connectionType: (v ?? '') as CompanyInternetInput['connectionType'] })}
          error={errors.connectionType}
          clearable
          comboboxProps={{ zIndex: 500, withinPortal: true }}
        />
      </SimpleGrid>
      <Textarea
        label='Observaciones'
        placeholder='Número de contrato, soporte del proveedor, sede…'
        autosize
        minRows={2}
        maxRows={5}
        value={form.notes}
        maxLength={INTERNET_FIELD_LIMITS.notes}
        error={errors.notes}
        onChange={(e) => set({ notes: e.currentTarget.value })}
      />
    </>
  ),
};

/** Proveedores → Internet: several channels per company. */
export default function InternetPanel({ companyId }: { companyId: number | null }) {
  return <ProviderRecords companyId={companyId} config={config} />;
}

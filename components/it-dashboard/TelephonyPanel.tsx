'use client';

import type { ReactNode } from 'react';
import { NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconPhone } from '@tabler/icons-react';
import {
  TELEPHONY_SERVICES,
  TELEPHONY_TEXT_LIMITS,
  telephonyButtonLabel,
  telephonyServiceLabel,
  type CompanyTelephony,
  type CompanyTelephonyInput,
} from '../../lib/it-dashboard/telephony';
import { formatMoney, formatNumber, text } from './assetFormat';
import ProviderRecords, { type ProviderRecordsConfig } from './ProviderRecords';

type Form = Omit<CompanyTelephonyInput, 'lines' | 'extensions' | 'monthlyCost'> & {
  lines: number | string;
  extensions: number | string;
  monthlyCost: number | string;
};

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

const config: ProviderRecordsConfig<CompanyTelephony, Form> = {
  endpoint: '/api/it-dashboard/telephony',
  noun: 'ningún servicio de telefonía',
  addLabel: 'Agregar servicio',
  icon: <IconPhone size={16} />,
  buttonLabel: telephonyButtonLabel,
  summary: (i) => i.label || [i.provider, telephonyServiceLabel(i.serviceType)].filter(Boolean).join(' · '),
  emptyForm: () => ({
    label: '',
    provider: '',
    serviceType: '',
    mainNumber: '',
    lines: '',
    extensions: '',
    plan: '',
    monthlyCost: '',
    contractNumber: '',
    supportContact: '',
    notes: '',
  }),
  toForm: (t) => ({
    label: t.label,
    provider: t.provider,
    serviceType: t.serviceType,
    mainNumber: t.mainNumber,
    lines: t.lines ?? '',
    extensions: t.extensions ?? '',
    plan: t.plan,
    monthlyCost: t.monthlyCost ?? '',
    contractNumber: t.contractNumber,
    supportContact: t.supportContact,
    notes: t.notes,
  }),
  toBody: (f) => ({
    ...f,
    lines: f.lines === '' ? null : f.lines,
    extensions: f.extensions === '' ? null : f.extensions,
    monthlyCost: f.monthlyCost === '' ? null : f.monthlyCost,
  }),
  renderView: (i) => (
    <Stack gap='md'>
      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing='md' verticalSpacing='sm'>
        {i.label ? <KeyValue label='Nombre del servicio' value={i.label} /> : null}
        <KeyValue label='Proveedor' value={text(i.provider)} />
        <KeyValue label='Tipo de servicio' value={telephonyServiceLabel(i.serviceType) || '—'} />
        <KeyValue label='Número principal' value={text(i.mainNumber)} />
        <KeyValue label='Plan' value={text(i.plan)} />
        <KeyValue label='Líneas' value={i.lines == null ? '—' : formatNumber(i.lines)} />
        <KeyValue label='Extensiones' value={i.extensions == null ? '—' : formatNumber(i.extensions)} />
        <KeyValue label='Costo mensual' value={i.monthlyCost == null ? '—' : formatMoney(i.monthlyCost)} />
        <KeyValue label='Número de contrato' value={text(i.contractNumber)} />
        <KeyValue label='Contacto de soporte' value={text(i.supportContact)} />
      </SimpleGrid>
      <KeyValue label='Observaciones' value={text(i.notes)} />
    </Stack>
  ),
  renderForm: (form, set, errors) => (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
        <TextInput
          label='Nombre del servicio'
          description='Texto del botón (opcional)'
          placeholder='Troncal principal, celulares gerencia…'
          value={form.label}
          maxLength={TELEPHONY_TEXT_LIMITS.label}
          error={errors.label}
          onChange={(e) => set({ label: e.currentTarget.value })}
          style={{ gridColumn: '1 / -1' }}
        />
        <TextInput
          label='Proveedor de telefonía'
          placeholder='Claro, Movistar, ETB…'
          value={form.provider}
          maxLength={TELEPHONY_TEXT_LIMITS.provider}
          error={errors.provider}
          onChange={(e) => set({ provider: e.currentTarget.value })}
        />
        <Select
          label='Tipo de servicio'
          placeholder='Elija'
          data={[...TELEPHONY_SERVICES]}
          value={form.serviceType || null}
          onChange={(v) => set({ serviceType: (v ?? '') as Form['serviceType'] })}
          error={errors.serviceType}
          clearable
          comboboxProps={{ zIndex: 500, withinPortal: true }}
        />
        <TextInput
          label='Número principal'
          placeholder='601 000 0000'
          value={form.mainNumber}
          maxLength={TELEPHONY_TEXT_LIMITS.mainNumber}
          error={errors.mainNumber}
          onChange={(e) => set({ mainNumber: e.currentTarget.value })}
        />
        <TextInput
          label='Plan'
          value={form.plan}
          maxLength={TELEPHONY_TEXT_LIMITS.plan}
          error={errors.plan}
          onChange={(e) => set({ plan: e.currentTarget.value })}
        />
        <NumberInput label='Número de líneas' min={0} allowDecimal={false} value={form.lines} error={errors.lines} onChange={(v) => set({ lines: v })} />
        <NumberInput label='Extensiones' min={0} allowDecimal={false} value={form.extensions} error={errors.extensions} onChange={(v) => set({ extensions: v })} />
        <NumberInput
          label='Costo mensual'
          min={0}
          prefix='$ '
          thousandSeparator='.'
          decimalSeparator=','
          decimalScale={2}
          value={form.monthlyCost}
          error={errors.monthlyCost}
          onChange={(v) => set({ monthlyCost: v })}
        />
        <TextInput
          label='Número de contrato'
          value={form.contractNumber}
          maxLength={TELEPHONY_TEXT_LIMITS.contractNumber}
          error={errors.contractNumber}
          onChange={(e) => set({ contractNumber: e.currentTarget.value })}
        />
        <TextInput
          label='Contacto de soporte'
          placeholder='Línea de soporte o ejecutivo de cuenta'
          value={form.supportContact}
          maxLength={TELEPHONY_TEXT_LIMITS.supportContact}
          error={errors.supportContact}
          onChange={(e) => set({ supportContact: e.currentTarget.value })}
          style={{ gridColumn: '1 / -1' }}
        />
      </SimpleGrid>
      <Textarea
        label='Observaciones'
        autosize
        minRows={2}
        maxRows={5}
        value={form.notes}
        maxLength={TELEPHONY_TEXT_LIMITS.notes}
        error={errors.notes}
        onChange={(e) => set({ notes: e.currentTarget.value })}
      />
    </>
  ),
};

/** Proveedores → Telefonía: several services per company. */
export default function TelephonyPanel({ companyId }: { companyId: number | null }) {
  return <ProviderRecords companyId={companyId} config={config} />;
}

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { IconAlertCircle, IconArrowLeft, IconCheck, IconDeviceFloppy, IconEdit, IconX } from '@tabler/icons-react';
import {
  TELEPHONY_SERVICES,
  TELEPHONY_TEXT_LIMITS,
  telephonyServiceLabel,
  type CompanyTelephony,
  type CompanyTelephonyInput,
} from '../../lib/it-dashboard/telephony';
import { formatMoney, formatNumber, text } from './assetFormat';

type FieldErrors = Partial<Record<keyof CompanyTelephonyInput, string>>;
type Form = Omit<CompanyTelephonyInput, 'lines' | 'extensions' | 'monthlyCost'> & {
  lines: number | string;
  extensions: number | string;
  monthlyCost: number | string;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(
    new Date(iso)
  );
}

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

const toForm = (t: CompanyTelephony): Form => ({
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
});

function CompanyTelephonyDetail({ item, onSaved }: { item: CompanyTelephony; onSaved: (t: CompanyTelephony) => void }) {
  const [editing, setEditing] = useState(!item.registered);
  const [form, setForm] = useState<Form>(() => toForm(item));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(toForm(item));
    setEditing(!item.registered);
    setErrors({});
    setError(null);
    setSaved(false);
  }, [item.companyId]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((cur) => ({ ...cur, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const res = await fetch(`/api/it-dashboard/telephony/${item.companyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          lines: form.lines === '' ? null : form.lines,
          extensions: form.extensions === '' ? null : form.extensions,
          monthlyCost: form.monthlyCost === '' ? null : form.monthlyCost,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.fields) setErrors(json.fields as FieldErrors);
        throw new Error(json.error ?? 'No se pudieron guardar los datos de telefonía.');
      }
      onSaved(json.telephony as CompanyTelephony);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap='md'>
      {error ? (
        <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' title='Error'>
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert icon={<IconCheck size={18} />} color='teal' variant='light' withCloseButton onClose={() => setSaved(false)}>
          Datos de telefonía guardados.
        </Alert>
      ) : null}

      {editing ? (
        <Stack gap='sm'>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
            <TextInput
              label='Proveedor de telefonía'
              placeholder='Claro, Movistar, ETB…'
              value={form.provider}
              maxLength={TELEPHONY_TEXT_LIMITS.provider}
              error={errors.provider}
              onChange={(e) => set('provider', e.currentTarget.value)}
            />
            <Select
              label='Tipo de servicio'
              placeholder='Elija'
              data={[...TELEPHONY_SERVICES]}
              value={form.serviceType || null}
              onChange={(v) => set('serviceType', (v ?? '') as Form['serviceType'])}
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
              onChange={(e) => set('mainNumber', e.currentTarget.value)}
            />
            <TextInput
              label='Plan'
              placeholder='Nombre del plan contratado'
              value={form.plan}
              maxLength={TELEPHONY_TEXT_LIMITS.plan}
              error={errors.plan}
              onChange={(e) => set('plan', e.currentTarget.value)}
            />
            <NumberInput
              label='Número de líneas'
              min={0}
              allowDecimal={false}
              value={form.lines}
              error={errors.lines}
              onChange={(v) => set('lines', v)}
            />
            <NumberInput
              label='Extensiones'
              min={0}
              allowDecimal={false}
              value={form.extensions}
              error={errors.extensions}
              onChange={(v) => set('extensions', v)}
            />
            <NumberInput
              label='Costo mensual'
              min={0}
              prefix='$ '
              thousandSeparator='.'
              decimalSeparator=','
              decimalScale={2}
              value={form.monthlyCost}
              error={errors.monthlyCost}
              onChange={(v) => set('monthlyCost', v)}
            />
            <TextInput
              label='Número de contrato'
              value={form.contractNumber}
              maxLength={TELEPHONY_TEXT_LIMITS.contractNumber}
              error={errors.contractNumber}
              onChange={(e) => set('contractNumber', e.currentTarget.value)}
            />
            <TextInput
              label='Contacto de soporte'
              placeholder='Línea de soporte o ejecutivo de cuenta'
              value={form.supportContact}
              maxLength={TELEPHONY_TEXT_LIMITS.supportContact}
              error={errors.supportContact}
              onChange={(e) => set('supportContact', e.currentTarget.value)}
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
            onChange={(e) => set('notes', e.currentTarget.value)}
          />
          <Group justify='flex-end' gap='xs'>
            {item.registered ? (
              <Button
                variant='default'
                leftSection={<IconX size={16} />}
                onClick={() => {
                  setForm(toForm(item));
                  setEditing(false);
                }}
                disabled={saving}
              >
                Cancelar
              </Button>
            ) : null}
            <Button leftSection={<IconDeviceFloppy size={16} />} onClick={() => void save()} loading={saving}>
              Guardar
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap='md'>
          <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing='md' verticalSpacing='sm'>
            <KeyValue label='Proveedor' value={text(item.provider)} />
            <KeyValue label='Tipo de servicio' value={telephonyServiceLabel(item.serviceType) || '—'} />
            <KeyValue label='Número principal' value={text(item.mainNumber)} />
            <KeyValue label='Plan' value={text(item.plan)} />
            <KeyValue label='Líneas' value={item.lines == null ? '—' : formatNumber(item.lines)} />
            <KeyValue label='Extensiones' value={item.extensions == null ? '—' : formatNumber(item.extensions)} />
            <KeyValue label='Costo mensual' value={item.monthlyCost == null ? '—' : formatMoney(item.monthlyCost)} />
            <KeyValue label='Número de contrato' value={text(item.contractNumber)} />
            <KeyValue label='Contacto de soporte' value={text(item.supportContact)} />
          </SimpleGrid>
          <KeyValue label='Observaciones' value={text(item.notes)} />
          <Group justify='space-between'>
            <Text size='xs' c='dimmed'>
              {item.updatedAt ? `Actualizado ${formatDateTime(item.updatedAt)}${item.updatedBy ? ` por ${item.updatedBy}` : ''}` : ''}
            </Text>
            <Button
              variant='light'
              leftSection={<IconEdit size={16} />}
              onClick={() => {
                setForm(toForm(item));
                setSaved(false);
                setEditing(true);
              }}
            >
              Editar
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}

/** «Telefonía» section of the Proveedores window (same behaviour as Internet). */
export default function TelephonyPanel({ companyId }: { companyId: number | null }) {
  const [items, setItems] = useState<CompanyTelephony[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(companyId);

  useEffect(() => {
    setPicked(companyId);
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/it-dashboard/telephony', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los datos de telefonía.');
        if (!cancelled) setItems((json.companies ?? []) as CompanyTelephony[]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSaved = (updated: CompanyTelephony) =>
    setItems((cur) => (cur ?? []).map((i) => (i.companyId === updated.companyId ? updated : i)));

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' title='Error al cargar'>
        {error}
      </Alert>
    );
  }
  if (!items) return <Skeleton height={220} />;

  const current = picked == null ? null : (items.find((i) => i.companyId === picked) ?? null);
  if (current) {
    return (
      <Stack gap='md'>
        {companyId == null ? (
          <Group>
            <Button size='xs' variant='subtle' leftSection={<IconArrowLeft size={14} />} onClick={() => setPicked(null)}>
              Todas las empresas
            </Button>
          </Group>
        ) : null}
        <Text fw={600}>{current.company}</Text>
        <CompanyTelephonyDetail item={current} onSaved={onSaved} />
      </Stack>
    );
  }

  return (
    <Stack gap='xs'>
      <Text size='sm' c='dimmed'>
        {items.filter((i) => i.registered).length} de {items.length} empresas con datos registrados · haga clic en una para ver o editar.
      </Text>
      <ScrollArea.Autosize mah='55vh' type='auto'>
        <Table striped highlightOnHover withTableBorder miw={700}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Empresa</Table.Th>
              <Table.Th>Proveedor</Table.Th>
              <Table.Th>Servicio</Table.Th>
              <Table.Th>Número principal</Table.Th>
              <Table.Th ta='right'>Líneas</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((i) => (
              <Table.Tr
                key={i.companyId}
                onClick={() => setPicked(i.companyId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPicked(i.companyId);
                  }
                }}
                tabIndex={0}
                role='button'
                aria-label={`Ver los datos de telefonía de ${i.company}`}
                style={{ cursor: 'pointer' }}
              >
                <Table.Td>
                  <Text size='sm' fw={500} c='blue' td='underline'>
                    {i.company}
                  </Text>
                </Table.Td>
                {i.registered ? (
                  <>
                    <Table.Td>{text(i.provider)}</Table.Td>
                    <Table.Td>
                      {i.serviceType ? (
                        <Badge size='sm' variant='light'>
                          {telephonyServiceLabel(i.serviceType)}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </Table.Td>
                    <Table.Td>{text(i.mainNumber)}</Table.Td>
                    <Table.Td ta='right'>{i.lines == null ? '—' : formatNumber(i.lines)}</Table.Td>
                  </>
                ) : (
                  <Table.Td colSpan={4}>
                    <Text size='sm' c='dimmed'>
                      Sin registrar
                    </Text>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
    </Stack>
  );
}

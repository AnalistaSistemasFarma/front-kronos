'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconDeviceFloppy,
  IconEdit,
  IconWorld,
  IconX,
} from '@tabler/icons-react';
import {
  CHANNEL_TYPES,
  CONNECTION_TYPES,
  EMPTY_INTERNET_INPUT,
  INTERNET_FIELD_LIMITS,
  channelLabel,
  connectionLabel,
  type CompanyInternet,
  type CompanyInternetInput,
} from '../../lib/it-dashboard/internet';
import { text } from './assetFormat';

type FieldErrors = Partial<Record<keyof CompanyInternetInput, string>>;

const TEXT_FIELDS: Array<{ key: keyof CompanyInternetInput; label: string; placeholder: string }> = [
  { key: 'provider', label: 'Proveedor de internet', placeholder: 'Claro, Movistar, ETB…' },
  { key: 'publicIp', label: 'IP pública', placeholder: '190.0.0.10' },
  { key: 'subnetMask', label: 'Máscara', placeholder: '255.255.255.248' },
  { key: 'gateway', label: 'Gateway', placeholder: '190.0.0.9' },
  { key: 'dnsServers', label: 'DNS', placeholder: '8.8.8.8, 1.1.1.1' },
  { key: 'bandwidth', label: 'Ancho de banda', placeholder: '300 Mbps' },
];

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

function ChannelBadges({ item }: { item: CompanyInternet }) {
  return (
    <Group gap={4}>
      {item.channelType ? (
        <Badge size='sm' variant='light' color={item.channelType === 'dedicado' ? 'indigo' : 'cyan'}>
          {channelLabel(item.channelType)}
        </Badge>
      ) : null}
      {item.connectionType ? (
        <Badge size='sm' variant='light' color={item.connectionType === 'fibra' ? 'teal' : 'orange'}>
          {connectionLabel(item.connectionType)}
        </Badge>
      ) : null}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Detail / edit of one company                                        */
/* ------------------------------------------------------------------ */

function CompanyInternetDetail({
  item,
  onSaved,
}: {
  item: CompanyInternet;
  onSaved: (updated: CompanyInternet) => void;
}) {
  const [editing, setEditing] = useState(!item.registered);
  const [form, setForm] = useState<CompanyInternetInput>(EMPTY_INTERNET_INPUT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fill = useCallback(() => {
    setForm({
      provider: item.provider,
      publicIp: item.publicIp,
      subnetMask: item.subnetMask,
      gateway: item.gateway,
      dnsServers: item.dnsServers,
      bandwidth: item.bandwidth,
      channelType: item.channelType,
      connectionType: item.connectionType,
      notes: item.notes,
    });
    setErrors({});
    setError(null);
  }, [item]);

  useEffect(() => {
    fill();
    setEditing(!item.registered);
    setSaved(false);
  }, [item.companyId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const res = await fetch(`/api/it-dashboard/internet/${item.companyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.fields) setErrors(json.fields as FieldErrors);
        throw new Error(json.error ?? 'No se pudieron guardar los datos de internet.');
      }
      onSaved(json.internet as CompanyInternet);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof CompanyInternetInput) => (value: string | null) =>
    setForm((cur) => ({ ...cur, [key]: value ?? '' }));

  return (
    <Stack gap='md'>
      {error ? (
        <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' title='Error'>
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert icon={<IconCheck size={18} />} color='teal' variant='light' withCloseButton onClose={() => setSaved(false)}>
          Datos de internet guardados.
        </Alert>
      ) : null}

      {editing ? (
        <Stack gap='sm'>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
            {TEXT_FIELDS.map((f) => (
              <TextInput
                key={f.key}
                label={f.label}
                placeholder={f.placeholder}
                value={form[f.key]}
                maxLength={INTERNET_FIELD_LIMITS[f.key]}
                error={errors[f.key]}
                onChange={(e) => set(f.key)(e.currentTarget.value)}
              />
            ))}
            <Select
              label='Tipo de canal'
              placeholder='Elija'
              data={[...CHANNEL_TYPES]}
              value={form.channelType || null}
              onChange={set('channelType')}
              error={errors.channelType}
              clearable
              comboboxProps={{ zIndex: 500, withinPortal: true }}
            />
            <Select
              label='Conexión'
              placeholder='Elija'
              data={[...CONNECTION_TYPES]}
              value={form.connectionType || null}
              onChange={set('connectionType')}
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
            onChange={(e) => set('notes')(e.currentTarget.value)}
          />
          <Group justify='flex-end' gap='xs'>
            {item.registered ? (
              <Button
                variant='default'
                leftSection={<IconX size={16} />}
                onClick={() => {
                  fill();
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
            {TEXT_FIELDS.map((f) => (
              <KeyValue key={f.key} label={f.label} value={text(item[f.key])} />
            ))}
            <KeyValue label='Tipo de canal' value={channelLabel(item.channelType) || '—'} />
            <KeyValue label='Conexión' value={connectionLabel(item.connectionType) || '—'} />
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
                fill();
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

/* ------------------------------------------------------------------ */
/* Card in the KPI row + its window                                    */
/* ------------------------------------------------------------------ */

/**
 * «Internet» card of the Dashboard TI. With a company selected it shows its
 * channel; with «Todas las empresas», how many have data. A click opens a
 * window to see and edit the data (provider, public IP, mask, gateway, DNS,
 * bandwidth, channel type and connection).
 */
export default function InternetCard({ companyId, color }: { companyId: number | null; color: string }) {
  const [items, setItems] = useState<CompanyInternet[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [modalCompany, setModalCompany] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/it-dashboard/internet', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los datos de internet.');
      setItems((json.companies ?? []) as CompanyInternet[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = useMemo(
    () => (companyId == null ? null : (items?.find((i) => i.companyId === companyId) ?? null)),
    [items, companyId]
  );
  const registeredCount = items?.filter((i) => i.registered).length ?? 0;
  const modalItem = modalCompany == null ? null : (items?.find((i) => i.companyId === modalCompany) ?? null);

  const open = () => {
    setModalCompany(companyId);
    setOpened(true);
  };

  const onSaved = (updated: CompanyInternet) =>
    setItems((cur) => (cur ?? []).map((i) => (i.companyId === updated.companyId ? updated : i)));

  let value: ReactNode;
  let hint: ReactNode;
  if (loading && !items) {
    value = <Skeleton height={28} width='70%' />;
    hint = <Skeleton height={10} width='50%' mt={6} />;
  } else if (error) {
    value = '—';
    hint = 'No se pudieron cargar los datos';
  } else if (companyId == null) {
    value = `${registeredCount} de ${items?.length ?? 0}`;
    hint = 'Empresas con datos de internet registrados';
  } else if (!current || !current.registered) {
    value = 'Sin registrar';
    hint = 'Haga clic para agregar los datos';
  } else {
    value = current.bandwidth || current.provider || 'Registrado';
    hint = (
      <Stack gap={4}>
        <Text size='xs' c='dimmed' lineClamp={1}>
          {current.provider || 'Proveedor sin registrar'}
          {current.publicIp ? ` · ${current.publicIp}` : ''}
        </Text>
        <ChannelBadges item={current} />
      </Stack>
    );
  }

  return (
    <>
      <Tooltip label='Ver y editar los datos de internet' withArrow>
        <UnstyledButton
          onClick={open}
          aria-label='Ver y editar los datos de internet'
          style={{ display: 'block', width: '100%', height: '100%', borderRadius: 'var(--mantine-radius-md)' }}
        >
          <Card shadow='sm' padding='lg' radius='md' withBorder h='100%'>
            <Group justify='space-between' mb='xs' wrap='nowrap'>
              <Text size='xs' tt='uppercase' fw={600} c='dimmed'>
                Internet
              </Text>
              <ThemeIcon size='lg' radius='md' variant='light' style={{ color }}>
                <IconWorld size={18} />
              </ThemeIcon>
            </Group>
            <Text fw={700} style={{ color, lineHeight: 1.1, fontSize: 'clamp(1.15rem, 2.2vw, 1.6rem)' }} lineClamp={1} component='div'>
              {value}
            </Text>
            <Text size='xs' c='dimmed' mt='xs' component='div'>
              {hint}
            </Text>
          </Card>
        </UnstyledButton>
      </Tooltip>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        size='xl'
        radius='md'
        centered
        title={
          <Group gap='sm' wrap='nowrap'>
            <ThemeIcon variant='light' radius='md' size='lg'>
              <IconWorld size={20} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={700}>Internet{modalItem ? ` · ${modalItem.company}` : ''}</Text>
              <Text size='xs' c='dimmed'>
                {modalItem ? 'Canal de internet de la empresa' : 'Haga clic en una empresa para ver o editar sus datos'}
              </Text>
            </Stack>
          </Group>
        }
      >
        {error ? (
          <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' title='Error al cargar'>
            {error}
          </Alert>
        ) : !items ? (
          <Skeleton height={240} />
        ) : modalItem ? (
          <Stack gap='md'>
            {companyId == null ? (
              <Group>
                <Button size='xs' variant='subtle' leftSection={<IconArrowLeft size={14} />} onClick={() => setModalCompany(null)}>
                  Todas las empresas
                </Button>
              </Group>
            ) : null}
            <CompanyInternetDetail item={modalItem} onSaved={onSaved} />
          </Stack>
        ) : (
          <ScrollArea.Autosize mah='60vh' type='auto'>
            <Table striped highlightOnHover withTableBorder miw={700}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Empresa</Table.Th>
                  <Table.Th>Proveedor</Table.Th>
                  <Table.Th>IP pública</Table.Th>
                  <Table.Th>Ancho de banda</Table.Th>
                  <Table.Th>Canal</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((i) => (
                  <Table.Tr
                    key={i.companyId}
                    onClick={() => setModalCompany(i.companyId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setModalCompany(i.companyId);
                      }
                    }}
                    tabIndex={0}
                    role='button'
                    aria-label={`Ver los datos de internet de ${i.company}`}
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
                        <Table.Td>{text(i.publicIp)}</Table.Td>
                        <Table.Td>{text(i.bandwidth)}</Table.Td>
                        <Table.Td>
                          <ChannelBadges item={i} />
                        </Table.Td>
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
        )}
      </Modal>
    </>
  );
}

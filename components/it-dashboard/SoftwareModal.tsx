'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  ActionIcon,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBell,
  IconCheck,
  IconDeviceFloppy,
  IconEdit,
  IconLicense,
  IconMail,
  IconPlus,
  IconX,
} from '@tabler/icons-react';
import {
  LICENSE_TYPES,
  MAX_NOTIFY_EMAILS,
  NOTIFY_DAYS_BEFORE,
  isEmail,
  SOFTWARE_KINDS,
  SOFTWARE_TEXT_LIMITS,
  expiryState,
  kindLabel,
  licenseTypeLabel,
  type SoftwareInput,
  type SoftwareItem,
} from '../../lib/it-dashboard/software';
import { formatDate, formatMoney, formatNumber, text } from './assetFormat';

type FieldErrors = Partial<Record<keyof SoftwareInput, string>>;
type FormState = Omit<SoftwareInput, 'companyId' | 'kind' | 'licenses' | 'cost'> & {
  companyId: string;
  kind: string;
  licenses: number | string;
  cost: number | string;
};

const EMPTY_FORM: FormState = {
  companyId: '',
  kind: 'software',
  description: '',
  provider: '',
  purchaseDate: '',
  expirationDate: '',
  licenses: '',
  assignedTo: '',
  cost: '',
  licenseType: '',
  notifyEmails: [],
  platformEmail: '',
};

/**
 * «Correos de notificación»: one input + «Agregar» button, and the added
 * e-mails below as removable chips (several allowed, up to MAX_NOTIFY_EMAILS).
 */
function NotifyEmailsField({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (list: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const add = () => {
    const parts = draft
      .split(/[,;\s]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) return;
    const bad = parts.find((p) => !isEmail(p));
    if (bad) {
      setLocal(`Correo no válido: ${bad}`);
      return;
    }
    const next = Array.from(new Set([...value, ...parts]));
    if (next.length > MAX_NOTIFY_EMAILS) {
      setLocal(`Máximo ${MAX_NOTIFY_EMAILS} correos`);
      return;
    }
    onChange(next);
    setDraft('');
    setLocal(null);
  };

  return (
    <Stack gap={6}>
      <Group gap='xs' align='flex-end' wrap='nowrap'>
        <TextInput
          label='Correos de notificación'
          description={`Se les envía un aviso ${NOTIFY_DAYS_BEFORE} días antes del vencimiento. Puede agregar varios.`}
          placeholder='correo@empresa.com'
          leftSection={<IconBell size={16} />}
          value={draft}
          error={local ?? error}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            setLocal(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          style={{ flex: 1 }}
        />
        <Button variant='light' leftSection={<IconPlus size={14} />} onClick={add} disabled={!draft.trim()}>
          Agregar
        </Button>
      </Group>
      {value.length ? (
        <Group gap={6}>
          {value.map((email) => (
            <Badge
              key={email}
              variant='light'
              size='lg'
              tt='none'
              rightSection={
                <ActionIcon
                  size='xs'
                  variant='transparent'
                  aria-label={`Quitar ${email}`}
                  onClick={() => onChange(value.filter((v) => v !== email))}
                >
                  <IconX size={12} />
                </ActionIcon>
              }
            >
              {email}
            </Badge>
          ))}
        </Group>
      ) : (
        <Text size='xs' c='dimmed'>
          Aún no hay correos de notificación.
        </Text>
      )}
    </Stack>
  );
}

function ExpiryBadge({ date }: { date: string }) {
  const state = expiryState(date);
  if (state === 'none') return <>—</>;
  const color = state === 'expired' ? 'red' : state === 'soon' ? 'orange' : 'teal';
  const label = state === 'expired' ? 'Vencido' : state === 'soon' ? 'Por vencer' : 'Vigente';
  return (
    <Stack gap={2}>
      <Text size='sm'>{formatDate(date)}</Text>
      <Badge size='xs' variant='light' color={color}>
        {label}
      </Badge>
    </Stack>
  );
}

/* Register / edit form. */
function SoftwareForm({
  initial,
  companies,
  lockedCompanyId,
  onCancel,
  onSaved,
}: {
  initial: SoftwareItem | null;
  companies: Array<{ id: number; name: string }>;
  lockedCompanyId: number | null;
  onCancel: () => void;
  onSaved: (item: SoftwareItem, created: boolean) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    initial
      ? {
          companyId: String(initial.companyId),
          kind: initial.kind,
          description: initial.description,
          provider: initial.provider,
          purchaseDate: initial.purchaseDate,
          expirationDate: initial.expirationDate,
          licenses: initial.licenses ?? '',
          assignedTo: initial.assignedTo,
          cost: initial.cost ?? '',
          licenseType: initial.licenseType,
          notifyEmails: initial.notifyEmails,
          platformEmail: initial.platformEmail,
        }
      : { ...EMPTY_FORM, companyId: lockedCompanyId ? String(lockedCompanyId) : '' }
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((cur) => ({ ...cur, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const body = {
        ...form,
        companyId: Number(form.companyId) || 0,
        licenses: form.licenses === '' ? null : form.licenses,
        cost: form.cost === '' ? null : form.cost,
      };
      const res = await fetch(initial ? `/api/it-dashboard/software/${initial.id}` : '/api/it-dashboard/software', {
        method: initial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.fields) setErrors(json.fields as FieldErrors);
        throw new Error(json.error ?? 'No se pudo guardar el software.');
      }
      onSaved(json.item as SoftwareItem, !initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  const companyOptions = companies.map((c) => ({ value: String(c.id), label: c.name }));

  return (
    <Stack gap='sm'>
      {error ? (
        <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' title='Error'>
          {error}
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
        <Select
          label='Empresa'
          required
          data={companyOptions}
          value={form.companyId || null}
          onChange={(v) => set('companyId', v ?? '')}
          disabled={lockedCompanyId != null && !initial}
          error={errors.companyId}
          searchable
          comboboxProps={{ zIndex: 500, withinPortal: true }}
        />
        <Select
          label='Tipo'
          required
          data={[...SOFTWARE_KINDS]}
          value={form.kind || null}
          onChange={(v) => set('kind', v ?? '')}
          error={errors.kind}
          allowDeselect={false}
          comboboxProps={{ zIndex: 500, withinPortal: true }}
        />
        <TextInput
          label='Descripción'
          required
          placeholder='Microsoft 365 Business, certificado SSL *.gsslatam.com…'
          value={form.description}
          maxLength={SOFTWARE_TEXT_LIMITS.description}
          error={errors.description}
          onChange={(e) => set('description', e.currentTarget.value)}
          style={{ gridColumn: '1 / -1' }}
        />
        <TextInput
          label='Proveedor'
          placeholder='Microsoft, Sectigo, distribuidor…'
          value={form.provider}
          maxLength={SOFTWARE_TEXT_LIMITS.provider}
          error={errors.provider}
          onChange={(e) => set('provider', e.currentTarget.value)}
        />
        <TextInput
          label='Asignado a'
          placeholder='Persona, área o servidor'
          value={form.assignedTo}
          maxLength={SOFTWARE_TEXT_LIMITS.assignedTo}
          error={errors.assignedTo}
          onChange={(e) => set('assignedTo', e.currentTarget.value)}
        />
        <TextInput
          type='date'
          label='Fecha de compra'
          value={form.purchaseDate}
          error={errors.purchaseDate}
          onChange={(e) => set('purchaseDate', e.currentTarget.value)}
        />
        <TextInput
          type='date'
          label='Fecha de vencimiento'
          value={form.expirationDate}
          error={errors.expirationDate}
          onChange={(e) => set('expirationDate', e.currentTarget.value)}
        />
        <NumberInput
          label='Número de licencias'
          min={0}
          allowDecimal={false}
          thousandSeparator='.'
          decimalSeparator=','
          value={form.licenses}
          error={errors.licenses}
          onChange={(v) => set('licenses', v)}
        />
        <NumberInput
          label='Costo'
          min={0}
          prefix='$ '
          thousandSeparator='.'
          decimalSeparator=','
          decimalScale={2}
          value={form.cost}
          error={errors.cost}
          onChange={(v) => set('cost', v)}
        />
        <Select
          label='Tipo de licencia'
          placeholder='Elija'
          data={[...LICENSE_TYPES]}
          value={form.licenseType || null}
          onChange={(v) => set('licenseType', (v ?? '') as FormState['licenseType'])}
          error={errors.licenseType}
          clearable
          comboboxProps={{ zIndex: 500, withinPortal: true }}
        />
        <TextInput
          label='Correo de registro en plataforma'
          description='Cuenta con la que se registró en la plataforma del proveedor'
          placeholder='licencias@gsslatam.com'
          leftSection={<IconMail size={16} />}
          value={form.platformEmail}
          error={errors.platformEmail}
          onChange={(e) => set('platformEmail', e.currentTarget.value)}
        />
      </SimpleGrid>
      <NotifyEmailsField
        value={form.notifyEmails}
        onChange={(list) => {
          setErrors((cur) => ({ ...cur, notifyEmails: undefined }));
          set('notifyEmails', list);
        }}
        error={errors.notifyEmails}
      />
      <Group justify='flex-end' gap='xs' mt='xs'>
        <Button variant='default' leftSection={<IconArrowLeft size={16} />} onClick={onCancel} disabled={saving}>
          Volver
        </Button>
        <Button leftSection={<IconDeviceFloppy size={16} />} onClick={() => void save()} loading={saving}>
          {initial ? 'Guardar cambios' : 'Registrar'}
        </Button>
      </Group>
    </Stack>
  );
}

/**
 * «Software» window: software and certificates of the selected company (or
 * all), with expiry status, and the «Registrar software» form.
 */
export default function SoftwareModal({
  opened,
  onClose,
  companyId,
  companyName,
  companies,
  onChanged,
}: {
  opened: boolean;
  onClose: () => void;
  companyId: number | null;
  companyName: string;
  companies: Array<{ id: number; name: string }>;
  /** Called after a save so the dashboard refreshes its counter. */
  onChanged: () => void;
}) {
  const [items, setItems] = useState<SoftwareItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'new' | SoftwareItem>('list');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    setMode('list');
    setNotice(null);
    const q = companyId == null ? '' : `?company=${companyId}`;
    fetch(`/api/it-dashboard/software${q}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el software.');
        if (!cancelled) setItems((json.items ?? []) as SoftwareItem[]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
      });
    return () => {
      cancelled = true;
    };
  }, [opened, companyId]);

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      expired: list.filter((i) => expiryState(i.expirationDate) === 'expired').length,
      soon: list.filter((i) => expiryState(i.expirationDate) === 'soon').length,
    };
  }, [items]);

  const onSaved = (item: SoftwareItem, created: boolean) => {
    setItems((cur) => {
      const list = cur ?? [];
      const visible = companyId == null || item.companyId === companyId;
      const rest = list.filter((i) => i.id !== item.id);
      return visible ? [item, ...rest] : rest;
    });
    setNotice(created ? 'Software registrado.' : 'Cambios guardados.');
    setMode('list');
    onChanged();
  };

  const title =
    mode === 'new' ? 'Registrar software' : typeof mode === 'object' ? `Editar · ${mode.description}` : 'Software';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={mode === 'list' ? '80rem' : 'xl'}
      radius='md'
      centered
      title={
        <Group gap='sm' wrap='nowrap'>
          <ThemeIcon variant='light' radius='md' size='lg'>
            <IconLicense size={20} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text fw={700}>{title}</Text>
            <Text size='xs' c='dimmed'>
              {companyName}
            </Text>
          </Stack>
        </Group>
      }
    >
      {mode !== 'list' ? (
        <SoftwareForm
          key={typeof mode === 'object' ? mode.id : 'new'}
          initial={typeof mode === 'object' ? mode : null}
          companies={companies}
          lockedCompanyId={companyId}
          onCancel={() => setMode('list')}
          onSaved={onSaved}
        />
      ) : error ? (
        <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' title='Error al cargar'>
          {error}
        </Alert>
      ) : !items ? (
        <Skeleton height={260} />
      ) : (
        <Stack gap='sm'>
          {notice ? (
            <Alert icon={<IconCheck size={18} />} color='teal' variant='light' withCloseButton onClose={() => setNotice(null)}>
              {notice}
            </Alert>
          ) : null}
          {counts.expired > 0 || counts.soon > 0 ? (
            <Alert icon={<IconAlertCircle size={18} />} color={counts.expired > 0 ? 'red' : 'orange'} variant='light'>
              {counts.expired > 0 ? `${counts.expired} vencido(s)` : ''}
              {counts.expired > 0 && counts.soon > 0 ? ' · ' : ''}
              {counts.soon > 0 ? `${counts.soon} por vencer en los próximos 30 días` : ''}
            </Alert>
          ) : null}
          <Group justify='space-between'>
            <Text size='sm' c='dimmed'>
              {formatNumber(items.length)} registros
            </Text>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setMode('new')}>
              Registrar software
            </Button>
          </Group>
          {items.length === 0 ? (
            <Text c='dimmed' ta='center' py='lg' size='sm'>
              Aún no hay software ni certificados registrados.
            </Text>
          ) : (
            <ScrollArea.Autosize mah='60vh' type='auto'>
              <Table striped highlightOnHover withTableBorder stickyHeader miw={1250}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th>Descripción</Table.Th>
                    {companyId == null ? <Table.Th>Empresa</Table.Th> : null}
                    <Table.Th>Proveedor</Table.Th>
                    <Table.Th>Licencia</Table.Th>
                    <Table.Th ta='right'>Licencias</Table.Th>
                    <Table.Th>Asignado a</Table.Th>
                    <Table.Th>Correo de registro</Table.Th>
                    <Table.Th>Compra</Table.Th>
                    <Table.Th>Vencimiento</Table.Th>
                    <Table.Th ta='right'>Costo</Table.Th>
                    <Table.Th>Aviso</Table.Th>
                    <Table.Th aria-label='Editar' />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((i) => (
                    <Table.Tr key={i.id}>
                      <Table.Td>
                        <Badge variant='light' color={i.kind === 'certificado' ? 'grape' : i.kind === 'dominio' ? 'teal' : 'blue'}>
                          {kindLabel(i.kind)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size='sm' fw={500}>
                          {i.description}
                        </Text>
                      </Table.Td>
                      {companyId == null ? <Table.Td>{i.company}</Table.Td> : null}
                      <Table.Td>{text(i.provider)}</Table.Td>
                      <Table.Td>{licenseTypeLabel(i.licenseType) || '—'}</Table.Td>
                      <Table.Td ta='right'>{i.licenses == null ? '—' : formatNumber(i.licenses)}</Table.Td>
                      <Table.Td>{text(i.assignedTo)}</Table.Td>
                      <Table.Td>{text(i.platformEmail)}</Table.Td>
                      <Table.Td>{formatDate(i.purchaseDate || null)}</Table.Td>
                      <Table.Td>
                        <ExpiryBadge date={i.expirationDate} />
                      </Table.Td>
                      <Table.Td ta='right'>{i.cost == null ? '—' : formatMoney(i.cost)}</Table.Td>
                      <Table.Td>
                        {i.notifyEmails.length ? (
                          <Tooltip
                            label={`${i.notifyEmails.join(', ')}${i.noticeSentAt ? ` · último aviso ${formatDate(i.noticeSentAt)}` : ''}`}
                            withArrow
                            multiline
                            maw={320}
                          >
                            <Badge size='sm' variant='light' color='blue' leftSection={<IconBell size={12} />}>
                              {i.notifyEmails.length}
                            </Badge>
                          </Tooltip>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label='Editar' withArrow>
                          <ActionIcon variant='subtle' aria-label={`Editar ${i.description}`} onClick={() => setMode(i)}>
                            <IconEdit size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Stack>
      )}
    </Modal>
  );
}

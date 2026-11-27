'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Skeleton,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconDeviceFloppy,
  IconEdit,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react';

export interface ProviderRecord {
  id: number;
  companyId: number;
  company: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type FieldErrors = Record<string, string | undefined>;

export interface ProviderRecordsConfig<T extends ProviderRecord, F extends object> {
  /** API base: GET ?company= / POST, and PUT / DELETE /<id>. */
  endpoint: string;
  /** «canal de internet», «servicio de telefonía». */
  noun: string;
  addLabel: string;
  icon: ReactNode;
  buttonLabel: (item: T, index: number) => string;
  /** Short text for the company list (Todas las empresas). */
  summary: (item: T) => string;
  emptyForm: () => F;
  toForm: (item: T) => F;
  toBody: (form: F) => Record<string, unknown>;
  renderView: (item: T) => ReactNode;
  renderForm: (form: F, set: (patch: Partial<F>) => void, errors: FieldErrors) => ReactNode;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(
    new Date(iso)
  );
}

/**
 * Several records per company (Proveedores → Internet / Telefonía): one button
 * per record that shows its data on click, plus «Agregar» for a new one.
 * With «Todas las empresas» it first lists the companies.
 */
export default function ProviderRecords<T extends ProviderRecord, F extends object>({
  companyId,
  config,
}: {
  companyId: number | null;
  config: ProviderRecordsConfig<T, F>;
}) {
  const [items, setItems] = useState<T[] | null>(null);
  const [companies, setCompanies] = useState<Array<{ id: number; name: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(companyId);
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<F>(config.emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPicked(companyId);
    setSelected(null);
    setEditing(false);
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setLoadError(null);
    fetch(config.endpoint, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los datos.');
        if (!cancelled) {
          setItems((json.items ?? []) as T[]);
          setCompanies((json.companies ?? []) as Array<{ id: number; name: string }>);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
      });
    return () => {
      cancelled = true;
    };
  }, [config.endpoint]);

  const companyItems = useMemo(() => (items ?? []).filter((i) => i.companyId === picked), [items, picked]);
  const current = typeof selected === 'number' ? (companyItems.find((i) => i.id === selected) ?? null) : null;
  const companyName = companies.find((c) => c.id === picked)?.name ?? companyItems[0]?.company ?? '';

  const reset = useCallback(() => {
    setErrors({});
    setError(null);
  }, []);

  const select = (id: number) => {
    reset();
    setNotice(null);
    setEditing(false);
    setSelected((cur) => (cur === id ? null : id));
  };
  const startNew = () => {
    reset();
    setNotice(null);
    setForm(config.emptyForm());
    setSelected('new');
    setEditing(true);
  };
  const startEdit = (item: T) => {
    reset();
    setNotice(null);
    setForm(config.toForm(item));
    setEditing(true);
  };

  const save = async () => {
    if (picked == null) return;
    setSaving(true);
    reset();
    try {
      const isNew = selected === 'new';
      const res = await fetch(isNew ? config.endpoint : `${config.endpoint}/${selected}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config.toBody(form), companyId: picked }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.fields) setErrors(json.fields as FieldErrors);
        throw new Error(json.error ?? 'No se pudo guardar.');
      }
      const item = json.item as T;
      setItems((cur) => {
        const list = (cur ?? []).filter((i) => i.id !== item.id);
        return [...list, item].sort((a, b) => a.id - b.id);
      });
      setSelected(item.id);
      setEditing(false);
      setNotice(isNew ? 'Registro agregado.' : 'Cambios guardados.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: T, label: string) => {
    if (!window.confirm(`¿Eliminar «${label}»?`)) return;
    setSaving(true);
    reset();
    try {
      const res = await fetch(`${config.endpoint}/${item.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'No se pudo eliminar.');
      setItems((cur) => (cur ?? []).filter((i) => i.id !== item.id));
      setSelected(null);
      setNotice('Registro eliminado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light' title='Error al cargar'>
        {loadError}
      </Alert>
    );
  }
  if (!items) return <Skeleton height={200} />;

  /* «Todas las empresas»: list of companies. */
  if (picked == null) {
    return (
      <Stack gap='xs'>
        <Text size='sm' c='dimmed'>
          Haga clic en una empresa para ver, agregar o editar sus registros.
        </Text>
        <ScrollArea.Autosize mah='55vh' type='auto'>
          <Table striped highlightOnHover withTableBorder miw={600}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Empresa</Table.Th>
                <Table.Th>Registros</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {companies.map((c) => {
                const list = items.filter((i) => i.companyId === c.id);
                return (
                  <Table.Tr
                    key={c.id}
                    onClick={() => setPicked(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPicked(c.id);
                      }
                    }}
                    tabIndex={0}
                    role='button'
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td>
                      <Text size='sm' fw={500} c='blue' td='underline'>
                        {c.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {list.length ? (
                        <Group gap={4}>
                          {list.map((i) => (
                            <Badge key={i.id} size='sm' variant='light'>
                              {config.summary(i)}
                            </Badge>
                          ))}
                        </Group>
                      ) : (
                        <Text size='sm' c='dimmed'>
                          Sin registrar
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      </Stack>
    );
  }

  /* One company: one button per record + «Agregar». */
  return (
    <Stack gap='md'>
      {companyId == null ? (
        <Group>
          <Button
            size='xs'
            variant='subtle'
            leftSection={<IconArrowLeft size={14} />}
            onClick={() => {
              setPicked(null);
              setSelected(null);
              setEditing(false);
            }}
          >
            Todas las empresas
          </Button>
        </Group>
      ) : null}
      <Text fw={600}>{companyName}</Text>

      {error ? (
        <Alert icon={<IconAlertCircle size={18} />} color='red' variant='light'>
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert icon={<IconCheck size={18} />} color='teal' variant='light' withCloseButton onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      ) : null}

      <Group gap='sm'>
        {companyItems.map((item, index) => (
          <Button
            key={item.id}
            variant={selected === item.id ? 'filled' : 'light'}
            leftSection={config.icon}
            onClick={() => select(item.id)}
            aria-pressed={selected === item.id}
          >
            {config.buttonLabel(item, index)}
          </Button>
        ))}
        <Button variant='outline' leftSection={<IconPlus size={16} />} onClick={startNew} disabled={saving}>
          {config.addLabel}
        </Button>
      </Group>
      {companyItems.length === 0 && selected !== 'new' ? (
        <Text size='sm' c='dimmed'>
          Esta empresa aún no tiene {config.noun} registrado.
        </Text>
      ) : null}

      {selected === 'new' || (current && editing) ? (
        <Paper withBorder radius='md' p='md'>
          <Stack gap='sm'>
            {config.renderForm(form, (patch) => setForm((f) => ({ ...f, ...patch })), errors)}
            <Group justify='flex-end' gap='xs'>
              <Button
                variant='default'
                leftSection={<IconX size={16} />}
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  if (selected === 'new') setSelected(null);
                  reset();
                }}
              >
                Cancelar
              </Button>
              <Button leftSection={<IconDeviceFloppy size={16} />} loading={saving} onClick={() => void save()}>
                {selected === 'new' ? 'Agregar' : 'Guardar'}
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : current ? (
        <Paper withBorder radius='md' p='md'>
          <Stack gap='md'>
            {config.renderView(current)}
            <Group justify='space-between'>
              <Text size='xs' c='dimmed'>
                {current.updatedAt
                  ? `Actualizado ${formatDateTime(current.updatedAt)}${current.updatedBy ? ` por ${current.updatedBy}` : ''}`
                  : ''}
              </Text>
              <Group gap='xs'>
                <Button
                  variant='subtle'
                  color='red'
                  leftSection={<IconTrash size={16} />}
                  disabled={saving}
                  onClick={() => void remove(current, config.buttonLabel(current, companyItems.indexOf(current)))}
                >
                  Eliminar
                </Button>
                <Button variant='light' leftSection={<IconEdit size={16} />} onClick={() => startEdit(current)}>
                  Editar
                </Button>
              </Group>
            </Group>
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}

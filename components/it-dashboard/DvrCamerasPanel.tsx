'use client';

import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconDeviceCctv,
  IconDeviceFloppy,
  IconEdit,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  CAMERA_STATUSES,
  CAMERA_TEXT_LIMITS,
  cameraStatusColor,
  cameraStatusLabel,
  summarizeCameras,
  type Camera,
  type CameraInput,
} from '../../lib/it-dashboard/cameras';
import { text } from './assetFormat';

type FieldErrors = Partial<Record<keyof CameraInput, string>>;
type Form = { name: string; location: string; brand: string; status: string };
const EMPTY: Form = { name: '', location: '', brand: '', status: 'funcional' };

/**
 * «Cámaras» section of the detail window of a DVR: list with status, and a
 * button to register / edit / remove cameras (nombre, ubicación, marca, estado).
 */
export default function DvrCamerasPanel({ dvrId }: { dvrId: number }) {
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | number | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const url = `/api/it-dashboard/assets/${dvrId}/cameras`;

  useEffect(() => {
    let cancelled = false;
    setCameras(null);
    setError(null);
    setEditing(null);
    setNotice(null);
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar las cámaras.');
        if (!cancelled) setCameras((json.cameras ?? []) as Camera[]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const startNew = () => {
    setForm(EMPTY);
    setErrors({});
    setNotice(null);
    setEditing('new');
  };
  const startEdit = (c: Camera) => {
    setForm({ name: c.name, location: c.location, brand: c.brand, status: c.status });
    setErrors({});
    setNotice(null);
    setEditing(c.id);
  };

  const call = async (method: 'POST' | 'PUT' | 'DELETE', cameraId?: number, body?: Form) => {
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const res = await fetch(cameraId ? `${url}?camera=${cameraId}` : url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.fields) setErrors(json.fields as FieldErrors);
        throw new Error(json.error ?? 'No se pudo guardar la cámara.');
      }
      setCameras((json.cameras ?? []) as Camera[]);
      setEditing(null);
      setNotice(method === 'POST' ? 'Cámara registrada.' : method === 'PUT' ? 'Cambios guardados.' : 'Cámara eliminada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  const summary = summarizeCameras(cameras ?? []);

  return (
    <Paper withBorder radius='md' p='md'>
      <Stack gap='sm'>
        <Group justify='space-between' wrap='wrap'>
          <Group gap='xs'>
            <ThemeIcon variant='light' size='sm' radius='md'>
              <IconDeviceCctv size={14} />
            </ThemeIcon>
            <Title order={6}>Cámaras del DVR</Title>
            {cameras && cameras.length ? (
              <Group gap={4}>
                {CAMERA_STATUSES.map((s) =>
                  summary[s.value] ? (
                    <Badge key={s.value} size='sm' variant='light' color={s.color}>
                      {summary[s.value]} {s.label.toLowerCase()}
                    </Badge>
                  ) : null
                )}
              </Group>
            ) : null}
          </Group>
          {editing == null ? (
            <Button size='xs' leftSection={<IconPlus size={14} />} onClick={startNew} disabled={!cameras}>
              Registrar cámara
            </Button>
          ) : null}
        </Group>

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

        {editing != null ? (
          <Paper withBorder radius='md' p='sm' bg='var(--mantine-color-default-hover)'>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
              <TextInput
                label='Nombre'
                required
                placeholder='Cámara 01 - Entrada'
                value={form.name}
                maxLength={CAMERA_TEXT_LIMITS.name}
                error={errors.name}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setForm((f) => ({ ...f, name: v }));
                }}
              />
              <TextInput
                label='Ubicación'
                placeholder='Bodega, piso 2, parqueadero…'
                value={form.location}
                maxLength={CAMERA_TEXT_LIMITS.location}
                error={errors.location}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setForm((f) => ({ ...f, location: v }));
                }}
              />
              <TextInput
                label='Marca'
                placeholder='Hikvision, Dahua…'
                value={form.brand}
                maxLength={CAMERA_TEXT_LIMITS.brand}
                error={errors.brand}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setForm((f) => ({ ...f, brand: v }));
                }}
              />
              <Select
                label='Estado'
                required
                data={CAMERA_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                value={form.status}
                onChange={(v) => setForm((f) => ({ ...f, status: v ?? 'funcional' }))}
                error={errors.status}
                allowDeselect={false}
                comboboxProps={{ zIndex: 600, withinPortal: true }}
              />
            </SimpleGrid>
            <Group justify='flex-end' gap='xs' mt='sm'>
              <Button size='xs' variant='default' leftSection={<IconX size={14} />} onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button
                size='xs'
                leftSection={<IconDeviceFloppy size={14} />}
                loading={saving}
                onClick={() => void (editing === 'new' ? call('POST', undefined, form) : call('PUT', editing, form))}
              >
                {editing === 'new' ? 'Registrar' : 'Guardar'}
              </Button>
            </Group>
          </Paper>
        ) : null}

        {!cameras ? (
          error ? null : <Skeleton height={80} />
        ) : cameras.length === 0 ? (
          <Text size='sm' c='dimmed'>
            Este DVR aún no tiene cámaras registradas.
          </Text>
        ) : (
          <ScrollArea.Autosize mah={320} type='auto'>
            <Table striped highlightOnHover withTableBorder miw={560}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Ubicación</Table.Th>
                  <Table.Th>Marca</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th aria-label='Acciones' />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {cameras.map((c) => (
                  <Table.Tr key={c.id}>
                    <Table.Td>
                      <Text size='sm' fw={500}>
                        {c.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>{text(c.location)}</Table.Td>
                    <Table.Td>{text(c.brand)}</Table.Td>
                    <Table.Td>
                      <Badge variant='light' color={cameraStatusColor(c.status)}>
                        {cameraStatusLabel(c.status)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap='nowrap' justify='flex-end'>
                        <Tooltip label='Editar' withArrow>
                          <ActionIcon variant='subtle' aria-label={`Editar ${c.name}`} onClick={() => startEdit(c)} disabled={saving}>
                            <IconEdit size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label='Eliminar' withArrow>
                          <ActionIcon
                            variant='subtle'
                            color='red'
                            aria-label={`Eliminar ${c.name}`}
                            disabled={saving}
                            onClick={() => {
                              if (window.confirm(`¿Eliminar la cámara «${c.name}»?`)) void call('DELETE', c.id);
                            }}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        )}
      </Stack>
    </Paper>
  );
}

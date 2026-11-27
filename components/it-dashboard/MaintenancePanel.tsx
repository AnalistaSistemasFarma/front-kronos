'use client';

import { useEffect, useState } from 'react';
import {
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
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconDeviceFloppy, IconHistory, IconTool } from '@tabler/icons-react';
import {
  MAINTENANCE_KINDS,
  MAINTENANCE_NOTES_LIMIT,
  maintenanceKindColor,
  maintenanceKindLabel,
  type MaintenanceInput,
  type MaintenanceLog,
} from '../../lib/it-dashboard/maintenance';
import { formatDate, text } from './assetFormat';

type FieldErrors = Partial<Record<keyof MaintenanceInput, string>>;

const todayBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(
    new Date(iso)
  );
}

/**
 * «Mantenimiento» section of the detail window of a computer: date (calendar)
 * + kind (Preventivo / Correctivo) + optional note, and the «Logs» table below
 * with every registered maintenance.
 */
export default function MaintenancePanel({ assetId }: { assetId: number }) {
  const [logs, setLogs] = useState<MaintenanceLog[] | null>(null);
  const [date, setDate] = useState(todayBogota());
  const [kind, setKind] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const url = `/api/it-dashboard/assets/${assetId}/maintenance`;

  useEffect(() => {
    let cancelled = false;
    setLogs(null);
    setError(null);
    setNotice(null);
    setDate(todayBogota());
    setKind(null);
    setNotes('');
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar el registro de mantenimientos.');
        if (!cancelled) setLogs((json.logs ?? []) as MaintenanceLog[]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setErrors({});
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, kind: kind ?? '', notes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.fields) setErrors(json.fields as FieldErrors);
        throw new Error(json.error ?? 'No se pudo registrar el mantenimiento.');
      }
      setLogs((json.logs ?? []) as MaintenanceLog[]);
      setKind(null);
      setNotes('');
      setNotice('Mantenimiento registrado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper withBorder radius='md' p='md'>
      <Stack gap='sm'>
        <Group gap='xs'>
          <ThemeIcon variant='light' size='sm' radius='md'>
            <IconTool size={14} />
          </ThemeIcon>
          <Title order={6}>Mantenimiento</Title>
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

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='sm'>
          <TextInput
            type='date'
            label='Fecha'
            required
            value={date}
            error={errors.date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <Select
            label='Tipo de mantenimiento'
            required
            placeholder='Elija'
            data={MAINTENANCE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
            value={kind}
            onChange={setKind}
            error={errors.kind}
            comboboxProps={{ zIndex: 600, withinPortal: true }}
          />
          <TextInput
            label='Observación'
            placeholder='Opcional: qué se hizo'
            value={notes}
            maxLength={MAINTENANCE_NOTES_LIMIT}
            error={errors.notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />
        </SimpleGrid>
        <Group justify='flex-end'>
          <Button size='xs' leftSection={<IconDeviceFloppy size={14} />} loading={saving} onClick={() => void save()}>
            Registrar mantenimiento
          </Button>
        </Group>

        <Group gap='xs' mt='xs'>
          <IconHistory size={16} />
          <Text size='sm' fw={600}>
            Logs
          </Text>
          {logs ? (
            <Text size='xs' c='dimmed'>
              {logs.length} registro(s)
            </Text>
          ) : null}
        </Group>
        {!logs ? (
          error ? null : <Skeleton height={80} />
        ) : logs.length === 0 ? (
          <Text size='sm' c='dimmed'>
            Aún no hay mantenimientos registrados para este equipo.
          </Text>
        ) : (
          <ScrollArea.Autosize mah={260} type='auto'>
            <Table striped withTableBorder miw={600} fz='sm'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha del mantenimiento</Table.Th>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th>Observación</Table.Th>
                  <Table.Th>Registrado por</Table.Th>
                  <Table.Th>Registrado el</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {logs.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td>{formatDate(l.date)}</Table.Td>
                    <Table.Td>
                      <Badge size='sm' variant='light' color={maintenanceKindColor(l.kind)}>
                        {maintenanceKindLabel(l.kind)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{text(l.notes)}</Table.Td>
                    <Table.Td>{text(l.createdBy)}</Table.Td>
                    <Table.Td>{formatDateTime(l.createdAt)}</Table.Td>
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

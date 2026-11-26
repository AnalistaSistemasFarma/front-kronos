'use client';

import { Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { IconCalendarDue } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface Data {
  canEdit: boolean;
  tableFields: { id: number; label: string; columns: { key: string; label: string; type: string }[] }[];
  tracking: { idFormField: number; dateCol: string; extensionCol: string | null; statusCol: string | null; doneValue: string | null; warnBusinessDays: number; singleExtension: boolean } | null;
  tasks: { id: number; task: string; startDelayDays: number | null }[];
}

/**
 * «Seguimiento de fechas» (2026-11-26): fechas comprometidas de una tabla del formulario (aviso antes de vencer, aviso
 * de vencida, una sola prórroga) y tareas diferidas (p. ej. verificación de eficacia a los 90 días).
 */
export function FollowupsCard({ processId }: { processId: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState(false);
  const [on, setOn] = useState(false);
  const [field, setField] = useState<string | null>(null);
  const [dateCol, setDateCol] = useState<string | null>(null);
  const [extCol, setExtCol] = useState<string | null>(null);
  const [statusCol, setStatusCol] = useState<string | null>(null);
  const [doneValue, setDoneValue] = useState('');
  const [warn, setWarn] = useState<number | string>(7);
  const [single, setSingle] = useState(true);
  const [delays, setDelays] = useState<Record<number, number | string>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/requests-general/followups-config?id=${processId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const d = (await res.json()) as Data;
    setData(d);
    const t = d.tracking;
    setOn(Boolean(t));
    setField(t ? String(t.idFormField) : d.tableFields[0] ? String(d.tableFields[0].id) : null);
    setDateCol(t?.dateCol ?? null);
    setExtCol(t?.extensionCol ?? null);
    setStatusCol(t?.statusCol ?? null);
    setDoneValue(t?.doneValue ?? '');
    setWarn(t?.warnBusinessDays ?? 7);
    setSingle(t?.singleExtension ?? true);
    setDelays(Object.fromEntries(d.tasks.map((x) => [x.id, x.startDelayDays ?? ''])));
  };
  useEffect(() => {
    void load();
  }, [processId]);
  if (!data) return null;

  const cols = data.tableFields.find((f) => String(f.id) === field)?.columns ?? [];
  const dateCols = cols.filter((c) => c.type === 'date').map((c) => ({ value: c.key, label: c.label }));
  const anyCols = cols.map((c) => ({ value: c.key, label: c.label }));
  const delayed = data.tasks.filter((t) => t.startDelayDays);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/requests-general/followups-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: processId,
          tracking: on && field && dateCol ? { idFormField: Number(field), dateCol, extensionCol: extCol, statusCol, doneValue, warnBusinessDays: warn === '' ? 7 : warn, singleExtension: single } : null,
          delays: Object.entries(delays).map(([id, days]) => ({ id: Number(id), days: days === '' ? null : days })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo guardar');
      toast.success('Seguimiento guardado');
      setEditing(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder radius='md' p='md' data-testid='followups-card'>
      <Stack gap='sm'>
        <Group justify='space-between'>
          <Group gap='xs'>
            <IconCalendarDue size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
            <Text size='sm' c='dimmed' fw={500}>
              Seguimiento de fechas y tareas diferidas
            </Text>
          </Group>
          {data.canEdit && !editing && (
            <Button size='xs' variant='light' onClick={() => setEditing(true)} data-testid='followups-edit'>
              Editar seguimiento
            </Button>
          )}
        </Group>
        {!editing ? (
          <Stack gap={4}>
            <Text size='sm'>
              {data.tracking
                ? `Fechas comprometidas en «${data.tableFields.find((f) => f.id === data.tracking!.idFormField)?.label ?? 'tabla'}»: aviso ${data.tracking.warnBusinessDays} días hábiles antes y al vencer${data.tracking.singleExtension ? '; una sola prórroga' : ''}.`
                : 'Sin seguimiento de fechas comprometidas.'}
            </Text>
            {delayed.map((t) => (
              <Text key={t.id} size='sm'>
                «{t.task}» se activa {t.startDelayDays} día(s) después de cerrarse la tarea anterior.
              </Text>
            ))}
          </Stack>
        ) : (
          <Stack gap='md'>
            {data.tableFields.length > 0 ? (
              <>
                <Switch label='Vigilar fechas comprometidas de una tabla del formulario' checked={on} onChange={(e) => setOn(e.currentTarget.checked)} />
                {on && (
                  <SimpleGrid cols={{ base: 1, md: 3 }} spacing='xs'>
                    <Select label='Tabla' data={data.tableFields.map((f) => ({ value: String(f.id), label: f.label }))} value={field} onChange={setField} allowDeselect={false} />
                    <Select label='Columna de fecha comprometida' data={dateCols} value={dateCol} onChange={setDateCol} />
                    <Select label='Columna de nueva fecha (prórroga)' data={dateCols} value={extCol} onChange={setExtCol} clearable />
                    <Select label='Columna de estado' data={anyCols} value={statusCol} onChange={setStatusCol} clearable />
                    <TextInput label='Estado que la da por cumplida' value={doneValue} onChange={(e) => setDoneValue(e.currentTarget.value)} placeholder='Cumplida' />
                    <NumberInput label='Avisar antes (días hábiles)' min={0} max={60} allowDecimal={false} value={warn} onChange={setWarn} />
                    <Switch mt='md' label='Una sola prórroga por acción' checked={single} onChange={(e) => setSingle(e.currentTarget.checked)} />
                  </SimpleGrid>
                )}
              </>
            ) : (
              <Text size='sm' c='dimmed'>
                El flujo no tiene campos tipo tabla para vigilar fechas.
              </Text>
            )}
            <div>
              <Text size='sm' fw={600} mb={4}>
                Tareas diferidas
              </Text>
              <Table fz='sm' verticalSpacing={4}>
                <Table.Tbody>
                  {data.tasks.map((t) => (
                    <Table.Tr key={t.id}>
                      <Table.Td>{t.task}</Table.Td>
                      <Table.Td w={220}>
                        <NumberInput size='xs' min={1} max={730} allowDecimal={false} value={delays[t.id] ?? ''} onChange={(v) => setDelays((x) => ({ ...x, [t.id]: v }))} placeholder='Inmediata' rightSection={<Text size='xs'>días</Text>} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            <Group justify='flex-end'>
              <Button variant='default' size='xs' onClick={() => { setEditing(false); void load(); }}>
                Cancelar
              </Button>
              <Button size='xs' loading={saving} disabled={on && (!field || !dateCol)} onClick={() => void save()} data-testid='followups-save'>
                Guardar seguimiento
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

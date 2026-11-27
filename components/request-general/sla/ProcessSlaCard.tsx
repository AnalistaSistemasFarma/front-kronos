'use client';

import { Badge, Button, Card, Group, NumberInput, Select, Stack, Text } from '@mantine/core';
import { IconClockHour4 } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { formatSla } from '../../../lib/requests-general/sla';

interface SlaRow {
  available: boolean;
  canEdit: boolean;
  sla_value?: number | null;
  sla_unit?: string | null;
  sla_warn_pct?: number | null;
  sla_source?: string | null;
}

const UNITS = [
  { value: 'business_hours', label: 'Horas hábiles' },
  { value: 'business_days', label: 'Días hábiles' },
  { value: 'calendar_hours', label: 'Horas calendario' },
];

/** SLA (ANS) of a subprocess in the workflow administration (own load/save). */
export function ProcessSlaCard({ processId }: { processId: number }) {
  const [row, setRow] = useState<SlaRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | string>('');
  const [unit, setUnit] = useState<string>('business_hours');
  const [warn, setWarn] = useState<number | string>('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/requests-general/process-sla?id=${processId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as SlaRow;
    setRow(data);
    setValue(data.sla_value ?? '');
    setUnit(data.sla_unit ?? 'business_hours');
    setWarn(data.sla_warn_pct ?? '');
  };
  useEffect(() => {
    void load();
  }, [processId]);

  if (!row || !row.available) return null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/requests-general/process-sla', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: processId, value: value === '' ? null : value, unit, warnPct: warn === '' ? null : warn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar el ANS');
      toast.success('ANS guardado');
      setEditing(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar el ANS');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder radius='md' p='md' data-testid='process-sla-card'>
      <Stack gap='sm'>
        <Group justify='space-between'>
          <Group gap='xs'>
            <IconClockHour4 size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
            <Text size='sm' c='dimmed' fw={500}>
              ANS (acuerdo de nivel de servicio)
            </Text>
          </Group>
          {row.canEdit && !editing && (
            <Button size='xs' variant='light' onClick={() => setEditing(true)}>
              Editar ANS
            </Button>
          )}
        </Group>
        {editing ? (
          <>
            <Group grow align='flex-end'>
              <NumberInput label='Valor' min={1} max={10000} allowDecimal={false} value={value} onChange={setValue} placeholder='Vacío = sin ANS' />
              <Select label='Unidad' data={UNITS} value={unit} onChange={(v) => setUnit(v || 'business_hours')} allowDeselect={false} />
              <NumberInput label='Aviso próximo a vencer (%)' min={1} max={99} allowDecimal={false} value={warn} onChange={setWarn} placeholder='20' />
            </Group>
            <Group justify='flex-end'>
              <Button variant='default' size='xs' onClick={() => { setEditing(false); void load(); }}>
                Cancelar
              </Button>
              <Button size='xs' loading={saving} onClick={save}>
                Guardar ANS
              </Button>
            </Group>
          </>
        ) : (
          <Group gap='xs'>
            <Text size='lg' fw={600}>
              {formatSla({ value: row.sla_value, unit: row.sla_unit })}
            </Text>
            {row.sla_source === 'baseline' && (
              <Badge size='sm' variant='light' color='blue'>
                Calculado con el promedio histórico
              </Badge>
            )}
            {row.sla_value ? (
              <Text size='xs' c='dimmed'>
                Aviso cuando quede el {row.sla_warn_pct ?? 20} % o menos
              </Text>
            ) : null}
          </Group>
        )}
      </Stack>
    </Card>
  );
}

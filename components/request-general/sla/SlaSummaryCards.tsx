'use client';

import { Badge, Group, Paper, SimpleGrid, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconAlarm, IconAlertTriangle, IconCircleCheck, IconHourglassEmpty } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { SlaState } from '../../../lib/requests-general/sla';
import type { SlaSummary } from './useSlaSummary';

const CARDS: { state: Exclude<SlaState, 'no_sla'>; label: string; color: string; icon: ReactNode; hint: string }[] = [
  { state: 'overdue', label: 'Vencidos', color: 'red', icon: <IconAlarm size={18} />, hint: 'Ya superaron el ANS del subproceso' },
  {
    state: 'near_due',
    label: 'Próximos a vencer',
    color: 'yellow',
    icon: <IconAlertTriangle size={18} />,
    hint: 'Les queda el 20 % o menos del ANS',
  },
  { state: 'on_time', label: 'Dentro del tiempo', color: 'green', icon: <IconCircleCheck size={18} />, hint: 'Van dentro del ANS' },
];

/**
 * «Trámites pendientes de gestión»: open requests by SLA (ANS) state. Clicking a card
 * filters the list (`onSelect`); clicking it again clears the filter.
 */
export function SlaSummaryCards({
  data,
  selected,
  onSelect,
}: {
  data: SlaSummary | null;
  selected: SlaState | null;
  onSelect: (state: SlaState | null) => void;
}) {
  if (!data || !data.available) return null;
  const toggle = (s: SlaState) => onSelect(selected === s ? null : s);
  return (
    <Paper withBorder radius='lg' p='md' mb='md' data-testid='sla-summary'>
      <Group justify='space-between' mb='sm' wrap='wrap' gap='xs'>
        <div>
          <Text fw={700}>Trámites pendientes de gestión</Text>
          <Text size='xs' c='dimmed'>
            Tiempo hábil (lunes a viernes, 8:00 a 17:00, sin festivos). No cuentan las devueltas ni los borradores.
          </Text>
        </div>
        <Tooltip label='Solicitudes de subprocesos que aún no tienen ANS configurado' withArrow>
          <UnstyledButton onClick={() => toggle('no_sla')} aria-pressed={selected === 'no_sla'} data-testid='sla-card-no_sla'>
            <Badge
              size='lg'
              variant={selected === 'no_sla' ? 'filled' : 'light'}
              color='gray'
              leftSection={<IconHourglassEmpty size={14} />}
            >
              Sin ANS: {data.counts.no_sla}
            </Badge>
          </UnstyledButton>
        </Tooltip>
      </Group>
      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing='sm'>
        {CARDS.map((c) => {
          const active = selected === c.state;
          return (
            <UnstyledButton
              key={c.state}
              onClick={() => toggle(c.state)}
              aria-pressed={active}
              data-testid={`sla-card-${c.state}`}
              style={{
                borderRadius: 12,
                padding: '12px 14px',
                border: `2px solid var(--mantine-color-${c.color}-${active ? 6 : 2})`,
                background: `var(--mantine-color-${c.color}-light)`,
              }}
            >
              <Group gap={6} c={`${c.color}.7`}>
                {c.icon}
                <Text size='sm' fw={600}>
                  {c.label}
                </Text>
              </Group>
              <Text fz={28} fw={800} lh={1.2} mt={4}>
                {data.counts[c.state]}
              </Text>
              <Text size='xs' c='dimmed'>
                {active ? 'Filtrando la lista · clic para quitar' : c.hint}
              </Text>
            </UnstyledButton>
          );
        })}
      </SimpleGrid>
    </Paper>
  );
}

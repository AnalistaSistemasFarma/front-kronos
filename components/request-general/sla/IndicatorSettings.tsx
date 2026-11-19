'use client';

import { ActionIcon, Button, Checkbox, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { IconEyeOff, IconSettings } from '@tabler/icons-react';
import type { IndicatorCard } from '../../../lib/ui/preferences';
import { useIndicatorPrefs } from './useIndicatorPrefs';

const SLA_OPTIONS: { card: IndicatorCard; label: string }[] = [
  { card: 'sla.overdue', label: 'Vencidos' },
  { card: 'sla.near_due', label: 'Próximos a vencer' },
  { card: 'sla.on_time', label: 'Dentro del tiempo' },
  { card: 'sla.no_sla', label: 'Sin ANS' },
  { card: 'sla.paused', label: 'En pausa' },
];
const STATUS_OPTIONS: { card: IndicatorCard; label: string }[] = [
  { card: 'status.all', label: 'Total' },
  { card: 'status.pending', label: 'Pendientes' },
  { card: 'status.returned', label: 'Devueltas' },
  { card: 'status.done', label: 'Completadas' },
  { card: 'status.cancelled', label: 'Canceladas' },
  { card: 'status.progress', label: 'Avance de tareas' },
];

/** Gear next to the SLA row: which cards to show and «Ocultar indicadores». Saved per user. */
export function IndicatorSettings({ showStatusOptions = false }: { showStatusOptions?: boolean }) {
  const { prefs, isVisible, setCardVisible, setSlaHidden } = useIndicatorPrefs();
  const group = (title: string, options: typeof SLA_OPTIONS) => (
    <Stack gap={6}>
      <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
        {title}
      </Text>
      {options.map((o) => (
        <Checkbox
          key={o.card}
          size='xs'
          label={o.label}
          checked={isVisible(o.card)}
          onChange={(e) => setCardVisible(o.card, e.currentTarget.checked)}
          data-testid={`indicator-option-${o.card}`}
        />
      ))}
    </Stack>
  );
  return (
    <Popover position='bottom-start' withArrow shadow='md' width={250}>
      <Popover.Target>
        <Tooltip label='Mostrar tarjetas' withArrow>
          <ActionIcon
            variant='subtle'
            color='gray'
            size='sm'
            aria-label='Configurar indicadores'
            data-testid='indicator-settings'
          >
            <IconSettings size={15} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap='sm'>
          <Text size='sm' fw={700}>
            Mostrar tarjetas
          </Text>
          {group('ANS', SLA_OPTIONS)}
          {showStatusOptions ? group('Estado', STATUS_OPTIONS) : null}
          <Button
            size='xs'
            variant='light'
            color='gray'
            leftSection={<IconEyeOff size={14} />}
            onClick={() => setSlaHidden(!prefs.slaHidden)}
            data-testid='indicator-hide-sla'
          >
            {prefs.slaHidden ? 'Mostrar indicadores' : 'Ocultar indicadores'}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

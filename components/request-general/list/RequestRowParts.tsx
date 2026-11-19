'use client';

import { Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  IconCalendarEvent,
  IconCircle,
  IconCircleCheckFilled,
  IconCircleDot,
  IconClock,
  IconListCheck,
  IconProgress,
  IconTicket,
  IconX,
} from '@tabler/icons-react';
import CompanyLogo from '../../ui/CompanyLogo';
import { buildTaskDisplayBadges } from '@/lib/orion/taskProgress';

/**
 * Cells of the request lists (assigned inbox and «Solicitudes generales»), shared so both
 * tables look the same: company logo, type badge, status badge, date and task chips.
 */

export function requestStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'abierto':
      return 'blue';
    case 'cancelado':
      return 'red';
    case 'resuelto':
      return 'green';
    case 'devuelta':
    case 'devuelto':
      return 'orange';
    default:
      return 'gray';
  }
}

export function requestStatusIcon(status: string) {
  switch (status?.toLowerCase()) {
    case 'sin empezar':
      return IconClock;
    case 'abierto':
      return IconProgress;
    case 'cancelado':
      return IconX;
    case 'resuelto':
      return IconCircleCheckFilled;
    default:
      return IconClock;
  }
}

export function taskVisual(status: string) {
  switch (status?.toLowerCase()) {
    case 'resuelto':
      return { color: 'green', Icon: IconCircleCheckFilled };
    case 'abierto':
      return { color: 'orange', Icon: IconCircleDot };
    case 'sin empezar':
      return { color: 'gray', Icon: IconCircle };
    default:
      return { color: 'red', Icon: IconCircle };
  }
}

/** DB wall-clock date (Bogotá in UTC fields) as "3 de septiembre de 2026, 07:13 a. m.". */
export function formatRequestDate(raw: string | null | undefined): string {
  if (!raw) return 'Sin fecha';
  const date = new Date(raw);
  if (isNaN(date.getTime())) return 'Fecha inválida';
  const adjusted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(adjusted);
}

export function RequestStatusBadge({ status }: { status: string }) {
  const StatusIcon = requestStatusIcon(status);
  return (
    <Badge
      color={requestStatusColor(status)}
      variant='light'
      size='sm'
      leftSection={<StatusIcon size={12} />}
      styles={{ label: { overflow: 'visible' } }}
    >
      {status}
    </Badge>
  );
}

/** Small label under the ID: «Solicitud» (blue) or «Tarea» (violet). */
export function RequestTypeBadge({ kind }: { kind: 'request' | 'task' }) {
  return kind === 'request' ? (
    <Badge
      variant='light'
      color='blue'
      size='xs'
      leftSection={<IconTicket size={12} />}
      styles={{ root: { textTransform: 'none' }, label: { overflow: 'visible' } }}
    >
      Solicitud
    </Badge>
  ) : (
    <Badge
      variant='light'
      color='violet'
      size='xs'
      leftSection={<IconListCheck size={12} />}
      styles={{ root: { textTransform: 'none' }, label: { overflow: 'visible' } }}
    >
      Tarea
    </Badge>
  );
}

/** «Compañía / Categoría» column: logo + category · process in grey. */
export function RequestCompanyCell({
  company,
  category,
  process,
}: {
  company: string;
  category?: string | null;
  process?: string | null;
}) {
  return (
    <Stack gap={2}>
      <CompanyLogo name={company} />
      <Text size='xs' c='dimmed'>
        {[category, process].filter(Boolean).join(' · ')}
      </Text>
    </Stack>
  );
}

export function RequestDateCell({ raw }: { raw: string | null | undefined }) {
  return (
    <Group gap={4} wrap='nowrap' align='flex-start'>
      <IconCalendarEvent size={14} className='text-gray-400' style={{ marginTop: 2 }} />
      <Text size='sm' c='dimmed'>
        {formatRequestDate(raw)}
      </Text>
    </Group>
  );
}

/** Chips of the tasks of a request (name + status colour/icon). */
export function RequestTaskChips({
  tasks,
}: {
  tasks: Parameters<typeof buildTaskDisplayBadges>[0];
}) {
  return (
    <Group gap={6} wrap='wrap'>
      {buildTaskDisplayBadges(tasks).map((badge) => {
        const { color, Icon } = taskVisual(badge.statusKey);
        return (
          <Tooltip key={badge.key} label={`${badge.label} · ${badge.statusLabel}`} withArrow>
            <Badge
              variant='light'
              color={color}
              size='sm'
              radius='sm'
              styles={{
                root: { textTransform: 'none', fontWeight: 500, cursor: 'default' },
                label: { overflow: 'hidden', textOverflow: 'ellipsis' },
              }}
              leftSection={<Icon size={13} />}
            >
              {badge.label}
            </Badge>
          </Tooltip>
        );
      })}
    </Group>
  );
}

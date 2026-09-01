'use client';

import { ActionIcon, Avatar, Badge, Box, Group, Paper, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconCheck, IconClock, IconUser } from '@tabler/icons-react';
import type { OrionParticipant } from '../../lib/orion/participants';
import type { SignatureFieldPlacement } from '../../lib/orion/signatureFields';

type Props = {
  participants: OrionParticipant[];
  activeOrder: number;
  onSelect: (order: number) => void;
  fields: SignatureFieldPlacement[];
  signerStatuses?: Record<string, string>;
  compact?: boolean;
  variant?: 'placement' | 'sequence';
  sequential?: boolean;
  onReorder?: (order: number, direction: 'up' | 'down') => void;
};

function roleColor(role: OrionParticipant['role']): string {
  switch (role) {
    case 'Solicitante':
      return 'blue';
    case 'Asignado':
      return 'violet';
    default:
      return 'gray';
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function signerStatusLabel(
  status: string,
  placed: boolean,
  variant: 'placement' | 'sequence'
): { label: string; color: string; done: boolean } {
  const upper = status.toUpperCase();
  if (['FIRMADO', 'SIGNED', 'COMPLETED'].includes(upper)) {
    return { label: 'Firmado', color: 'green', done: true };
  }
  if (variant === 'placement') {
    return placed
      ? { label: 'Firma ubicada', color: 'green', done: true }
      : { label: 'Sin ubicar', color: 'orange', done: false };
  }
  return { label: 'Pendiente', color: 'gray', done: false };
}

export default function OrionSignersList({
  participants,
  activeOrder,
  onSelect,
  fields,
  signerStatuses = {},
  compact = false,
  variant = 'placement',
  sequential = true,
  onReorder,
}: Props) {
  if (participants.length === 0) {
    return (
      <Text size='sm' c='dimmed' ta='center' py='md'>
        No hay firmantes configurados.
      </Text>
    );
  }

  return (
    <Stack gap='sm'>
      <Group justify='space-between' align='flex-end'>
        <Text size='xs' fw={700} tt='uppercase' c='dimmed' lts={0.6}>
          Firmantes ({participants.length})
        </Text>
        {sequential && variant === 'sequence' && (
          <Badge size='sm' variant='light' color='blue'>
            Orden secuencial
          </Badge>
        )}
      </Group>
      {participants.map((person, idx) => {
        const placed = fields.some((f) => f.signerOrder === person.order);
        const isActive = person.order === activeOrder;
        const rawStatus = signerStatuses[person.email.toLowerCase()] ?? (placed ? 'UBICADA' : 'SIN UBICAR');
        const statusInfo = signerStatusLabel(rawStatus, placed, variant);
        const canMoveUp = Boolean(onReorder) && idx > 0;
        const canMoveDown = Boolean(onReorder) && idx < participants.length - 1;

        return (
          <Paper
            key={`${person.email}-${person.order}`}
            withBorder
            radius='md'
            p={compact ? 'xs' : 'sm'}
            onClick={() => onSelect(person.order)}
            style={{
              cursor: variant === 'placement' ? 'pointer' : 'default',
              borderColor: isActive && variant === 'placement' ? 'var(--app-accent)' : 'var(--app-border)',
              borderWidth: isActive && variant === 'placement' ? 2 : 1,
              background:
                isActive && variant === 'placement'
                  ? 'color-mix(in srgb, var(--app-accent) 12%, var(--app-surface))'
                  : 'var(--app-surface)',
              boxShadow: isActive && variant === 'placement' ? 'var(--app-card-shadow)' : 'none',
              transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
            }}
          >
            <Box style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <ThemeIcon
                size={compact ? 32 : 36}
                radius='xl'
                variant={isActive && variant === 'placement' ? 'filled' : 'light'}
                color='blue'
                style={{ flexShrink: 0 }}
              >
                <Text size='sm' fw={700}>
                  {person.order}
                </Text>
              </ThemeIcon>

              <Avatar radius='xl' size={compact ? 36 : 42} color={roleColor(person.role)} variant='filled'>
                {initials(person.name) || <IconUser size={18} />}
              </Avatar>

              <Box style={{ flex: 1, minWidth: 0 }}>
                <Group justify='space-between' wrap='nowrap' gap='xs'>
                  <Text size='sm' fw={700} lineClamp={1}>
                    {person.name}
                  </Text>
                  <Badge
                    size='sm'
                    variant='light'
                    color={statusInfo.color}
                    leftSection={statusInfo.done ? <IconCheck size={12} /> : <IconClock size={12} />}
                    style={{ flexShrink: 0 }}
                  >
                    {statusInfo.label}
                  </Badge>
                </Group>
                <Text size='xs' lineClamp={1} c='dimmed' mt={2}>
                  {person.email}
                </Text>
                <Box mt={8} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <Badge size='sm' variant='light' color={roleColor(person.role)}>
                    {person.role}
                  </Badge>
                  {sequential && variant === 'sequence' && (
                    <Badge size='sm' variant='outline' color='gray'>
                      Paso {person.order}
                    </Badge>
                  )}
                </Box>
                {variant === 'placement' && person.signatureDataUrl ? (
                  <Box
                    mt={10}
                    p={6}
                    style={{
                      border: '1px dashed var(--app-border)',
                      borderRadius: 8,
                      background: 'var(--app-surface-raised)',
                      maxWidth: 160,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={person.signatureDataUrl}
                      alt={`Firma de ${person.name}`}
                      style={{ height: 32, width: '100%', objectFit: 'contain' }}
                    />
                  </Box>
                ) : variant === 'placement' ? (
                  <Text size='xs' c='orange.8' mt={8} fw={500}>
                    Sin rúbrica guardada aún
                  </Text>
                ) : null}
              </Box>

              {onReorder && variant === 'sequence' && (
                <Stack gap={4} style={{ flexShrink: 0 }}>
                  <Tooltip label='Subir en el orden'>
                    <ActionIcon
                      size='sm'
                      variant='subtle'
                      disabled={!canMoveUp}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReorder(person.order, 'up');
                      }}
                    >
                      <IconArrowUp size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label='Bajar en el orden'>
                    <ActionIcon
                      size='sm'
                      variant='subtle'
                      disabled={!canMoveDown}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReorder(person.order, 'down');
                      }}
                    >
                      <IconArrowDown size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Stack>
              )}
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
}

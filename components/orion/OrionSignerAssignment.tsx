'use client';

import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconCheck, IconClock, IconX } from '@tabler/icons-react';
import type { OrionParticipant } from '../../lib/orion/participants';
import { parseUserOptionLabel, type OrionUserOption } from '../../lib/orion/participants';

type Props = {
  participants: OrionParticipant[];
  signerCount: number;
  sequential: boolean;
  includeSelf: boolean;
  availableUsers: OrionUserOption[];
  currentUserEmail?: string;
  currentUserName?: string;
  signerStatuses?: Record<string, string>;
  onSignerCountChange: (count: number) => void;
  onSequentialChange: (value: boolean) => void;
  onIncludeSelfChange: (value: boolean) => void;
  onAssign: (order: number, email: string, name: string) => void;
  onClear: (order: number) => void;
  onReorder?: (order: number, direction: 'up' | 'down') => void;
  readOnly?: boolean;
};

function statusFor(email: string, signerStatuses: Record<string, string>) {
  const raw = signerStatuses[email.toLowerCase()] ?? '';
  const upper = raw.toUpperCase();
  if (['FIRMADO', 'SIGNED', 'COMPLETED'].includes(upper)) {
    return { label: 'Firmado', color: 'green', done: true };
  }
  if (email) return { label: 'Asignado', color: 'blue', done: true };
  return { label: 'Sin asignar', color: 'gray', done: false };
}

export default function OrionSignerAssignment({
  participants,
  signerCount,
  sequential,
  includeSelf,
  availableUsers,
  currentUserEmail,
  currentUserName,
  signerStatuses = {},
  onSignerCountChange,
  onSequentialChange,
  onIncludeSelfChange,
  onAssign,
  onClear,
  onReorder,
  readOnly = false,
}: Props) {
  const usedEmails = new Set(
    participants.map((p) => p.email.toLowerCase()).filter(Boolean)
  );

  const slots = Array.from({ length: signerCount }, (_, idx) => {
    const order = idx + 1;
    return (
      participants.find((p) => p.order === order) ?? {
        order,
        email: '',
        name: '',
        role: 'Firmante' as const,
      }
    );
  });

  return (
    <Stack gap='md'>
      <Group align='flex-end' wrap='wrap'>
        <NumberInput
          label='Cantidad de firmas'
          description='Puede definir entre 1 y 10 firmantes.'
          value={signerCount}
          min={1}
          max={10}
          w={160}
          disabled={readOnly}
          onChange={(value) => {
            const next = typeof value === 'number' ? value : Number(value);
            if (Number.isFinite(next)) onSignerCountChange(Math.min(10, Math.max(1, next)));
          }}
        />
        <Checkbox
          label='Yo también firmo'
          description='Si está marcado, usted será el primer firmante.'
          checked={includeSelf}
          disabled={readOnly}
          onChange={(e) => onIncludeSelfChange(e.currentTarget.checked)}
          mt={4}
        />
        <Checkbox
          label='Firma secuencial'
          description='Un firmante a la vez, en el orden definido.'
          checked={sequential}
          disabled={readOnly}
          onChange={(e) => onSequentialChange(e.currentTarget.checked)}
          mt={4}
        />
      </Group>

      <Box>
        <Text size='sm' fw={600} mb='xs'>
          Asignar firmantes
        </Text>
        <Text size='xs' c='dimmed' mb='md'>
          Busque cada firmante por nombre o correo. Use las flechas para cambiar el orden.
        </Text>

        <Stack gap='sm'>
          {slots.map((person, idx) => {
            const status = statusFor(person.email, signerStatuses);
            const canMoveUp = Boolean(onReorder) && idx > 0;
            const canMoveDown = Boolean(onReorder) && idx < slots.length - 1;
            const options = availableUsers.filter(
              (u) =>
                !usedEmails.has(u.value.toLowerCase()) ||
                u.value.toLowerCase() === person.email.toLowerCase()
            );

            return (
              <Paper
                key={`slot-${person.order}`}
                withBorder
                radius='md'
                p='sm'
                style={{ background: 'var(--app-surface)' }}
              >
                <Group align='flex-start' wrap='nowrap' gap='sm'>
                  <ThemeIcon size={36} radius='xl' variant='light' color='blue' style={{ flexShrink: 0 }}>
                    <Text size='sm' fw={700}>
                      {person.order}
                    </Text>
                  </ThemeIcon>

                  <Box style={{ flex: 1, minWidth: 0 }}>
                    {person.email ? (
                      <Group justify='space-between' wrap='nowrap' gap='xs' mb={6}>
                        <Box style={{ minWidth: 0 }}>
                          <Text size='sm' fw={700} lineClamp={1}>
                            {person.name}
                          </Text>
                          <Text size='xs' c='dimmed' lineClamp={1}>
                            {person.email}
                          </Text>
                        </Box>
                        <Group gap={6} style={{ flexShrink: 0 }}>
                          <Badge
                            size='sm'
                            variant='light'
                            color={status.color}
                            leftSection={status.done ? <IconCheck size={12} /> : <IconClock size={12} />}
                          >
                            {status.label}
                          </Badge>
                          <Tooltip label='Quitar firmante'>
                            <ActionIcon
                              size='sm'
                              variant='subtle'
                              color='red'
                              disabled={readOnly}
                              onClick={() => onClear(person.order)}
                            >
                              <IconX size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                    ) : (
                      <Autocomplete
                        placeholder='Buscar firmante por nombre o correo…'
                        data={options}
                        limit={12}
                        disabled={readOnly}
                        onOptionSubmit={(value) => {
                          const match = availableUsers.find(
                            (u) => u.value.toLowerCase() === value.toLowerCase()
                          );
                          if (!match) return;
                          onAssign(
                            person.order,
                            match.value,
                            parseUserOptionLabel(match.label)
                          );
                        }}
                        onChange={(value) => {
                          const match = availableUsers.find(
                            (u) =>
                              u.value.toLowerCase() === value.toLowerCase() ||
                              u.label.toLowerCase() === value.toLowerCase()
                          );
                          if (match) {
                            onAssign(
                              person.order,
                              match.value,
                              parseUserOptionLabel(match.label)
                            );
                          }
                        }}
                      />
                    )}
                    {sequential && (
                      <Badge size='xs' variant='outline' color='gray' mt={8}>
                        Paso {person.order} en la secuencia
                      </Badge>
                    )}
                  </Box>

                  {onReorder && slots.length > 1 && (
                    <Stack gap={4} style={{ flexShrink: 0 }}>
                      <Tooltip label='Subir en el orden'>
                        <ActionIcon
                          size='sm'
                          variant='subtle'
                          disabled={!canMoveUp}
                          onClick={() => onReorder(person.order, 'up')}
                        >
                          <IconArrowUp size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label='Bajar en el orden'>
                        <ActionIcon
                          size='sm'
                          variant='subtle'
                          disabled={!canMoveDown}
                          onClick={() => onReorder(person.order, 'down')}
                        >
                          <IconArrowDown size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Stack>
                  )}
                </Group>
              </Paper>
            );
          })}
        </Stack>
      </Box>
    </Stack>
  );
}

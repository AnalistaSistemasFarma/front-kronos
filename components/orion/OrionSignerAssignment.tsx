'use client';

import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconCheck, IconClock, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { OrionParticipant, OrionParticipantType } from '../../lib/orion/participants';
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
  companyId?: number | null;
  canUseFingerprint?: boolean;
  onSignerCountChange: (count: number) => void;
  onSequentialChange: (value: boolean) => void;
  onIncludeSelfChange: (value: boolean) => void;
  onAssign: (
    order: number,
    email: string,
    name: string,
    meta?: { type?: OrionParticipantType; cardCode?: string | null }
  ) => void;
  onClear: (order: number) => void;
  onReorder?: (order: number, direction: 'up' | 'down') => void;
  onToggleNotifyByEmail?: (order: number, value: boolean) => void;
  onToggleRequireFingerprint?: (order: number, value: boolean) => void;
  readOnly?: boolean;
};

function statusFor(
  person: { order: number; email: string },
  signerStatuses: Record<string, string>
) {
  const raw =
    signerStatuses[`order:${person.order}`] ??
    (person.email ? signerStatuses[person.email.toLowerCase()] : '') ??
    '';
  const upper = raw.toUpperCase();
  if (['FIRMADO', 'SIGNED', 'COMPLETED'].includes(upper)) {
    return { label: 'Firmado', color: 'green', done: true };
  }
  if (person.email) return { label: 'Asignado', color: 'blue', done: true };
  return { label: 'Sin asignar', color: 'gray', done: false };
}

type PartnerOption = {
  value: string;
  label: string;
  cardCode: string;
  cardName: string;
  email: string;
};

function PartnerSearch({
  companyId,
  disabled,
  onPick,
}: {
  companyId?: number | null;
  disabled?: boolean;
  onPick: (p: PartnerOption) => void;
}) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<PartnerOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId || q.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      void fetch(
        `/api/integrations/orion/external-partners?companyId=${companyId}&q=${encodeURIComponent(q.trim())}`
      )
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setOptions((data.options || []) as PartnerOption[]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [companyId, q]);

  return (
    <Autocomplete
      placeholder={
        companyId
          ? 'Buscar socio por nombre, código o correo…'
          : 'Falta empresa de la solicitud para buscar socios'
      }
      data={options.map((o) => ({ value: o.email, label: o.label }))}
      value={q}
      onChange={setQ}
      disabled={disabled || !companyId}
      limit={12}
      rightSection={loading ? <Loader size={14} /> : null}
      onOptionSubmit={(value) => {
        const match = options.find((o) => o.email === value || o.value === value);
        if (match) {
          onPick(match);
          setQ('');
        }
      }}
    />
  );
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
  companyId,
  canUseFingerprint = false,
  onSignerCountChange,
  onSequentialChange,
  onIncludeSelfChange,
  onAssign,
  onClear,
  onReorder,
  onToggleNotifyByEmail,
  onToggleRequireFingerprint,
  readOnly = false,
}: Props) {
  const [slotSource, setSlotSource] = useState<Record<number, 'internal' | 'external'>>({});

  const slots = Array.from({ length: signerCount }, (_, idx) => {
    const order = idx + 1;
    return (
      participants.find((p) => p.order === order) ?? {
        order,
        email: '',
        name: '',
        role: 'Firmante' as const,
        type: 'internal' as const,
      }
    );
  });

  const sourceFor = useCallback(
    (person: OrionParticipant) => {
      if (person.email) {
        return person.type === 'external' ? 'external' : 'internal';
      }
      return slotSource[person.order] || 'internal';
    },
    [slotSource]
  );

  return (
    <Stack gap='md'>
      <Group align='flex-end' wrap='wrap'>
        <NumberInput
          label='Cantidad de firmas'
          description='Puede definir entre 1 y 10 firmantes (se puede repetir la misma persona).'
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
          Usuarios SynerLink o socios de negocio (externos). Plazo por turno: 24 horas.
        </Text>

        <Stack gap='sm'>
          {slots.map((person, idx) => {
            const status = statusFor(person, signerStatuses);
            const canMoveUp = Boolean(onReorder) && idx > 0;
            const canMoveDown = Boolean(onReorder) && idx < slots.length - 1;
            const source = sourceFor(person);

            return (
              <Paper
                key={`slot-${idx}-${person.order ?? 'x'}-${person.email || 'empty'}`}
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
                          <Group gap={6} mb={2}>
                            <Text size='sm' fw={700} lineClamp={1}>
                              {person.name}
                            </Text>
                            <Badge size='xs' variant='light' color={person.type === 'external' ? 'orange' : 'blue'}>
                              {person.type === 'external' ? 'Externo' : 'Interno'}
                            </Badge>
                          </Group>
                          <Text size='xs' c='dimmed' lineClamp={1}>
                            {person.email}
                            {person.cardCode ? ` · ${person.cardCode}` : ''}
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
                      <Stack gap='xs'>
                        <SegmentedControl
                          size='xs'
                          value={source}
                          disabled={readOnly}
                          onChange={(v) =>
                            setSlotSource((prev) => ({
                              ...prev,
                              [person.order]: v as 'internal' | 'external',
                            }))
                          }
                          data={[
                            { label: 'Usuario SynerLink', value: 'internal' },
                            { label: 'Socio de negocio', value: 'external' },
                          ]}
                        />
                        {source === 'external' ? (
                          <PartnerSearch
                            companyId={companyId}
                            disabled={readOnly}
                            onPick={(p) =>
                              onAssign(person.order, p.email, p.cardName, {
                                type: 'external',
                                cardCode: p.cardCode,
                              })
                            }
                          />
                        ) : (
                          <Autocomplete
                            placeholder='Buscar firmante por nombre o correo…'
                            data={availableUsers}
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
                                parseUserOptionLabel(match.label),
                                { type: 'internal', cardCode: null }
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
                                  parseUserOptionLabel(match.label),
                                  { type: 'internal', cardCode: null }
                                );
                              }
                            }}
                          />
                        )}
                      </Stack>
                    )}
                    {sequential && (
                      <Badge size='xs' variant='outline' color='gray' mt={8}>
                        Paso {person.order} en la secuencia
                      </Badge>
                    )}
                    {person.email ? (
                      <Stack gap={6} mt='sm'>
                        <Checkbox
                          size='xs'
                          label='Enviar correo con link de firma'
                          description={
                            person.type === 'external'
                              ? 'Recomendado para socios externos (URL Orion).'
                              : 'Opcional; los internos también reciben tarea/notificación en SynerLink.'
                          }
                          checked={Boolean(person.notifyByEmail)}
                          disabled={readOnly || !onToggleNotifyByEmail}
                          onChange={(e) =>
                            onToggleNotifyByEmail?.(person.order, e.currentTarget.checked)
                          }
                        />
                        {canUseFingerprint ? (
                          <Checkbox
                            size='xs'
                            label='Requiere huella dactilar'
                            description='Coloque una caja de huella para este firmante en el PDF.'
                            checked={Boolean(person.requireFingerprint)}
                            disabled={readOnly || !onToggleRequireFingerprint}
                            onChange={(e) =>
                              onToggleRequireFingerprint?.(
                                person.order,
                                e.currentTarget.checked
                              )
                            }
                          />
                        ) : null}
                      </Stack>
                    ) : null}
                  </Box>

                  {onReorder && slots.length > 1 && (
                    <Stack gap={4} style={{ flexShrink: 0 }}>
                      <Tooltip label='Subir en el orden'>
                        <ActionIcon
                          size='sm'
                          variant='subtle'
                          disabled={!canMoveUp || readOnly}
                          onClick={() => onReorder(person.order, 'up')}
                        >
                          <IconArrowUp size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label='Bajar en el orden'>
                        <ActionIcon
                          size='sm'
                          variant='subtle'
                          disabled={!canMoveDown || readOnly}
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

'use client';

import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconCheck, IconClock, IconPencil, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { OrionParticipant, OrionParticipantType } from '../../lib/orion/participants';
import {
  parseUserOptionLabel,
  resolveSignatureMarkId,
  type OrionUserOption,
} from '../../lib/orion/participants';
import toast from 'react-hot-toast';

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
  onSignatureMarkIdChange?: (order: number, markId: number) => void;
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

export type PartnerOption = {
  value: string;
  label: string;
  cardCode: string;
  cardName: string;
  email: string;
  source: 'sap' | 'user';
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function PartnerSearch({
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sapWarning, setSapWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<PartnerOption | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');

  useEffect(() => {
    if (!companyId || q.trim().length < 2) {
      setOptions([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      setSearchError(null);
      void fetch(
        `/api/integrations/orion/external-partners?companyId=${companyId}&q=${encodeURIComponent(q.trim())}`
      )
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (!res.ok) {
            setOptions([]);
            setSearchError(
              typeof data.error === 'string' ? data.error : 'No se pudo buscar socios'
            );
            return;
          }
          const raw = Array.isArray(data.options) ? data.options : [];
          // Valor único (evita crash de Autocomplete con valores duplicados/vacíos).
          const seen = new Set<string>();
          const next: PartnerOption[] = [];
          for (const row of raw as PartnerOption[]) {
            const cardCode = String(row?.cardCode || '').trim();
            const value = String(row?.value || cardCode).trim();
            const email = String(row?.email || '')
              .trim()
              .toLowerCase();
            if ((!cardCode && row.source !== 'user') || !value || seen.has(value)) continue;
            seen.add(value);
            next.push({
              value,
              label: String(row.label || `${row.cardName || cardCode} <${email}>`),
              cardCode,
              cardName: String(row.cardName || cardCode),
              email: email.includes('@') ? email : '',
              source: row.source === 'user' ? 'user' : 'sap',
            });
          }
          setOptions(next);
          setSapWarning(typeof data.sapError === 'string' ? data.sapError : null);
        })
        .catch(() => {
          if (!cancelled) {
            setOptions([]);
            setSearchError('Error de red al buscar socios');
          }
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

  const confirmPending = () => {
    const email = pendingEmail.trim().toLowerCase();
    if (!pending || !EMAIL_RE.test(email)) {
      setSearchError('Escriba un correo válido para este socio.');
      return;
    }
    onPick({ ...pending, email });
    setPending(null);
    setPendingEmail('');
    setSearchError(null);
  };

  if (pending) {
    const hasSapEmail = Boolean(pending.email);
    return (
      <Stack gap={4}>
        <Text size='xs'>
          <b>{pending.cardName}</b>
          {pending.cardCode ? ` · ${pending.cardCode}` : ''}
          {hasSapEmail
            ? '. Confirme o cambie el correo donde recibirá la invitación a firmar:'
            : ' no tiene correo en SAP. Escriba el correo donde recibirá la invitación a firmar:'}
        </Text>
        <Group gap='xs' wrap='nowrap'>
          <TextInput
            size='xs'
            placeholder='correo@empresa.com'
            aria-label='Correo del socio'
            value={pendingEmail}
            onChange={(e) => setPendingEmail(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmPending();
            }}
            style={{ flex: 1 }}
            autoFocus
          />
          <Button size='xs' onClick={confirmPending}>
            Asignar
          </Button>
          <Button
            size='xs'
            variant='subtle'
            color='gray'
            onClick={() => {
              setPending(null);
              setPendingEmail('');
              setSearchError(null);
            }}
          >
            Cancelar
          </Button>
        </Group>
        {searchError ? (
          <Text size='xs' c='red'>
            {searchError}
          </Text>
        ) : null}
      </Stack>
    );
  }

  const pick = (match: PartnerOption) => {
    try {
      setQ('');
      setOptions([]);
      // Socios SAP: siempre confirmar correo (permite usar el suyo en pruebas).
      // Usuarios SynerLink con correo: se asignan directo.
      if (match.source === 'sap' || !match.email) {
        setPending(match);
        setPendingEmail(match.email || '');
        return;
      }
      onPick(match);
    } catch (err) {
      console.error('[orion] PartnerSearch pick', err);
      setSearchError('No se pudo asignar este socio. Intente de nuevo.');
    }
  };

  return (
    <Stack gap={4}>
      <TextInput
        placeholder={
          companyId
            ? 'Buscar socio por nombre, NIT, código o correo…'
            : 'Falta empresa de la solicitud para buscar socios'
        }
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        disabled={disabled || !companyId}
        rightSection={loading ? <Loader size={14} /> : null}
      />
      {options.length > 0 ? (
        <Stack
          gap={2}
          style={{
            maxHeight: 180,
            overflowY: 'auto',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 8,
            padding: 4,
          }}
        >
          {options.map((o) => (
            <UnstyledButton
              key={o.value}
              onClick={() => pick(o)}
              disabled={disabled}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 8px',
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.35,
              }}
              className='orion-partner-option'
            >
              <Text size='xs' fw={600}>
                {o.cardName}
              </Text>
              <Text size='xs' c='dimmed'>
                {o.cardCode}
                {o.email ? ` · ${o.email}` : ' · sin correo en SAP'}
                {o.source === 'user' ? ' · Usuario SynerLink' : ''}
              </Text>
            </UnstyledButton>
          ))}
        </Stack>
      ) : null}
      {searchError ? (
        <Text size='xs' c='red'>
          {searchError}
        </Text>
      ) : null}
      {sapWarning && !searchError && q.trim().length >= 2 ? (
        <Text size='xs' c='orange'>
          {sapWarning}
        </Text>
      ) : null}
      {!loading && q.trim().length >= 2 && options.length === 0 && !searchError ? (
        <Text size='xs' c='dimmed'>
          Sin socios activos en SAP de esta empresa. Pruebe con parte del nombre,
          el NIT, el código o el correo. El socio debe existir en el SAP de la
          compañía de la solicitud.
        </Text>
      ) : null}
    </Stack>
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
  onSignatureMarkIdChange,
  readOnly = false,
}: Props) {
  const [slotSource, setSlotSource] = useState<Record<number, 'internal' | 'external'>>({});
  const [editingEmailOrder, setEditingEmailOrder] = useState<number | null>(null);
  const [editingEmailValue, setEditingEmailValue] = useState('');
  const [editingEmailError, setEditingEmailError] = useState<string | null>(null);

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
                      {resolveSignatureMarkId(person)}
                    </Text>
                  </ThemeIcon>

                  <Box style={{ flex: 1, minWidth: 0 }}>
                    {person.email ? (
                      <Stack gap={6} mb={6}>
                        <Group justify='space-between' wrap='nowrap' gap='xs'>
                          <Box style={{ minWidth: 0 }}>
                            <Group gap={6} mb={2}>
                              <Text size='sm' fw={700} lineClamp={1}>
                                {person.name}
                              </Text>
                              <Badge
                                size='xs'
                                variant='light'
                                color={person.type === 'external' ? 'orange' : 'blue'}
                              >
                                {person.type === 'external' ? 'Externo' : 'Interno'}
                              </Badge>
                            </Group>
                            {editingEmailOrder === person.order ? null : (
                              <Text size='xs' c='dimmed' lineClamp={1}>
                                {person.email}
                                {person.cardCode ? ` · ${person.cardCode}` : ''}
                              </Text>
                            )}
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
                            {person.type === 'external' && !readOnly ? (
                              <Tooltip label='Cambiar correo de invitación'>
                                <ActionIcon
                                  size='sm'
                                  variant='subtle'
                                  color='gray'
                                  onClick={() => {
                                    setEditingEmailOrder(person.order);
                                    setEditingEmailValue(person.email);
                                    setEditingEmailError(null);
                                  }}
                                >
                                  <IconPencil size={14} />
                                </ActionIcon>
                              </Tooltip>
                            ) : null}
                            <Tooltip label='Quitar firmante'>
                              <ActionIcon
                                size='sm'
                                variant='subtle'
                                color='red'
                                disabled={readOnly}
                                onClick={() => {
                                  setEditingEmailOrder(null);
                                  onClear(person.order);
                                }}
                              >
                                <IconX size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Group>
                        {editingEmailOrder === person.order ? (
                          <Stack gap={4}>
                            <Text size='xs' c='dimmed'>
                              Correo donde llegará la invitación a firmar
                              {person.cardCode ? ` · ${person.cardCode}` : ''}
                            </Text>
                            <Group gap='xs' wrap='nowrap'>
                              <TextInput
                                size='xs'
                                value={editingEmailValue}
                                onChange={(e) => setEditingEmailValue(e.currentTarget.value)}
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter') return;
                                  const email = editingEmailValue.trim().toLowerCase();
                                  if (!EMAIL_RE.test(email)) {
                                    setEditingEmailError('Escriba un correo válido.');
                                    return;
                                  }
                                  onAssign(person.order, email, person.name, {
                                    type: 'external',
                                    cardCode: person.cardCode ?? null,
                                  });
                                  setEditingEmailOrder(null);
                                  setEditingEmailError(null);
                                }}
                                style={{ flex: 1 }}
                                autoFocus
                                aria-label='Correo de invitación'
                              />
                              <Button
                                size='xs'
                                onClick={() => {
                                  const email = editingEmailValue.trim().toLowerCase();
                                  if (!EMAIL_RE.test(email)) {
                                    setEditingEmailError('Escriba un correo válido.');
                                    return;
                                  }
                                  onAssign(person.order, email, person.name, {
                                    type: 'external',
                                    cardCode: person.cardCode ?? null,
                                  });
                                  setEditingEmailOrder(null);
                                  setEditingEmailError(null);
                                }}
                              >
                                Guardar
                              </Button>
                              <Button
                                size='xs'
                                variant='subtle'
                                color='gray'
                                onClick={() => {
                                  setEditingEmailOrder(null);
                                  setEditingEmailError(null);
                                }}
                              >
                                Cancelar
                              </Button>
                            </Group>
                            {editingEmailError ? (
                              <Text size='xs' c='red'>
                                {editingEmailError}
                              </Text>
                            ) : null}
                          </Stack>
                        ) : null}
                      </Stack>
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
                              onAssign(
                                person.order,
                                p.email,
                                p.cardName,
                                p.source === 'user'
                                  ? { type: 'internal', cardCode: null }
                                  : { type: 'external', cardCode: p.cardCode }
                              )
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
                    <NumberInput
                      mt='sm'
                      size='xs'
                      label='ID firma'
                      description='Número visible en el documento (ej. 1, 2…).'
                      value={resolveSignatureMarkId(person)}
                      min={1}
                      max={99}
                      disabled={readOnly || !onSignatureMarkIdChange}
                      w={120}
                      onChange={(value) => {
                        const next = typeof value === 'number' ? value : Number(value);
                        if (!Number.isFinite(next) || next < 1) return;
                        const markId = Math.trunc(next);
                        const clash = slots.some(
                          (other) =>
                            other.order !== person.order &&
                            resolveSignatureMarkId(other) === markId
                        );
                        if (clash) {
                          toast.error(`El ID de firma ${markId} ya está en uso`);
                          return;
                        }
                        onSignatureMarkIdChange?.(person.order, markId);
                      }}
                    />
                    {person.email && canUseFingerprint ? (
                      <Checkbox
                        size='xs'
                        mt='sm'
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

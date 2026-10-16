'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Box, Button, Group, Modal, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconArrowLeft, IconCheck, IconShieldCheck } from '@tabler/icons-react';
import { isSignerTurnExpired } from '../../lib/orion/signerDeadline';
import {
  getCurrentPendingSigner,
  isSignerCompleted,
  orderedSigners,
} from '../../lib/orion/signerStatus';
import type { OrionSignatureState, OrionSignerState } from '../../lib/orion/types';

type Props = {
  state: OrionSignatureState;
  currentUserEmail?: string | null;
  /** Si true (default), muestra solo el enlace. */
  compact?: boolean;
  /**
   * firma = progreso de firmantes.
   * validacion = cadena de quién pasó / quién aprobó (ideal al cierre).
   * auto = validacion si FIRMADO o hay cajas validation; si no, firma.
   */
  mode?: 'firma' | 'validacion' | 'auto';
  onRenewDeadline?: (() => void) | null;
  renewLoading?: boolean;
  canRenewDeadline?: boolean;
  requestId?: number | null;
  processName?: string | null;
  requesterName?: string | null;
  fileName?: string | null;
};

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function documentStatusMeta(status?: string | null): {
  label: string;
  color: string;
} {
  const value = String(status || '').toUpperCase();
  if (value === 'FIRMADO') return { label: 'Validado', color: 'var(--mantine-color-teal-6)' };
  if (value === 'RECHAZADO') return { label: 'Rechazado', color: 'var(--mantine-color-red-6)' };
  if (value === 'DEVUELTO') return { label: 'Devuelto', color: 'var(--mantine-color-orange-6)' };
  if (value === 'BORRADOR') return { label: 'Borrador', color: 'var(--mantine-color-gray-6)' };
  if (value === 'EN_PROCESO' || value === 'PENDIENTE_FIRMA') {
    return { label: 'En proceso', color: 'var(--mantine-color-blue-6)' };
  }
  return { label: 'En proceso', color: 'var(--mantine-color-blue-6)' };
}

function resolveMode(
  state: OrionSignatureState,
  mode: 'firma' | 'validacion' | 'auto' | undefined
): 'firma' | 'validacion' {
  if (mode === 'firma' || mode === 'validacion') return mode;
  const status = String(state.status || '').toUpperCase();
  if (status === 'FIRMADO' || status === 'SIGNED' || status === 'COMPLETED') return 'validacion';
  const hasValidation = (state.signatureFields ?? []).some(
    (f) => String(f.kind || '').toLowerCase() === 'validation'
  );
  return hasValidation ? 'validacion' : 'firma';
}

function signerRoleLabel(
  signer: OrionSignerState,
  state: OrionSignatureState,
  validationMode: boolean
): string {
  const order = Number(signer.order);
  const kinds = new Set(
    (state.signatureFields ?? [])
      .filter((f) => Number(f.signerOrder) === order)
      .map((f) => String(f.kind || 'signature').toLowerCase())
  );
  if (kinds.has('validation') && !kinds.has('signature')) {
    return validationMode ? 'Revisor / elaboró' : 'Validación';
  }
  if (kinds.has('fingerprint')) {
    return validationMode ? 'Firmante (con huella)' : 'Firma + huella';
  }
  return validationMode ? 'Firmante / aprobador' : 'Firmante';
}

function formatSignedAt(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function signerStepMeta(
  signer: OrionSignerState,
  pendingEmail: string | null,
  validationMode: boolean
): { label: string; tone: 'done' | 'active' | 'pending' | 'expired' } {
  if (isSignerCompleted(signer.status)) {
    return { label: validationMode ? 'Aprobado' : 'Completado', tone: 'done' };
  }
  const email = normalizeEmail(signer.email);
  const isPending = Boolean(pendingEmail && email === pendingEmail);
  if (isPending && isSignerTurnExpired(signer)) return { label: 'Vencido', tone: 'expired' };
  if (isPending) return { label: validationMode ? 'En revisión' : 'En proceso', tone: 'active' };
  return { label: 'Pendiente', tone: 'pending' };
}

function toneColor(tone: 'done' | 'active' | 'pending' | 'expired'): string {
  if (tone === 'done') return 'var(--mantine-color-teal-6)';
  if (tone === 'active') return 'var(--mantine-color-blue-6)';
  if (tone === 'expired') return 'var(--mantine-color-orange-6)';
  return 'var(--mantine-color-gray-5)';
}

function StepDot({
  tone,
  children,
}: {
  tone: 'done' | 'active' | 'pending' | 'expired';
  children?: ReactNode;
}) {
  const bg =
    tone === 'done'
      ? 'var(--mantine-color-teal-6)'
      : tone === 'active'
        ? 'var(--mantine-color-blue-6)'
        : tone === 'expired'
          ? 'var(--mantine-color-orange-6)'
          : 'var(--mantine-color-gray-3)';
  return (
    <Box
      style={{
        width: 28,
        height: 28,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        background: bg,
        color: tone === 'pending' ? 'var(--mantine-color-gray-7)' : '#fff',
        fontSize: 12,
        fontWeight: 800,
        position: 'relative',
        zIndex: 1,
      }}
    >
      {tone === 'done' ? <IconCheck size={14} stroke={3} color='#fff' /> : children}
    </Box>
  );
}

function FlowContent({
  state,
  onRenewDeadline,
  renewLoading,
  canRenewDeadline,
  requestId,
  processName,
  requesterName,
  fileName,
  resolvedMode,
  onClose,
}: Props & { onClose?: () => void; resolvedMode: 'firma' | 'validacion' }) {
  const validationMode = resolvedMode === 'validacion';
  const signers = useMemo(() => orderedSigners(state.signers), [state.signers]);
  const pending = getCurrentPendingSigner(signers);
  const pendingEmail = normalizeEmail(pending?.email);
  const completedCount = signers.filter((s) => isSignerCompleted(s.status)).length;
  const total = signers.length;
  const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const statusMeta = documentStatusMeta(state.status);
  const expired = Boolean(pending && isSignerTurnExpired(pending));
  const isClosed =
    String(state.status || '').toUpperCase() === 'FIRMADO' ||
    String(state.status || '').toUpperCase() === 'SIGNED' ||
    String(state.status || '').toUpperCase() === 'COMPLETED';
  const lastApprover = [...signers].reverse().find((s) => isSignerCompleted(s.status));
  const headlineId =
    requestId != null
      ? String(requestId)
      : String(state.orionDocumentId || '').trim() ||
        String(fileName || 'Documento').replace(/\.pdf$/i, '');
  const subtitle = [processName, requesterName].filter(Boolean).join(' · ') || fileName || '';

  return (
    <Box
      style={{
        background: 'var(--mantine-color-body)',
        color: 'var(--mantine-color-text)',
        borderRadius: 16,
        border: '1px solid var(--mantine-color-default-border)',
        padding: '22px 22px 18px',
      }}
    >
      <Group justify='space-between' align='flex-start' mb={6} wrap='nowrap' gap='md'>
        <Text
          size='11px'
          fw={700}
          c='dimmed'
          style={{ letterSpacing: 1.2, textTransform: 'uppercase' }}
        >
          {validationMode ? 'Cadena de validación' : 'Documento en flujo'}
        </Text>
        <Box
          px={10}
          py={3}
          style={{
            borderRadius: 999,
            border: `1px solid ${statusMeta.color}`,
            color: statusMeta.color,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {statusMeta.label}
        </Box>
      </Group>

      <Text fw={800} style={{ fontSize: 28, lineHeight: 1.15, letterSpacing: -0.4 }} mb={4}>
        {headlineId}
      </Text>
      {subtitle ? (
        <Text size='sm' c='dimmed' mb={6}>
          {subtitle}
        </Text>
      ) : null}
      <Text size='sm' mb='lg'>
        {validationMode
          ? `Aprobaciones ${completedCount}/${total || 0}`
          : `Firmantes ${completedCount}/${total || 0}`}
        <Text span c='dimmed'>
          {validationMode ? ' · Quién pasó y quién aprobó' : ' · Firma secuencial'}
        </Text>
      </Text>

      {validationMode && isClosed && lastApprover ? (
        <Box
          mb='lg'
          p='sm'
          style={{
            borderRadius: 10,
            background: 'light-dark(var(--mantine-color-teal-0), rgba(18, 184, 134, 0.14))',
            border: '1px solid light-dark(var(--mantine-color-teal-3), rgba(18, 184, 134, 0.45))',
          }}
        >
          <Group gap={8} wrap='nowrap'>
            <IconShieldCheck
              size={18}
              style={{
                color:
                  'light-dark(var(--mantine-color-teal-7), var(--mantine-color-teal-4))',
                flexShrink: 0,
              }}
            />
            <Box style={{ minWidth: 0 }}>
              <Text
                size='xs'
                fw={700}
                tt='uppercase'
                style={{
                  letterSpacing: 0.4,
                  color:
                    'light-dark(var(--mantine-color-teal-7), var(--mantine-color-teal-4))',
                }}
              >
                Documento validado
              </Text>
              <Text
                size='sm'
                fw={600}
                lineClamp={1}
                style={{
                  color:
                    'light-dark(var(--mantine-color-dark-7), var(--mantine-color-gray-0))',
                }}
              >
                Aprobado finalmente por {lastApprover.name || lastApprover.email}
              </Text>
              {formatSignedAt(lastApprover.signedAt) ? (
                <Text
                  size='xs'
                  style={{
                    color:
                      'light-dark(var(--mantine-color-dark-3), var(--mantine-color-gray-5))',
                  }}
                >
                  {formatSignedAt(lastApprover.signedAt)}
                </Text>
              ) : null}
            </Box>
          </Group>
        </Box>
      ) : null}

      <Group justify='space-between' mb={6}>
        <Text size='sm' fw={700}>
          {validationMode ? 'Recorrido del documento' : 'Progreso del flujo'}
        </Text>
        <Text size='sm' c='dimmed'>
          {percent}%
        </Text>
      </Group>
      <Progress value={percent} size={10} radius='xl' color='blue' mb='xl' />

      <Stack gap={0} mb='lg'>
        <Group align='flex-start' wrap='nowrap' gap='sm' style={{ position: 'relative' }}>
          <Box style={{ position: 'relative', width: 28, flexShrink: 0 }}>
            <Box
              style={{
                position: 'absolute',
                left: '50%',
                top: 28,
                bottom: -8,
                width: 2,
                transform: 'translateX(-50%)',
                background: 'var(--mantine-color-teal-5)',
              }}
            />
            <StepDot tone='done' />
          </Box>
          <Group justify='space-between' style={{ flex: 1, minWidth: 0 }} wrap='nowrap' pb='md'>
            <Box style={{ minWidth: 0 }}>
              <Text size='sm' fw={700}>
                Documento creado
              </Text>
              {requesterName ? (
                <Text size='xs' c='dimmed' lineClamp={1}>
                  Solicitante: {requesterName}
                </Text>
              ) : null}
            </Box>
            <Text size='sm' fw={600} c='teal' style={{ whiteSpace: 'nowrap' }}>
              Completado
            </Text>
          </Group>
        </Group>

        {signers.map((signer, index) => {
          const meta = signerStepMeta(signer, pendingEmail || null, validationMode);
          const isLast = index === signers.length - 1 && !isClosed;
          const name = signer.name || signer.email || `Firmante ${index + 1}`;
          const role = signerRoleLabel(signer, state, validationMode);
          const signedAtLabel = formatSignedAt(signer.signedAt);
          const lineColor =
            meta.tone === 'done'
              ? 'var(--mantine-color-teal-5)'
              : meta.tone === 'active'
                ? 'var(--mantine-color-blue-5)'
                : 'var(--mantine-color-gray-3)';

          return (
            <Group
              key={`${signer.email}-${index}`}
              align='flex-start'
              wrap='nowrap'
              gap='sm'
              style={{ position: 'relative' }}
            >
              <Box style={{ position: 'relative', width: 28, flexShrink: 0 }}>
                {(!isLast || isClosed) && (
                  <Box
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: 28,
                      bottom: -8,
                      width: 2,
                      transform: 'translateX(-50%)',
                      background: lineColor,
                    }}
                  />
                )}
                <StepDot tone={meta.tone}>{index + 1}</StepDot>
              </Box>
              <Group
                justify='space-between'
                align='flex-start'
                style={{ flex: 1, minWidth: 0 }}
                wrap='nowrap'
                gap='md'
                pb={isLast && !isClosed ? 0 : 'md'}
              >
                <Box style={{ minWidth: 0 }}>
                  <Text
                    size='sm'
                    fw={700}
                    c={meta.tone === 'active' ? 'blue' : undefined}
                    lineClamp={1}
                  >
                    {index + 1}. {name}
                  </Text>
                  <Text size='xs' c='dimmed' lineClamp={1}>
                    {role}
                    {signer.email ? ` · ${signer.email}` : ''}
                  </Text>
                  {signedAtLabel ? (
                    <Text size='xs' c='teal'>
                      {validationMode ? `Aprobó: ${signedAtLabel}` : `Firmó: ${signedAtLabel}`}
                    </Text>
                  ) : null}
                </Box>
                <Text
                  size='sm'
                  fw={600}
                  style={{ color: toneColor(meta.tone), whiteSpace: 'nowrap' }}
                >
                  {meta.label}
                </Text>
              </Group>
            </Group>
          );
        })}

        {isClosed ? (
          <Group align='flex-start' wrap='nowrap' gap='sm' style={{ position: 'relative' }}>
            <Box style={{ position: 'relative', width: 28, flexShrink: 0 }}>
              <StepDot tone='done'>
                <IconShieldCheck size={14} stroke={2.5} color='#fff' />
              </StepDot>
            </Box>
            <Group justify='space-between' style={{ flex: 1, minWidth: 0 }} wrap='nowrap'>
              <Box style={{ minWidth: 0 }}>
                <Text size='sm' fw={700}>
                  Documento validado
                </Text>
                <Text size='xs' c='dimmed'>
                  Marca de agua “SYNERLINK-VALIDO” en todas las hojas
                </Text>
              </Box>
              <Text size='sm' fw={600} c='teal' style={{ whiteSpace: 'nowrap' }}>
                Cerrado
              </Text>
            </Group>
          </Group>
        ) : null}
      </Stack>

      {canRenewDeadline &&
        pending &&
        (expired || pending.extensionRequestedAt) &&
        onRenewDeadline && (
          <Button
            loading={renewLoading}
            onClick={onRenewDeadline}
            fullWidth
            mb='sm'
            variant='light'
            color='orange'
          >
            Renovar plazo 24 h
          </Button>
        )}

      <Button
        fullWidth
        variant='default'
        leftSection={<IconArrowLeft size={16} />}
        onClick={onClose}
        styles={{
          root: {
            height: 42,
            borderRadius: 10,
          },
        }}
      >
        Volver a documentos
      </Button>
    </Box>
  );
}

/** Enlace + modal de flujo (firma o validación). */
export default function OrionSignatureFlow(props: Props) {
  const [opened, setOpened] = useState(false);
  const signers = useMemo(() => orderedSigners(props.state.signers), [props.state.signers]);
  const compact = props.compact !== false;
  const resolvedMode = resolveMode(props.state, props.mode);
  const linkLabel =
    resolvedMode === 'validacion' ? 'Ver flujo de validación →' : 'Ver flujo de firma →';

  if (signers.length === 0) return null;

  if (!compact) {
    return <FlowContent {...props} resolvedMode={resolvedMode} />;
  }

  return (
    <>
      <UnstyledButton
        onClick={() => setOpened(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--mantine-color-blue-6)',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'underline',
          textUnderlineOffset: 3,
        }}
      >
        {linkLabel}
      </UnstyledButton>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        withCloseButton={false}
        centered
        size={440}
        padding={0}
        radius='lg'
        overlayProps={{ backgroundOpacity: 0.35, blur: 1 }}
        styles={{
          content: {
            background: 'var(--mantine-color-body)',
            boxShadow: '0 16px 48px rgba(15, 23, 42, 0.12)',
          },
          body: { padding: 0 },
        }}
      >
        <FlowContent
          {...props}
          resolvedMode={resolvedMode}
          onClose={() => setOpened(false)}
        />
      </Modal>
    </>
  );
}

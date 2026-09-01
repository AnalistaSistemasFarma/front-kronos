'use client';

import { Badge, Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconCheck, IconClock, IconEye, IconSettings, IconSignature } from '@tabler/icons-react';
import type { OrionUiPermissions } from '../../lib/orion/permissions';

type Props = {
  permissions: OrionUiPermissions;
};

const ROLE_COPY = {
  coordinator: {
    title: 'Coordinador de firma',
    description:
      'Usted prepara el documento: carga el PDF, asigna firmantes, ubica las firmas y envía el flujo.',
    color: 'blue',
    icon: IconSettings,
  },
  signer: {
    title: 'Firmante',
    description:
      'Revise el documento, dibuje su firma y presione Aceptar. El sistema avanzará al siguiente firmante.',
    color: 'green',
    icon: IconSignature,
  },
  waiting: {
    title: 'Firmante en espera',
    description:
      'Aún no es su turno. El flujo es secuencial: cuando le corresponda podrá firmar desde esta misma tarea.',
    color: 'yellow',
    icon: IconClock,
  },
  viewer: {
    title: 'Solo consulta',
    description: 'Puede ver el estado del proceso, sin acciones de configuración ni firma.',
    color: 'gray',
    icon: IconEye,
  },
} as const;

export default function OrionPermissionsOverview({ permissions }: Props) {
  const role = ROLE_COPY[permissions.userRole];
  const RoleIcon = role.icon;

  const coordinatorActions = [
    { label: 'Cargar documento', ok: permissions.canUploadDocument || permissions.canUseAttachment },
    { label: 'Asignar firmantes', ok: permissions.canAssignSigners },
    { label: 'Ubicar firmas', ok: permissions.canPlaceSignatures },
  ];

  const signerActions = [
    { label: 'Ver documento', ok: permissions.canViewDocument },
    { label: 'Dibujar mi firma', ok: permissions.canDrawSignature },
    { label: 'Aceptar y firmar', ok: permissions.canAcceptSign },
  ];

  const actions = permissions.userRole === 'coordinator' ? coordinatorActions : signerActions;

  return (
    <Paper
      withBorder
      p='md'
      radius='md'
      mb='md'
      style={{
        background: 'var(--app-surface-raised)',
        borderColor: 'var(--app-border)',
      }}
    >
      <Group justify='space-between' wrap='wrap' gap='sm' mb='sm'>
        <Group gap='sm'>
          <ThemeIcon size={36} radius='md' variant='light' color={role.color}>
            <RoleIcon size={18} />
          </ThemeIcon>
          <div>
            <Text size='sm' fw={700}>
              {role.title}
            </Text>
            <Text size='xs' c='dimmed'>
              {role.description}
            </Text>
          </div>
        </Group>
        <Badge variant='light' color={role.color}>
          {permissions.roleLabel}
        </Badge>
      </Group>

      {(permissions.userRole === 'coordinator' || permissions.userRole === 'signer') && (
        <Group gap='xs' wrap='wrap'>
          {actions.map((action) => (
            <Badge
              key={action.label}
              size='sm'
              variant='light'
              color={action.ok ? 'green' : 'gray'}
              leftSection={action.ok ? <IconCheck size={12} /> : undefined}
            >
              {action.label}
            </Badge>
          ))}
        </Group>
      )}

      {permissions.userRole === 'waiting' && (
        <Text size='xs' c='dimmed'>
          Acciones disponibles cuando el coordinador envíe el documento y sea su turno en la secuencia.
        </Text>
      )}
    </Paper>
  );
}

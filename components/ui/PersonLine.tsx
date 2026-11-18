'use client';

import React from 'react';
import { Avatar, Group, Text, Tooltip } from '@mantine/core';

const ROLE_LABEL = { requester: 'Solicitante', assignee: 'Asignado' } as const;

/**
 * Foto de perfil (o iniciales) y nombre de una persona, para columnas «Solicitante / Asignado».
 * `role` pone una etiqueta corta delante para que se sepa quién es quién.
 */
export default function PersonLine({
  name,
  image,
  dimmed = false,
  role,
}: {
  name?: string | null;
  image?: string | null;
  dimmed?: boolean;
  role?: keyof typeof ROLE_LABEL;
}) {
  const label = String(name ?? '').trim();
  const roleText = role ? ROLE_LABEL[role] : null;
  return (
    <Group gap={6} wrap='nowrap' style={{ minWidth: 0 }}>
      {roleText && (
        <Text size='xs' c='dimmed' w={70} style={{ flexShrink: 0 }}>
          {roleText}
        </Text>
      )}
      <Tooltip label={roleText ? `${roleText}: ${label}` : label} withArrow openDelay={300}>
        <Avatar src={image || null} name={label.split(',')[0] || '?'} color='initials' size={22} radius='xl' style={{ flexShrink: 0 }} />
      </Tooltip>
      <Text size='sm' c={dimmed ? 'dimmed' : undefined} truncate>
        {label}
      </Text>
    </Group>
  );
}

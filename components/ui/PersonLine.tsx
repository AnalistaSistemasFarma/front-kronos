'use client';

import React from 'react';
import { Avatar, Group, Text } from '@mantine/core';

/** Foto de perfil (o iniciales) y nombre de una persona, para columnas «Solicitante / Asignado». */
export default function PersonLine({ name, image, dimmed = false }: { name?: string | null; image?: string | null; dimmed?: boolean }) {
  const label = String(name ?? '').trim();
  return (
    <Group gap={6} wrap='nowrap'>
      <Avatar src={image || null} name={label.split(',')[0] || '?'} color='initials' size={22} radius='xl' />
      <Text size='sm' c={dimmed ? 'dimmed' : undefined} truncate>
        {label}
      </Text>
    </Group>
  );
}

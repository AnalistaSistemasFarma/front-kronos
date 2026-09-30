'use client';

import type { ReactNode } from 'react';
import { Badge, Card, Group, Text, ThemeIcon } from '@mantine/core';

/**
 * Tarjeta del tablero de accesos del SGC documental. En el Sprint 0 todas
 * quedan como "próximamente" (sin enlace); cada sprint las va habilitando.
 */
export interface SgcModuleCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  /** Sprint del plan en el que se habilita (se muestra mientras no esté lista). */
  sprint: string;
}

export default function SgcModuleCard({ title, description, icon, sprint }: SgcModuleCardProps) {
  return (
    <Card
      withBorder
      radius='md'
      p='lg'
      shadow='xs'
      aria-disabled='true'
      data-testid='sgc-module-card'
      style={{ opacity: 0.85 }}
    >
      <Group justify='space-between' align='flex-start' mb='sm' wrap='nowrap'>
        <ThemeIcon size={44} radius='md' variant='light'>
          {icon}
        </ThemeIcon>
        <Badge variant='light' color='gray' size='sm'>
          Próximamente · {sprint}
        </Badge>
      </Group>
      <Text fw={600} size='md' mb={4}>
        {title}
      </Text>
      <Text size='sm' c='dimmed'>
        {description}
      </Text>
    </Card>
  );
}

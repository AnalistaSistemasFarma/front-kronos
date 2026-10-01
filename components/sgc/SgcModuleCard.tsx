'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Card, Group, Text, ThemeIcon } from '@mantine/core';
import './sgc-states.css';

/**
 * Tarjeta del tablero de accesos del SGC documental. Con `href` es un acceso
 * activo; sin él queda como "Próximamente · Sprint N" (sin enlace).
 */
export interface SgcModuleCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  /** Sprint del plan en el que se habilita (se muestra mientras no esté lista). */
  sprint: string;
  href?: string;
  /** Distintivo opcional para accesos activos (p. ej. "Calidad"). */
  badge?: string;
}

export default function SgcModuleCard({ title, description, icon, sprint, href, badge }: SgcModuleCardProps) {
  const enabled = !!href;
  const body = (
    <>
      <Group justify='space-between' align='flex-start' mb='sm' wrap='nowrap'>
        <ThemeIcon size={44} radius='md' variant='light' color={enabled ? undefined : 'gray'}>
          {icon}
        </ThemeIcon>
        {enabled ? (
          badge ? (
            <Badge variant='light' size='sm'>
              {badge}
            </Badge>
          ) : null
        ) : (
          <Badge variant='light' color='gray' size='sm'>
            Próximamente · {sprint}
          </Badge>
        )}
      </Group>
      <Text fw={600} size='md' mb={4}>
        {title}
      </Text>
      <Text size='sm' c='dimmed'>
        {description}
      </Text>
    </>
  );

  if (enabled) {
    return (
      <Card
        withBorder
        radius='md'
        p='lg'
        shadow='xs'
        component={Link}
        href={href}
        data-testid='sgc-module-card'
        data-enabled='true'
        className='sgc-module-card'
      >
        {body}
      </Card>
    );
  }

  return (
    <Card withBorder radius='md' p='lg' shadow='xs' aria-disabled='true' data-testid='sgc-module-card' data-enabled='false' style={{ opacity: 0.5, cursor: 'not-allowed' }}>
      {body}
    </Card>
  );
}

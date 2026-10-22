'use client';

import Link from 'next/link';
import { Alert, Anchor, Avatar, Badge, Group, Skeleton, Stack, Title, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconChevronRight, IconCircleCheck, IconFolders } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import AgentAvatar from '../chat/AgentAvatar';
import { PROJECT_ROLE_LABELS, type ProjectRole } from '../../lib/chat/projects-rules';
import type { AgenteMiniDto } from '../../lib/proyectos/tipos';
import css from './proyectos.module.css';

/** Corte de celular/tableta: el mismo del chat y del Correo (62em). */
export const CONSULTA_ESCRITORIO = '(min-width: 62em)';

const COLOR_ROL: Record<ProjectRole, string> = { owner: 'grape', editor: 'blue', reader: 'gray' };

export function BadgeRol({ role }: { role: ProjectRole }) {
  return (
    <Badge size='sm' variant='light' color={COLOR_ROL[role]} style={{ flexShrink: 0 }}>
      {PROJECT_ROLE_LABELS[role]}
    </Badge>
  );
}

/** Avatares de los agentes del proyecto, encimados (máx. 4 + contador). */
export function AgentesApilados({ agentes, size = 26 }: { agentes: AgenteMiniDto[]; size?: number }) {
  const visibles = agentes.slice(0, 4);
  const resto = agentes.length - visibles.length;
  return (
    <Tooltip label={agentes.map((a) => a.displayName).join(', ')} withArrow openDelay={300} disabled={agentes.length === 0}>
      <Avatar.Group spacing={size / 3}>
        {visibles.map((a) => (
          <AgentAvatar
            key={a.idAgent}
            code={a.code}
            displayName={a.displayName}
            avatarUrl={a.avatarUrl}
            avatarVersion={a.avatarVersion}
            size={size}
            showStatus={false}
            withTooltip={false}
          />
        ))}
        {resto > 0 && (
          <Avatar size={size} radius='xl'>
            +{resto}
          </Avatar>
        )}
      </Avatar.Group>
    </Tooltip>
  );
}

/** Encabezado de UNA línea, como el del Correo: «Procesos › Proyectos» y, a la derecha, las acciones. */
export function Encabezado({ titulo, migas, derecha }: { titulo: ReactNode; migas?: ReactNode; derecha?: ReactNode }) {
  return (
    <Group className={css.encabezado} justify='space-between' wrap='nowrap' gap='sm' data-testid='proyectos-encabezado'>
      <Group gap={8} wrap='nowrap' style={{ minWidth: 0, flex: 1 }}>
        <Anchor component={Link} href='/process' size='sm' c='dimmed' visibleFrom='sm' style={{ flexShrink: 0 }}>
          Procesos
        </Anchor>
        <IconChevronRight size={14} color='var(--mantine-color-dimmed)' style={{ flexShrink: 0 }} className='hidden sm:block' />
        {migas}
        <Title order={1} fz={20} fw={700} className={`flex items-center gap-2 ${css.truncar}`} data-testid='proyectos-titulo'>
          <IconFolders size={22} className='text-blue-600' style={{ flexShrink: 0 }} />
          <span className={css.truncar}>{titulo}</span>
        </Title>
      </Group>
      {derecha}
    </Group>
  );
}

export type Aviso = { tipo: 'ok' | 'error' | 'advertencia'; texto: string } | null;

/** Aviso ARRIBA y con color (lineamiento de SynerLink): verde, rojo o amarillo. */
export function AvisoArriba({ aviso, onClose }: { aviso: Aviso; onClose: () => void }) {
  if (!aviso) return null;
  const color = aviso.tipo === 'ok' ? 'green' : aviso.tipo === 'error' ? 'red' : 'yellow';
  const icono =
    aviso.tipo === 'ok' ? <IconCircleCheck size={18} /> : aviso.tipo === 'error' ? <IconAlertCircle size={18} /> : <IconAlertTriangle size={18} />;
  return (
    <Alert color={color} radius='md' icon={icono} withCloseButton onClose={onClose} py={8} data-testid='proyectos-aviso' role={aviso.tipo === 'error' ? 'alert' : 'status'}>
      {aviso.texto}
    </Alert>
  );
}

export function EsqueletoTarjetas({ n = 6 }: { n?: number }) {
  return (
    <div className={css.rejilla} aria-hidden='true'>
      {Array.from({ length: n }, (_, i) => (
        <Stack key={i} gap={10} p='md' style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-md)' }}>
          <Skeleton height={16} width='70%' radius='sm' />
          <Skeleton height={10} width='45%' radius='sm' />
          <Skeleton height={10} width='90%' radius='sm' />
          <Group gap={6}>
            <Skeleton height={24} circle />
            <Skeleton height={24} circle />
            <Skeleton height={18} width={60} radius='xl' />
          </Group>
        </Stack>
      ))}
    </div>
  );
}

export function EsqueletoFilas({ n = 5 }: { n?: number }) {
  return (
    <Stack gap={6} p='sm' aria-hidden='true'>
      {Array.from({ length: n }, (_, i) => (
        <Group key={i} gap={10} wrap='nowrap' className={css.fila}>
          <Skeleton height={32} circle />
          <Stack gap={6} style={{ flex: 1 }}>
            <Skeleton height={12} width={`${60 + ((i * 13) % 30)}%`} radius='sm' />
            <Skeleton height={9} width='40%' radius='sm' />
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}

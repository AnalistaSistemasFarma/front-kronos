'use client';

import { useState } from 'react';
import { ActionIcon, Badge, Tooltip } from '@mantine/core';
import { IconBell, IconBellOff } from '@tabler/icons-react';
import { apiSend } from './api';
import type { Aviso } from './ui';

/**
 * «Silenciar notificaciones» of a project (2026-11-23, msg 38059). Only for the
 * person in session; see lib/proyectos/mute.ts for what it silences.
 * Bell = notifications on; crossed-out bell (orange) = muted.
 */
export function BotonSilenciar({
  idProject,
  muted,
  onChange,
  avisar,
  size = 32,
}: {
  idProject: number;
  muted: boolean;
  onChange: (muted: boolean) => void;
  avisar: (a: Aviso) => void;
  size?: number;
}) {
  const [ocupado, setOcupado] = useState(false);
  const etiqueta = muted ? 'Activar notificaciones' : 'Silenciar notificaciones';

  const alternar = async () => {
    if (ocupado) return;
    setOcupado(true);
    const nuevo = !muted;
    const r = await apiSend<{ muted: boolean }>('PATCH', `/api/proyectos/${idProject}/notificaciones`, { muted: nuevo }, 'No se pudo cambiar las notificaciones del proyecto.');
    setOcupado(false);
    if (!r.ok) {
      avisar({ tipo: 'error', texto: r.error });
      return;
    }
    onChange(r.data.muted);
    avisar({
      tipo: 'ok',
      texto: r.data.muted
        ? 'Notificaciones silenciadas: este proyecto ya no le enviará avisos ni sonidos. Los mensajes siguen llegando al proyecto.'
        : 'Notificaciones activadas: volverá a recibir los avisos de este proyecto.',
    });
  };

  return (
    <Tooltip label={etiqueta} withArrow openDelay={300}>
      <ActionIcon
        variant={muted ? 'light' : 'subtle'}
        color={muted ? 'orange' : 'gray'}
        size={size}
        radius='xl'
        loading={ocupado}
        onClick={() => void alternar()}
        aria-label={etiqueta}
        aria-pressed={muted}
        data-testid='proyecto-silenciar'
        data-muted={muted ? 'true' : 'false'}
        style={{ flexShrink: 0 }}
      >
        {muted ? <IconBellOff size={size * 0.56} /> : <IconBell size={size * 0.56} />}
      </ActionIcon>
    </Tooltip>
  );
}

/** «Silenciado» badge for the project list and header. */
export function BadgeSilenciado() {
  return (
    <Badge size='sm' variant='light' color='orange' leftSection={<IconBellOff size={12} />} style={{ textTransform: 'none' }} data-testid='proyecto-silenciado'>
      Silenciado
    </Badge>
  );
}

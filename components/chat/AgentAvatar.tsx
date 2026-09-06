'use client';

import { Avatar, Indicator, Tooltip } from '@mantine/core';
import {
  agentColor,
  agentInitials,
  describeAgentStatus,
  type ChatStatusDto,
} from '../../lib/chat/client';

/**
 * Avatar de un agente con sus dos señales:
 *
 *   - CONTADOR de mensajes sin leer (Indicator de Mantine, mismo patrón que
 *     components/NotificationBell.tsx).
 *   - PUNTO DE ESTADO (trabajando / disponible). Es lo que evita que el chat
 *     parezca congelado mientras el agente piensa.
 *
 * `avatar_url` viene NULL para todos los agentes sembrados hoy, así que el
 * camino normal es el avatar por INICIAL, con un color estable derivado del
 * `code` para que cada agente se distinga de un vistazo.
 */
export default function AgentAvatar({
  code,
  displayName,
  avatarUrl,
  unread = 0,
  status = null,
  size = 34,
  showStatus = true,
  withTooltip = true,
}: {
  code: string;
  displayName: string;
  avatarUrl: string | null;
  unread?: number;
  status?: ChatStatusDto | null;
  size?: number;
  showStatus?: boolean;
  withTooltip?: boolean;
}) {
  const view = describeAgentStatus(status);

  const avatar = (
    <Avatar
      src={avatarUrl || undefined}
      alt={displayName}
      size={size}
      radius='xl'
      color={agentColor(code)}
      variant='filled'
    >
      {agentInitials(displayName)}
    </Avatar>
  );

  // Dos Indicator anidados: el de afuera lleva el contador (arriba-derecha) y
  // el de adentro el punto de estado (abajo-derecha). Anidarlos es lo que
  // permite mostrar las dos señales sin que se pisen.
  const withStatus = showStatus ? (
    <Indicator
      inline
      position='bottom-end'
      size={Math.max(9, Math.round(size * 0.28))}
      offset={Math.round(size * 0.1)}
      color={view.color}
      processing={view.busy}
      withBorder
      aria-label={`Estado: ${view.label}`}
    >
      {avatar}
    </Indicator>
  ) : (
    avatar
  );

  const withUnread =
    unread > 0 ? (
      <Indicator
        inline
        position='top-end'
        size={16}
        offset={2}
        color='red'
        label={unread > 99 ? '99+' : String(unread)}
        aria-label={`${unread} mensajes sin leer`}
      >
        {withStatus}
      </Indicator>
    ) : (
      withStatus
    );

  if (!withTooltip) return withUnread;

  const tooltip =
    unread > 0
      ? `${displayName} · ${unread} sin leer · ${view.label}`
      : `${displayName} · ${view.label}`;

  return (
    <Tooltip label={tooltip} withArrow position='bottom'>
      <div style={{ display: 'inline-flex' }}>{withUnread}</div>
    </Tooltip>
  );
}

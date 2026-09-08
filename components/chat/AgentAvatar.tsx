'use client';

import { Avatar, Tooltip } from '@mantine/core';
import {
  agentColor,
  agentInitials,
  describeAgentStatus,
  type ChatStatusDto,
} from '../../lib/chat/client';

/**
 * Avatar de un agente con sus dos señales:
 *
 *   - CONTADOR de mensajes sin leer, arriba a la derecha.
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

  /*
   * DOS MARCAS CON POSICIÓN EXPLÍCITA, no `Indicator` anidados.
   *
   * Antes eran dos `Indicator` de Mantine, uno dentro del otro, confiando en
   * que "bottom-end" y "top-end" nunca se pisaran. Nicolás mandó un
   * acercamiento donde el contador quedaba tapado —"el 1 se ve detrás del
   * circulito de estado"— y las esquinas opuestas dejaron de ser garantía.
   *
   * Con un contenedor relativo y dos elementos absolutos el resultado no
   * depende de cómo Mantine resuelva el anidamiento: el punto de estado va
   * ABAJO A LA DERECHA, el contador ARRIBA A LA DERECHA y por encima
   * (`z-index`), y los dos llevan un borde del color del fondo para que se
   * separen del avatar y entre sí.
   */
  const puntoTamano = Math.max(9, Math.round(size * 0.28));
  const marcas = (
    <div className='agent-avatar' style={{ width: size, height: size }}>
      {avatar}

      {showStatus && (
        <span
          className={`agent-avatar__estado${view.busy ? ' agent-avatar__estado--ocupado' : ''}`}
          style={{
            width: puntoTamano,
            height: puntoTamano,
            backgroundColor: `var(--mantine-color-${view.color}-filled)`,
          }}
          role='img'
          aria-label={`Estado: ${view.label}`}
        />
      )}

      {unread > 0 && (
        <span
          className='agent-avatar__contador'
          aria-label={`${unread} mensajes sin leer`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </div>
  );

  if (!withTooltip) return marcas;

  const tooltip =
    unread > 0
      ? `${displayName} · ${unread} sin leer · ${view.label}`
      : `${displayName} · ${view.label}`;

  return (
    <Tooltip label={tooltip} withArrow position='bottom'>
      <div style={{ display: 'inline-flex' }}>{marcas}</div>
    </Tooltip>
  );
}

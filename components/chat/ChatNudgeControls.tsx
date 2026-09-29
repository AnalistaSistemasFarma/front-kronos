'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Menu, Text, Tooltip } from '@mantine/core';
import { IconBell, IconBellOff, IconDotsVertical } from '@tabler/icons-react';
import { chatFetch, pedirSondeoDelHilo } from '../../lib/chat/client';

/**
 * Controles del ZUMBIDO 📳 en el encabezado de un hilo entre personas.
 *
 *   - El botón 📳 manda el zumbido (POST …/nudge) y muestra la cuenta
 *     regresiva del límite de 30 s (D4). Si el servidor responde 429, la cuenta
 *     sale de su `Retry-After`: el límite de verdad es el del servidor.
 *   - El menú ⋮ silencia los zumbidos de ESTE hilo (D5). Es una preferencia de
 *     quien la cambia; la otra persona no se entera.
 */
export function ChatNudgeButton({
  idConversation,
  nombre,
}: {
  idConversation: number;
  /** La otra persona, para el aria-label y el aviso. */
  nombre: string;
}) {
  const [enviando, setEnviando] = useState(false);
  // Segundos que faltan para poder volver a zumbar. 0 = disponible.
  const [espera, setEspera] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (espera <= 0) return;
    const reloj = window.setTimeout(() => setEspera((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(reloj);
  }, [espera]);

  // Al cambiar de hilo, la cuenta de otro hilo no aplica.
  useEffect(() => {
    setEspera(0);
    setAviso(null);
  }, [idConversation]);

  const zumbar = async () => {
    if (enviando || espera > 0) return;
    setEnviando(true);
    setAviso(null);
    try {
      const res = await chatFetch(`/api/chat/conversations/${idConversation}/nudge`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => null)) as {
        cooldownSeconds?: number;
        retryAfterSeconds?: number;
        error?: string;
      } | null;
      if (res.status === 201) {
        setEspera(data?.cooldownSeconds ?? 30);
        // Que el zumbido aparezca ya en el hilo, sin esperar la cadencia.
        pedirSondeoDelHilo(idConversation);
        return;
      }
      if (res.status === 429) {
        const cabecera = Number(res.headers.get('Retry-After'));
        setEspera(Number.isFinite(cabecera) && cabecera > 0 ? cabecera : (data?.retryAfterSeconds ?? 30));
        setAviso(data?.error ?? 'Espere un momento para volver a zumbar.');
        return;
      }
      setAviso(data?.error ?? 'No se pudo enviar el zumbido.');
    } catch {
      setAviso('No se pudo enviar el zumbido.');
    } finally {
      setEnviando(false);
    }
  };

  const etiqueta =
    espera > 0
      ? `Podrá enviar otro zumbido en ${espera} s`
      : aviso ?? `Enviarle un zumbido a ${nombre}`;

  return (
    <Tooltip label={etiqueta} withArrow>
      <ActionIcon
        variant='subtle'
        color='gray'
        onClick={() => void zumbar()}
        loading={enviando}
        disabled={espera > 0}
        aria-label={
          espera > 0
            ? `Zumbido enviado. Podrá enviar otro en ${espera} segundos`
            : `Enviarle un zumbido a ${nombre}`
        }
        className='chat-zumbido__boton'
      >
        {espera > 0 ? (
          <Text size='xs' fw={600} component='span'>
            {espera}
          </Text>
        ) : (
          <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>
            📳
          </span>
        )}
      </ActionIcon>
    </Tooltip>
  );
}

export function ChatNudgeMenu({
  idConversation,
  silenciado,
  onCambio,
}: {
  idConversation: number;
  /** Lo que dice el servidor (ChatConversationDto.nudgesMuted). */
  silenciado: boolean;
  /** Tras guardar: para refrescar la bandeja. */
  onCambio?: () => void;
}) {
  // Optimista: el menú responde de una; si el servidor falla, vuelve atrás.
  const [local, setLocal] = useState(silenciado);
  useEffect(() => setLocal(silenciado), [silenciado, idConversation]);

  const alternar = async () => {
    const siguiente = !local;
    setLocal(siguiente);
    try {
      const res = await chatFetch(`/api/chat/conversations/${idConversation}/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ nudgesMuted: siguiente }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onCambio?.();
    } catch {
      setLocal(!siguiente);
    }
  };

  return (
    <Menu position='bottom-end' withArrow shadow='md'>
      <Menu.Target>
        <ActionIcon variant='subtle' color='gray' aria-label='Opciones de la conversación'>
          <IconDotsVertical size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={local ? <IconBell size={16} /> : <IconBellOff size={16} />}
          onClick={() => void alternar()}
        >
          {local ? 'Volver a recibir zumbidos' : 'Silenciar los zumbidos de esta conversación'}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

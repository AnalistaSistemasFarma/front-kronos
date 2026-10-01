'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconCheck, IconVolume, IconVolumeOff } from '@tabler/icons-react';
import {
  TONOS_MENSAJE,
  guardarTonoMensaje,
  previsualizarTono,
  tonoMensaje,
  type TonoMensaje,
} from '../../lib/chat/message-sound';

/**
 * Elegir el SONIDO DE MENSAJE NUEVO de este equipo (o "Silencio"). Al elegir
 * un tono suena de una vez como vista previa. Vive en localStorage: es una
 * comodidad del equipo, igual que el sonido del zumbido.
 */
export default function ChatSoundMenu() {
  const [tono, setTono] = useState<TonoMensaje>('campanita');
  useEffect(() => setTono(tonoMensaje()), []);

  const elegir = (siguiente: TonoMensaje) => {
    setTono(siguiente);
    guardarTonoMensaje(siguiente);
    previsualizarTono(siguiente);
  };

  const silencio = tono === 'silencio';

  return (
    <Menu position='bottom-end' withArrow shadow='md' closeOnItemClick={false}>
      <Menu.Target>
        <Tooltip label='Sonido de mensajes nuevos' withArrow>
          <ActionIcon variant='subtle' color='gray' aria-label='Sonido de mensajes nuevos'>
            {silencio ? <IconVolumeOff size={18} /> : <IconVolume size={18} />}
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Sonido de mensajes nuevos</Menu.Label>
        {TONOS_MENSAJE.map((t) => (
          <Menu.Item
            key={t.id}
            onClick={() => elegir(t.id)}
            leftSection={
              tono === t.id ? <IconCheck size={16} /> : <span style={{ width: 16 }} aria-hidden />
            }
            aria-checked={tono === t.id}
            role='menuitemradio'
          >
            {t.label}
          </Menu.Item>
        ))}
        <Menu.Label style={{ maxWidth: 230, whiteSpace: 'normal' }}>
          Suena solo con SynerLink abierto, si no está viendo esa conversación.
        </Menu.Label>
      </Menu.Dropdown>
    </Menu>
  );
}

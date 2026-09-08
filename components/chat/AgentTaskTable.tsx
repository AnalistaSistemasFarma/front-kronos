'use client';

import { useEffect, useState } from 'react';
import { Box, Text } from '@mantine/core';
import type { AgentTaskDto } from '../../lib/chat/client';

/**
 * Tablita de "qué está corriendo" — una fila por sub-agente del agente.
 *
 * Nicolás (2026-09-07): "si tienes subagentes trabajando también nos muestres
 * como si fuera una tablita, como lo hace claude". La idea es la misma que en
 * la terminal: qué está haciendo cada sub-agente y cuánto lleva, para que la
 * espera se entienda en vez de parecer un chat congelado.
 *
 * El reloj corre en el NAVEGADOR: el servidor manda el instante de arranque
 * (`startedAt`) y aquí se cuenta el transcurrido. Así el tiempo avanza cada
 * segundo aunque el sondeo del estado solo llegue cada pocos, que era lo que
 * hacía ver el indicador quieto.
 */

/** "12 s" · "3 min" · "1 h 04 min". Nunca negativo (reloj del cliente vs. servidor). */
function formatElapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return '—';
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return '—';

  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) return `${seconds} s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}

export default function AgentTaskTable({ tasks }: { tasks?: AgentTaskDto[] }) {
  const list = tasks ?? [];
  const running = list.length;

  const [now, setNow] = useState<number>(() => Date.now());

  // El intervalo solo existe mientras haya algo corriendo: un temporizador
  // vivo en un chat inactivo es batería del celular a cambio de nada.
  useEffect(() => {
    if (running === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (running === 0) return null;

  return (
    <Box className='chat-tasks' role='region' aria-label='Sub-agentes en curso'>
      <Text component='div' size='xs' fw={600} className='chat-tasks__title'>
        {running === 1 ? 'Sub-agente en curso' : `${running} sub-agentes en curso`}
      </Text>

      <table className='chat-tasks__table'>
        <tbody>
          {list.map((task, index) => (
            // La descripción no es única (dos sub-agentes pueden hacer lo
            // mismo), así que la llave lleva el índice.
            <tr key={`${task.desc}-${index}`}>
              <td className='chat-tasks__cell'>
                <span className='chat-tasks__dot' aria-hidden />
              </td>
              <td className='chat-tasks__cell chat-tasks__desc'>{task.desc}</td>
              <td className='chat-tasks__cell chat-tasks__time'>
                {formatElapsed(task.startedAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

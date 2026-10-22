'use client';

import { ActionIcon, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { IconGauge } from '@tabler/icons-react';
import { DetalleConsumo, useConsumoEnUrl } from '../proyectos/MedidorConsumo';
import { colorDeUso, vistaCuota } from '../../lib/proyectos/consumo-anthropic';

/** El peor de los dos colores (rojo > amarillo > verde): el que manda en el ícono. */
const ORDEN = { gray: 0, green: 1, yellow: 2, red: 3 } as const;

/**
 * BOTÓN DE CONSUMO en la cabecera de una conversación con un agente
 * (2026-10-22). Pedido de Nicolás Rivera: «quiero que el widget de consumo se
 * pueda ver desde el chat como un botoncito».
 *
 * Un ícono de medidor que abre un popover con el MISMO medidor de Proyectos
 * (DetalleConsumo: semanal y 5 h, porcentaje con color, hora de reinicio,
 * «token compartido» y la hora de la medición). El ícono toma el color de la
 * ventana más cargada, así se ve de un vistazo sin abrirlo.
 *
 * Si el agente NO publica cuota (hoy solo la publica Orus, por el puente de
 * hilos), el botón NO aparece: en el chat la cabecera es de todos los agentes
 * y un «sin medición» permanente en casi todos sería ruido. Aparece solo, sin
 * recargar, la primera vez que el agente reporte (se vuelve a leer cada 60 s).
 */
export default function ChatConsumoBoton({ code, displayName }: { code: string; displayName: string }) {
  const { agentes } = useConsumoEnUrl(`/api/chat/agents/${encodeURIComponent(code)}/consumo`);
  const agente = agentes[0];
  if (!agente) return null;

  const v = vistaCuota(agente);
  const colores = [v.semanal?.color, v.cinco?.color].filter((c): c is ReturnType<typeof colorDeUso> => Boolean(c));
  const peor = colores.reduce<ReturnType<typeof colorDeUso>>((a, c) => (ORDEN[c] > ORDEN[a] ? c : a), 'gray');
  const resumen = [v.semanal && `semanal ${v.semanal.porcentaje}`, v.cinco && `5 h ${v.cinco.porcentaje}`].filter(Boolean).join(', ');
  const colorIcono = v.vieja || peor === 'gray' ? 'gray' : peor === 'green' ? 'teal' : peor;

  return (
    <Popover position='bottom-end' withArrow shadow='md' width={290} radius='md' trapFocus={false} withinPortal>
      <Popover.Target>
        <Tooltip label={`Consumo de Anthropic: ${resumen}`} withArrow>
          <ActionIcon
            variant='subtle'
            color={colorIcono}
            aria-label={`Consumo de Anthropic de ${displayName}: ${resumen}`}
            data-testid='chat-consumo-boton'
            data-color={peor}
          >
            <IconGauge size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className='chat-surface' data-testid='chat-consumo-popover'>
        <Stack gap='sm'>
          <Text size='sm' fw={600}>
            Consumo de Anthropic · {displayName}
          </Text>
          <DetalleConsumo agente={agente} />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

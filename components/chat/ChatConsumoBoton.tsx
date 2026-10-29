'use client';

import { ActionIcon, Divider, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { IconGauge } from '@tabler/icons-react';
import { DetalleConsumo, useConsumoEnUrl } from '../proyectos/MedidorConsumo';
import { colorDeUso, vistaCuota } from '../../lib/proyectos/consumo-anthropic';
import { colorDeContexto, contextoRancio } from '../../lib/chat/agent-context';
import { DetalleContexto, useContextoAgente } from './ChatContextoAgente';

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
 *
 * CONTEXTO DE LA SESIÓN (2026-10-29, pedido de Nicolás Rivera): debajo del
 * consumo, cuán lleno está el contexto de la sesión del agente (🟢 < 60 %,
 * 🟡 60–85 %, 🔴 ≥ 85 %) y, solo para administradores, «Limpiar contexto». El
 * botón aparece si el agente publica cuota O contexto; el ícono toma el peor
 * color de los dos.
 */
export default function ChatConsumoBoton({
  code,
  displayName,
  idConversacion = null,
}: {
  code: string;
  displayName: string;
  idConversacion?: number | null;
}) {
  const { agentes } = useConsumoEnUrl(`/api/chat/agents/${encodeURIComponent(code)}/consumo`);
  const ctx = useContextoAgente(code, idConversacion);
  const agente = agentes[0];
  const contexto = ctx.contexto;
  if (!agente && !contexto) return null;

  const v = agente ? vistaCuota(agente) : null;
  const colores = [
    v && !v.vieja ? v.semanal?.color : undefined,
    v && !v.vieja ? v.cinco?.color : undefined,
    contexto && !contextoRancio(contexto) ? colorDeContexto(contexto.percent) : undefined,
  ].filter((c): c is ReturnType<typeof colorDeUso> => Boolean(c));
  const peor = colores.reduce<ReturnType<typeof colorDeUso>>((a, c) => (ORDEN[c] > ORDEN[a] ? c : a), 'gray');
  const resumen = [
    v?.semanal && `semanal ${v.semanal.porcentaje}`,
    v?.cinco && `5 h ${v.cinco.porcentaje}`,
    contexto?.percent !== null && contexto?.percent !== undefined && `contexto ${Math.round(contexto.percent)} %`,
  ]
    .filter(Boolean)
    .join(', ');
  const colorIcono = peor === 'gray' ? 'gray' : peor === 'green' ? 'teal' : peor;

  return (
    <Popover position='bottom-end' withArrow shadow='md' width={290} radius='md' trapFocus={false} withinPortal>
      <Popover.Target>
        <Tooltip label={`Consumo y contexto: ${resumen}`} withArrow>
          <ActionIcon
            variant='subtle'
            color={colorIcono}
            aria-label={`Consumo y contexto de ${displayName}: ${resumen}`}
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
            {agente ? 'Consumo de Anthropic' : 'Contexto'} · {displayName}
          </Text>
          {agente && <DetalleConsumo agente={agente} />}
          {agente && contexto && <Divider />}
          {contexto && (
            <DetalleContexto code={code} displayName={displayName} idConversacion={idConversacion} estado={ctx} onOrden={ctx.setOrden} />
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

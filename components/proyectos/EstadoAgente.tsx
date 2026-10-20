'use client';

import { Box, Group, Text } from '@mantine/core';
import AgentTaskTable from '../chat/AgentTaskTable';
import LogoPensando from '../chat/LogoPensando';
import { textoSubagentes, type VistaEstadoAgente } from '../../lib/proyectos/estado-agente';
import css from './proyectos.module.css';

/**
 * «Orus está trabajando… · Consultando SAP» con el logo animado del chat
 * (LogoPensando, el mismo del indicador del hilo) — 2026-10-20.
 *
 * `subagentes`:
 *   - 'tabla'  : la tablita de sub-agentes del chat (AgentTaskTable), para la
 *                lista de conversaciones del proyecto;
 *   - 'resumen': «2 subagentes en curso», para tarjetas y paneles angostos.
 *
 * `role='status'` + `aria-live='polite'`: el lector de pantalla anuncia el
 * cambio sin interrumpir, igual que el indicador del chat.
 */
export function LineaEstadoAgente({
  vista,
  nombre,
  subagentes = 'resumen',
  testId = 'estado-agente',
}: {
  vista: VistaEstadoAgente;
  /** Texto principal; por defecto, el de la vista («Orus está trabajando…»). */
  nombre?: string;
  subagentes?: 'tabla' | 'resumen' | 'no';
  testId?: string;
}) {
  if (!vista.trabajando) return null;
  const resumen = subagentes === 'resumen' ? textoSubagentes(vista.subagentes.length) : '';
  const detalle = [vista.actividad, resumen].filter(Boolean).join(' · ');
  return (
    <Box role='status' aria-live='polite' data-testid={testId} className={css.estadoAgente}>
      <Group gap={6} wrap='nowrap' align='center'>
        <LogoPensando variante={vista.variante} size={20} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text size='xs' c='blue' fw={600} className={css.truncar}>
            {nombre ?? vista.texto}
          </Text>
          {detalle && (
            <Text size='xs' className={`chat-activity__label ${css.truncar}`}>
              {detalle}
            </Text>
          )}
        </div>
      </Group>
      {subagentes === 'tabla' && vista.subagentes.length > 0 && (
        <div className={css.subagentes}>
          <AgentTaskTable tasks={vista.subagentes} />
        </div>
      )}
    </Box>
  );
}

'use client';

import { useState } from 'react';
import { Anchor, Badge, Collapse, List, Stack, Text, Tooltip } from '@mantine/core';
import { CRITERIO_TEXTO, type Calificacion, type EstadoFlujo } from '../../lib/workflow/mejora-continua-rules';

/**
 * Calificación de un flujo (2026-11-09): «Necesita mejoras», «Revisar», «Va bien» o «Pocos
 * datos», con sus motivos, y el criterio explicado («¿Cómo se califica?»). La misma en el
 * indicador del panel de flujos y en la página de Mejora continua de cada flujo.
 */

export const COLOR_ESTADO: Record<EstadoFlujo, string> = { necesita_mejoras: 'red', revisar: 'yellow', va_bien: 'green', pocos_datos: 'gray' };
export const TITULO_ESTADO: Record<EstadoFlujo, string> = {
  necesita_mejoras: 'Necesita mejoras',
  revisar: 'Revisar',
  va_bien: 'Va bien',
  pocos_datos: 'Pocos datos',
};

export function EstadoFlujoBadge({ calificacion, size = 'sm' }: { calificacion: Calificacion; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <Tooltip
      label={
        <Stack gap={2}>
          {calificacion.motivos.map((m) => (
            <Text key={m} size='xs'>
              • {m}
            </Text>
          ))}
        </Stack>
      }
      withArrow
      multiline
      w={320}
      disabled={calificacion.motivos.length === 0}
    >
      <Badge color={COLOR_ESTADO[calificacion.estado]} variant='light' size={size}>
        {TITULO_ESTADO[calificacion.estado]}
        {calificacion.pocosCasos && calificacion.estado !== 'pocos_datos' ? ' · pocos casos' : ''}
      </Badge>
    </Tooltip>
  );
}

export function CriterioCalificacion() {
  const [abierto, setAbierto] = useState(false);
  return (
    <div>
      <Anchor component='button' type='button' size='xs' onClick={() => setAbierto((a) => !a)}>
        {abierto ? 'Ocultar' : '¿Cómo se califica un flujo?'}
      </Anchor>
      <Collapse in={abierto}>
        <List size='xs' spacing={4} mt={6}>
          {CRITERIO_TEXTO.map((c) => (
            <List.Item key={c.estado}>
              <Badge size='xs' color={COLOR_ESTADO[c.estado]} variant='light' mr={6}>
                {c.titulo}
              </Badge>
              {c.regla}
            </List.Item>
          ))}
          <List.Item>
            «Lo normal» es la mediana: la mitad de las solicitudes tarda menos y la otra mitad, más. Se cuentan los últimos 6 meses y el
            tiempo de cada tarea desde que quedó disponible.
          </List.Item>
        </List>
      </Collapse>
    </div>
  );
}

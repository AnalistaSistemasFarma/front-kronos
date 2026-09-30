'use client';

import React from 'react';
import { Stack, Text } from '@mantine/core';
import { IconListCheck } from '@tabler/icons-react';
import { Seccion } from './ui';

/**
 * Sub-pestaña "Decisiones por artículo" — RESERVADA, todavía no visible.
 *
 * Solo deja listo el lugar (estructura y estilo) para una vista futura que
 * mostrará, por artículo, la decisión sugerida (pedir, esperar, liberar
 * cuarentena…). No tiene lógica ni consulta ninguna API: cuando exista el
 * dato en el snapshot se pinta aquí y se enciende la constante.
 */
export const MOSTRAR_DECISIONES_POR_ARTICULO = false;

export default function DecisionesArticulo() {
  return (
    <Stack gap="lg" className="pb-6">
      <Seccion
        titulo="Decisiones por artículo"
        subtitulo="Aquí se verá, artículo por artículo, qué conviene hacer y por qué."
        icono={<IconListCheck size={20} />}
      >
        <Text size="sm" c="dimmed">
          Todavía no hay decisiones calculadas para mostrar.
        </Text>
      </Seccion>
    </Stack>
  );
}

'use client';

import { Box, Group, Skeleton, Stack } from '@mantine/core';

/**
 * Esqueletos de carga del chat.
 *
 * Pedido de Nicolás (2026-09-09): "quiero cambiar los loaders por skeletons".
 *
 * POR QUÉ SON MEJORES QUE UN GIRATORIO, y no es cuestión de moda: un giratorio
 * dice "espere" y nada más; un esqueleto dice "aquí va una lista de asistentes"
 * o "aquí va una conversación". La pantalla no salta cuando llegan los datos,
 * porque el espacio ya estaba reservado con la forma correcta.
 *
 * Con la caché de `useChatOverview`, estos esqueletos se ven cada vez menos:
 * solo en la primera visita de la pestaña. Es el orden correcto — primero no
 * volver a pedir lo que ya se sabe, y para lo que sí toca esperar, mostrar la
 * forma de lo que viene.
 */

/** Una fila de la lista de asistentes: avatar redondo, nombre y renglón suelto. */
function FilaAgente() {
  return (
    <Group gap='sm' wrap='nowrap' align='flex-start'>
      <Skeleton height={42} circle />
      <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
        <Skeleton height={11} width='42%' radius='sm' />
        <Skeleton height={9} width='68%' radius='sm' />
      </Stack>
    </Group>
  );
}

/** La lista de asistentes mientras se resuelven los permisos. */
export function EsqueletoListaAgentes({ filas = 5 }: { filas?: number }) {
  return (
    <Stack gap='md' p='md' aria-hidden='true'>
      <Skeleton height={13} width={160} radius='sm' />
      {Array.from({ length: filas }, (_, i) => (
        <FilaAgente key={i} />
      ))}
    </Stack>
  );
}

/**
 * Una conversación cargando: burbujas alternadas, anchos distintos.
 *
 * Los anchos van variados a propósito. Con todas las barras del mismo largo el
 * bloque se lee como una tabla y no como una charla, y el salto al llegar los
 * mensajes de verdad se nota más.
 */
export function EsqueletoHilo({ burbujas = 4 }: { burbujas?: number }) {
  const anchos = ['62%', '44%', '73%', '38%', '55%', '68%'];
  return (
    <Stack gap='lg' p='md' aria-hidden='true'>
      {Array.from({ length: burbujas }, (_, i) => {
        const mia = i % 2 === 1;
        return (
          <Group key={i} justify={mia ? 'flex-end' : 'flex-start'} wrap='nowrap' align='flex-end' gap='sm'>
            {!mia && <Skeleton height={28} circle />}
            <Box style={{ maxWidth: 'min(78%, 640px)', width: anchos[i % anchos.length] }}>
              <Skeleton height={i % 3 === 0 ? 56 : 38} radius='lg' />
            </Box>
          </Group>
        );
      })}
    </Stack>
  );
}

/** La pantalla entera del chat antes de saber siquiera qué puede ver el usuario. */
export function EsqueletoPantallaChat() {
  return (
    <div className='app-page-shell app-page-shell--fill min-h-screen'>
      <EsqueletoListaAgentes />
    </div>
  );
}

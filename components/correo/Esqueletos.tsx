'use client';

import { Group, Skeleton, Stack } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import css from './correo.module.css';

/**
 * Esqueletos de carga del módulo Correo, con el mismo `Skeleton` de Mantine que usa el chat
 * (components/chat/ChatSkeletons.tsx): muestran la FORMA de lo que viene (filas de la bandeja,
 * mensajes del hilo, carpetas) en vez de un giratorio, y la pantalla no salta al llegar los datos.
 *
 * Pedido de Nicolás (2026-10-16): «cuando cambio de Recibidos a Enviados no hace un skeleton o una
 * animación de carga». Con «reducir movimiento» del sistema operativo el brillo se apaga (bloques quietos).
 */

/** Anchos variados a propósito: con todas las barras iguales se lee como una tabla vacía. */
const ANCHO_DE = ['62%', '78%', '54%', '70%', '46%', '66%', '58%', '74%'];
const ANCHO_ASUNTO = ['48%', '64%', '38%', '56%', '70%', '44%', '60%', '52%'];

function useAnimar() {
  return !useReducedMotion();
}

/** Filas de la bandeja mientras llega la carpeta: casilla, remitente, asunto + extracto y fecha (o tarjeta en el celular). */
export function EsqueletoFilas({ filas = 8, movil = false }: { filas?: number; movil?: boolean }) {
  const animar = useAnimar();
  return (
    <div aria-hidden='true' data-testid='correo-esqueleto'>
      {Array.from({ length: filas }, (_, i) =>
        movil ? (
          <div key={i} className={css.filaMovilEsqueleto}>
            <Skeleton height={40} circle animate={animar} />
            <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
              <Group justify='space-between' wrap='nowrap'>
                <Skeleton height={11} width={ANCHO_DE[i % 8]} maw={180} radius='sm' animate={animar} />
                <Skeleton height={9} width={36} radius='sm' animate={animar} />
              </Group>
              <Skeleton height={10} width={ANCHO_ASUNTO[i % 8]} radius='sm' animate={animar} />
              <Skeleton height={9} width='82%' radius='sm' animate={animar} />
            </Stack>
          </div>
        ) : (
          <div key={i} className={css.filaEsqueleto}>
            <Skeleton height={18} width={18} radius='sm' animate={animar} />
            <div className={css.de}>
              <Skeleton height={10} width={ANCHO_DE[i % 8]} radius='sm' animate={animar} />
            </div>
            <div className={css.asunto}>
              <Skeleton height={10} width={ANCHO_ASUNTO[i % 8]} radius='sm' animate={animar} />
              <Skeleton height={10} width='22%' radius='sm' animate={animar} style={{ opacity: 0.6 }} />
            </div>
            <div className={css.meta}>
              <Skeleton height={9} width={44} radius='sm' animate={animar} />
            </div>
          </div>
        )
      )}
    </div>
  );
}

/** Carpetas de la barra lateral mientras se consultan (con sus contadores de no leídos). */
export function EsqueletoCarpetas({ filas = 3 }: { filas?: number }) {
  const animar = useAnimar();
  return (
    <Stack gap={14} px={12} py={8} aria-hidden='true' data-testid='correo-carpetas-esqueleto'>
      {Array.from({ length: filas }, (_, i) => (
        <Group key={i} gap='sm' wrap='nowrap'>
          <Skeleton height={18} width={18} radius='sm' animate={animar} />
          <Skeleton height={10} width={['58%', '46%', '52%'][i % 3]} radius='sm' animate={animar} />
          <Skeleton height={9} width={18} radius='sm' animate={animar} ml='auto' />
        </Group>
      ))}
    </Stack>
  );
}

/** Un hilo abriéndose: asunto y luego mensajes (avatar, remitente, fecha y cuerpo). */
export function EsqueletoHiloCorreo({ mensajes = 2 }: { mensajes?: number }) {
  const animar = useAnimar();
  return (
    <Stack gap='lg' aria-hidden='true' data-testid='correo-hilo-esqueleto'>
      <Skeleton height={20} width='64%' radius='sm' animate={animar} />
      {Array.from({ length: mensajes }, (_, i) => (
        <Stack key={i} gap='sm'>
          <Group gap='sm' wrap='nowrap'>
            <Skeleton height={40} circle animate={animar} />
            <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
              <Skeleton height={11} width={i % 2 ? '34%' : '42%'} radius='sm' animate={animar} />
              <Skeleton height={9} width='26%' radius='sm' animate={animar} />
            </Stack>
            <Skeleton height={9} width={60} radius='sm' animate={animar} />
          </Group>
          {i === mensajes - 1 && (
            <Stack gap={8} pl={52}>
              <Skeleton height={10} width='92%' radius='sm' animate={animar} />
              <Skeleton height={10} width='86%' radius='sm' animate={animar} />
              <Skeleton height={10} width='70%' radius='sm' animate={animar} />
              <Skeleton height={10} width='40%' radius='sm' animate={animar} />
            </Stack>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

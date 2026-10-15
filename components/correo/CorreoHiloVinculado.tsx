'use client';

import { useEffect, useState } from 'react';
import { Badge, Group } from '@mantine/core';
import { IconMail } from '@tabler/icons-react';
import type { VinculoHilo } from '../../lib/correo/types';
import { correoApi } from './correoClient';

/**
 * En la vista de una solicitud: enlace al hilo de correo PROPIO vinculado (módulo
 * Correo). No muestra nada si la persona no tiene el módulo o no hay hilo suyo.
 */
export default function CorreoHiloVinculado({ requestId }: { requestId: number | string | null | undefined }) {
  const [vinculos, setVinculos] = useState<VinculoHilo[]>([]);
  useEffect(() => {
    const id = Number(requestId);
    if (!Number.isInteger(id) || id <= 0) return;
    let activo = true;
    correoApi
      .vinculos(id)
      .then((r) => activo && setVinculos(r.vinculos))
      .catch(() => activo && setVinculos([]));
    return () => {
      activo = false;
    };
  }, [requestId]);
  if (vinculos.length === 0) return null;
  return (
    <Group gap='xs' data-testid='solicitud-hilo-correo'>
      {vinculos.map((v) => (
        <Badge
          key={v.id}
          component='a'
          href={`/process/correo?hilo=${encodeURIComponent(v.conversationId)}`}
          color='teal'
          variant='light'
          size='lg'
          leftSection={<IconMail size={14} />}
          style={{ cursor: 'pointer', textTransform: 'none' }}
        >
          Ver hilo de correo
        </Badge>
      ))}
    </Group>
  );
}

'use client';

import { useState } from 'react';
import { AspectRatio, Center, Image, Paper, Stack, Text } from '@mantine/core';
import { IconPhotoOff } from '@tabler/icons-react';
import { urlImagen } from '../../lib/vitrina/medios';

/**
 * Imagen de empaque (vial, etiqueta o plegadiza). Sin imagen cargada —o si no se puede
 * leer— muestra el estado vacío «Imagen pendiente»: nunca se inventa una imagen.
 * Solo componentes y variables del tema de Mantine (claro, oscuro y paletas).
 */
export default function VitrinaImagen({
  id,
  etiqueta,
  ratio = 1,
  compacta = false,
}: {
  id: number | null;
  etiqueta: string;
  ratio?: number;
  /** Miniatura (tarjetas y listas): sin textos. */
  compacta?: boolean;
}) {
  const [fallo, setFallo] = useState(false);
  const hay = id !== null && !fallo;
  return (
    <Paper withBorder radius='md' style={{ overflow: 'hidden' }} data-testid={hay ? 'vitrina-imagen' : 'vitrina-imagen-pendiente'}>
      <AspectRatio ratio={ratio}>
        {hay ? (
          <Image src={urlImagen(id)} alt={etiqueta} fit='contain' w='100%' h='100%' loading='lazy' onError={() => setFallo(true)} />
        ) : (
          <Center bg='var(--mantine-color-default-hover)'>
            <Stack gap={4} align='center' p='xs'>
              <IconPhotoOff size={compacta ? 20 : 32} color='var(--mantine-color-dimmed)' aria-hidden />
              {!compacta && (
                <>
                  <Text size='sm' fw={600} c='dimmed' ta='center'>
                    {etiqueta}
                  </Text>
                  <Text size='sm' c='dimmed' ta='center'>
                    Imagen pendiente
                  </Text>
                </>
              )}
            </Stack>
          </Center>
        )}
      </AspectRatio>
    </Paper>
  );
}

'use client';

import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, Text } from '@mantine/core';
import { IconDownload, IconX } from '@tabler/icons-react';
import { formatBytes, urlImagenEnLinea } from '../../lib/chat/attachments';

/** Lo mínimo de un adjunto para mostrarlo como imagen. */
export interface ImagenAdjunta {
  id: number;
  fileName: string;
  sizeBytes: number | null;
  downloadUrl: string;
}

/**
 * VISOR a pantalla completa de una imagen del chat, con Descargar.
 *
 * Se cierra con Esc, clic fuera o el botón. `lockScroll={false}` a propósito:
 * bloquear el desplazamiento del documento le pone `overflow:hidden` (y un
 * relleno por la barra de desplazamiento) al body, ese cambio de tamaño lo ve
 * el ResizeObserver del hilo y lo manda al fondo — el mismo terreno delicado
 * del iPhone (ver ChatThread, doble rAF). El velo ya tapa la conversación.
 */
export function ChatImageViewer({
  imagen,
  onClose,
}: {
  imagen: ImagenAdjunta | null;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={imagen !== null}
      onClose={onClose}
      withCloseButton={false}
      centered
      size='auto'
      padding={0}
      radius='md'
      lockScroll={false}
      overlayProps={{ backgroundOpacity: 0.85, blur: 2 }}
      classNames={{ content: 'chat-visor__contenido', body: 'chat-visor__cuerpo' }}
    >
      {imagen && (
        <>
          <Group justify='space-between' wrap='nowrap' gap='xs' className='chat-visor__barra'>
            <Text size='sm' fw={600} lineClamp={1} style={{ minWidth: 0 }}>
              {imagen.fileName}
              {imagen.sizeBytes !== null && (
                <Text span size='xs' className='chat-text-muted' ml={6}>
                  {formatBytes(imagen.sizeBytes)}
                </Text>
              )}
            </Text>
            <Group gap={4} wrap='nowrap'>
              <Button
                component='a'
                href={imagen.downloadUrl}
                download={imagen.fileName}
                size='xs'
                variant='light'
                leftSection={<IconDownload size={14} />}
              >
                Descargar
              </Button>
              <ActionIcon variant='subtle' color='gray' onClick={onClose} aria-label='Cerrar'>
                <IconX size={18} />
              </ActionIcon>
            </Group>
          </Group>
          {/* eslint-disable-next-line @next/next/no-img-element -- pasa por la ruta autenticada, no por el optimizador */}
          <img
            src={urlImagenEnLinea(imagen.downloadUrl)}
            alt={imagen.fileName}
            className='chat-visor__imagen'
            decoding='async'
          />
        </>
      )}
    </Modal>
  );
}

/**
 * MINIATURA de una imagen dentro de la burbuja (o de la galería). Si falla al
 * cargar —HEIC fuera de Safari, archivo dañado, permiso revocado— se oculta y
 * queda la ficha de descarga de siempre (`onFallo`).
 */
export function ChatImageThumb({
  imagen,
  onAbrir,
  className,
}: {
  imagen: ImagenAdjunta;
  onAbrir: (imagen: ImagenAdjunta) => void;
  className?: string;
}) {
  const [fallo, setFallo] = useState(false);
  if (fallo) return null;
  return (
    <button
      type='button'
      className={className ?? 'chat-imagen'}
      onClick={() => onAbrir(imagen)}
      aria-label={`Ver ${imagen.fileName}`}
      title={imagen.fileName}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pasa por la ruta autenticada, no por el optimizador */}
      <img
        src={urlImagenEnLinea(imagen.downloadUrl)}
        alt={imagen.fileName}
        loading='lazy'
        decoding='async'
        onError={() => setFallo(true)}
      />
    </button>
  );
}

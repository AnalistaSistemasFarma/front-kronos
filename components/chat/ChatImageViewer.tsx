'use client';

import { useState } from 'react';
import { urlImagenEnLinea } from '../../lib/chat/attachments';

/** Lo mínimo de un adjunto para mostrarlo como imagen. */
export interface ImagenAdjunta {
  id: number;
  fileName: string;
  sizeBytes: number | null;
  downloadUrl: string;
}

/**
 * MINIATURA de una imagen dentro de la burbuja (o de la galería). Si falla al
 * cargar —HEIC fuera de Safari, archivo dañado, permiso revocado— se oculta y
 * queda la ficha del archivo. Al tocarla se abre el visor de adjuntos
 * (ChatAttachmentViewer, 2026-10-22), que reemplazó al visor de solo imágenes.
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

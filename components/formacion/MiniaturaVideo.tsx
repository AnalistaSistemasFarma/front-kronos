'use client';

import { useEffect, useRef, useState } from 'react';
import { AspectRatio, Box, Center, ThemeIcon } from '@mantine/core';
import { IconPlayerPlayFilled } from '@tabler/icons-react';

/**
 * Previsualización de un video del curso en el temario (Nicolás Rivera,
 * 2026-10-26): un cuadro del propio video, sin guardar miniaturas aparte.
 *
 * El navegador pide solo los primeros bytes (`preload='metadata'` y la ruta del
 * archivo acepta rangos) y muestra el cuadro del segundo `segundo`. Se carga
 * cuando la miniatura entra en pantalla, para no pedir todos los videos de un
 * curso largo de una vez. Si el video no se puede leer, queda el ícono.
 */
export default function MiniaturaVideo({
  url,
  titulo,
  ancho = 120,
  segundo = 2,
  completado = false,
}: {
  url: string;
  titulo: string;
  ancho?: number;
  segundo?: number;
  completado?: boolean;
}) {
  const caja = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [lista, setLista] = useState(false);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    const el = caja.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <Box ref={caja} w={ancho} style={{ flexShrink: 0 }} data-testid='miniatura-video'>
      <AspectRatio ratio={16 / 9} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: 'var(--mantine-color-dark-6)' }}>
        {visible && !fallo && (
          <video
            src={`${url}#t=${segundo}`}
            preload='metadata'
            muted
            playsInline
            disablePictureInPicture
            tabIndex={-1}
            aria-label={`Vista previa de ${titulo}`}
            onLoadedData={() => setLista(true)}
            onError={() => setFallo(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: lista ? 1 : 0, transition: 'opacity 150ms' }}
          />
        )}
        <Center style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <ThemeIcon radius='xl' size={28} color={completado ? 'green' : 'dark'} variant={lista ? 'filled' : 'light'} style={{ opacity: 0.85 }}>
            <IconPlayerPlayFilled size={14} />
          </ThemeIcon>
        </Center>
      </AspectRatio>
    </Box>
  );
}

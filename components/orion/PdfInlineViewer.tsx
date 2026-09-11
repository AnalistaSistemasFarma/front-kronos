'use client';

import { useEffect, useState } from 'react';
import { Box, Button, Group, Loader, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconExternalLink, IconFileText } from '@tabler/icons-react';
import { usePdfBlobPreview } from './usePdfBlobPreview';

type Props = {
  src: string | null;
  /** Si `src` falla (p. ej. signed-file 409), intentar este PDF. */
  fallbackSrc?: string | null;
  fileName?: string;
  minHeight?: number;
  onOpenExternal?: () => void;
};

/**
 * Vista previa PDF embebida en la página (sin forzar descarga).
 * Carga el archivo como blob → blob: URL → iframe (Content-Type application/pdf).
 */
export default function PdfInlineViewer({
  src,
  fallbackSrc = null,
  fileName,
  minHeight = 420,
  onOpenExternal,
}: Props) {
  const [activeSrc, setActiveSrc] = useState<string | null>(src);
  const { blobUrl, loading, failed } = usePdfBlobPreview(activeSrc, Boolean(activeSrc));

  useEffect(() => {
    setActiveSrc(src);
  }, [src]);

  useEffect(() => {
    if (!failed || !fallbackSrc) return;
    if (fallbackSrc === activeSrc) return;
    setActiveSrc(fallbackSrc);
  }, [failed, fallbackSrc, activeSrc]);

  const openExternal = () => {
    if (onOpenExternal) {
      onOpenExternal();
      return;
    }
    // Preferir blob (inline) sobre la URL remota (a veces dispara descarga).
    const href = blobUrl || activeSrc || src || fallbackSrc;
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  if (!src && !fallbackSrc) return null;

  if (loading) {
    return (
      <Paper withBorder radius='md' h={minHeight} style={{ background: 'var(--app-surface-raised)' }}>
        <Stack align='center' justify='center' h='100%' gap='sm'>
          <Loader size='sm' />
          <Text size='sm' c='dimmed'>
            Cargando documento…
          </Text>
        </Stack>
      </Paper>
    );
  }

  if (failed || !blobUrl) {
    return (
      <Paper withBorder radius='md' h={minHeight} style={{ background: 'var(--app-surface-raised)' }}>
        <Stack align='center' justify='center' h='100%' gap='md' p='xl'>
          <ThemeIcon size={56} radius='xl' variant='light' color='blue'>
            <IconFileText size={28} />
          </ThemeIcon>
          <Text size='sm' fw={600} ta='center'>
            {fileName || 'Documento PDF'}
          </Text>
          <Text size='xs' c='dimmed' ta='center' maw={320}>
            No se pudo cargar la vista previa. Puede abrir el archivo directamente.
          </Text>
          <Button variant='light' leftSection={<IconExternalLink size={16} />} onClick={openExternal}>
            Abrir documento
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper
      withBorder
      radius='md'
      style={{
        overflow: 'hidden',
        minHeight,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--app-surface-raised)',
      }}
    >
      {fileName && (
        <Group
          px='md'
          py={8}
          gap='xs'
          style={{
            borderBottom: '1px solid var(--app-border)',
            background: 'var(--app-surface)',
            flexShrink: 0,
          }}
        >
          <IconFileText size={16} style={{ opacity: 0.6 }} />
          <Text size='xs' fw={600} lineClamp={1} style={{ flex: 1 }}>
            {fileName}
          </Text>
          <Button variant='subtle' size='compact-xs' onClick={openExternal}>
            Ampliar
          </Button>
        </Group>
      )}
      <Box style={{ flex: 1, minHeight: fileName ? minHeight - 40 : minHeight }}>
        <iframe
          title={fileName || 'Documento PDF'}
          src={`${blobUrl}#toolbar=1&navpanes=0&scrollbar=1`}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            minHeight: fileName ? minHeight - 40 : minHeight,
            border: 'none',
            background: '#525659',
          }}
        />
      </Box>
    </Paper>
  );
}

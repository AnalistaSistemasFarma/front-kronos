'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Box, Button, Group, Loader, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconExternalLink, IconFileText } from '@tabler/icons-react';
import { usePdfBlobPreview } from './usePdfBlobPreview';

type Props = {
  src: string | null;
  /** Si `src` falla (p. ej. signed-file 409), intentar este PDF. */
  fallbackSrc?: string | null;
  fileName?: string;
  minHeight?: number;
  /** Si true, el visor llena el alto del contenedor padre (flex). */
  fill?: boolean;
  onOpenExternal?: () => void;
};

/**
 * Vista previa PDF embebida (blob URL → iframe).
 * Con `fill` ocupa todo el alto disponible (ideal para layout split macOS).
 */
export default function PdfInlineViewer({
  src,
  fallbackSrc = null,
  fileName,
  minHeight = 420,
  fill = false,
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
    const href = blobUrl || activeSrc || src || fallbackSrc;
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  const shellStyle: CSSProperties = fill
    ? {
        overflow: 'hidden',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--app-surface-raised)',
        boxShadow:
          '0 1px 2px color-mix(in srgb, #000 4%, transparent), 0 8px 24px color-mix(in srgb, #000 6%, transparent)',
      }
    : {
        overflow: 'hidden',
        minHeight,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--app-surface-raised)',
      };

  if (!src && !fallbackSrc) return null;

  if (loading) {
    return (
      <Paper withBorder radius='lg' style={shellStyle} h={fill ? undefined : minHeight}>
        <Stack align='center' justify='center' h='100%' gap='sm' style={{ flex: 1 }}>
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
      <Paper withBorder radius='lg' style={shellStyle} h={fill ? undefined : minHeight}>
        <Stack align='center' justify='center' h='100%' gap='md' p='xl' style={{ flex: 1 }}>
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
    <Paper withBorder radius='lg' style={shellStyle}>
      {fileName ? (
        <Group
          px='md'
          py={10}
          gap='xs'
          style={{
            borderBottom: '1px solid var(--app-border)',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--app-surface) 92%, #fff), var(--app-surface))',
            flexShrink: 0,
          }}
        >
          <ThemeIcon size={28} radius='md' variant='light' color='gray'>
            <IconFileText size={15} />
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size='xs' fw={700} lineClamp={1} style={{ letterSpacing: '-0.01em' }}>
              {fileName}
            </Text>
            <Text size='10px' c='dimmed'>
              Vista previa
            </Text>
          </Box>
          <Button
            variant='light'
            size='compact-xs'
            radius='md'
            leftSection={<IconExternalLink size={14} />}
            onClick={openExternal}
          >
            Ampliar
          </Button>
        </Group>
      ) : null}
      <Box
        style={{
          flex: 1,
          minHeight: fill ? 0 : fileName ? minHeight - 44 : minHeight,
          background: '#3a3d40',
        }}
      >
        <iframe
          title={fileName || 'Documento PDF'}
          src={`${blobUrl}#toolbar=1&navpanes=0&scrollbar=1&zoom=page-width`}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            minHeight: fill ? undefined : fileName ? minHeight - 44 : minHeight,
            border: 'none',
            background: '#3a3d40',
          }}
        />
      </Box>
    </Paper>
  );
}

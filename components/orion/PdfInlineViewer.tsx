'use client';

import { Box, Button, Group, Loader, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconExternalLink, IconFileText } from '@tabler/icons-react';
import { usePdfBlobPreview } from './usePdfBlobPreview';

type Props = {
  src: string | null;
  fileName?: string;
  minHeight?: number;
  onOpenExternal?: () => void;
};

export default function PdfInlineViewer({
  src,
  fileName,
  minHeight = 420,
  onOpenExternal,
}: Props) {
  const isEmbeddable =
    Boolean(src) &&
    (src!.startsWith('blob:') ||
      src!.includes('/embed/') ||
      src!.includes('localhost') ||
      src!.includes('/api/integrations/'));

  const { blobUrl, loading, failed } = usePdfBlobPreview(src, Boolean(src) && !isEmbeddable);
  const displayUrl = isEmbeddable ? src : blobUrl;

  const openExternal = () => {
    if (onOpenExternal) onOpenExternal();
    else if (src) window.open(src, '_blank', 'noopener,noreferrer');
  };

  if (!src) return null;

  if (loading) {
    return (
      <Paper withBorder radius='md' h={minHeight} style={{ background: 'var(--app-surface-raised)' }}>
        <Stack align='center' justify='center' h='100%' gap='sm'>
          <Loader size='sm' />
          <Text size='sm' c='dimmed'>
            Cargando vista previa…
          </Text>
        </Stack>
      </Paper>
    );
  }

  if (failed || !displayUrl) {
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
            La vista previa no está disponible en el navegador. Puede abrir el archivo directamente.
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
      style={{ overflow: 'hidden', minHeight, background: 'var(--app-surface-raised)' }}
    >
      {fileName && (
        <Group
          px='md'
          py={8}
          gap='xs'
          style={{
            borderBottom: '1px solid var(--app-border)',
            background: 'var(--app-surface)',
          }}
        >
          <IconFileText size={16} style={{ opacity: 0.6 }} />
          <Text size='xs' fw={600} lineClamp={1} style={{ flex: 1 }}>
            {fileName}
          </Text>
          <Button variant='subtle' size='compact-xs' onClick={openExternal}>
            Abrir
          </Button>
        </Group>
      )}
      <Box h={fileName ? minHeight - 40 : minHeight}>
        <object
          data={`${displayUrl}#toolbar=0&navpanes=0`}
          type='application/pdf'
          width='100%'
          height='100%'
          style={{ display: 'block', border: 'none' }}
        >
          <Stack align='center' justify='center' h='100%' p='md'>
            <Text size='sm' c='dimmed' ta='center'>
              No se pudo renderizar el PDF aquí.
            </Text>
            <Button size='xs' variant='light' onClick={openExternal}>
              Abrir en nueva pestaña
            </Button>
          </Stack>
        </object>
      </Box>
    </Paper>
  );
}

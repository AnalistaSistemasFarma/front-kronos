'use client';

import { useState, type CSSProperties } from 'react';
import { ActionIcon, Alert, Button, Group, Loader, Modal, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconDownload, IconExternalLink, IconEye } from '@tabler/icons-react';
import { usePdfPageImages } from './usePdfPageImages';

/** Celular o tableta: el navegador descarga los PDF en vez de mostrarlos. */
const MOBILE_QUERY = '(max-width: 48em), (pointer: coarse)';
const PDF_VIEW_SCALE = 1.6;

type Kind = 'pdf' | 'image' | 'other';

function fileKind(fileName: string): Kind {
  if (/\.pdf$/i.test(fileName)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(fileName)) return 'image';
  return 'other';
}

type Props = {
  fileName: string;
  /** Enlace que abre el ojito en computador (pestaña nueva). */
  href: string | null | undefined;
  /** Archivo servido en línea por SynerLink (mismo origen), para el visor del celular. */
  inlineSrc?: string | null;
  /** Office en línea (SharePoint), para Word/Excel en el celular. */
  webUrl?: string | null;
  downloadUrl?: string | null;
  size?: 'sm' | 'md';
  iconSize?: number;
  style?: CSSProperties;
};

function PdfPages({ src }: { src: string }) {
  const { pages, loading, error } = usePdfPageImages(src, PDF_VIEW_SCALE);
  if (error) {
    return (
      <Alert color='red' variant='light'>
        No se pudo mostrar el PDF: {error}
      </Alert>
    );
  }
  if (loading && pages.length === 0) {
    return (
      <Group justify='center' py='xl'>
        <Loader size='sm' />
        <Text size='sm' c='dimmed'>
          Cargando documento…
        </Text>
      </Group>
    );
  }
  return (
    <Stack gap='sm'>
      {pages.map((page) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={page.page}
          src={page.dataUrl ?? undefined}
          alt={`Página ${page.page}`}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            aspectRatio: `${page.width} / ${page.height}`,
            background: '#fff',
            boxShadow: 'var(--mantine-shadow-sm)',
          }}
        />
      ))}
    </Stack>
  );
}

export default function ViewOnlineButton({
  fileName,
  href,
  inlineSrc,
  webUrl,
  downloadUrl,
  size = 'sm',
  iconSize = 16,
  style,
}: Props) {
  const isMobile = useMediaQuery(MOBILE_QUERY) ?? false;
  const [opened, setOpened] = useState(false);
  const kind = fileKind(fileName);
  const viewerSrc = String(inlineSrc || '').trim() || null;
  const desktopHref = String(href || '').trim() || null;

  if (!desktopHref && !viewerSrc && !webUrl) return null;

  if (!isMobile || !viewerSrc) {
    const target = desktopHref || webUrl || viewerSrc;
    return (
      <Tooltip label='Ver en línea (sin descargar)'>
        <ActionIcon
          variant='subtle'
          color='blue'
          size={size}
          component='a'
          href={target ?? undefined}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={`Ver en línea ${fileName}`}
          style={style}
        >
          <IconEye size={iconSize} />
        </ActionIcon>
      </Tooltip>
    );
  }

  return (
    <>
      <ActionIcon
        variant='subtle'
        color='blue'
        size={size}
        onClick={() => setOpened(true)}
        aria-label={`Ver en línea ${fileName}`}
        style={style}
      >
        <IconEye size={iconSize} />
      </ActionIcon>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        fullScreen
        zIndex={450}
        title={
          <Text fw={600} size='sm' lineClamp={1}>
            {fileName}
          </Text>
        }
        styles={{
          content: { display: 'flex', flexDirection: 'column' },
          body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 0 },
        }}
      >
        <ScrollArea style={{ flex: 1, minHeight: 0 }} type='auto'>
          <Stack p='sm' gap='sm' style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
            {opened && kind === 'pdf' ? <PdfPages src={viewerSrc} /> : null}
            {opened && kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewerSrc} alt={fileName} style={{ width: '100%', height: 'auto', display: 'block' }} />
            ) : null}
            {kind === 'other' ? (
              <Alert color='blue' variant='light'>
                Este tipo de archivo no se puede mostrar dentro de SynerLink en el celular.
                {webUrl ? ' Ábralo en Office en línea para verlo sin descargarlo.' : ''}
              </Alert>
            ) : null}
          </Stack>
        </ScrollArea>
        <Group justify='flex-end' gap='xs' p='sm' style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
          {kind === 'other' && webUrl ? (
            <Button
              component='a'
              href={webUrl}
              target='_blank'
              rel='noopener noreferrer'
              variant='light'
              leftSection={<IconExternalLink size={14} />}
            >
              Office en línea
            </Button>
          ) : null}
          {downloadUrl ? (
            <Button component='a' href={downloadUrl} variant='default' leftSection={<IconDownload size={14} />}>
              Descargar
            </Button>
          ) : null}
        </Group>
      </Modal>
    </>
  );
}

'use client';

import { ActionIcon, Modal, Text, Tooltip } from '@mantine/core';
import { IconEye } from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';

const SgcSecureViewer = dynamic(() => import('../../sgc/SgcSecureViewer'), { ssr: false });

/**
 * «Ver sin descargar» (2026-11-24): adjunto de una solicitud de un flujo restringido. Se abre en el visor seguro del SGC
 * (pdf.js en canvas, sin barra del navegador, sin descargar ni imprimir); las imágenes, sin menú contextual ni arrastre.
 */
export default function ViewOnlyAttachmentButton({ fileName, src }: { fileName: string; src: string }) {
  const [opened, setOpened] = useState(false);
  const isPdf = /\.pdf$/i.test(fileName);
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(fileName);
  if (!isPdf && !isImage) {
    return (
      <Tooltip label='Solo consulta: este tipo de archivo no se ve en línea; cárguelo en PDF.'>
        <Text size='xs' c='dimmed'>
          Solo consulta
        </Text>
      </Tooltip>
    );
  }
  return (
    <>
      <Tooltip label='Ver (solo consulta, sin descargar)'>
        <ActionIcon variant='subtle' color='blue' size='sm' aria-label={`Ver ${fileName}`} onClick={() => setOpened(true)} data-testid='view-only-attachment'>
          <IconEye size={16} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={opened} onClose={() => setOpened(false)} size='90rem' title={<Text fw={700}>{fileName}</Text>}>
        {opened &&
          (isPdf ? (
            <SgcSecureViewer fileUrl={src} canDownload={false} canPrint={false} hideDownloadPrint />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={fileName} draggable={false} onContextMenu={(e) => e.preventDefault()} style={{ maxWidth: '100%', userSelect: 'none' }} />
          ))}
      </Modal>
    </>
  );
}

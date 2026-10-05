'use client';

import { Modal } from '@mantine/core';
import SgcSecureViewer from './SgcSecureViewer';

/**
 * «Ver documento» de los adjuntos de la solicitud (borrador y soportes):
 * abre el VISOR SEGURO del SGC dentro de la app, sin descargar ni imprimir.
 * RN de auditoría (2026-10-05): un documento del SGC nunca se descarga.
 */
export default function SgcDocumentViewerModal({ fileUrl, title, onClose }: { fileUrl: string | null; title: string; onClose: () => void }) {
  return (
    <Modal opened={Boolean(fileUrl)} onClose={onClose} title={title} centered size='xl' zIndex={400} overlayProps={{ blur: 3, backgroundOpacity: 0.45 }} data-testid='sgc-ver-documento-modal'>
      {fileUrl && <SgcSecureViewer key={fileUrl} fileUrl={fileUrl} canDownload={false} canPrint={false} hideDownloadPrint />}
    </Modal>
  );
}

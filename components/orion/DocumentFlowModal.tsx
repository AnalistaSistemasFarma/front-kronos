'use client';

/**
 * Ventana «Ver flujo» (2026-11-11): solo el recorrido del documento, sin cargar el resto del detalle
 * de la solicitud, para entender rápido en qué va (botón en Acciones de Autorizaciones).
 */
import { Group, Modal, Text, ThemeIcon } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconRoute } from '@tabler/icons-react';
import DocumentFlowTimeline from './DocumentFlowTimeline';

export interface DocumentFlowTarget {
  requestId: number;
  fileId: string;
  fileName: string | null;
}

export default function DocumentFlowModal({ target, onClose }: { target: DocumentFlowTarget | null; onClose: () => void }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      centered
      size='lg'
      radius='lg'
      padding='lg'
      fullScreen={isMobile}
      title={
        <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
          <ThemeIcon variant='gradient' gradient={{ from: 'violet', to: 'grape', deg: 135 }} radius='lg' size={38}>
            <IconRoute size={18} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text fw={700} size='md'>
              Flujo del documento
            </Text>
            {target?.fileName ? (
              <Text size='xs' c='dimmed' truncate>
                Solicitud #{target.requestId} · {target.fileName}
              </Text>
            ) : target ? (
              <Text size='xs' c='dimmed'>
                Solicitud #{target.requestId}
              </Text>
            ) : null}
          </div>
        </Group>
      }
    >
      {target ? <DocumentFlowTimeline requestId={target.requestId} fileId={target.fileId} /> : null}
    </Modal>
  );
}

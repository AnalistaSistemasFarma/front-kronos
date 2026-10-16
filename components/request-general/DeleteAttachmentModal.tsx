'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import {
  JUSTIFICACION_MAX,
  JUSTIFICACION_MIN,
  validarJustificacionEliminacion,
} from '../../lib/orion/deletePolicy';

type Props = {
  opened: boolean;
  fileName: string | null;
  onClose: () => void;
  /** Devuelve true si se eliminó (cierra el modal); false deja el modal abierto. */
  onConfirm: (justification: string) => Promise<boolean>;
};

/**
 * Confirmación para eliminar un documento de la solicitud: la justificación es obligatoria
 * y queda en el historial de la solicitud, en la hoja de vida del documento y en las tareas.
 */
export default function DeleteAttachmentModal({ opened, fileName, onClose, onConfirm }: Props) {
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (opened) setJustification('');
  }, [opened, fileName]);

  const validation = validarJustificacionEliminacion(justification);
  const length = justification.trim().length;

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleConfirm = async () => {
    if (!validation.ok || submitting) return;
    setSubmitting(true);
    try {
      const done = await onConfirm(validation.valor);
      if (done) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      size='md'
      radius='lg'
      centered
      overlayProps={{ blur: 4 }}
      closeOnClickOutside={!submitting}
      closeOnEscape={!submitting}
      title={
        <Group gap='sm'>
          <IconTrash size={18} color='var(--mantine-color-red-6)' />
          <Text fw={700}>Eliminar documento</Text>
        </Group>
      }
    >
      <Stack gap='md'>
        <Text size='sm'>
          Va a eliminar <b>{fileName || 'este documento'}</b>.
        </Text>
        <Alert color='red' variant='light' icon={<IconAlertTriangle size={16} />}>
          La eliminación queda registrada con su nombre, la fecha y la justificación en el historial
          de la solicitud y en la hoja de vida del documento. Si la firma sigue en curso se detiene
          primero en GSS Firma; si no se puede detener, no se elimina nada. Esta acción no se puede
          deshacer.
        </Alert>
        <Textarea
          label='Justificación'
          description={`Obligatoria. Explique por qué se elimina (mínimo ${JUSTIFICACION_MIN} caracteres).`}
          placeholder='Ej.: se cargó una versión equivocada del contrato.'
          required
          autosize
          minRows={3}
          maxRows={8}
          maxLength={JUSTIFICACION_MAX}
          value={justification}
          onChange={(e) => setJustification(e.currentTarget.value)}
          disabled={submitting}
          error={length > 0 && !validation.ok ? validation.error : undefined}
          data-autofocus
        />
        <Text size='xs' c='dimmed' ta='right'>
          {length}/{JUSTIFICACION_MAX}
        </Text>
        <Group justify='flex-end' gap='sm'>
          <Button variant='default' onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            color='red'
            leftSection={<IconTrash size={16} />}
            onClick={() => void handleConfirm()}
            disabled={!validation.ok}
            loading={submitting}
          >
            Eliminar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

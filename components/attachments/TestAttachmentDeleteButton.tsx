'use client';

import { useState } from 'react';
import { ActionIcon, Button, Group, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { IconTrashX } from '@tabler/icons-react';
import toast from 'react-hot-toast';
import { isOneDriveSandbox } from '../../lib/onedrive/root';

type Props = {
  requestId: number;
  fileId: string;
  fileName: string;
  storagePath?: 'SG' | 'MA';
  entityType?: 'Request' | 'Ticket';
  /** Se llama tras borrar en OneDrive, para quitarlo de la tabla. */
  onDeleted: (fileId: string) => void;
};

/**
 * Botón para borrar adjuntos subidos en PRUEBAS. Solo aparece en testing/local (raíz de OneDrive
 * distinta de SAPSEND, ver lib/onedrive/root.ts); en producción no se renderiza. El servidor
 * vuelve a verificar que el archivo esté en la carpeta de pruebas antes de borrarlo.
 */
export default function TestAttachmentDeleteButton({
  requestId,
  fileId,
  fileName,
  storagePath = 'SG',
  entityType = 'Request',
  onDeleted,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!isOneDriveSandbox()) return null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch('/api/requests-general/delete-test-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, storagePath, entityType }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // 404 = ya no estaba: igual se quita de la tabla.
        if (res.status === 404 && data.error?.includes('ya no existe')) {
          onDeleted(fileId);
          setOpened(false);
          return;
        }
        throw new Error(data.error || `No se pudo borrar (HTTP ${res.status})`);
      }
      onDeleted(fileId);
      toast.success(`Archivo de prueba borrado: ${fileName}`);
      setOpened(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo borrar el archivo');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Popover opened={opened} onChange={setOpened} position='bottom-end' withArrow shadow='md' width={260}>
      <Popover.Target>
        <Tooltip label='Borrar archivo de prueba' disabled={opened}>
          <ActionIcon
            variant='subtle'
            color='orange'
            size='sm'
            aria-label={`Borrar archivo de prueba ${fileName}`}
            onClick={() => setOpened((o) => !o)}
          >
            <IconTrashX size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={8}>
          <Text size='sm' fw={600}>
            ¿Borrar este archivo de prueba?
          </Text>
          <Text size='xs' c='dimmed' lineClamp={2}>
            {fileName}
          </Text>
          <Text size='xs' c='dimmed'>
            Va a la papelera de OneDrive (se puede recuperar). Solo disponible en pruebas.
          </Text>
          <Group justify='flex-end' gap={6}>
            <Button size='xs' variant='default' onClick={() => setOpened(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button size='xs' color='red' onClick={handleDelete} loading={deleting}>
              Borrar
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

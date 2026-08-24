'use client';

import React, { useState } from 'react';
import { Modal, FileInput, Textarea, Button, Group, Stack, Alert } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';

interface Props {
  opened: boolean;
  onClose: () => void;
  idDocument: number;
  onCreated: () => void;
}

/**
 * Sube una versión NUEVA de un documento existente. A diferencia del modal de
 * carga inicial (Fase 1, que crea el documento directo en "Vigente"), esta
 * versión arranca el flujo de aprobación de 14 estados en "En creación" (ver
 * lib/document-management/newVersion.ts).
 */
export default function UploadVersionModal({ opened, onClose, idDocument, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setComments('');
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!file) return setError('Seleccione el archivo de la nueva versión');

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (comments.trim()) formData.append('comments', comments.trim());

      const res = await fetch(`/api/document-management/documents/${idDocument}/versions`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo cargar la nueva versión');
        return;
      }
      reset();
      onCreated();
      onClose();
    } catch {
      setError('Error de red al cargar la nueva versión');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Subir nueva versión" size="md">
      <Stack gap="sm">
        {error && <Alert color="red">{error}</Alert>}
        <FileInput
          label="Archivo de la nueva versión"
          placeholder="Seleccione el archivo"
          required
          value={file}
          onChange={setFile}
          leftSection={<IconUpload size={16} />}
        />
        <Textarea
          label="Comentario (queda en la versión)"
          value={comments}
          onChange={(e) => setComments(e.currentTarget.value)}
          minRows={2}
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Subir versión
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Anchor, Button, FileInput, Group, List, Loader, Stack, Text } from '@mantine/core';
import { IconDownload, IconPaperclip, IconUpload } from '@tabler/icons-react';

/**
 * Adjuntos (cotizaciones y anexos) de un borrador de solicitud de compra.
 * Lista y sube via /api/purchases/attachments; las reglas (PDF/JPG/PNG, 10 MB,
 * 10 archivos) se validan tambien en el servidor.
 */

interface AttachmentFile {
  line: number;
  name: string;
  date: string | null;
}

interface Props {
  companyId: number;
  docEntry: number;
  /** false = solo lectura (estado distinto de B/ENC). */
  canUpload: boolean;
  /** Solicitud de Mis solicitudes / Autorizaciones: permite verlos sin permiso de Compras. */
  requestId?: number | string | null;
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png';

export default function AttachmentsPanel({ companyId, docEntry, canUpload, requestId }: Props) {
  const reqParam = requestId ? `&requestId=${requestId}` : '';
  const fileUrl = (line: number, download = false) =>
    `/api/purchases/attachments/file?companyId=${companyId}&docEntry=${docEntry}&line=${line}${reqParam}${download ? '&download=1' : ''}`;
  const [files, setFiles] = useState<AttachmentFile[]>([]);
  const [selected, setSelected] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/attachments?companyId=${companyId}&docEntry=${docEntry}${reqParam}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los adjuntos');
      setFiles(data.files ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, docEntry, reqParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    if (selected.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('companyId', String(companyId));
      form.append('docEntry', String(docEntry));
      for (const f of selected) form.append('files', f, f.name);
      const res = await fetch('/api/purchases/attachments', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data.rejected) ? ` ${data.rejected.map((r: { error: string }) => r.error).join(' ')}` : '';
        throw new Error(`${data.error || 'No se pudo adjuntar'}${detail}`);
      }
      setSelected([]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Adjuntos (cotizaciones y anexos)
      </Text>
      {error && <Alert color="red">{error}</Alert>}
      {loading ? (
        <Loader size="sm" />
      ) : files.length === 0 ? (
        <Text size="sm" c="dimmed">
          Sin adjuntos.
        </Text>
      ) : (
        <List size="sm" icon={<IconPaperclip size={14} />}>
          {files.map((f) => (
            <List.Item key={f.line}>
              <Group gap={8} wrap="nowrap">
                <Anchor href={fileUrl(f.line)} target="_blank" rel="noopener noreferrer" size="sm">
                  {f.name}
                </Anchor>
                {f.date ? (
                  <Text span size="xs" c="dimmed">
                    {String(f.date).slice(0, 10)}
                  </Text>
                ) : null}
                <Anchor href={fileUrl(f.line, true)} size="xs" aria-label={`Descargar ${f.name}`}>
                  <IconDownload size={14} />
                </Anchor>
              </Group>
            </List.Item>
          ))}
        </List>
      )}
      {canUpload && (
        <Group align="flex-end">
          <FileInput
            multiple
            accept={ACCEPT}
            placeholder="PDF, JPG o PNG (max. 10 MB c/u)"
            value={selected}
            onChange={setSelected}
            clearable
            style={{ flex: 1 }}
            aria-label="Seleccionar adjuntos"
          />
          <Button
            leftSection={<IconUpload size={14} />}
            onClick={upload}
            loading={uploading}
            disabled={selected.length === 0}
          >
            Adjuntar
          </Button>
        </Group>
      )}
    </Stack>
  );
}

'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import toast from 'react-hot-toast';
import { IconDownload, IconHistory } from '@tabler/icons-react';
import type { OrionSignatureState } from '../../lib/orion/types';
import { listOrionDocumentVersions, ensureOriginalOrionVersion } from '../../lib/orion/documentVersions';
import { resolveOrionVersionAccessUrl } from '../../lib/orion/signedFileAccess';

type Props = {
  state?: OrionSignatureState | null;
  fileName?: string;
  canView?: boolean;
  fallbackOriginalUrl?: string | null;
  requestId: number;
  fileId: string;
};

function kindColor(kind: string): string {
  switch (kind) {
    case 'original':
      return 'gray';
    case 'final':
      return 'green';
    default:
      return 'blue';
  }
}

export default function OrionDocumentVersionsButton({
  state,
  fileName,
  canView,
  fallbackOriginalUrl,
  requestId,
  fileId,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const versions = listOrionDocumentVersions(
    ensureOriginalOrionVersion(state ?? {}, fallbackOriginalUrl)
  );

  const handleDownload = async (version: (typeof versions)[number]) => {
    const href = resolveOrionVersionAccessUrl({
      requestId,
      fileId,
      versionId: version.id,
      url: version.url,
      kind: version.kind,
    });
    const baseName = (fileName || state?.fileName || 'documento').replace(/\.pdf$/i, '');
    const suffix =
      version.kind === 'original'
        ? '-original'
        : version.kind === 'final'
          ? '-firmado'
          : '-parcial';
    const downloadName = `${baseName}${suffix}.pdf`;

    setDownloadingId(version.id);
    try {
      const res = await fetch(href, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.error === 'string' ? err.error : `No se pudo descargar (${res.status})`
        );
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = downloadName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Intente de nuevo');
    } finally {
      setDownloadingId(null);
    }
  };
  if (!canView || !state?.orionDocumentId || versions.length === 0) return null;

  return (
    <>
      <Button
        size='compact-xs'
        variant='light'
        color='violet'
        leftSection={<IconHistory size={12} />}
        onClick={() => setOpened(true)}
      >
        Versiones
      </Button>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={`Versiones — ${fileName || state?.fileName || 'Documento'}`}
        size='md'
        centered
      >
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            Solo el administrador y quien creó la solicitud pueden ver este historial.
          </Text>
          {versions.map((version) => (
            <Group
              key={version.id}
              justify='space-between'
              align='flex-start'
              p='sm'
              style={{
                border: '1px solid var(--app-border)',
                borderRadius: 8,
                background: 'var(--app-surface-raised)',
              }}
            >
              <Group align='flex-start' gap='sm' wrap='nowrap'>
                <ThemeIcon size={32} radius='md' variant='light' color={kindColor(version.kind)}>
                  <IconHistory size={16} />
                </ThemeIcon>
                <Stack gap={2}>
                  <Text size='sm' fw={600}>
                    {version.label}
                  </Text>
                  <Text size='xs' c='dimmed'>
                    {new Date(version.createdAt).toLocaleString('es-CO')}
                  </Text>
                  {version.signerName && (
                    <Text size='xs' c='dimmed'>
                      {version.signerName}
                      {version.signerEmail ? ` · ${version.signerEmail}` : ''}
                    </Text>
                  )}
                </Stack>
              </Group>
              <Stack gap={4} align='flex-end'>
                <Badge size='xs' color={kindColor(version.kind)} variant='light'>
                  {version.kind === 'original'
                    ? 'Original'
                    : version.kind === 'final'
                      ? 'Final'
                      : 'Parcial'}
                </Badge>
                <Button
                  size='compact-xs'
                  variant='light'
                  leftSection={<IconDownload size={12} />}
                  loading={downloadingId === version.id}
                  onClick={() => handleDownload(version)}
                >
                  Descargar
                </Button>              </Stack>
            </Group>
          ))}
        </Stack>
      </Modal>
    </>
  );
}

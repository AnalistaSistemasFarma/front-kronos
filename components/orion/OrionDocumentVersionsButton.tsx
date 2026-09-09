'use client';

import { useState } from 'react';
import { Box, Button, Group, Modal, Stack, Text, UnstyledButton } from '@mantine/core';
import toast from 'react-hot-toast';
import {
  IconArrowLeft,
  IconCheck,
  IconDownload,
  IconFile,
  IconHistory,
  IconSignature,
} from '@tabler/icons-react';
import type { OrionDocumentVersion, OrionSignatureState } from '../../lib/orion/types';
import {
  ensureOriginalOrionVersion,
  listOrionDocumentVersionsForViewer,
} from '../../lib/orion/documentVersions';
import { resolveOrionVersionAccessUrl } from '../../lib/orion/signedFileAccess';

type Props = {
  state?: OrionSignatureState | null;
  fileName?: string;
  /** Historial completo (creador/admin). Si false, solo la última versión firmada. */
  canView?: boolean;
  /** true = creador/admin (todas); false = firmante (solo última). */
  fullHistory?: boolean;
  fallbackOriginalUrl?: string | null;
  requestId: number;
  fileId: string;
};

function kindMeta(kind: string): {
  label: string;
  color: string;
  tone: 'original' | 'partial' | 'final';
} {
  if (kind === 'original') {
    return { label: 'Original', color: 'var(--mantine-color-gray-6)', tone: 'original' };
  }
  if (kind === 'final') {
    return { label: 'Final', color: 'var(--mantine-color-teal-6)', tone: 'final' };
  }
  return { label: 'Parcial', color: 'var(--mantine-color-blue-6)', tone: 'partial' };
}

function VersionDot({ tone }: { tone: 'original' | 'partial' | 'final' }) {
  const bg =
    tone === 'final'
      ? 'var(--mantine-color-teal-6)'
      : tone === 'partial'
        ? 'var(--mantine-color-blue-6)'
        : 'var(--mantine-color-gray-5)';
  return (
    <Box
      style={{
        width: 28,
        height: 28,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        background: bg,
        color: '#fff',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {tone === 'final' ? (
        <IconCheck size={14} stroke={3} />
      ) : tone === 'partial' ? (
        <IconSignature size={14} stroke={2} />
      ) : (
        <IconFile size={14} stroke={2} />
      )}
    </Box>
  );
}

export default function OrionDocumentVersionsButton({
  state,
  fileName,
  canView,
  fullHistory = true,
  fallbackOriginalUrl,
  requestId,
  fileId,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const versions = listOrionDocumentVersionsForViewer(
    ensureOriginalOrionVersion(state ?? {}, fallbackOriginalUrl),
    { fullHistory }
  );

  const handleDownload = async (version: OrionDocumentVersion) => {
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

  const docTitle = fileName || state?.fileName || 'Documento';
  const statusUpper = String(state?.status || '').toUpperCase();
  const statusLabel =
    statusUpper === 'FIRMADO'
      ? 'Firmado'
      : statusUpper === 'RECHAZADO'
        ? 'Rechazado'
        : statusUpper === 'EN_PROCESO' || statusUpper === 'PENDIENTE_FIRMA'
          ? 'En proceso'
          : statusUpper === 'BORRADOR'
            ? 'Borrador'
            : statusUpper || 'Documento';
  const statusColor =
    statusUpper === 'FIRMADO'
      ? 'var(--mantine-color-teal-6)'
      : statusUpper === 'RECHAZADO'
        ? 'var(--mantine-color-red-6)'
        : statusUpper === 'BORRADOR'
          ? 'var(--mantine-color-gray-6)'
          : 'var(--mantine-color-blue-6)';

  return (
    <>
      <UnstyledButton
        onClick={() => setOpened(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 8px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--mantine-color-text)',
          textAlign: 'left',
        }}
      >
        <IconHistory size={15} stroke={1.6} />
        {fullHistory ? 'Versiones' : 'Descargar PDF'}
      </UnstyledButton>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        withCloseButton={false}
        centered
        size={440}
        padding={0}
        radius='lg'
        overlayProps={{ backgroundOpacity: 0.35, blur: 1 }}
        styles={{
          content: {
            background: 'var(--mantine-color-body)',
            boxShadow: '0 16px 48px rgba(15, 23, 42, 0.12)',
          },
          body: { padding: 0 },
        }}
      >
        <Box
          style={{
            background: 'var(--mantine-color-body)',
            color: 'var(--mantine-color-text)',
            borderRadius: 16,
            border: '1px solid var(--mantine-color-default-border)',
            padding: '22px 22px 18px',
          }}
        >
          <Group justify='space-between' align='flex-start' mb={6} wrap='nowrap' gap='md'>
            <Text
              size='11px'
              fw={700}
              c='dimmed'
              style={{ letterSpacing: 1.2, textTransform: 'uppercase' }}
            >
              Historial de versiones
            </Text>
            <Box
              px={10}
              py={3}
              style={{
                borderRadius: 999,
                border: `1px solid ${statusColor}`,
                color: statusColor,
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {statusLabel}
            </Box>
          </Group>

          <Text fw={800} style={{ fontSize: 22, lineHeight: 1.2, letterSpacing: -0.3 }} mb={4}>
            {docTitle}
          </Text>
          <Text size='sm' c='dimmed' mb='lg'>
            {fullHistory
              ? `${versions.length} versión(es) · original → firmas acumuladas`
              : 'Solo la última versión disponible para descarga'}
          </Text>

          <Stack gap={0} mb='lg'>
            {versions.map((version, index) => {
              const meta = kindMeta(version.kind);
              const isLast = index === versions.length - 1;
              const lineColor =
                meta.tone === 'final'
                  ? 'var(--mantine-color-teal-5)'
                  : meta.tone === 'partial'
                    ? 'var(--mantine-color-blue-5)'
                    : 'var(--mantine-color-gray-4)';

              return (
                <Group
                  key={version.id}
                  align='flex-start'
                  wrap='nowrap'
                  gap='sm'
                  style={{ position: 'relative' }}
                >
                  <Box style={{ position: 'relative', width: 28, flexShrink: 0 }}>
                    {!isLast && (
                      <Box
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: 28,
                          bottom: -8,
                          width: 2,
                          transform: 'translateX(-50%)',
                          background: lineColor,
                        }}
                      />
                    )}
                    <VersionDot tone={meta.tone} />
                  </Box>

                  <Group
                    justify='space-between'
                    align='flex-start'
                    style={{ flex: 1, minWidth: 0 }}
                    wrap='nowrap'
                    gap='md'
                    pb={isLast ? 0 : 'md'}
                  >
                    <Box style={{ minWidth: 0 }}>
                      <Text size='sm' fw={700} lineClamp={1}>
                        {version.label}
                      </Text>
                      <Text size='xs' c='dimmed'>
                        {new Date(version.createdAt).toLocaleString('es-CO')}
                      </Text>
                      {(version.signerName || version.signerEmail) && (
                        <Text size='xs' c='dimmed' lineClamp={1}>
                          {[version.signerName, version.signerEmail].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                      <UnstyledButton
                        onClick={() => void handleDownload(version)}
                        disabled={downloadingId === version.id}
                        style={{
                          marginTop: 6,
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--mantine-color-blue-6)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          textDecoration: 'underline',
                          textUnderlineOffset: 3,
                          opacity: downloadingId === version.id ? 0.6 : 1,
                        }}
                      >
                        <IconDownload size={13} />
                        {downloadingId === version.id ? 'Descargando…' : 'Descargar'}
                      </UnstyledButton>
                    </Box>
                    <Text size='sm' fw={600} style={{ color: meta.color, whiteSpace: 'nowrap' }}>
                      {meta.label}
                    </Text>
                  </Group>
                </Group>
              );
            })}
          </Stack>

          <Button
            fullWidth
            variant='default'
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => setOpened(false)}
            styles={{
              root: {
                height: 42,
                borderRadius: 10,
              },
            }}
          >
            Volver a documentos
          </Button>
        </Box>
      </Modal>
    </>
  );
}

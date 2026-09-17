'use client';

import {
  ActionIcon,
  Badge,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconEye,
  IconFile,
  IconPencil,
  IconSignature,
  IconSparkles,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import type { OrionSignatureState } from '../../lib/orion/types';
import OrionSignatureFlow from './OrionSignatureFlow';
import {
  type OrionAttachmentSignActionsProps,
  useOrionAttachmentDerived,
} from './OrionAttachmentSignActions';
import { resolveRequestPdfAccessUrl } from '../../lib/attachments/fileUrl';
import {
  buildOrionSignedFileProxyUrl,
  orionDocumentHasSignedCopy,
} from '../../lib/orion/signedFileAccess';

type RowProps = OrionAttachmentSignActionsProps & {
  rowNumber?: number | string;
  fileSizeLabel?: string;
  openUrl?: string | null;
  /** Visor en línea (SharePoint/OneDrive webUrl). No usar downloadUrl. */
  previewUrl?: string | null;
  versionsSlot?: ReactNode;
  canDeleteAttachment?: boolean;
  onDeleteAttachment?: (fileId: string) => void | Promise<void>;
};

function ActionLink({
  icon,
  label,
  onClick,
  href,
  danger,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string | null;
  danger?: boolean;
  disabled?: boolean;
}) {
  const style = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    color: danger
      ? 'var(--mantine-color-red-7)'
      : 'var(--mantine-color-text)',
    background: danger ? 'var(--mantine-color-red-light)' : 'transparent',
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'default' : 'pointer',
    textAlign: 'left' as const,
  };

  if (href && !disabled) {
    return (
      <UnstyledButton
        component='a'
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        style={style}
      >
        {icon}
        {label}
      </UnstyledButton>
    );
  }

  return (
    <UnstyledButton onClick={disabled ? undefined : onClick} style={style} disabled={disabled}>
      {icon}
      {label}
    </UnstyledButton>
  );
}

/** Fila estilo Orion (colores del tema de la página). */
export default function OrionAttachmentTableRow({
  rowNumber,
  fileSizeLabel,
  openUrl,
  previewUrl,
  versionsSlot,
  canDeleteAttachment = false,
  onDeleteAttachment,
  ...props
}: RowProps) {
  void previewUrl; // OneDrive webUrl no se usa: Ver en línea va por proxy SynerLink.
  const d = useOrionAttachmentDerived(props);
  const [extensionLoading, setExtensionLoading] = useState(false);
  const [renewLoading, setRenewLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const applyDocs = (documents: Record<string, OrionSignatureState>) => {
    props.onDocumentsUpdate?.(documents);
  };

  const doRequestExtension = async () => {
    setExtensionLoading(true);
    try {
      const res = await fetch('/api/integrations/orion/request-sign-extension', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: props.requestId, fileId: props.fileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || 'No se pudo enviar la solicitud');
        return;
      }
      if (data.documents) applyDocs(data.documents);
      window.alert(data.message || 'Solicitud enviada al líder del proceso.');
    } finally {
      setExtensionLoading(false);
    }
  };

  const doRenew = async () => {
    setRenewLoading(true);
    try {
      const res = await fetch('/api/integrations/orion/request-sign-extension', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: props.requestId, fileId: props.fileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || 'No se pudo renovar el plazo');
        return;
      }
      if (data.documents) applyDocs(data.documents);
    } finally {
      setRenewLoading(false);
    }
  };

  const runSign = () => {
    if (d.api?.enabled) {
      if (!d.api.hasSignature) {
        d.api.actions.openConfigureSignature();
        return;
      }
      d.api.actions.openSignFlow(d.meta);
      return;
    }
    window.dispatchEvent(new CustomEvent('orion-open-sign', { detail: d.meta }));
  };

  const openEditor = (initialStep: 0 | 1 | 2 = 0) => {
    if (d.api?.enabled) d.api.actions.openDocumentEditor(d.meta, { initialStep });
  };

  // Vista vigente (última con firmas acumuladas). El original solo vía historial de versiones.
  const isClosed =
    String(d.state.status || '').toUpperCase() === 'FIRMADO' ||
    (d.signers.length > 0 && d.completedCount === d.signers.length);
  const hasSignedCopy = orionDocumentHasSignedCopy(d.state);

  const originalFileHref =
    hasSignedCopy && d.hasOrionDoc && props.requestId && props.fileId && d.api?.canViewVersions
      ? buildOrionSignedFileProxyUrl({
          requestId: props.requestId,
          fileId: props.fileId,
          versionId: 'original',
          download: true,
        })
      : null;

  /** Descarga: SynerLink OneDrive si no hay firmas; Orion si ya hay copia firmada. */
  const downloadHref =
    props.requestId && props.fileId
      ? resolveRequestPdfAccessUrl({
          requestId: props.requestId,
          fileId: props.fileId,
          state: d.state,
          download: true,
        })
      : String(openUrl || '').trim() || originalFileHref || null;

  /**
   * Ver en línea:
   * - sin firmas → `/api/requests-general/attachment-file` (OneDrive SynerLink)
   * - con firmas → `/api/integrations/orion/signed-file` (OneDrive Orion)
   */
  const viewOnlineHref =
    props.requestId && props.fileId
      ? resolveRequestPdfAccessUrl({
          requestId: props.requestId,
          fileId: props.fileId,
          state: d.state,
        })
      : String(props.pdfUrl || openUrl || '').trim() || null;

  const statusColor =
    d.displayStatus.color === 'yellow'
      ? 'blue'
      : d.displayStatus.color === 'gray'
        ? 'gray'
        : d.displayStatus.color;
  // Historial/original: solo creador del flujo / admin.
  const canAccessOriginalFile = Boolean(d.api?.canViewVersions);

  const deleteAction =
    canDeleteAttachment && onDeleteAttachment ? (
      <ActionLink
        icon={<IconTrash size={15} stroke={1.6} />}
        label={deleteLoading ? 'Eliminando…' : 'Eliminar'}
        danger
        disabled={deleteLoading || isClosed}
        onClick={() => {
          if (deleteLoading || isClosed) return;
          if (
            !window.confirm(
              `¿Eliminar “${props.fileName}” de la solicitud? Esta acción no se puede deshacer.`
            )
          ) {
            return;
          }
          setDeleteLoading(true);
          void Promise.resolve(onDeleteAttachment(props.fileId)).finally(() => {
            setDeleteLoading(false);
          });
        }}
      />
    ) : null;

  return (
    <Table.Tr className={isClosed ? 'doc-row doc-row--closed' : 'doc-row'}>
      <Table.Td data-label='N.º' className='doc-cell doc-cell--mono doc-col--secondary' style={{ width: 56, whiteSpace: 'nowrap' }}>
        <Text size='sm' c='dimmed'>
          {rowNumber ?? '—'}
        </Text>
      </Table.Td>

      <Table.Td data-label='Documento' className='doc-cell doc-cell--file' style={{ minWidth: 140, maxWidth: 280 }}>
        <Group gap={6} wrap='nowrap' align='flex-start'>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text size='sm' fw={700} lineClamp={2}>
              {props.fileName}
            </Text>
            {fileSizeLabel ? (
              <Text size='xs' c='dimmed' mt={2}>
                {fileSizeLabel}
              </Text>
            ) : null}
          </div>
          {viewOnlineHref ? (
            <Tooltip label='Ver en línea (sin descargar)'>
              <ActionIcon
                variant='subtle'
                color='blue'
                size='md'
                component='a'
                href={viewOnlineHref}
                target='_blank'
                rel='noopener noreferrer'
                aria-label={`Ver en línea ${props.fileName}`}
                style={{ flexShrink: 0, marginTop: 1, minWidth: 36, minHeight: 36 }}
              >
                <IconEye size={16} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
      </Table.Td>

      <Table.Td data-label='Departamento' className='doc-cell doc-col--secondary' style={{ minWidth: 120, maxWidth: 180 }}>
        <Text size='sm' c='dimmed' lineClamp={2}>
          {props.processName || '—'}
        </Text>
      </Table.Td>

      <Table.Td data-label='Estado' className='doc-cell'>
        <Stack gap={6} className='doc-intent-control'>
          {d.permissionsPending ? (
            <Text size='xs' c='dimmed'>
              Cargando permisos…
            </Text>
          ) : d.canToggleIntent ? (
            <SegmentedControl
              size='xs'
              fullWidth
              value={d.signatureIntent}
              disabled={d.intentLoading}
              onChange={(value) => {
                void d.setSignatureIntent(value as 'sign' | 'view');
              }}
              data={[
                { label: 'Para firmar', value: 'sign' },
                { label: 'Solo ver', value: 'view' },
              ]}
            />
          ) : d.forSigning ? (
            <Tooltip
              label={
                d.intentLockedReason ||
                'Para firmar · Orion. No se puede pasar a Solo ver si el documento ya está en Orion o tiene firmas.'
              }
              multiline
              maw={280}
              withArrow
            >
              <Badge
                variant='outline'
                color={statusColor}
                size='sm'
                radius='xl'
                styles={{ label: { textTransform: 'none', fontWeight: 600 } }}
              >
                {d.displayStatus.label}
              </Badge>
            </Tooltip>
          ) : d.enabled ? (
            <Tooltip
              label='Solo ver · OneDrive SynerLink'
              withArrow
            >
              <Badge
                variant='outline'
                color='gray'
                size='sm'
                radius='xl'
                styles={{ label: { textTransform: 'none', fontWeight: 600 } }}
              >
                Solo ver
              </Badge>
            </Tooltip>
          ) : (
            <Text size='sm' c='dimmed'>
              —
            </Text>
          )}
        </Stack>
      </Table.Td>

      <Table.Td data-label='Firmantes' className='doc-cell doc-col--secondary'>
        <Text size='sm' c='dimmed'>
          {d.enabled && d.signers.length > 0
            ? `${d.completedCount}/${d.signers.length}`
            : '—'}
        </Text>
      </Table.Td>

      <Table.Td data-label='Responsable' className='doc-cell doc-col--secondary' style={{ maxWidth: 160 }}>
        <Text size='sm' c='dimmed' lineClamp={1}>
          {d.enabled && d.signers.length > 0
            ? d.turnName
            : props.requesterName || '—'}
        </Text>
      </Table.Td>

      <Table.Td
        data-label='Acciones'
        className={isClosed ? 'doc-cell doc-cell--actions doc-cell--actions-closed' : 'doc-cell doc-cell--actions'}
        style={{
          minWidth: 160,
          verticalAlign: 'top',
        }}
      >
        {!d.enabled && !d.canToggleIntent ? (
          <div className='doc-dossier'>
            <div className='doc-dossier__rail' />
            <Stack gap={4} className='doc-dossier__body'>
              {viewOnlineHref ? (
                <ActionLink
                  icon={<IconEye size={15} stroke={1.6} />}
                  label='Ver en línea'
                  href={viewOnlineHref}
                />
              ) : null}
              <ActionLink
                icon={<IconFile size={15} stroke={1.6} />}
                label='Abrir / descargar'
                href={downloadHref}
                disabled={!downloadHref}
              />
              {deleteAction}
            </Stack>
          </div>
        ) : !d.forSigning ? (
          <div className='doc-dossier'>
            <div className='doc-dossier__rail' />
            <Stack gap={4} className='doc-dossier__body'>
              <Text
                size='10px'
                c='dimmed'
                tt='uppercase'
                fw={700}
                style={{ letterSpacing: 0.6 }}
              >
                Solo ver
              </Text>
              {viewOnlineHref ? (
                <ActionLink
                  icon={<IconEye size={15} stroke={1.6} />}
                  label='Ver en línea'
                  href={viewOnlineHref}
                />
              ) : null}
              <ActionLink
                icon={<IconFile size={15} stroke={1.6} />}
                label='Descargar'
                href={downloadHref}
                disabled={!downloadHref}
              />
              {deleteAction}
            </Stack>
          </div>
        ) : (
          <div className={isClosed ? 'doc-dossier doc-dossier--closed' : 'doc-dossier'}>
            <div className='doc-dossier__rail' />
            <Stack gap={4} className='doc-dossier__body'>
            <Text
              size='10px'
              c='dimmed'
              tt='uppercase'
              fw={700}
              style={{ letterSpacing: 0.6 }}
            >
              Para firmar · Orion
            </Text>
            {!d.hasOrionDoc ? (
              <Text size='xs' c='dimmed' className='doc-dossier__hint'>
                Pulse “Preparar documento” para enviarlo a Orion. Mientras no se prepare, puede
                volver a Solo ver (OneDrive SynerLink). Tras preparar o firmar, el destino queda
                fijado en Orion.
              </Text>
            ) : null}

            {d.hasOrionDoc && d.signers.length > 0 ? (
              <OrionSignatureFlow
                compact
                state={d.state}
                currentUserEmail={props.currentUserEmail}
                canRenewDeadline={d.permissions.canRenewDeadline}
                onRenewDeadline={() => void doRenew()}
                renewLoading={renewLoading}
                requestId={props.requestId}
                fileName={props.fileName}
                processName={props.processName}
                requesterName={props.requesterName}
              />
            ) : null}

            {isClosed ? (
              <Text size='xs' fw={700} c='teal' className='doc-dossier__seal'>
                CERRADO
                <Text span fw={500} c='dimmed'>
                  {' '}
                  · Firmado por completo
                </Text>
              </Text>
            ) : null}

            <Stack gap={2} mt={2}>
              {viewOnlineHref ? (
                <ActionLink
                  icon={<IconEye size={15} stroke={1.6} />}
                  label='Ver en línea'
                  href={viewOnlineHref}
                />
              ) : null}

              {/* Descargar = binario; Ver en línea = visor (arriba). */}
              {downloadHref ? (
                <ActionLink
                  icon={<IconFile size={15} stroke={1.6} />}
                  label='Descargar'
                  href={downloadHref}
                />
              ) : null}

              {deleteAction}

              {canAccessOriginalFile && originalFileHref ? (
                <ActionLink
                  icon={<IconFile size={15} stroke={1.6} />}
                  label='Original'
                  href={originalFileHref}
                />
              ) : null}

              {!isClosed && d.canEditDocument && d.api ? (
                <>
                  <ActionLink
                    icon={<IconUsers size={15} stroke={1.6} />}
                    label='Firmantes'
                    onClick={() => openEditor(1)}
                  />
                  <ActionLink
                    icon={<IconPencil size={15} stroke={1.6} />}
                    label='Colocar firmas'
                    onClick={() => openEditor(2)}
                  />
                  <ActionLink
                    icon={<IconSparkles size={15} stroke={1.6} />}
                    label='Editar expediente'
                    onClick={() => openEditor(0)}
                  />
                </>
              ) : null}

              {versionsSlot && d.api?.canViewVersions ? (
                <div>{versionsSlot}</div>
              ) : null}

              {d.canSignNow ? (
                <Button
                  size='compact-xs'
                  color='blue'
                  variant='light'
                  leftSection={<IconSignature size={12} />}
                  loading={Boolean(d.api?.acceptLoading)}
                  onClick={runSign}
                  fullWidth
                  mt={4}
                >
                  {d.needsSignaturePad ? 'Mi firma' : 'Firmar'}
                </Button>
              ) : d.missingSignPermission ? (
                <Text size='xs' c='orange' mt={4}>
                  Sin permiso “Firmar documento”
                </Text>
              ) : null}

              {d.turnExpired && d.isMyTurn ? (
                <Button
                  size='compact-xs'
                  color='orange'
                  variant='light'
                  loading={extensionLoading}
                  onClick={() => void doRequestExtension()}
                  fullWidth
                  mt={4}
                >
                  Solicitar firmar
                </Button>
              ) : null}

              {!isClosed && d.canPrepareDocument && d.api ? (
                <ActionLink
                  icon={<IconPencil size={15} stroke={1.6} />}
                  label='Preparar documento'
                  onClick={openEditor}
                />
              ) : null}
            </Stack>
            </Stack>
          </div>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

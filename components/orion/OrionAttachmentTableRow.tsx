'use client';

import { Badge, Button, SegmentedControl, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import {
  IconFile,
  IconPencil,
  IconSignature,
  IconSparkles,
  IconUsers,
} from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import type { OrionSignatureState } from '../../lib/orion/types';
import OrionSignatureFlow from './OrionSignatureFlow';
import {
  type OrionAttachmentSignActionsProps,
  useOrionAttachmentDerived,
} from './OrionAttachmentSignActions';
import { buildOrionSignedFileProxyUrl } from '../../lib/orion/signedFileAccess';

type RowProps = OrionAttachmentSignActionsProps & {
  rowNumber?: number | string;
  fileSizeLabel?: string;
  openUrl?: string | null;
  versionsSlot?: ReactNode;
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
  versionsSlot,
  ...props
}: RowProps) {
  const d = useOrionAttachmentDerived(props);
  const [extensionLoading, setExtensionLoading] = useState(false);
  const [renewLoading, setRenewLoading] = useState(false);

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

  const openEditor = () => {
    if (d.api?.enabled) d.api.actions.openDocumentEditor(d.meta);
  };

  // "Archivo" siempre debe abrir el original sin firmas.
  // Si el documento ya está vinculado a Orion, usamos el proxy same-origin con versionId=original
  // para evitar URLs temporales expiradas de SharePoint/OneDrive.
  const originalFileHref =
    d.hasOrionDoc && props.requestId && props.fileId
      ? buildOrionSignedFileProxyUrl({
          requestId: props.requestId,
          fileId: props.fileId,
          versionId: 'original',
        })
      : String(d.state.originalFileUrl || '').trim() || openUrl || null;

  const statusColor =
    d.displayStatus.color === 'yellow'
      ? 'blue'
      : d.displayStatus.color === 'gray'
        ? 'gray'
        : d.displayStatus.color;
  const isClosed =
    String(d.state.status || '').toUpperCase() === 'FIRMADO' ||
    (d.signers.length > 0 && d.completedCount === d.signers.length);
  const canAccessOriginalFile = Boolean(d.api?.canManage || d.api?.isAdmin);

  return (
    <Table.Tr className={isClosed ? 'doc-row doc-row--closed' : 'doc-row'}>
      <Table.Td data-label='N.º' className='doc-cell doc-cell--mono' style={{ width: 72, whiteSpace: 'nowrap' }}>
        <Text size='sm' c='dimmed'>
          {rowNumber ?? '—'}
        </Text>
      </Table.Td>

      <Table.Td data-label='Documento' className='doc-cell' style={{ minWidth: 160, maxWidth: 260 }}>
        <Text size='sm' fw={700} lineClamp={2}>
          {props.fileName}
        </Text>
        {fileSizeLabel ? (
          <Text size='xs' c='dimmed' mt={2}>
            {fileSizeLabel}
          </Text>
        ) : null}
      </Table.Td>

      <Table.Td data-label='Departamento' className='doc-cell' style={{ minWidth: 140, maxWidth: 200 }}>
        <Text size='sm' c='dimmed' lineClamp={2}>
          {props.processName || '—'}
        </Text>
      </Table.Td>

      <Table.Td data-label='Estado' className='doc-cell'>
        <Stack gap={6}>
          {d.canToggleIntent ? (
            <SegmentedControl
              size='xs'
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
          ) : null}
          {d.enabled || d.forSigning ? (
            <Badge
              variant='outline'
              color={statusColor}
              size='sm'
              radius='xl'
              styles={{ label: { textTransform: 'none', fontWeight: 600 } }}
            >
              {d.displayStatus.label}
            </Badge>
          ) : (
            <Text size='sm' c='dimmed'>
              —
            </Text>
          )}
        </Stack>
      </Table.Td>

      <Table.Td data-label='Firmantes' className='doc-cell'>
        <Text size='sm' c='dimmed'>
          {d.enabled && d.signers.length > 0
            ? `${d.completedCount}/${d.signers.length}`
            : '—'}
        </Text>
      </Table.Td>

      <Table.Td data-label='Responsable' className='doc-cell' style={{ maxWidth: 160 }}>
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
          minWidth: 200,
          verticalAlign: 'top',
        }}
      >
        {!d.enabled && !d.canToggleIntent ? (
          <Text size='sm' c='dimmed'>
            —
          </Text>
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
                Consulta
              </Text>
              <Text size='xs' c='dimmed'>
                Este documento no está marcado para firma.
              </Text>
              <ActionLink
                icon={<IconFile size={15} stroke={1.6} />}
                label='Abrir / descargar'
                href={openUrl || originalFileHref}
                disabled={!openUrl && !originalFileHref}
              />
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
              Seguimiento
            </Text>

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
              {canAccessOriginalFile ? (
                <ActionLink
                  icon={<IconFile size={15} stroke={1.6} />}
                  label='Archivo'
                  href={originalFileHref}
                  disabled={!originalFileHref}
                />
              ) : null}

              {!isClosed && d.canEditDocument && d.api ? (
                <>
                  <ActionLink
                    icon={<IconUsers size={15} stroke={1.6} />}
                    label='Firmantes'
                    onClick={openEditor}
                  />
                  <ActionLink
                    icon={<IconPencil size={15} stroke={1.6} />}
                    label='Colocar firmas'
                    onClick={openEditor}
                  />
                  <ActionLink
                    icon={<IconSparkles size={15} stroke={1.6} />}
                    label='Editar expediente'
                    onClick={openEditor}
                  />
                </>
              ) : null}

              {versionsSlot ? (
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

'use client';

import { Button, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconSignature } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { resolveOrionDocumentForAttachment } from '../../lib/orion/formValue';
import { resolveOrionPermissions } from '../../lib/orion/permissions';
import { isSignerTurnExpired } from '../../lib/orion/signerDeadline';
import {
  getCurrentPendingSigner,
  isSignerCompleted,
  orderedSigners,
} from '../../lib/orion/signerStatus';
import type { OrionSignatureState } from '../../lib/orion/types';
import { useOrionSignatureApi } from './OrionSignatureContext';
import OrionSignatureFlow from './OrionSignatureFlow';

export type OrionAttachmentSignActionsProps = {
  requestId: number;
  fileId: string;
  fileName: string;
  pdfUrl: string;
  currentUserEmail?: string | null;
  currentUserId?: string | null;
  createdByEmail?: string | null;
  requesterId?: string | null;
  fallbackState?: OrionSignatureState | null;
  allDocuments?: Record<string, OrionSignatureState> | null;
  workflowLocked?: boolean;
  forceSignerUi?: boolean;
  onDocumentsUpdate?: (documents: Record<string, OrionSignatureState>) => void;
  processName?: string | null;
  requesterName?: string | null;
};

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function orionStatusOutline(status?: string | null): { label: string; color: string } {
  const value = String(status || '').toUpperCase();
  if (value === 'FIRMADO') return { label: 'Firmado', color: 'green' };
  if (value === 'RECHAZADO') return { label: 'Rechazado', color: 'red' };
  if (value === 'DEVUELTO') return { label: 'Devuelto', color: 'orange' };
  if (value === 'EN_PROCESO' || value === 'PENDIENTE_FIRMA') {
    return { label: 'En proceso', color: 'blue' };
  }
  if (value === 'BORRADOR') return { label: 'Borrador', color: 'gray' };
  return { label: status || 'Sin iniciar', color: 'gray' };
}

export function useOrionAttachmentDerived(props: OrionAttachmentSignActionsProps) {
  const api = useOrionSignatureApi();
  const {
    fileId,
    fileName,
    pdfUrl,
    currentUserEmail,
    currentUserId = null,
    createdByEmail = null,
    requesterId = null,
    fallbackState = null,
    allDocuments = null,
    workflowLocked = false,
    forceSignerUi = false,
  } = props;

  const state = useMemo(() => {
    const fromApi = api?.documents ?? null;
    const merged: Record<string, OrionSignatureState> = {
      ...(allDocuments ?? {}),
      ...(fromApi ?? {}),
    };
    const fbId = String(fallbackState?.fileId || '').trim();
    const fallbackBelongsHere =
      Boolean(fallbackState) &&
      (!fbId || fbId === fileId) &&
      Boolean(
        fallbackState?.orionDocumentId ||
          (fallbackState?.signers?.length ?? 0) > 0 ||
          fallbackState?.status
      );
    if (fallbackBelongsHere && fallbackState) {
      if (!merged[fileId]?.orionDocumentId && !(merged[fileId]?.signers?.length)) {
        merged[fileId] = { ...fallbackState, fileId };
      }
    }
    return resolveOrionDocumentForAttachment({
      fileId,
      fileName,
      documents: merged,
      fallback: fallbackBelongsHere ? fallbackState : null,
    });
  }, [allDocuments, api?.documents, fallbackState, fileId, fileName]);

  const enabled =
    /\.pdf$/i.test(fileName) &&
    Boolean(fileId) &&
    (Boolean(api?.enabled) ||
      Boolean(state.orionDocumentId || state.status || (state.signers?.length ?? 0) > 0) ||
      forceSignerUi);

  const permissions = resolveOrionPermissions({
    canManage: api?.canManage ?? false,
    isAdmin: api?.isAdmin ?? false,
    currentUserEmail: currentUserEmail ?? undefined,
    currentUserId,
    createdByEmail,
    requesterId,
    state,
    hasAttachment: true,
    hasPersonalSignature: api?.hasSignature ?? false,
    workflowLocked,
  });

  const me = normalizeEmail(currentUserEmail);
  const mySigner = me
    ? state.signers?.find((s) => normalizeEmail(s.email) === me)
    : undefined;
  const currentUserCompleted = Boolean(mySigner && isSignerCompleted(mySigner.status));
  const pendingSigner = getCurrentPendingSigner(state.signers);
  const isMyTurn = Boolean(
    me && pendingSigner && normalizeEmail(pendingSigner.email) === me
  );
  const turnExpired = Boolean(isMyTurn && pendingSigner && isSignerTurnExpired(pendingSigner));
  const statusUpper = String(state.status || '').toUpperCase();
  const isTerminal = statusUpper === 'FIRMADO' || statusUpper === 'RECHAZADO';
  const isCoordinatorUi = permissions.userRole === 'coordinator';
  const inSigningPhase =
    (!isTerminal && forceSignerUi && !isCoordinatorUi) ||
    statusUpper === 'EN_PROCESO' ||
    statusUpper === 'PENDIENTE_FIRMA' ||
    Boolean(
      statusUpper !== 'BORRADOR' &&
        state.orionDocumentId &&
        (state.signers?.length ?? 0) > 0 &&
        !isTerminal
    ) ||
    Boolean(api?.pendingAuthorizationByFile?.[fileId]);

  const signers = orderedSigners(state.signers);
  const completedCount = signers.filter((s) => isSignerCompleted(s.status)).length;
  const turnName =
    pendingSigner?.name ||
    pendingSigner?.email ||
    (isTerminal || (signers.length > 0 && completedCount === signers.length)
      ? 'Completo'
      : '—');

  const canManageAttachment =
    isCoordinatorUi &&
    Boolean(api?.enabled) &&
    Boolean(api) &&
    !isTerminal &&
    permissions.canManageWorkflow;

  // Editar expediente: no depende del rol UI del turno (creador puede ser también firmante).
  const canEditDocument =
    Boolean(api?.enabled) &&
    Boolean(api) &&
    !isTerminal &&
    permissions.canManageWorkflow;

  const canPrepareDocument =
    Boolean(api?.enabled) &&
    Boolean(api?.canManage || api?.isAdmin) &&
    !isTerminal &&
    !state.orionDocumentId;

  const canSignNow =
    !canManageAttachment &&
    !currentUserCompleted &&
    !isTerminal &&
    inSigningPhase &&
    !turnExpired &&
    (forceSignerUi || isMyTurn || permissions.userRole === 'signer');

  const isWaiting =
    !canManageAttachment &&
    !currentUserCompleted &&
    !isTerminal &&
    inSigningPhase &&
    Boolean(mySigner) &&
    !isMyTurn;

  const displayStatus = orionStatusOutline(
    state.status ||
      (state.orionDocumentId
        ? statusUpper === 'BORRADOR' || statusUpper === 'DEVUELTO'
          ? statusUpper
          : 'EN_PROCESO'
        : 'SIN INICIAR')
  );

  const meta = { fileId, fileName, pdfUrl: pdfUrl || `#orion-file-${fileId}` };
  const hasOrionDoc = Boolean(
    state.orionDocumentId || state.status || (state.signers?.length ?? 0) > 0
  );

  return {
    api,
    enabled,
    state,
    permissions,
    meta,
    hasOrionDoc,
    signers,
    completedCount,
    turnName,
    displayStatus,
    currentUserCompleted,
    isTerminal,
    canManageAttachment,
    canEditDocument,
    canPrepareDocument,
    canSignNow,
    isWaiting,
    turnExpired,
    isMyTurn,
    needsSignaturePad: Boolean(api?.enabled) && !api!.hasSignature,
  };
}

/** Columna Seguimiento estilo Orion (para layouts sin tabla completa). */
export default function OrionAttachmentSignActions(props: OrionAttachmentSignActionsProps) {
  const d = useOrionAttachmentDerived(props);
  const [extensionLoading, setExtensionLoading] = useState(false);
  const [renewLoading, setRenewLoading] = useState(false);

  if (!d.enabled) return null;

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

  return (
    <Stack gap={4} align='flex-start'>
      <Text size='10px' c='dimmed' tt='uppercase' fw={700} style={{ letterSpacing: 0.4 }}>
        Seguimiento
      </Text>

      {d.hasOrionDoc && d.signers.length > 0 && (
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
      )}

      {d.canManageAttachment && d.api ? (
        <UnstyledButton
          onClick={() => d.api!.actions.openDocumentEditor(d.meta)}
          style={{ fontSize: 13, color: 'var(--mantine-color-blue-6)', fontWeight: 600 }}
        >
          {!d.state.orionDocumentId ? 'Preparar' : 'Gestionar'}
        </UnstyledButton>
      ) : null}

      {d.canEditDocument && d.api && !d.canManageAttachment ? (
        <UnstyledButton
          onClick={() => d.api!.actions.openDocumentEditor(d.meta)}
          style={{ fontSize: 13, color: 'var(--mantine-color-blue-6)', fontWeight: 600 }}
        >
          Editar expediente
        </UnstyledButton>
      ) : null}

      {d.canSignNow ? (
        <Button
          size='compact-xs'
          color='teal'
          variant='light'
          leftSection={<IconSignature size={12} />}
          loading={Boolean(d.api?.acceptLoading)}
          onClick={runSign}
        >
          {d.needsSignaturePad ? 'Mi firma' : 'Tu turno'}
        </Button>
      ) : d.turnExpired && d.isMyTurn ? (
        <Button
          size='compact-xs'
          color='orange'
          variant='light'
          loading={extensionLoading}
          onClick={() => void doRequestExtension()}
        >
          Solicitar firmar
        </Button>
      ) : d.currentUserCompleted ? (
        <Text size='xs' c='teal' fw={600}>
          Firmado por usted
        </Text>
      ) : d.isWaiting ? (
        <Text size='xs' c='dimmed'>
          Aún no se puede firmar
        </Text>
      ) : d.state.signedFileUrl ? (
        <UnstyledButton
          onClick={() => d.api?.actions.openSignedDocument(props.fileId)}
          style={{ fontSize: 13, color: 'var(--mantine-color-teal-7)', fontWeight: 600 }}
        >
          Ver firmado
        </UnstyledButton>
      ) : null}
    </Stack>
  );
}

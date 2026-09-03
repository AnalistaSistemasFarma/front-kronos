'use client';

import { Badge, Button, Stack, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconClock, IconSignature } from '@tabler/icons-react';
import { useMemo } from 'react';
import { resolveOrionDocumentForAttachment } from '../../lib/orion/formValue';
import { resolveOrionPermissions } from '../../lib/orion/permissions';
import { getCurrentPendingSigner, isSignerCompleted } from '../../lib/orion/signerStatus';
import type { OrionSignatureState } from '../../lib/orion/types';
import { useOrionSignatureApi } from './OrionSignatureContext';

type Props = {
  fileId: string;
  fileName: string;
  pdfUrl: string;
  currentUserEmail?: string | null;
  fallbackState?: OrionSignatureState | null;
  allDocuments?: Record<string, OrionSignatureState> | null;
  /** Forzar UI de firmante (proceso FIRMA / auth / deep-link). */
  forceSignerUi?: boolean;
};

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function statusBadgeColor(status?: string | null): string {
  switch (String(status || '').toUpperCase()) {
    case 'FIRMADO':
      return 'green';
    case 'RECHAZADO':
      return 'red';
    case 'EN_PROCESO':
    case 'PENDIENTE_FIRMA':
      return 'blue';
    default:
      return 'gray';
  }
}

/**
 * Una sola columna de acciones Orion por PDF en adjuntos.
 */
export default function OrionAttachmentSignActions({
  fileId,
  fileName,
  pdfUrl,
  currentUserEmail,
  fallbackState = null,
  allDocuments = null,
  forceSignerUi = false,
}: Props) {
  const api = useOrionSignatureApi();

  const state = useMemo(() => {
    const fromApi = api?.documents ?? null;
    const merged: Record<string, OrionSignatureState> = {
      ...(allDocuments ?? {}),
      ...(fromApi ?? {}),
    };
    if (fallbackState && (fallbackState.orionDocumentId || (fallbackState.signers?.length ?? 0) > 0)) {
      merged[fileId] = { ...fallbackState, ...(merged[fileId] ?? {}), fileId };
    }
    return resolveOrionDocumentForAttachment({
      fileId,
      fileName,
      documents: merged,
      fallback: fallbackState,
    });
  }, [allDocuments, api?.documents, fallbackState, fileId, fileName]);

  if (!/\.pdf$/i.test(fileName) || !fileId) {
    return null;
  }

  const effectivePdfUrl = pdfUrl || `#orion-file-${fileId}`;
  const hasOrionDoc = Boolean(
    state.orionDocumentId || state.status || (state.signers?.length ?? 0) > 0
  );
  if (!api?.enabled && !hasOrionDoc && !forceSignerUi) {
    return null;
  }

  const permissions = resolveOrionPermissions({
    canManage: api?.canManage ?? false,
    isAdmin: api?.isAdmin ?? false,
    currentUserEmail: currentUserEmail ?? undefined,
    state,
    hasAttachment: true,
    hasPersonalSignature: api?.hasSignature ?? false,
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
  const statusUpper = String(state.status || '').toUpperCase();
  const isTerminal = statusUpper === 'FIRMADO' || statusUpper === 'RECHAZADO';
  const inSigningPhase =
    (!isTerminal && forceSignerUi) ||
    statusUpper === 'EN_PROCESO' ||
    statusUpper === 'PENDIENTE_FIRMA' ||
    Boolean(state.orionDocumentId && (state.signers?.length ?? 0) > 0 && !isTerminal) ||
    Boolean(api?.pendingAuthorizationByFile?.[fileId]);

  const meta = { fileId, fileName, pdfUrl: effectivePdfUrl };
  const listedAsSigner = Boolean(mySigner) || isMyTurn || permissions.userRole === 'signer';

  const canSignNow =
    !currentUserCompleted &&
    !isTerminal &&
    inSigningPhase &&
    (forceSignerUi ||
      isMyTurn ||
      permissions.userRole === 'signer' ||
      (listedAsSigner && Boolean(state.orionDocumentId)));

  const isWaiting =
    !currentUserCompleted &&
    !isTerminal &&
    !forceSignerUi &&
    inSigningPhase &&
    Boolean(mySigner) &&
    !isMyTurn &&
    permissions.userRole !== 'signer';

  const apiReady = Boolean(api?.enabled);
  const needsSignaturePad = apiReady ? !api!.hasSignature : false;

  const runSign = () => {
    if (api?.enabled) {
      if (!api.hasSignature) {
        api.actions.openConfigureSignature();
        return;
      }
      api.actions.openSignFlow(meta);
      return;
    }
    // Fallback si el panel aún no registró el context
    window.dispatchEvent(
      new CustomEvent('orion-open-sign', {
        detail: meta,
      })
    );
  };

  // Ya firmó el usuario: un solo badge
  if (currentUserCompleted) {
    return (
      <Tooltip label='Ya registró su firma en este documento'>
        <Badge size='xs' color='green' variant='light' leftSection={<IconCheck size={10} />}>
          Firmado
        </Badge>
      </Tooltip>
    );
  }

  // Documento cerrado: un solo estado (+ ver firmado si hay URL)
  if (isTerminal) {
    return (
      <Stack gap={4} align='center'>
        <Badge size='xs' color={statusBadgeColor(state.status)} variant='light'>
          {state.status || 'FIRMADO'}
        </Badge>
        {state.signedFileUrl ? (
          <Button
            size='compact-xs'
            variant='light'
            color='green'
            onClick={() => api?.actions.openSignedDocument(fileId)}
          >
            Ver firmado
          </Button>
        ) : null}
      </Stack>
    );
  }

  return (
    <Stack gap={4} align='center'>
      <Badge size='xs' color={statusBadgeColor(state.status)} variant='light'>
        {state.status ||
          (state.orionDocumentId || forceSignerUi ? 'EN_PROCESO' : 'SIN INICIAR')}
      </Badge>

      {canSignNow ? (
        <Button
          size='compact-xs'
          color={needsSignaturePad ? 'orange' : 'green'}
          leftSection={<IconSignature size={12} />}
          loading={Boolean(api?.acceptLoading)}
          onClick={runSign}
        >
          {!apiReady ? 'Firmar' : needsSignaturePad ? 'Mi firma' : 'Firmar'}
        </Button>
      ) : isWaiting ? (
        <Stack gap={2} align='center'>
          <IconClock size={14} color='var(--mantine-color-gray-5)' />
          <Text size='10px' c='dimmed' ta='center' maw={72} lh={1.2}>
            En espera de turno
          </Text>
        </Stack>
      ) : permissions.userRole === 'coordinator' && apiReady && api ? (
        !state.orionDocumentId ? (
          <Button
            size='compact-xs'
            variant='light'
            onClick={() => api.actions.openDocumentEditor(meta)}
          >
            Preparar
          </Button>
        ) : permissions.canEditAssignments ? (
          <Button
            size='compact-xs'
            variant='light'
            color='blue'
            onClick={() => api.actions.openDocumentEditor(meta)}
          >
            Gestionar
          </Button>
        ) : (
          <Badge size='xs' color='gray' variant='light'>
            En firma
          </Badge>
        )
      ) : forceSignerUi || hasOrionDoc ? (
        <Badge size='xs' color='blue' variant='light'>
          EN_PROCESO
        </Badge>
      ) : null}
    </Stack>
  );
}

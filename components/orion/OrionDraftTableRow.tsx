'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Group, Modal, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconDownload,
  IconFile,
  IconFileText,
  IconFileTypePdf,
  IconLayoutBoard,
  IconTrash,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import type { OrionDraftState } from '../../lib/orion/types';
import {
  ORION_DRAFT_STATUS_COLOR,
  ORION_DRAFT_STATUS_LABEL,
  activeClientReviewers,
  draftCorrectionRequests,
  pendingDraftValidators,
  type DraftPermissions,
} from '../../lib/orion/draftState';

type DraftInfo = {
  draft: OrionDraftState | null;
  permissions: DraftPermissions | null;
  canStart: boolean;
  isElaborator: boolean;
  currentUserEmail: string;
};

type Props = {
  rowNumber?: number | string;
  requestId: number;
  fileId: string;
  fileName: string;
  fileSizeLabel?: string;
  processName?: string | null;
  requesterName?: string | null;
  /** Descarga directa del adjunto (antes de iniciar la preparación). */
  openUrl?: string | null;
  canDeleteAttachment?: boolean;
  onDeleteAttachment?: (fileId: string, fileName?: string | null) => void | Promise<void>;
  /** Botón para borrar adjuntos de prueba (solo testing/local; lo arma la página). */
  testDeleteSlot?: ReactNode;
  /** Llegó desde Autorizaciones a validar este documento: abre el tablero. */
  autoOpenReview?: boolean;
  /** Tras convertir a PDF: la página recarga los adjuntos para mostrar el PDF debajo del Word. */
  onConverted?: () => void | Promise<void>;
};

const API = '/api/integrations/orion/draft';

const DRAFT_STAGES = ['Elaboración', 'Validación', 'Cliente', 'Firma'] as const;

/** Las 4 etapas del Word antes de firmar; la actual en azul, las cumplidas en verde. */
function DraftStageTrack({ stage }: { stage: number }) {
  const done = stage >= DRAFT_STAGES.length;
  return (
    <Stack gap={3}>
      <Group gap={3} wrap='nowrap' aria-hidden>
        {DRAFT_STAGES.map((label, i) => (
          <Tooltip key={label} label={`${i + 1}. ${label}`} withArrow>
            <div
              style={{
                width: 26,
                height: 5,
                borderRadius: 3,
                background:
                  i < stage
                    ? 'var(--mantine-color-teal-6)'
                    : i === stage
                      ? 'var(--mantine-color-blue-6)'
                      : 'var(--mantine-color-default-border)',
              }}
            />
          </Tooltip>
        ))}
      </Group>
      <Text size='10px' c='dimmed'>
        {done ? 'Listo: pasó a firma' : `Etapa ${stage + 1} de ${DRAFT_STAGES.length} · ${DRAFT_STAGES[stage]}`}
      </Text>
    </Stack>
  );
}

/** Acción de la columna Acciones, con el mismo aspecto que en las filas de PDF. */
function RowAction({
  icon,
  label,
  href,
  onClick,
  danger,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  href?: string | null;
  onClick?: () => void;
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
    color: danger ? 'var(--mantine-color-red-7)' : 'var(--mantine-color-text)',
    background: danger ? 'var(--mantine-color-red-light)' : 'transparent',
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'default' : 'pointer',
    textAlign: 'left' as const,
  };
  if (href && !disabled) {
    return (
      <UnstyledButton component='a' href={href} style={style}>
        {icon}
        {label}
      </UnstyledButton>
    );
  }
  return (
    <UnstyledButton onClick={disabled ? undefined : onClick} disabled={disabled} style={style}>
      {icon}
      {label}
    </UnstyledButton>
  );
}

/**
 * Fila de un .docx en preparación (docs/orion-borrador-word-diseno.md). Todo el trabajo se hace
 * en el tablero del documento; aquí solo se ve el estado y se entra al tablero.
 */
export default function OrionDraftTableRow({
  rowNumber,
  requestId,
  fileId,
  fileName,
  fileSizeLabel,
  processName,
  requesterName,
  openUrl,
  canDeleteAttachment = false,
  onDeleteAttachment,
  testDeleteSlot,
  autoOpenReview = false,
  onConverted,
}: Props) {
  const [info, setInfo] = useState<DraftInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const router = useRouter();
  const autoOpenHandled = useRef(false);

  const boardUrl = `/process/request-general/draft-board?${new URLSearchParams({
    requestId: String(requestId),
    fileId,
  }).toString()}`;

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ requestId: String(requestId), fileId });
      const res = await fetch(`${API}?${qs.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setLoadError(data?.error || 'No se pudo cargar el estado del documento');
        return;
      }
      setLoadError(null);
      setInfo(data as DraftInfo);
    } catch {
      setLoadError('No se pudo cargar el estado del documento');
    }
  }, [requestId, fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Desde Autorizaciones ("Validar documento"): el validador va directo al tablero, solo si
  // todavía le toca. Se quita el aviso del enlace para que "Volver" no lo mande otra vez.
  useEffect(() => {
    if (!autoOpenReview || autoOpenHandled.current || !info) return;
    autoOpenHandled.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('orionAction');
      url.searchParams.delete('orionFileId');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      /* sin cambio de URL: igual se abre una sola vez */
    }
    if (info.permissions?.canDecideInternal) router.push(boardUrl);
  }, [autoOpenReview, info, router, boardUrl]);

  /** Preparar en Word y entrar directo al tablero (un solo clic). */
  const start = async () => {
    setStarting(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', requestId, fileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo iniciar la preparación', { duration: 8000 });
        return;
      }
      setInfo(data as DraftInfo);
      toast.success('Documento en preparación (v0.1).');
      router.push(boardUrl);
    } catch {
      toast.error('No se pudo iniciar la preparación');
    } finally {
      setStarting(false);
    }
  };

  /** Validado (o aprobado por el cliente) → PDF v1.0, que aparece debajo de esta fila. */
  const convert = async () => {
    setConverting(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert-pdf', requestId, fileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo convertir a PDF', { duration: 10000 });
        return;
      }
      setConvertOpen(false);
      toast.success('PDF creado debajo del Word. Siguiente: enviarlo a la validación del PDF.');
      await load();
      await onConverted?.();
    } catch {
      toast.error('No se pudo convertir a PDF');
    } finally {
      setConverting(false);
    }
  };

  const draft = info?.draft ?? null;
  const perms = info?.permissions ?? null;
  const canViewBoard = Boolean(perms?.canViewBoard);
  const isElaborator = Boolean(info?.isElaborator);
  const status = draft?.status ?? null;
  const review = draft?.internalReview ?? null;
  const clientReview = draft?.clientReview ?? null;
  const pendingValidators = pendingDraftValidators(draft);
  const corrections = draftCorrectionRequests(draft);
  const approvedCount = review?.approvals.filter((a) => a.decision === 'APROBADO').length ?? 0;
  const clientAccepted = clientReview?.reviewers.filter((r) => r.decision === 'ACEPTADO').length ?? 0;
  const clientRejection = clientReview?.reviewers.find((r) => r.decision === 'RECHAZADO') ?? null;
  const me = info?.currentUserEmail ?? '';
  const iApproved = Boolean(review?.approvals.some((a) => a.email === me && a.decision === 'APROBADO'));
  const iAskedCorrection = corrections.some((a) => a.email === me);
  const correctionNames = corrections.map((a) => a.name || a.email).join(', ');
  const reviewedBefore = Boolean(review);
  const returned = status === 'DEVUELTO_INTERNO' || status === 'RECHAZADO_CLIENTE';

  const stage = !draft
    ? 0
    : status === 'EN_VALIDACION_INTERNA'
      ? 1
      : status === 'VALIDADO_INTERNO' || status === 'EN_REVISION_CLIENTE'
        ? 2
        : status === 'APROBADO_CLIENTE'
          ? 3
          : status === 'CONVERTIDO_PDF'
            ? 4
            : 0;

  const responsible =
    pendingValidators.length > 0
      ? pendingValidators.map((a) => a.name || a.email).join(', ')
      : corrections.length > 0
        ? `${requesterName || 'Preparadora'} (corrección)`
      : status === 'EN_REVISION_CLIENTE'
        ? activeClientReviewers(clientReview)
            .map((r) => r.name || r.email)
            .join(', ') || 'Cliente'
        : requesterName || '—';

  const progressLabel =
    status === 'EN_VALIDACION_INTERNA' && review
      ? `${approvedCount}/${review.approvals.length}`
      : status === 'EN_REVISION_CLIENTE' && clientReview
        ? `${clientAccepted}/${clientReview.reviewers.length}`
        : '—';

  // Qué ve cada persona: una línea con lo que pasa y, si le toca, en azul.
  const hint: { text: string; strong?: boolean } | null = (() => {
    if (!draft) {
      return info?.canStart ? { text: 'Es un Word. Si debe revisarse antes de firmar, prepárelo en Word.' } : null;
    }
    switch (draft.status) {
      case 'EN_ELABORACION':
        if (!isElaborator) return { text: reviewedBefore ? 'La preparadora lo está corrigiendo.' : 'La preparadora lo está elaborando.' };
        return reviewedBefore
          ? { text: 'Corríjalo en el tablero y reenvíelo a validación.', strong: true }
          : { text: 'Trabájelo en el tablero y envíelo a validación.', strong: true };
      case 'DEVUELTO_INTERNO':
      case 'RECHAZADO_CLIENTE':
        return isElaborator
          ? { text: 'Corríjalo en el tablero y reenvíelo a validación.', strong: true }
          : { text: 'Devuelto a la preparadora para corregir.' };
      case 'EN_VALIDACION_INTERNA':
        if (perms?.canDecideInternal) return { text: 'Le toca revisarlo: marque, comente y apruebe en el tablero.', strong: true };
        if (iAskedCorrection) return { text: 'Pidió corrección. Le llegará un aviso cuando envíen la versión corregida.' };
        if (iApproved) return { text: `Ya aprobó. Faltan ${review!.approvals.length - approvedCount} de ${review!.approvals.length}.` };
        if (isElaborator && corrections.length > 0) {
          return pendingValidators.length > 0
            ? { text: `${correctionNames} ${corrections.length === 1 ? 'pidió' : 'pidieron'} corrección. Espere a que respondan todos.` }
            : {
                text: `Le toca corregir: suba la versión corregida, marque lo corregido y envíela a los validadores (en el tablero).`,
                strong: true,
              };
        }
        if (isElaborator) return { text: `En validación (${approvedCount} de ${review?.approvals.length ?? 0}). Responda las marcas en el tablero.` };
        return { text: `En validación: aprobaron ${approvedCount} de ${review?.approvals.length ?? 0}.` };
      case 'VALIDADO_INTERNO':
        return isElaborator
          ? { text: 'Validado. Envíelo al cliente o conviértalo a PDF.', strong: true }
          : { text: 'Validado internamente.' };
      case 'EN_REVISION_CLIENTE':
        return { text: `Esperando al cliente: aceptaron ${clientAccepted} de ${clientReview?.reviewers.length ?? 0}.` };
      case 'APROBADO_CLIENTE':
        return isElaborator
          ? { text: 'El cliente lo aprobó. Conviértalo a PDF.', strong: true }
          : { text: 'Aprobado por el cliente. Falta convertirlo a PDF.' };
      case 'CONVERTIDO_PDF':
        return { text: 'Sigue en el PDF, aquí debajo (ya validado en el Word).' };
      default:
        return null;
    }
  })();

  const notice: { color: string; text: ReactNode } | null =
    status === 'DEVUELTO_INTERNO' && review?.returnReason
      ? { color: 'orange', text: <><b>Devuelto por {review.returnedBy}:</b> {review.returnReason}</> }
      : status === 'RECHAZADO_CLIENTE' && clientRejection
        ? {
            color: 'red',
            text: (
              <>
                <b>El cliente rechazó ({clientRejection.name || clientRejection.email}):</b>{' '}
                {clientRejection.comment || 'sin descripción'}
              </>
            ),
          }
        : null;

  const boardLabel = perms?.canDecideInternal
    ? 'Revisar en el tablero'
    : isElaborator && (returned || corrections.length > 0 || (status === 'EN_ELABORACION' && reviewedBefore))
      ? 'Corregir en el tablero'
      : 'Abrir tablero';

  return (
    <Table.Tr className={status === 'CONVERTIDO_PDF' ? 'doc-row doc-row--closed' : 'doc-row'}>
      <Table.Td data-label='N.º' className='doc-cell doc-cell--mono doc-col--secondary' style={{ width: 56, whiteSpace: 'nowrap' }}>
        <Text size='sm' c='dimmed'>
          {rowNumber ?? '—'}
        </Text>
      </Table.Td>

      <Table.Td data-label='Documento' className='doc-cell doc-cell--file' style={{ minWidth: 140, maxWidth: 280 }}>
        <Group gap={6} wrap='nowrap' align='flex-start'>
          <IconFileText size={16} color='var(--mantine-color-blue-6)' style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text size='sm' fw={700} lineClamp={2}>
              {fileName}
            </Text>
            <Text size='xs' c='dimmed' mt={2}>
              {[draft ? `Word ${draft.versionLabel}` : null, fileSizeLabel].filter(Boolean).join(' · ')}
            </Text>
          </div>
        </Group>
      </Table.Td>

      <Table.Td data-label='Departamento' className='doc-cell doc-col--secondary' style={{ minWidth: 120, maxWidth: 180 }}>
        <Text size='sm' c='dimmed' lineClamp={2}>
          {processName || '—'}
        </Text>
      </Table.Td>

      <Table.Td data-label='Estado' className='doc-cell'>
        {!info && !loadError ? (
          <Text size='xs' c='dimmed'>
            Cargando…
          </Text>
        ) : draft ? (
          <Stack gap={6}>
            <Badge
              variant='outline'
              color={ORION_DRAFT_STATUS_COLOR[draft.status]}
              size='sm'
              radius='xl'
              styles={{ label: { textTransform: 'none', fontWeight: 600 } }}
            >
              {ORION_DRAFT_STATUS_LABEL[draft.status]}
            </Badge>
            <DraftStageTrack stage={stage} />
          </Stack>
        ) : (
          <Badge variant='light' color='gray' size='sm' radius='xl' styles={{ label: { textTransform: 'none', fontWeight: 600 } }}>
            Word sin preparar
          </Badge>
        )}
      </Table.Td>

      <Table.Td data-label='Firmantes' className='doc-cell doc-col--secondary'>
        <Tooltip
          label={status === 'EN_REVISION_CLIENTE' ? 'Aprobadores del cliente que aceptaron' : 'Validadores que ya aprobaron'}
          disabled={progressLabel === '—'}
        >
          <Text size='sm' c='dimmed'>
            {progressLabel}
          </Text>
        </Tooltip>
      </Table.Td>

      <Table.Td data-label='Responsable' className='doc-cell doc-col--secondary' style={{ maxWidth: 160 }}>
        <Text size='sm' c='dimmed' lineClamp={1}>
          {responsible}
        </Text>
      </Table.Td>

      <Table.Td data-label='Acciones' className='doc-cell doc-cell--actions' style={{ minWidth: 190, verticalAlign: 'top' }}>
        <div className={status === 'CONVERTIDO_PDF' ? 'doc-dossier doc-dossier--closed' : 'doc-dossier'}>
          <div className='doc-dossier__rail' />
          <Stack gap={4} className='doc-dossier__body'>
            {loadError ? (
              <Text size='xs' c='red'>
                {loadError}
              </Text>
            ) : null}
            {notice ? (
              <Alert color={notice.color} variant='light' p={6} radius='sm'>
                <Text size='xs'>{notice.text}</Text>
              </Alert>
            ) : null}
            {hint ? (
              <Text size='xs' c={hint.strong ? 'blue' : 'dimmed'} fw={hint.strong ? 600 : 400}>
                {hint.text}
              </Text>
            ) : null}

            {info?.canStart ? (
              <Button
                size='compact-sm'
                leftSection={<IconFileText size={14} />}
                loading={starting}
                onClick={() => void start()}
                fullWidth
              >
                Preparar en Word
              </Button>
            ) : null}
            {/* El tablero solo lo ven la preparadora y los validadores de este documento. */}
            {draft && canViewBoard ? (
              <Button
                size='compact-sm'
                variant={hint?.strong ? 'filled' : 'light'}
                leftSection={<IconLayoutBoard size={14} />}
                component={Link}
                href={boardUrl}
                fullWidth
              >
                {boardLabel}
              </Button>
            ) : null}

            {perms?.canConvertPdf ? (
              <Button
                size='compact-sm'
                color='teal'
                leftSection={<IconFileTypePdf size={14} />}
                onClick={() => setConvertOpen(true)}
                fullWidth
              >
                Convertir a PDF
              </Button>
            ) : null}
            {/* Solo la preparadora descarga el Word; los validadores lo revisan en el tablero. */}
            {draft && info?.isElaborator ? (
              <RowAction
                icon={<IconDownload size={15} stroke={1.6} />}
                label={`Descargar Word ${draft.versionLabel}`}
                href={`${API}/file?${new URLSearchParams({ requestId: String(requestId), fileId }).toString()}`}
              />
            ) : !draft && openUrl ? (
              <RowAction icon={<IconFile size={15} stroke={1.6} />} label='Abrir / descargar' href={openUrl} />
            ) : null}
            {!draft && canDeleteAttachment && onDeleteAttachment ? (
              <RowAction
                icon={<IconTrash size={15} stroke={1.6} />}
                label='Eliminar'
                danger
                onClick={() => void onDeleteAttachment(fileId, fileName)}
              />
            ) : null}
            {testDeleteSlot}
          </Stack>
        </div>
        <Modal
          opened={convertOpen}
          onClose={() => (converting ? undefined : setConvertOpen(false))}
          title='Convertir a PDF'
          centered
        >
          <Stack gap='sm'>
            <Text size='sm'>
              Se creará el PDF <b>v1.0</b> de {draft?.fileName ?? fileName}. Aparecerá debajo de este Word y el Word
              queda cerrado. El PDF pasa por su propia validación y luego se ubican las firmas.
            </Text>
            <Text size='xs' c='dimmed'>
              Si el Word tiene comentarios o cambios sin aceptar, no se podrá convertir: quítelos en Word primero.
            </Text>
            <Group justify='flex-end'>
              <Button variant='default' disabled={converting} onClick={() => setConvertOpen(false)}>
                Cancelar
              </Button>
              <Button color='teal' leftSection={<IconFileTypePdf size={14} />} loading={converting} onClick={() => void convert()}>
                Convertir
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Table.Td>
    </Table.Tr>
  );
}

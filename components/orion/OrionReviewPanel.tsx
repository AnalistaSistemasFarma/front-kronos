'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconCheck,
  IconClock,
  IconExternalLink,
  IconEye,
  IconFileUpload,
  IconGavel,
  IconSend,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import type { OrionReviewState, OrionSignatureState } from '../../lib/orion/types';
import {
  ORION_REVIEW_STATUS_LABEL,
  knownReadyForSigning,
  previousReviewValidatorIds,
} from '../../lib/orion/reviewState';
import { resolveOrionVersionLabel } from '../../lib/orion/versionLabel';
import ValidatorOrderPicker, { type ValidatorOption } from './ValidatorOrderPicker';

type ReviewInfo = {
  hasValidators: boolean;
  /** Personas validadoras habilitadas en el flujo (sin orden). */
  validators: ValidatorOption[];
  review: OrionReviewState | null;
  versionLabel: string;
  canSubmit: boolean;
  canDecide: boolean;
  canUploadCorrection: boolean;
  readyForSigning: boolean;
};

type Props = {
  requestId: number;
  fileId: string;
  fileName?: string | null;
  state: OrionSignatureState;
  onDocumentsUpdate?: (documents: Record<string, OrionSignatureState>) => void;
  /** Con validadores, "Preparar documento" solo tras la aprobación final. */
  onReadyForSigningChange?: (ready: boolean) => void;
  /** PDF vigente para revisar dentro del modal de validación. */
  previewUrl?: string | null;
  /** Abre el modal de validación al cargar (llegada desde Autorizaciones). */
  autoOpenDecision?: boolean;
};

const STATUS_COLOR: Record<OrionReviewState['status'], string> = {
  SIN_VALIDACION: 'gray',
  EN_VALIDACION: 'blue',
  DEVUELTO_CORRECCION: 'orange',
  APROBADO: 'teal',
};

// Comparte la petición en curso entre montajes repetidos (StrictMode, re-render del padre).
const reviewInfoInFlight = new Map<string, Promise<ReviewInfo | null>>();

function fetchReviewInfo(requestId: number, fileId: string, key: string): Promise<ReviewInfo | null> {
  const cacheKey = `${requestId}|${fileId}|${key}`;
  const existing = reviewInfoInFlight.get(cacheKey);
  if (existing) return existing;
  const qs = new URLSearchParams({ requestId: String(requestId), fileId });
  const promise = fetch(`/api/integrations/orion/review?${qs.toString()}`, { cache: 'no-store' })
    .then(async (res) => {
      const data = await res.json().catch(() => null);
      return res.ok && data ? (data as ReviewInfo) : null;
    })
    .catch(() => null)
    .finally(() => {
      reviewInfoInFlight.delete(cacheKey);
    });
  reviewInfoInFlight.set(cacheKey, promise);
  return promise;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]+,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export default function OrionReviewPanel({
  requestId,
  fileId,
  fileName,
  state,
  onDocumentsUpdate,
  onReadyForSigningChange,
  previewUrl = null,
  autoOpenDecision = false,
}: Props) {
  const [info, setInfo] = useState<ReviewInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [decideOpen, setDecideOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const autoOpenHandled = useRef(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadReason, setUploadReason] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [validatorIds, setValidatorIds] = useState<string[]>([]);

  const reviewKey = `${state.review?.status ?? ''}|${state.review?.round ?? ''}|${state.versionLabel ?? ''}|${state.status ?? ''}|${
    state.review?.approvals.filter((a) => a.decision !== 'PENDIENTE').length ?? 0
  }`;

  const load = useCallback(
    async (key: string) => {
      const data = await fetchReviewInfo(requestId, fileId, key);
      if (data) setInfo(data);
    },
    [requestId, fileId]
  );

  useEffect(() => {
    void load(reviewKey);
  }, [load, reviewKey]);

  const knownReady = knownReadyForSigning(state);
  useEffect(() => {
    // El estado del documento manda si la validación ya empezó; si no, decide el flujo (API).
    const ready = knownReady ?? (info ? info.readyForSigning : null);
    if (ready !== null) onReadyForSigningChange?.(ready);
  }, [knownReady, info, onReadyForSigningChange]);

  useEffect(() => {
    if (!autoOpenDecision || !info || autoOpenHandled.current) return;
    autoOpenHandled.current = true;
    if (info.canDecide) {
      setReturning(false);
      setDecideOpen(true);
    } else {
      toast('Este documento no está pendiente de su validación.', { icon: 'ℹ️' });
    }
  }, [autoOpenDecision, info]);

  const openDecide = () => {
    setReturning(false);
    setDecideOpen(true);
  };

  const clearReviewDeepLink = () => {
    if (!autoOpenDecision || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('orionAction') !== 'review') return;
    url.searchParams.delete('orionAction');
    url.searchParams.delete('orionFileId');
    window.history.replaceState(window.history.state, '', url.toString());
  };

  const closeDecide = () => {
    if (busy) return;
    setDecideOpen(false);
    setReturning(false);
  };

  const post = async (action: string, extra: Record<string, unknown>, okMessage: string) => {
    setBusy(action);
    try {
      const res = await fetch('/api/integrations/orion/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, requestId, fileId, fileName, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo completar la acción');
        return false;
      }
      if (data.documents) onDocumentsUpdate?.(data.documents);
      toast.success(okMessage);
      // Oculta de inmediato la acción ya usada; la recarga trae los permisos nuevos.
      setInfo((prev) => (prev ? { ...prev, canDecide: false, canSubmit: false } : prev));
      // Con `documents` el cambio de reviewKey ya dispara la recarga.
      if (!data.documents) await load(`${reviewKey}|${Date.now()}`);
      return true;
    } finally {
      setBusy(null);
    }
  };

  /** Flujo sin validadores devuelto por un firmante: subversión directa en Orion. */
  const uploadSignerCorrection = async (pdfBase64: string, reason: string) => {
    const res = await fetch('/api/integrations/orion/ensure-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        fileId,
        fileName,
        pdfBase64,
        newVersion: true,
        versionReason: reason || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || 'No se pudo crear la subversión');
      return false;
    }
    if (data.documents) onDocumentsUpdate?.(data.documents);
    toast.success('Nueva subversión creada. Revise firmantes y envíe de nuevo a firma.');
    if (!data.documents) await load(`${reviewKey}|${Date.now()}`);
    return true;
  };

  /** Orden por defecto: el de la ronda anterior del documento (solo validadores aún habilitados). */
  const defaultValidatorIds = (): string[] => {
    const pool = info?.validators ?? [];
    const allowed = new Set(pool.map((v) => v.userId));
    const previous = previousReviewValidatorIds(info?.review).filter((id) => allowed.has(id));
    if (previous.length > 0) return previous;
    return pool.length === 1 ? [pool[0].userId] : [];
  };

  const openSubmit = () => {
    setValidatorIds(defaultValidatorIds());
    setSubmitOpen(true);
  };

  const openUpload = () => {
    setValidatorIds(defaultValidatorIds());
    setUploadOpen(true);
  };

  const submitCorrection = async () => {
    if (!uploadFile) {
      toast.error('Seleccione el PDF corregido');
      return;
    }
    if (info?.hasValidators && validatorIds.length === 0) {
      toast.error('Elija al menos un validador para este documento');
      return;
    }
    setBusy('resubmit');
    try {
      const pdfBase64 = await fileToBase64(uploadFile);
      const ok = info?.hasValidators
        ? await post(
            'resubmit',
            { pdfBase64, reason: uploadReason.trim() || null, validatorIds },
            'Versión corregida enviada a validación'
          )
        : await uploadSignerCorrection(pdfBase64, uploadReason.trim());
      if (ok) {
        setUploadOpen(false);
        setUploadFile(null);
        setUploadReason('');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo leer el PDF');
    } finally {
      setBusy(null);
    }
  };

  // Sin esperar la API: si la validación ya empezó, el estado del documento basta para mostrarla.
  const view: ReviewInfo | null =
    info ??
    (knownReady !== null
      ? {
          hasValidators: true,
          validators: [],
          review: state.review ?? null,
          versionLabel: resolveOrionVersionLabel(state.versionLabel),
          canSubmit: false,
          canDecide: false,
          canUploadCorrection: false,
          readyForSigning: knownReady,
        }
      : null);
  if (!view) return null;
  if (!view.hasValidators && !view.canUploadCorrection) return null;

  const review = state.review ?? view.review;
  const status = review?.status ?? 'SIN_VALIDACION';
  const approvals = [...(review?.approvals ?? [])].sort((a, b) => a.order - b.order);

  return (
    <>
      <Stack gap={4} mb={4}>
        {view.hasValidators ? (
          <Group gap={6} wrap='nowrap'>
            <ThemeIcon size={18} radius='xl' variant='light' color='violet'>
              <IconGavel size={11} />
            </ThemeIcon>
            <Badge
              size='sm'
              radius='xl'
              variant='light'
              color={STATUS_COLOR[status]}
              styles={{ label: { textTransform: 'none', fontWeight: 600 } }}
            >
              {ORION_REVIEW_STATUS_LABEL[status]}
            </Badge>
            <Badge size='xs' variant='outline' color='gray'>
              {view.versionLabel}
            </Badge>
            {review?.source === 'word' ? (
              <Tooltip label='Una sola validación: la hicieron en el Word. El PDF no se vuelve a validar.' withArrow>
                <Badge size='xs' variant='light' color='teal' styles={{ label: { textTransform: 'none' } }}>
                  Validado en el Word{review.sourceVersionLabel ? ` ${review.sourceVersionLabel}` : ''}
                </Badge>
              </Tooltip>
            ) : null}
          </Group>
        ) : null}

        {approvals.length > 0 ? (
          <Stack gap={2}>
            {approvals.map((a) => (
              <Tooltip
                key={`${a.order}-${a.email}`}
                label={a.comment || a.email}
                multiline
                maw={260}
                withArrow
              >
                <Group gap={6} wrap='nowrap'>
                  <ThemeIcon
                    size={16}
                    radius='xl'
                    color={
                      a.decision === 'APROBADO' ? 'teal' : a.decision === 'DEVUELTO' ? 'orange' : 'gray'
                    }
                    variant={a.decision === 'PENDIENTE' ? 'light' : 'filled'}
                  >
                    {a.decision === 'APROBADO' ? (
                      <IconCheck size={10} stroke={3} />
                    ) : a.decision === 'DEVUELTO' ? (
                      <IconArrowBackUp size={10} />
                    ) : (
                      <IconClock size={10} />
                    )}
                  </ThemeIcon>
                  <Text size='xs' lineClamp={1}>
                    {a.order}. {a.name || a.email}
                  </Text>
                </Group>
              </Tooltip>
            ))}
          </Stack>
        ) : null}

        {status === 'DEVUELTO_CORRECCION' && review?.returnReason ? (
          <Text size='xs' c='orange'>
            Motivo: {review.returnReason}
          </Text>
        ) : null}

        {view.canSubmit ? (
          <Button
            size='compact-xs'
            variant='light'
            color='violet'
            leftSection={<IconSend size={12} />}
            onClick={openSubmit}
            fullWidth
          >
            Enviar a validación
          </Button>
        ) : null}

        {view.canDecide ? (
          <Button
            size='compact-xs'
            color='teal'
            leftSection={<IconEye size={12} />}
            disabled={Boolean(busy)}
            onClick={() => openDecide()}
            fullWidth
          >
            Revisar y validar
          </Button>
        ) : null}

        {view.canUploadCorrection ? (
          <Button
            size='compact-xs'
            variant='light'
            color='orange'
            leftSection={<IconFileUpload size={12} />}
            onClick={openUpload}
            fullWidth
          >
            Subir versión corregida
          </Button>
        ) : null}
      </Stack>

      <Modal
        opened={submitOpen}
        onClose={() => setSubmitOpen(false)}
        centered
        radius='lg'
        size='lg'
        title={<Text fw={800}>Enviar a validación</Text>}
      >
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            Primero validan los validadores, en el orden que defina aquí; cuando apruebe el último
            se habilita la firma y podrá asignar los firmantes. Este orden aplica solo a{' '}
            <b>{fileName || 'este documento'}</b>.
          </Text>
          <ValidatorOrderPicker
            options={view.validators}
            value={validatorIds}
            onChange={setValidatorIds}
            disabled={busy === 'submit'}
          />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setSubmitOpen(false)}>
              Cancelar
            </Button>
            <Button
              color='violet'
              leftSection={<IconSend size={14} />}
              loading={busy === 'submit'}
              disabled={validatorIds.length === 0}
              onClick={async () => {
                const ok = await post('submit', { validatorIds }, 'Documento enviado a validación');
                if (ok) setSubmitOpen(false);
              }}
            >
              Enviar a {validatorIds.length || ''} validador{validatorIds.length === 1 ? '' : 'es'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={decideOpen}
        onClose={closeDecide}
        centered
        radius='lg'
        size='xl'
        closeOnClickOutside={!busy}
        title={
          <Group gap={8} wrap='nowrap'>
            <ThemeIcon size={26} radius='xl' variant='light' color='violet'>
              <IconGavel size={15} />
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text fw={800}>Validar documento</Text>
              <Text size='xs' c='dimmed' lineClamp={1}>
                {fileName || 'Documento'} · {view.versionLabel}
              </Text>
            </div>
          </Group>
        }
      >
        <Stack gap='sm'>
          {approvals.length > 0 ? (
            <Group gap={6}>
              {approvals.map((a) => (
                <Badge
                  key={`decide-${a.order}-${a.email}`}
                  size='sm'
                  radius='xl'
                  variant={a.decision === 'PENDIENTE' ? 'outline' : 'light'}
                  color={
                    a.decision === 'APROBADO' ? 'teal' : a.decision === 'DEVUELTO' ? 'orange' : 'gray'
                  }
                  leftSection={
                    a.decision === 'APROBADO' ? <IconCheck size={10} stroke={3} /> : <IconClock size={10} />
                  }
                  styles={{ label: { textTransform: 'none', fontWeight: 600 } }}
                >
                  {a.order}. {a.name || a.email}
                </Badge>
              ))}
            </Group>
          ) : null}

          {previewUrl ? (
            <div
              style={{
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <Group justify='flex-end' px='xs' py={4}>
                <Button
                  size='compact-xs'
                  variant='subtle'
                  leftSection={<IconExternalLink size={12} />}
                  component='a'
                  href={previewUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  Abrir en otra pestaña
                </Button>
              </Group>
              <iframe
                title={`Documento a validar: ${fileName || 'PDF'}`}
                src={previewUrl}
                style={{
                  display: 'block',
                  width: '100%',
                  height: returning ? '45vh' : '62vh',
                  border: 0,
                  borderTop: '1px solid var(--mantine-color-default-border)',
                }}
              />
            </div>
          ) : (
            <Alert color='gray' variant='light'>
              No se pudo cargar la vista previa. Use el ícono de ver en línea del documento.
            </Alert>
          )}

          {returning ? (
            <Stack gap='xs'>
              <Text size='sm' c='dimmed'>
                El preparador deberá subir una versión corregida y la validación empezará de nuevo
                desde el primer validador.
              </Text>
              <Textarea
                label='Motivo de la devolución'
                placeholder='Describa qué se debe corregir'
                minRows={3}
                autosize
                data-autofocus
                value={returnComment}
                onChange={(e) => setReturnComment(e.currentTarget.value)}
              />
              <Group justify='flex-end'>
                <Button variant='default' disabled={Boolean(busy)} onClick={() => setReturning(false)}>
                  Volver
                </Button>
                <Button
                  color='orange'
                  leftSection={<IconArrowBackUp size={14} />}
                  loading={busy === 'return'}
                  disabled={returnComment.trim().length < 3 || Boolean(busy)}
                  onClick={async () => {
                    const ok = await post(
                      'return',
                      { comment: returnComment.trim() },
                      'Documento devuelto para corrección'
                    );
                    if (ok) {
                      setDecideOpen(false);
                      setReturning(false);
                      setReturnComment('');
                      clearReviewDeepLink();
                    }
                  }}
                >
                  Confirmar devolución
                </Button>
              </Group>
            </Stack>
          ) : (
            <Group justify='space-between'>
              <Button variant='default' disabled={Boolean(busy)} onClick={closeDecide}>
                Cerrar
              </Button>
              <Group gap='xs'>
                <Button
                  color='orange'
                  variant='light'
                  leftSection={<IconArrowBackUp size={14} />}
                  disabled={Boolean(busy)}
                  onClick={() => setReturning(true)}
                >
                  Devolver
                </Button>
                <Button
                  color='teal'
                  leftSection={<IconCheck size={14} />}
                  loading={busy === 'approve'}
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    const ok = await post('approve', {}, 'Documento validado');
                    if (ok) {
                      setDecideOpen(false);
                      clearReviewDeepLink();
                    }
                  }}
                >
                  Validar
                </Button>
              </Group>
            </Group>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={uploadOpen}
        onClose={() => setUploadOpen(false)}
        centered
        radius='lg'
        title={<Text fw={800}>Subir versión corregida</Text>}
      >
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            Se creará la subversión siguiente a {view.versionLabel}. La versión anterior queda en la
            hoja de vida.
          </Text>
          <FileInput
            label='PDF corregido'
            placeholder='Seleccionar PDF'
            accept='application/pdf'
            value={uploadFile}
            onChange={setUploadFile}
            clearable
          />
          <Textarea
            label='Cambios realizados (opcional)'
            minRows={2}
            autosize
            value={uploadReason}
            onChange={(e) => setUploadReason(e.currentTarget.value)}
          />
          {view.hasValidators ? (
            <ValidatorOrderPicker
              options={view.validators}
              value={validatorIds}
              onChange={setValidatorIds}
              disabled={busy === 'resubmit'}
            />
          ) : null}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setUploadOpen(false)}>
              Cancelar
            </Button>
            <Button
              color='orange'
              loading={busy === 'resubmit'}
              disabled={!uploadFile || (view.hasValidators && validatorIds.length === 0)}
              onClick={() => void submitCorrection()}
            >
              {view.hasValidators ? 'Enviar a validación' : 'Crear subversión'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

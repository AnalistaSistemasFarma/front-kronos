'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Anchor,
  Breadcrumbs,
  Avatar,
  Badge,
  Button,
  Checkbox,
  FileInput,
  Grid,
  Group,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconChevronRight,
  IconCheck,
  IconCopy,
  IconDownload,
  IconFileTypePdf,
  IconMail,
  IconRefresh,
  IconSend,
  IconTrash,
  IconUpload,
  IconUsers,
} from '@tabler/icons-react';
import toast from 'react-hot-toast';
import type { OrionDraftClientReviewer, OrionDraftState } from '../../../lib/orion/types';
import type { DraftMark, DraftPresence } from '../../../lib/orion/draftBoardDb';
import type { DraftClientReviewerInput, DraftPermissions } from '../../../lib/orion/draftState';
import {
  ORION_DRAFT_STATUS_COLOR,
  ORION_DRAFT_STATUS_LABEL,
  activeClientReviewers,
  draftCorrectionRequests,
} from '../../../lib/orion/draftState';
import { alignBlocks, countChangeRuns, diffText, type DraftBlock } from '../../../lib/orion/draftDiff';
import DraftBoardDocument, { type DraftSelection } from './DraftBoardDocument';
import DraftBoardMarks, { blockLabel, type DraftComposer } from './DraftBoardMarks';
import DraftBoardSheet from './DraftBoardSheet';
import { fetchPdfArrayBuffer } from '../pdfFetchCache';
import { PartnerSearch } from '../OrionSignerAssignment';
import ValidatorOrderPicker, { type ValidatorOption } from '../ValidatorOrderPicker';

type BoardData = {
  draft: OrionDraftState;
  permissions: DraftPermissions;
  isElaborator: boolean;
  currentUserEmail: string;
  marks: DraftMark[];
  presence: DraftPresence[];
  /** Validadores habilitados en el flujo (solo llega para la preparadora). */
  validators: ValidatorOption[];
  /** Empresa de la solicitud (buscar aprobadores del cliente en SAP). */
  companyId: number | null;
};

const API = '/api/integrations/orion/draft';
const PRESENCE_MS = 15000;

const CLIENT_DECISION: Record<OrionDraftClientReviewer['decision'], { label: string; color: string }> = {
  PENDIENTE: { label: 'Pendiente', color: 'gray' },
  ACEPTADO: { label: 'Aceptó', color: 'teal' },
  RECHAZADO: { label: 'Rechazó', color: 'red' },
  ANULADO: { label: 'Anulado', color: 'gray' },
};

/** Subversión que descargó cada quien (para avisar si otra persona subió una después). */
function downloadedKey(requestId: number, fileId: string): string {
  return `kronos.draft.downloaded.${requestId}.${fileId}`;
}

function readDownloadedVersion(requestId: number, fileId: string): string | null {
  try {
    return window.localStorage.getItem(downloadedKey(requestId, fileId));
  } catch {
    return null;
  }
}

function rememberDownloadedVersion(requestId: number, fileId: string, label: string): void {
  try {
    window.localStorage.setItem(downloadedKey(requestId, fileId), label);
  } catch {
    /* sin almacenamiento: el servidor igual valida la subversión base */
  }
}

function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function countVersionChanges(before: DraftBlock[], after: DraftBlock[]): number {
  return alignBlocks(before, after).reduce((sum, row) => {
    if (row.type === 'eq') return sum;
    if (row.type === 'mod') return sum + countChangeRuns(diffText(before[row.oldIndex].text, after[row.newIndex].text));
    return sum + 1;
  }, 0);
}

/**
 * Tablero del documento Word (docs/orion-borrador-word-diseno.md): subversiones con control de
 * cambios, marcas en tiempo real, detección automática de correcciones y aprobación.
 */
export default function DraftBoard({ requestId, fileId }: { requestId: number; fileId: string }) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [mode, setMode] = useState<'changes' | 'clean'>('changes');
  /** Hoja = la página real del Word (lienzo); texto = párrafos con control de cambios en línea. */
  const [surface, setSurface] = useState<'sheet' | 'text'>('sheet');
  const [blocksById, setBlocksById] = useState<Record<string, DraftBlock[]>>({});
  const [activeMarkId, setActiveMarkId] = useState<number | null>(null);
  const [composer, setComposer] = useState<DraftComposer | null>(null);
  const [busy, setBusy] = useState(false);
  const [presence, setPresence] = useState<DraftPresence[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadNote, setUploadNote] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [validatorsOpen, setValidatorsOpen] = useState<'edit' | 'submit' | null>(null);
  const [validatorIds, setValidatorIds] = useState<string[]>([]);
  /** Subversión sobre la que trabajó quien sube (la que descargó, o la vigente al abrir el modal). */
  const [uploadBase, setUploadBase] = useState<string | null>(null);
  /** Pedidos de corrección que la subversión que se sube deja resueltos ("Corregido"). */
  const [resolvedEmails, setResolvedEmails] = useState<string[]>([]);
  const [sendClientOpen, setSendClientOpen] = useState(false);
  const [clientReviewers, setClientReviewers] = useState<DraftClientReviewerInput[]>([]);
  const [clientMode, setClientMode] = useState<'sequential' | 'parallel'>('sequential');
  const [convertOpen, setConvertOpen] = useState(false);
  const loadingBlocks = useRef(new Set<string>());
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const qs = useMemo(() => new URLSearchParams({ requestId: String(requestId), fileId }).toString(), [requestId, fileId]);
  const router = useRouter();
  const requestUrl = `/process/request-general/view-request?id=${requestId}`;

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(`${API}/board?${qs}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setLoadError(data?.error || 'No se pudo abrir el tablero del documento.');
        return;
      }
      setLoadError(null);
      setBoard(data as BoardData);
      setPresence((data as BoardData).presence ?? []);
    } catch {
      setLoadError('No se pudo abrir el tablero del documento.');
    }
  }, [qs]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void loadBoard(), 300);
  }, [loadBoard]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const versions = useMemo(() => (board?.draft.versions ?? []).filter((v) => v.kind !== 'pdf'), [board]);
  const latest = versions.at(-1) ?? null;
  const viewIndex = Math.max(0, versions.findIndex((v) => v.id === (viewId ?? latest?.id)));
  const view = versions[viewIndex] ?? null;
  const previous = viewIndex > 0 ? versions[viewIndex - 1] : null;
  const isLatestView = Boolean(view && latest && view.id === latest.id);

  // La hoja de la subversión vigente se pide ya, en paralelo con los párrafos (antes esperaba a que llegaran).
  const latestId = latest?.id ?? null;
  useEffect(() => {
    if (!latestId) return;
    void fetchPdfArrayBuffer(`${API}/pdf?${qs}&versionId=${encodeURIComponent(latestId)}`).catch(() => undefined);
  }, [latestId, qs]);

  // Párrafos de todas las subversiones (son pocas y no cambian; el navegador las guarda).
  useEffect(() => {
    for (const v of versions) {
      if (blocksById[v.id] || loadingBlocks.current.has(v.id)) continue;
      loadingBlocks.current.add(v.id);
      void fetch(`${API}/blocks?${qs}&versionId=${encodeURIComponent(v.id)}`)
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (res.ok && Array.isArray(data?.blocks)) setBlocksById((prev) => ({ ...prev, [v.id]: data.blocks }));
          else toast.error(data?.error || `No se pudo leer la ${v.label}`);
        })
        .finally(() => loadingBlocks.current.delete(v.id));
    }
  }, [versions, blocksById, qs]);

  // Tiempo real y presencia solo cuando el tablero abrió bien (si no, cada intento daría 404/403).
  const boardReady = board !== null;

  // Tiempo real: cualquier cambio de otra persona recarga el tablero.
  useEffect(() => {
    if (!boardReady) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API}/stream?${qs}`);
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as { type: string; presence?: DraftPresence[]; payload?: { versionLabel?: string; detected?: number[] } };
          if (data.type === 'presence') setPresence(data.presence ?? []);
          else if (data.type === 'version_added') {
            toast.success(
              `Nueva subversión ${data.payload?.versionLabel ?? ''}${
                data.payload?.detected?.length ? ` · corrigió las marcas ${data.payload.detected.join(', ')}` : ''
              }`
            );
            setViewId(null);
            scheduleReload();
          } else if (data.type !== 'connected') scheduleReload();
        } catch {
          /* mensaje inválido */
        }
      };
    } catch {
      /* sin EventSource: el usuario recarga a mano */
    }
    return () => es?.close();
  }, [qs, scheduleReload, boardReady]);

  // Presencia (y "está escribiendo" mientras hay una marca en edición).
  const typingBlock = composer?.blockIndex ?? null;
  useEffect(() => {
    if (!boardReady) return;
    let stopped = false;
    let t: ReturnType<typeof setInterval> | null = null;
    const ping = () =>
      void fetch(`${API}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, typingBlock }),
      })
        .then(async (r) => {
          // Sin acceso o el documento dejó de estar en preparación: no insistir.
          if (r.status === 401 || r.status === 403 || r.status === 404) {
            stopped = true;
            if (t) clearInterval(t);
            return;
          }
          const d = await r.json().catch(() => null);
          if (Array.isArray(d?.presence)) setPresence(d.presence);
        })
        .catch(() => undefined);
    ping();
    t = setInterval(() => {
      if (!stopped) ping();
    }, PRESENCE_MS);
    return () => {
      if (t) clearInterval(t);
    };
  }, [requestId, fileId, typingBlock, boardReady]);

  const me = board?.currentUserEmail ?? '';
  const typing = useMemo(() => {
    const map: Record<number, string> = {};
    for (const p of presence) {
      if (p.email !== me && p.typingBlock != null) map[p.typingBlock] = p.name || p.email;
    }
    return map;
  }, [presence, me]);

  const focusMark = useCallback(
    (id: number, opts?: { jumpToFix?: boolean }) => {
      setActiveMarkId(id);
      const mark = board?.marks.find((m) => m.id === id);
      if (opts?.jumpToFix && mark?.fixedIn) {
        const target = versions.find((v) => v.label === mark.fixedIn);
        if (target) {
          setViewId(target.id);
          setMode('changes');
        }
      }
      window.setTimeout(() => {
        document.querySelector(`[data-mark="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
    },
    [board, versions]
  );

  const postMarks = async (body: Record<string, unknown>, okMessage?: string) => {
    setBusy(true);
    try {
      const res = await fetch(`${API}/marks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo guardar');
        return false;
      }
      setBoard(data as BoardData);
      if (okMessage) toast.success(okMessage);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const callDraft = async (
    action: string,
    okMessage: string | null,
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo completar la acción', { duration: 8000 });
        return null;
      }
      if (okMessage) toast.success(okMessage);
      await loadBoard();
      return data as Record<string, unknown>;
    } catch {
      toast.error('No se pudo completar la acción');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const postDraft = async (action: string, okMessage: string, extra: Record<string, unknown> = {}) =>
    (await callDraft(action, okMessage, extra)) !== null;

  const reviewerInvite = async (email: string, inviteAction: 'url' | 'send' | 'regenerate') => {
    const data = await callDraft(
      'client-invite',
      inviteAction === 'send'
        ? 'Correo enviado al aprobador.'
        : inviteAction === 'regenerate'
          ? 'Enlace renovado (vigente 1 día).'
          : null,
      { email, inviteAction }
    );
    const url = typeof data?.reviewUrl === 'string' ? data.reviewUrl : null;
    if (inviteAction === 'url' && url) {
      try {
        await navigator.clipboard.writeText(url);
        toast.success('URL copiada');
      } catch {
        window.prompt('Copie la URL de revisión:', url);
      }
    }
  };

  const openSendClient = () => {
    // Tras un rechazo se reenvía a los mismos aprobadores (con el documento nuevo).
    const previous = board?.draft.clientReview;
    setClientReviewers((previous?.reviewers ?? []).map((r) => ({ email: r.email, name: r.name, cardCode: r.cardCode })));
    setClientMode(previous?.mode ?? 'sequential');
    setSendClientOpen(true);
  };

  const moveReviewer = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= clientReviewers.length) return;
    const next = [...clientReviewers];
    [next[index], next[target]] = [next[target], next[index]];
    setClientReviewers(next);
  };

  const openUpload = () => {
    setUploadBase(readDownloadedVersion(requestId, fileId) ?? board?.draft.versionLabel ?? null);
    // Por defecto la subversión resuelve todos los pedidos de corrección; se puede desmarcar alguno.
    setResolvedEmails(draftCorrectionRequests(board?.draft).map((a) => a.email.toLowerCase()));
    setUploadOpen(true);
  };

  /** Modal único de validadores: editar durante la validación o enviar / reenviar a validación. */
  const openValidators = (purpose: 'edit' | 'submit') => {
    const current = [...(board?.draft.internalReview?.approvals ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((a) => String(a.userId || ''))
      .filter((id) => (board?.validators ?? []).some((v) => v.userId === id));
    setValidatorIds(current);
    setValidatorsOpen(purpose);
  };

  const doUpload = async () => {
    if (!uploadFile) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('requestId', String(requestId));
      form.set('fileId', fileId);
      form.set('file', uploadFile);
      if (uploadNote.trim()) form.set('note', uploadNote.trim());
      if (uploadBase) form.set('baseVersion', uploadBase);
      if (board?.draft.status === 'EN_VALIDACION_INTERNA') form.set('resolvedEmails', JSON.stringify(resolvedEmails));
      const res = await fetch(`${API}/upload`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo subir la subversión', { duration: 10000 });
        return;
      }
      // Su archivo ya es la subversión vigente: la próxima subida parte de ella.
      if (data.draft?.versionLabel) rememberDownloadedVersion(requestId, fileId, data.draft.versionLabel);
      setUploadOpen(false);
      setUploadFile(null);
      setUploadNote('');
      setViewId(null);
      setMode('changes');
      toast.success(`Subversión ${data.draft?.versionLabel ?? ''} subida. Kronos revisó qué marcas quedaron corregidas.`);
      await loadBoard();
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Stack p='md' maw={640} mx='auto'>
        <Alert color='red' title='No se pudo abrir el tablero'>
          {loadError}
        </Alert>
        <Anchor component={Link} href={`/process/request-general/view-request?id=${requestId}`}>
          Volver a la solicitud
        </Anchor>
      </Stack>
    );
  }
  if (!board || !view) {
    return (
      <Group justify='center' p='xl'>
        <Loader size='sm' />
        <Text c='dimmed'>Abriendo el tablero…</Text>
      </Group>
    );
  }

  const { draft, permissions, marks, isElaborator } = board;
  const blocks = blocksById[view.id] ?? null;
  const previousBlocks = mode === 'changes' && previous ? blocksById[previous.id] ?? null : null;
  const approvals = [...(draft.internalReview?.approvals ?? [])].sort((a, b) => a.order - b.order);
  const myPendingMarks = marks.filter((m) => m.authorEmail.toLowerCase() === me && m.status !== 'confirmada');
  const openMarks = marks.filter((m) => m.status !== 'confirmada').length;
  const canSelect = permissions.canMark && isLatestView;
  const clientReview = draft.clientReview ?? null;
  const activeReviewerEmails = new Set(activeClientReviewers(clientReview).map((r) => r.email));
  const clientAccepted = clientReview?.reviewers.filter((r) => r.decision === 'ACEPTADO').length ?? 0;
  const returned = draft.status === 'DEVUELTO_INTERNO' || draft.status === 'RECHAZADO_CLIENTE';
  const corrections = draftCorrectionRequests(draft);
  const myApproval = approvals.find((a) => a.email.toLowerCase() === me) ?? null;
  const commentsUrl = `${API}/file?${qs}&withComments=1`;
  const downloadUrl = `${API}/file?${qs}`;
  /** Qué sigue para la preparadora: un texto y, si aplica, el botón para hacerlo aquí mismo. */
  const nextStep: { text: string; action?: { label: string; icon: ReactNode; color?: string; onClick: () => void } } | null =
    !isElaborator
      ? permissions.canDecideInternal
        ? {
            text: `Le toca revisar la ${draft.versionLabel}: seleccione texto en la hoja para subrayarlo y dejar su comentario. Cuando termine, apruebe o pida corrección en "Validadores".`,
          }
        : null
      : permissions.canSubmitInternal
        ? {
            text: returned
              ? 'Corrija el Word (abajo) y reenvíelo a validación.'
              : draft.internalReview
                ? 'Cuando termine la corrección, reenvíelo a validación.'
                : 'Cuando el Word esté listo, envíelo a validación. Los validadores lo revisan aquí, al mismo tiempo.',
            action: {
              label: draft.internalReview ? 'Reenviar a validación' : 'Enviar a validación',
              icon: <IconSend size={14} />,
              onClick: () => openValidators('submit'),
            },
          }
        : draft.status === 'EN_VALIDACION_INTERNA'
          ? corrections.length > 0
            ? {
                text: `${corrections.map((a) => a.name || a.email).join(', ')} ${
                  corrections.length === 1 ? 'pidió' : 'pidieron'
                } corrección. Corrija el Word y súbalo abajo: al subir marque qué pedidos quedaron corregidos y todos vuelven a revisar.`,
              }
            : { text: 'Los validadores están revisando. Responda sus marcas y suba subversiones abajo; ellos aprueban cada una.' }
          : permissions.canSendClient
            ? {
                text: `Todos aprobaron la ${draft.versionLabel}. Siguiente paso: enviar el borrador al cliente.`,
                action: {
                  label: clientReview ? 'Reenviar al cliente' : 'Enviar al cliente',
                  icon: <IconSend size={14} />,
                  onClick: openSendClient,
                },
              }
            : draft.status === 'EN_REVISION_CLIENTE'
              ? { text: 'Esperando al cliente. Envíe o renueve los enlaces en "Aprobadores del cliente".' }
              : permissions.canConvertPdf
                ? {
                    text: 'El cliente lo aprobó. Si el Word tiene comentarios o cambios sin aceptar, suba la versión limpia; luego conviértalo a PDF.',
                    action: {
                      label: 'Convertir a PDF para firmar',
                      icon: <IconFileTypePdf size={14} />,
                      color: 'teal',
                      onClick: () => setConvertOpen(true),
                    },
                  }
                : draft.status === 'CONVERTIDO_PDF'
                  ? { text: 'Ya pasó a firma: siga en la fila del PDF en la solicitud.' }
                  : null;

  return (
    <Stack gap='sm' p={{ base: 'xs', sm: 'md' }}>
      <Paper withBorder radius='md' p='sm'>
        <Breadcrumbs separator={<IconChevronRight size={14} />} mb='xs' fz='sm'>
          <Anchor component={Link} href='/process'>
            Procesos
          </Anchor>
          <Anchor component={Link} href='/process/request-general/create-request'>
            Solicitudes Generales
          </Anchor>
          <Anchor component={Link} href={requestUrl}>
            Solicitud #{requestId}
          </Anchor>
          <Text span fz='sm' c='dimmed'>
            Tablero del documento
          </Text>
        </Breadcrumbs>
        <Group justify='space-between' wrap='wrap' gap='sm'>
          <Button
            variant='outline'
            size='xs'
            leftSection={<IconArrowLeft size={14} />}
            onClick={() => {
              // Vuelve a la pantalla de origen (solicitud o actividad); si se abrió el enlace directo, a la solicitud.
              if (window.history.length > 1) router.back();
              else router.push(requestUrl);
            }}
          >
            Volver
          </Button>
          <Stack gap={2} style={{ minWidth: 0, flex: '1 1 280px' }}>
            <Title order={4} style={{ overflowWrap: 'anywhere' }}>
              {draft.fileName}
            </Title>
          </Stack>
          <Badge size='lg' variant='light' color={ORION_DRAFT_STATUS_COLOR[draft.status]}>
            {ORION_DRAFT_STATUS_LABEL[draft.status]} · {draft.versionLabel}
          </Badge>
          <Button
            size='xs'
            variant='default'
            leftSection={<IconDownload size={14} />}
            component='a'
            href={downloadUrl}
            onClick={() => rememberDownloadedVersion(requestId, fileId, draft.versionLabel)}
          >
            Descargar Word {draft.versionLabel}
          </Button>
          <Tooltip.Group>
            <Avatar.Group>
              {presence.map((p) => (
                <Tooltip key={p.email} label={`${p.name || p.email} · conectado`}>
                  <Avatar radius='xl' color='initials' name={p.name || p.email}>
                    {initials(p.name || p.email)}
                  </Avatar>
                </Tooltip>
              ))}
            </Avatar.Group>
          </Tooltip.Group>
        </Group>
      </Paper>

      {draft.status === 'VALIDADO_INTERNO' && !isElaborator ? (
        <Alert color='teal' variant='light' icon={<IconCheck size={16} />}>
          Validado internamente: todos aprobaron la {draft.versionLabel}. La preparadora lo enviará al cliente.
        </Alert>
      ) : null}
      {returned || (draft.status === 'EN_ELABORACION' && draft.internalReview) ? (
        <Alert
          color={draft.status === 'RECHAZADO_CLIENTE' ? 'red' : 'orange'}
          variant='light'
          icon={<IconArrowBackUp size={16} />}
          title={
            draft.status === 'DEVUELTO_INTERNO'
              ? 'Devuelto para corrección'
              : draft.status === 'RECHAZADO_CLIENTE'
                ? 'El cliente rechazó el borrador'
                : 'En corrección'
          }
        >
          <Stack gap={6}>
            {draft.status === 'RECHAZADO_CLIENTE' ? (
              (draft.clientReview?.reviewers ?? [])
                .filter((r) => r.decision === 'RECHAZADO')
                .map((r) => (
                  <Text key={r.email} size='sm'>
                    <b>{r.name || r.email}:</b> {r.comment || 'sin descripción'}
                  </Text>
                ))
            ) : draft.internalReview?.returnReason ? (
              <Text size='sm'>
                <b>{draft.internalReview.returnedBy}:</b> {draft.internalReview.returnReason}
              </Text>
            ) : null}
            {isElaborator ? (
              <Text size='sm'>
                Corrija en el panel <b>Corrección del Word</b> (descargar con comentarios y subir) y luego reenvíelo a
                validación.
              </Text>
            ) : (
              <Text size='sm'>La preparadora lo está corrigiendo. Recibirá una tarea cuando lo reenvíe a validación.</Text>
            )}
          </Stack>
        </Alert>
      ) : null}

      <Grid gutter='sm' align='flex-start'>
        <Grid.Col span={{ base: 12, md: 3, xl: 2 }}>
          <Paper withBorder radius='md' p='xs'>
            <Text size='xs' fw={700} c='dimmed' tt='uppercase' px={6} py={4} style={{ letterSpacing: 1 }}>
              Subversiones
            </Text>
            <Stack gap={2}>
              {versions.map((v, i) => {
                const current = v.id === view.id;
                const before = i > 0 ? blocksById[versions[i - 1].id] : null;
                const after = blocksById[v.id];
                const changes = before && after ? countVersionChanges(before, after) : null;
                const created = marks.filter((m) => m.createdVersion === v.label).map((m) => m.number);
                const resolved = marks.filter((m) => m.fixedIn === v.label).map((m) => m.number);
                return (
                  <UnstyledButton
                    key={v.id}
                    onClick={() => {
                      setViewId(v.id);
                      setComposer(null);
                    }}
                    aria-current={current}
                    p={8}
                    style={{
                      borderRadius: 8,
                      background: current ? 'var(--mantine-color-blue-light)' : undefined,
                    }}
                  >
                    <Group gap={6} wrap='nowrap'>
                      <Text ff='monospace' fw={700} size='sm'>
                        {v.label}
                      </Text>
                      <Text size='xs' c='dimmed' lineClamp={1}>
                        {formatDate(v.createdAt)}
                      </Text>
                    </Group>
                    <Text size='xs'>{v.uploadedByName || v.uploadedByEmail}</Text>
                    {v.note ? (
                      <Text size='xs' c='dimmed' lineClamp={2}>
                        {v.note}
                      </Text>
                    ) : null}
                    <Group gap={4} mt={4}>
                      {i === 0 ? (
                        <Badge size='xs' variant='default'>
                          inicial
                        </Badge>
                      ) : changes != null ? (
                        <Badge size='xs' variant='default'>
                          {changes} cambio{changes === 1 ? '' : 's'}
                        </Badge>
                      ) : null}
                      {created.length ? (
                        <Badge size='xs' variant='light'>
                          marcas {created.join(' · ')}
                        </Badge>
                      ) : null}
                      {resolved.length ? (
                        <Badge size='xs' variant='light' color='teal'>
                          resolvió {resolved.join(' · ')}
                        </Badge>
                      ) : null}
                      {v.id === latest?.id ? (
                        <Badge size='xs' variant='light' color='blue'>
                          vigente
                        </Badge>
                      ) : null}
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 9, xl: 7 }}>
          <Paper withBorder radius='md'>
            <Group gap='sm' p='sm' wrap='wrap' style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <SegmentedControl
                size='xs'
                value={surface}
                onChange={(v) => setSurface(v as 'sheet' | 'text')}
                data={[
                  { value: 'sheet', label: 'Hoja de Word' },
                  { value: 'text', label: 'Texto con cambios' },
                ]}
              />
              <SegmentedControl
                size='xs'
                value={mode}
                onChange={(v) => setMode(v as 'changes' | 'clean')}
                data={[
                  { value: 'changes', label: 'Con cambios' },
                  { value: 'clean', label: 'Limpio' },
                ]}
              />
              <Text size='xs' c='dimmed'>
                {mode === 'changes' && previous ? `Comparando ${previous.label} → ${view.label}` : `Viendo ${view.label} sin marcas de cambio`}
              </Text>
              <Button
                size='xs'
                variant='subtle'
                leftSection={<IconFileTypePdf size={14} />}
                component='a'
                href={`${API}/pdf?${qs}&versionId=${encodeURIComponent(view.id)}`}
                target='_blank'
                rel='noopener noreferrer'
              >
                Abrir PDF
              </Button>
              {Object.keys(typing).length > 0 ? (
                <Text size='xs' fw={600} c='cyan.7'>
                  {Object.entries(typing)
                    .map(([b, who]) => `${who} está escribiendo en ${blockLabel(blocksById[latest?.id ?? '']?.[Number(b)], Number(b))}…`)
                    .join(' · ')}
                </Text>
              ) : null}
              <Group gap={10} ml='auto' wrap='wrap'>
                <Text size='xs' c='green.7' td='underline'>
                  agregado
                </Text>
                <Text size='xs' c='red.7' td={surface === 'text' ? 'line-through' : undefined}>
                  {surface === 'text' ? 'quitado' : '▌ quitado (pase el mouse)'}
                </Text>
                <Text size='xs' px={4} bg='var(--mantine-color-yellow-light)'>
                  por corregir
                </Text>
                <Text size='xs' px={4} bg='var(--mantine-color-teal-light)'>
                  corregido
                </Text>
              </Group>
            </Group>
            <div style={{ padding: 16, background: 'var(--mantine-color-default-hover)' }}>
              <div style={{ maxHeight: '72vh', overflowY: 'auto', overflowX: 'hidden', padding: '4px 4px 8px' }}>
                {blocks && surface === 'sheet' ? (
                  <DraftBoardSheet
                    pdfUrl={`${API}/pdf?${qs}&versionId=${encodeURIComponent(view.id)}`}
                    versionLabel={view.label}
                    blocks={blocks}
                    previousBlocks={previousBlocks}
                    marks={marks}
                    activeMarkId={activeMarkId}
                    onMarkClick={(id) => focusMark(id)}
                    onSelect={
                      canSelect
                        ? (sel: DraftSelection) =>
                            setComposer({ ...sel, type: 'correccion', suggest: '', why: '' })
                        : null
                    }
                  />
                ) : blocks ? (
                  <DraftBoardDocument
                    blocks={blocks}
                    previousBlocks={previousBlocks}
                    versionLabel={view.label}
                    marks={marks}
                    activeMarkId={activeMarkId}
                    onMarkClick={(id) => focusMark(id)}
                    onSelect={
                      canSelect
                        ? (sel: DraftSelection) =>
                            setComposer({ ...sel, type: 'correccion', suggest: '', why: '' })
                        : null
                    }
                    typing={typing}
                  />
                ) : (
                  <Group justify='center' p='xl'>
                    <Loader size='sm' />
                    <Text size='sm' c='dimmed'>
                      Leyendo la {view.label}…
                    </Text>
                  </Group>
                )}
              </div>
              <Text size='xs' c='dimmed' ta='center' mt='sm'>
                {canSelect
                  ? 'Seleccione texto de un párrafo para marcar una corrección, sugerencia o pregunta.'
                  : !isLatestView
                    ? `Está viendo una subversión anterior. Las marcas nuevas se hacen sobre la ${latest?.label}.`
                    : permissions.canMark
                      ? ''
                      : 'Las marcas se hacen mientras el documento está en validación interna.'}
              </Text>
            </div>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, xl: 3 }}>
          <Stack gap='sm'>
            {nextStep ? (
              <Paper withBorder radius='md' p='sm' style={{ borderColor: 'var(--mantine-color-blue-filled)' }}>
                <Text size='xs' fw={700} c='blue' tt='uppercase' mb={6} style={{ letterSpacing: 1 }}>
                  Siguiente paso
                </Text>
                <Text size='sm' mb={nextStep.action ? 8 : 0}>
                  {nextStep.text}
                </Text>
                {nextStep.action ? (
                  <Button
                    fullWidth
                    color={nextStep.action.color ?? 'blue'}
                    leftSection={nextStep.action.icon}
                    disabled={busy}
                    onClick={nextStep.action.onClick}
                  >
                    {nextStep.action.label}
                  </Button>
                ) : null}
                {draft.status === 'CONVERTIDO_PDF' ? (
                  <Button fullWidth variant='light' component={Link} href={requestUrl}>
                    Ir a la solicitud
                  </Button>
                ) : null}
              </Paper>
            ) : null}

            <Paper withBorder radius='md' p='sm'>
              <Text size='xs' fw={700} c='dimmed' tt='uppercase' mb={8} style={{ letterSpacing: 1 }}>
                Correcciones · {marks.filter((m) => m.status !== 'confirmada').length} por cerrar
              </Text>
              <DraftBoardMarks
                marks={marks}
                blocks={blocksById[latest?.id ?? ''] ?? blocks ?? []}
                currentUserEmail={me}
                isElaborator={isElaborator}
                activeMarkId={activeMarkId}
                composer={composer}
                busy={busy}
                onComposerChange={setComposer}
                onCreate={async (c) => {
                  const ok = await postMarks(
                    { action: 'create', type: c.type, quote: c.quote, suggest: c.suggest, why: c.why, blockIndex: c.blockIndex },
                    'Marca creada. Los demás la ven al instante.'
                  );
                  if (ok) setComposer(null);
                }}
                onAction={(action, markId) =>
                  void postMarks(
                    { action, markId },
                    action === 'confirm' ? 'Corrección confirmada.' : action === 'reopen' ? 'Marca reabierta.' : 'Marcada como resuelta.'
                  )
                }
                onReply={(markId, text) => void postMarks({ action: 'reply', markId, text })}
                onFocus={focusMark}
              />
            </Paper>

            {approvals.length > 0 ? (
              <Paper withBorder radius='md' p='sm'>
                <Group justify='space-between' mb={8} wrap='nowrap'>
                  <Text size='xs' fw={700} c='dimmed' tt='uppercase' style={{ letterSpacing: 1 }}>
                    Validadores
                  </Text>
                  {isElaborator && draft.status === 'EN_VALIDACION_INTERNA' ? (
                    <Button
                      size='compact-xs'
                      variant='subtle'
                      leftSection={<IconUsers size={12} />}
                      onClick={() => openValidators('edit')}
                      disabled={busy}
                    >
                      Editar validadores
                    </Button>
                  ) : null}
                </Group>
                <Stack gap={6}>
                  {approvals.map((a) => {
                    const pending = marks.filter(
                      (m) => m.authorEmail.toLowerCase() === a.email.toLowerCase() && m.status !== 'confirmada'
                    ).length;
                    // Cada validador tiene su propio estado; pedir corrección no detiene a los demás.
                    const badge =
                      a.decision === 'APROBADO'
                        ? { color: 'teal', label: `Aprobó ${a.approvedVersion ?? draft.versionLabel}` }
                        : a.decision === 'DEVUELTO'
                          ? { color: 'red', label: `Pidió corrección · ${a.correctionVersion ?? draft.versionLabel}` }
                          : a.correctedIn && a.correctedIn === draft.versionLabel
                            ? { color: 'orange', label: `Corregido en ${a.correctedIn} · revisar` }
                            : a.approvedVersion
                              ? { color: 'orange', label: `Aprobó ${a.approvedVersion} · revisar ${draft.versionLabel}` }
                              : pending
                                ? { color: 'gray', label: `${pending} por cerrar` }
                                : { color: 'blue', label: 'Revisando' };
                    const showRequest = a.comment && (a.decision === 'DEVUELTO' || (a.correctedIn && a.correctedIn === draft.versionLabel));
                    return (
                      <Stack key={a.email} gap={2}>
                        <Group gap={8} wrap='nowrap'>
                          <Avatar size={24} radius='xl' color='initials' name={a.name || a.email}>
                            {initials(a.name || a.email)}
                          </Avatar>
                          <Text size='sm' style={{ flex: 1, minWidth: 0 }} lineClamp={1}>
                            {a.name || a.email}
                          </Text>
                          <Badge size='sm' variant='light' color={badge.color}>
                            {badge.label}
                          </Badge>
                        </Group>
                        {showRequest ? (
                          <Text size='xs' c={a.decision === 'DEVUELTO' ? 'red.7' : 'dimmed'} pl={32}>
                            {a.decision === 'DEVUELTO' ? 'Pide: ' : 'Había pedido: '}
                            {a.comment}
                          </Text>
                        ) : null}
                      </Stack>
                    );
                  })}
                  {permissions.canDecideInternal || approvals.some((a) => a.email.toLowerCase() === me) ? (
                    <Stack gap={4} mt={4}>
                      <Group gap={6} grow>
                        <Button
                          color='teal'
                          leftSection={<IconCheck size={14} />}
                          disabled={!permissions.canDecideInternal || myPendingMarks.length > 0 || busy}
                          onClick={() =>
                            void postDraft('approve', `Aprobó la ${draft.versionLabel}.`, { baseVersion: draft.versionLabel })
                          }
                        >
                          Aprobar {draft.versionLabel}
                        </Button>
                        <Button
                          color='orange'
                          variant='light'
                          leftSection={<IconArrowBackUp size={14} />}
                          disabled={!permissions.canDecideInternal || busy}
                          onClick={() => {
                            setReturnReason('');
                            setReturnOpen(true);
                          }}
                        >
                          Pedir corrección
                        </Button>
                      </Group>
                      <Text size='xs' c='dimmed'>
                        {!permissions.canDecideInternal
                          ? draft.status !== 'EN_VALIDACION_INTERNA'
                            ? 'La aprobación ya terminó.'
                            : myApproval?.decision === 'DEVUELTO'
                              ? 'Pidió corrección. Le tocará revisar cuando la preparadora suba la subversión corregida.'
                              : `Ya aprobó la ${draft.versionLabel}. Si llega una subversión nueva, le tocará aprobarla otra vez.`
                          : myPendingMarks.length > 0
                            ? `Tiene ${myPendingMarks.length} marca${myPendingMarks.length === 1 ? '' : 's'} sin confirmar (${myPendingMarks
                                .map((m) => m.number)
                                .join(', ')}). Confírmelas o reábralas primero.`
                            : 'Todas sus marcas están confirmadas.'}
                      </Text>
                    </Stack>
                  ) : null}
                </Stack>
              </Paper>
            ) : null}

            {isElaborator && permissions.canUpload ? (
              <Paper withBorder radius='md' p='sm'>
                <Text size='xs' fw={700} c='dimmed' tt='uppercase' mb={8} style={{ letterSpacing: 1 }}>
                  {draft.status === 'APROBADO_CLIENTE' ? 'Versión limpia del Word' : 'Corrección del Word'}
                </Text>
                <Stack gap={8}>
                  <Group gap={8} wrap='nowrap'>
                    <Text size='xs' c='dimmed' ff='monospace'>
                      1
                    </Text>
                    <Button
                      size='xs'
                      variant='default'
                      leftSection={<IconDownload size={14} />}
                      component='a'
                      href={openMarks > 0 ? commentsUrl : downloadUrl}
                      onClick={() => rememberDownloadedVersion(requestId, fileId, draft.versionLabel)}
                    >
                      {openMarks > 0
                        ? `Descargar Word con ${openMarks} comentario${openMarks === 1 ? '' : 's'}`
                        : `Descargar Word ${draft.versionLabel}`}
                    </Button>
                  </Group>
                  <Group gap={8} wrap='nowrap'>
                    <Text size='xs' c='dimmed' ff='monospace'>
                      2
                    </Text>
                    <Button size='xs' leftSection={<IconUpload size={14} />} disabled={busy} onClick={openUpload}>
                      {draft.status === 'APROBADO_CLIENTE' ? 'Subir versión limpia' : 'Subir subversión'}
                    </Button>
                  </Group>
                  <Text size='xs' c='dimmed'>
                    {draft.status === 'APROBADO_CLIENTE'
                      ? 'Sin comentarios ni cambios pendientes: es la que se convierte a PDF.'
                      : 'Pueden trabajar varias personas a la vez. Al subir, Kronos compara con la subversión anterior y marca solas las correcciones aplicadas.'}
                  </Text>
                </Stack>
              </Paper>
            ) : null}

            {clientReview ? (
              <Paper withBorder radius='md' p='sm'>
                <Text size='xs' fw={700} c='dimmed' tt='uppercase' mb={4} style={{ letterSpacing: 1 }}>
                  Aprobadores del cliente · {clientAccepted}/{clientReview.reviewers.length}
                </Text>
                <Text size='xs' c='dimmed' mb={8}>
                  Borrador {clientReview.versionLabel} · {clientReview.mode === 'parallel' ? 'todos a la vez' : 'en orden'} · ronda{' '}
                  {clientReview.round} · enviado {formatDate(clientReview.submittedAt)}
                </Text>
                <Stack gap={6}>
                  {clientReview.reviewers.map((r) => {
                    const isActive = activeReviewerEmails.has(r.email);
                    const expired = r.expiresAt ? Date.parse(r.expiresAt) <= Date.now() : false;
                    const decision = CLIENT_DECISION[r.decision];
                    return (
                      <Paper key={r.email} withBorder p={8} radius='sm'>
                        <Group gap={6} wrap='nowrap' justify='space-between'>
                          <Text size='sm' fw={700} lineClamp={1}>
                            {r.order}. {r.name || r.email}
                          </Text>
                          <Badge size='xs' variant='light' color={decision.color}>
                            {decision.label}
                          </Badge>
                        </Group>
                        <Text size='xs' c='dimmed'>
                          {r.email}
                        </Text>
                        {r.comment ? (
                          <Text size='xs' mt={2}>
                            {r.comment}
                          </Text>
                        ) : null}
                        {isActive ? (
                          <Text size='xs' c={expired ? 'red' : 'dimmed'} mt={2}>
                            {r.sentAt ? `Correo enviado ${formatDate(r.sentAt)} · ` : 'Correo sin enviar · '}
                            {expired ? 'enlace vencido' : r.expiresAt ? `vence ${formatDate(r.expiresAt)}` : ''}
                          </Text>
                        ) : r.decision === 'PENDIENTE' ? (
                          <Text size='xs' c='dimmed' mt={2}>
                            Recibirá el enlace cuando acepte el anterior.
                          </Text>
                        ) : null}
                        {isActive && permissions.canManageClientInvites ? (
                          <Group gap={4} mt={6} wrap='nowrap'>
                            <Button
                              size='compact-xs'
                              leftSection={<IconMail size={12} />}
                              disabled={busy}
                              onClick={() => void reviewerInvite(r.email, 'send')}
                            >
                              Enviar al correo
                            </Button>
                            <Tooltip label='Copiar URL'>
                              <ActionIcon
                                variant='light'
                                size='sm'
                                disabled={busy}
                                onClick={() => void reviewerInvite(r.email, 'url')}
                                aria-label='Copiar URL'
                              >
                                <IconCopy size={14} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label='Renovar enlace (1 día)'>
                              <ActionIcon
                                variant='light'
                                size='sm'
                                disabled={busy}
                                onClick={() => void reviewerInvite(r.email, 'regenerate')}
                                aria-label='Renovar enlace'
                              >
                                <IconRefresh size={14} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        ) : null}
                      </Paper>
                    );
                  })}
                </Stack>
              </Paper>
            ) : null}
          </Stack>
        </Grid.Col>
      </Grid>

      <Modal opened={returnOpen} onClose={() => setReturnOpen(false)} title='Pedir corrección' centered>
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            Quedará en <b>Pidió corrección</b> y la preparadora recibirá su pedido; los demás validadores siguen revisando.
            Cuando ella suba la subversión corregida, todos vuelven a revisarla.
          </Text>
          <Textarea
            label='¿Qué debe corregirse? (obligatorio)'
            placeholder='Ej.: falta la cláusula de confidencialidad y el valor no coincide con el anexo'
            value={returnReason}
            onChange={(e) => setReturnReason(e.currentTarget.value)}
            maxLength={1000}
            autosize
            minRows={3}
            autoFocus
          />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setReturnOpen(false)}>
              Cancelar
            </Button>
            <Button
              color='orange'
              loading={busy}
              disabled={!returnReason.trim()}
              onClick={async () => {
                const ok = await postDraft('return', 'Pedido de corrección enviado a la preparadora.', {
                  comment: returnReason.trim(),
                  baseVersion: draft.versionLabel,
                });
                if (ok) setReturnOpen(false);
              }}
            >
              Pedir corrección
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={validatorsOpen !== null}
        onClose={() => setValidatorsOpen(null)}
        title={validatorsOpen === 'edit' ? 'Editar validadores' : draft.internalReview ? 'Reenviar a validación' : 'Enviar a validación'}
        centered
      >
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            {validatorsOpen === 'edit'
              ? 'Agregue o quite validadores. Quien sigue conserva su aprobación; quien entra recibe una tarea; quien sale deja de tenerla.'
              : `Los validadores revisarán la ${draft.versionLabel} aquí en el tablero, al mismo tiempo: marcan, usted corrige y ellos aprueban cada subversión.`}
          </Text>
          {(board.validators ?? []).length === 0 ? (
            <Alert color='orange' variant='light'>
              Este flujo no tiene validadores configurados (Administración de flujo → Validadores).
            </Alert>
          ) : (
            <ValidatorOrderPicker options={board.validators} value={validatorIds} onChange={setValidatorIds} disabled={busy} />
          )}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setValidatorsOpen(null)}>
              Cancelar
            </Button>
            <Button
              leftSection={validatorsOpen === 'edit' ? <IconCheck size={14} /> : <IconSend size={14} />}
              loading={busy}
              disabled={validatorIds.length === 0}
              onClick={async () => {
                const ok =
                  validatorsOpen === 'edit'
                    ? await postDraft('edit-validators', 'Validadores actualizados.', { validatorIds })
                    : await postDraft('submit-internal', 'Enviado a validación. Se notificó a los validadores.', { validatorIds });
                if (ok) setValidatorsOpen(null);
              }}
            >
              {validatorsOpen === 'edit' ? 'Guardar' : 'Enviar'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title={draft.status === 'APROBADO_CLIENTE' ? 'Subir versión limpia del Word' : 'Subir subversión del Word'}
        centered
      >
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            {draft.status === 'APROBADO_CLIENTE'
              ? 'El cliente ya aprobó el contenido. Suba solo la versión sin comentarios ni cambios pendientes para convertirla a PDF; quedará registrada.'
              : `Suba el Word corregido. Se crea la subversión v0.${Number(/\d+$/.exec(draft.versionLabel)?.[0] ?? 0) + 1}${
                  draft.status === 'EN_VALIDACION_INTERNA'
                    ? ': los validadores ven los cambios resaltados y deben aprobarla de nuevo'
                    : ''
                }.`}
          </Text>
          {uploadBase && uploadBase !== draft.versionLabel ? (
            <Alert color='orange' variant='light' title={`Usted descargó la ${uploadBase}, pero ya hay una ${draft.versionLabel}`}>
              <Stack gap={6}>
                <Text size='sm'>
                  Otra persona subió cambios después de su descarga. Para no borrarlos, descargue la {draft.versionLabel} y
                  pase allí sus cambios.
                </Text>
                <Group gap={6}>
                  <Button
                    size='compact-xs'
                    variant='default'
                    leftSection={<IconDownload size={12} />}
                    component='a'
                    href={openMarks > 0 ? commentsUrl : downloadUrl}
                    onClick={() => rememberDownloadedVersion(requestId, fileId, draft.versionLabel)}
                  >
                    Descargar {draft.versionLabel}
                  </Button>
                  <Button size='compact-xs' variant='subtle' color='orange' onClick={() => setUploadBase(draft.versionLabel)}>
                    Mi archivo ya incluye la {draft.versionLabel}
                  </Button>
                </Group>
              </Stack>
            </Alert>
          ) : null}
          <FileInput
            label='Documento Word (.docx)'
            placeholder='Seleccione el archivo'
            accept='.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            value={uploadFile}
            onChange={setUploadFile}
            clearable
          />
          {corrections.length > 0 ? (
            <Paper withBorder radius='sm' p='xs'>
              <Text size='sm' fw={600} mb={4}>
                Corregido en esta subversión
              </Text>
              <Text size='xs' c='dimmed' mb={6}>
                Quien quede marcado vuelve a revisar; quien no, sigue esperando su corrección.
              </Text>
              <Stack gap={6}>
                {corrections.map((a) => {
                  const email = a.email.toLowerCase();
                  return (
                    <Checkbox
                      key={email}
                      checked={resolvedEmails.includes(email)}
                      onChange={(e) => {
                        const on = e.currentTarget.checked;
                        setResolvedEmails((prev) => (on ? [...prev, email] : prev.filter((x) => x !== email)));
                      }}
                      label={
                        <Text size='sm'>
                          <b>{a.name || a.email}</b>: {a.comment || 'sin detalle'}
                        </Text>
                      }
                    />
                  );
                })}
              </Stack>
            </Paper>
          ) : null}
          <Textarea
            label='Nota (opcional)'
            placeholder='Ej.: correcciones de Ana y respuesta a Beto'
            value={uploadNote}
            onChange={(e) => setUploadNote(e.currentTarget.value)}
            maxLength={500}
            autosize
            minRows={2}
          />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setUploadOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void doUpload()}
              loading={busy}
              disabled={!uploadFile || Boolean(uploadBase && uploadBase !== draft.versionLabel)}
            >
              {draft.status === 'APROBADO_CLIENTE' ? 'Subir versión limpia' : 'Subir subversión'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={sendClientOpen} onClose={() => setSendClientOpen(false)} title='Enviar borrador al cliente' centered size='lg'>
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            El cliente verá una copia de la versión {draft.versionLabel} marcada como <b>BORRADOR</b> (no se puede firmar
            ni editar) y podrá aceptarla o rechazarla con una descripción. El enlace dura 1 día.
          </Text>
          <PartnerSearch
            companyId={board.companyId}
            disabled={busy}
            onPick={(p) => {
              if (clientReviewers.some((r) => r.email === p.email)) return;
              setClientReviewers([...clientReviewers, { email: p.email, name: p.cardName, cardCode: p.cardCode }]);
            }}
          />
          {clientReviewers.length === 0 ? (
            <Text size='xs' c='dimmed'>
              Busque y agregue a los aprobadores del cliente.
            </Text>
          ) : (
            <Stack gap={6}>
              {clientReviewers.map((r, index) => (
                <Paper key={r.email} withBorder p={6} radius='sm'>
                  <Group justify='space-between' wrap='nowrap'>
                    <Group gap={8} wrap='nowrap' style={{ minWidth: 0 }}>
                      <Badge size='sm' variant='light' circle>
                        {index + 1}
                      </Badge>
                      <div style={{ minWidth: 0 }}>
                        <Text size='sm' fw={600} lineClamp={1}>
                          {r.name || r.email}
                        </Text>
                        <Text size='xs' c='dimmed' lineClamp={1}>
                          {r.email}
                          {r.cardCode ? ` · ${r.cardCode}` : ''}
                        </Text>
                      </div>
                    </Group>
                    <Group gap={2} wrap='nowrap'>
                      <ActionIcon variant='subtle' size='sm' onClick={() => moveReviewer(index, -1)} disabled={index === 0} aria-label='Subir'>
                        <IconArrowUp size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant='subtle'
                        size='sm'
                        onClick={() => moveReviewer(index, 1)}
                        disabled={index === clientReviewers.length - 1}
                        aria-label='Bajar'
                      >
                        <IconArrowDown size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant='subtle'
                        color='red'
                        size='sm'
                        onClick={() => setClientReviewers(clientReviewers.filter((x) => x.email !== r.email))}
                        aria-label='Quitar'
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
          <SegmentedControl
            size='xs'
            value={clientMode}
            onChange={(v) => setClientMode(v as 'sequential' | 'parallel')}
            data={[
              { label: 'En orden (uno después de otro)', value: 'sequential' },
              { label: 'Todos a la vez', value: 'parallel' },
            ]}
          />
          <Text size='xs' c='dimmed'>
            Basta con que uno rechace para devolver el documento; los enlaces de los demás se anulan.
          </Text>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setSendClientOpen(false)}>
              Cancelar
            </Button>
            <Button
              leftSection={<IconSend size={14} />}
              loading={busy}
              disabled={clientReviewers.length === 0}
              onClick={async () => {
                const ok = await postDraft(
                  'send-client',
                  'Borrador listo en Orion. Envíe el enlace por correo a cada aprobador (panel "Aprobadores del cliente").',
                  { reviewers: clientReviewers, mode: clientMode }
                );
                if (ok) setSendClientOpen(false);
              }}
            >
              Crear borrador
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={convertOpen} onClose={() => setConvertOpen(false)} title='Convertir a PDF' centered>
        <Stack gap='sm'>
          <Text size='sm'>
            Se creará el PDF <b>v1.0</b> de {draft.fileName} como adjunto nuevo de la solicitud, listo para preparar la
            firma. El Word queda cerrado.
          </Text>
          <Text size='xs' c='dimmed'>
            Si el Word tiene comentarios o cambios sin aceptar, primero suba la versión limpia.
          </Text>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setConvertOpen(false)}>
              Cancelar
            </Button>
            <Button
              color='teal'
              leftSection={<IconFileTypePdf size={14} />}
              loading={busy}
              onClick={async () => {
                const data = await callDraft('convert-pdf', 'PDF creado. Ya puede preparar la firma en la solicitud.');
                if (data) {
                  setConvertOpen(false);
                  router.push(requestUrl);
                }
              }}
            >
              Convertir
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

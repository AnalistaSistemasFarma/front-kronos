'use client';

// Asistente SynerLink: distingue CASO (Help Desk) vs SOLICITUD general.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ActionIcon,
  Affix,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
  Transition,
  UnstyledButton,
  useMantineColorScheme,
  useMantineTheme,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconFilePlus,
  IconMessageChatbot,
  IconPlayerStop,
  IconRobot,
  IconSend,
  IconSparkles,
  IconTicket,
  IconTrash,
  IconUser,
  IconX,
  IconCircleCheck,
} from '@tabler/icons-react';
import {
  ASSISTANT_SYSTEM_PROMPT,
  buildGroundedAnswerTurn,
  buildUserTurn,
  extractAssistantAction,
  stripActionJson,
  type AssistantAction,
  type PageContextSnapshot,
} from '../../lib/ai/assistantPrompt';
import {
  fetchAssistantCatalog,
  formatCatalogForPrompt,
  resolveCompany,
  resolveProcess,
  type AssistantCatalog,
} from '../../lib/ai/assistantCatalog';
import {
  fetchActivities,
  fetchHelpDeskCatalog,
  fetchSubcategories,
  formatHelpDeskCatalogForPrompt,
  resolveHelpDeskCategory,
  resolveHelpDeskCompany,
  resolveTechnician,
  type HelpDeskCatalog,
  type HelpDeskOption,
} from '../../lib/ai/helpDeskCatalog';
import { createGeneralRequest, resolveRequesterUserId } from '../../lib/ai/createRequestTool';
import { createHelpDeskTicket } from '../../lib/ai/createTicketTool';
import { resolveGeneralRequest } from '../../lib/ai/resolveRequestTool';
import {
  parseHowToIntent,
  parseResolveIntent,
  parseUserIntent,
  parseWorkspaceQuery,
} from '../../lib/ai/intentParse';
import {
  fetchWorkspaceSnapshot,
  formatWorkspaceAnswer,
  formatWorkspaceForPrompt,
  type WorkspaceSnapshot,
} from '../../lib/ai/workspaceContext';
import {
  buildProcessIndexFromApi,
  retrieveKnowledge,
  type ProcessIndexEntry,
} from '../../lib/ai/appKnowledge';
import { useAiAssistantPageExtrasOptional } from '../../lib/ai/AiAssistantContext';
import { suggestionsForPath } from '../../lib/ai/routeScreenCatalog';
import AssistantMarkdown from './AssistantMarkdown';

type Support = 'checking' | 'unsupported' | 'ready';
type Phase = 'idle' | 'downloading' | 'thinking' | 'creating';

interface RequestProposal {
  kind: 'request';
  companyId: number | null;
  processId: number | null;
  subject: string;
  description: string;
  source: 'ai' | 'manual' | 'heuristic';
}

interface TicketProposal {
  kind: 'ticket';
  companyId: number | null;
  categoryId: number | null;
  subcategoryId: number | null;
  activityId: number | null;
  departmentId: number | null;
  technicianId: number | null;
  requestType: string;
  priority: string;
  site: string;
  subject: string;
  description: string;
  source: 'ai' | 'manual' | 'heuristic';
}

interface ResolveProposal {
  kind: 'resolve';
  requestId: number;
  statusKind: 'resolve' | 'cancel' | 'return';
  resolution: string;
  sendEmail: boolean;
  source: 'ai' | 'manual' | 'heuristic';
}

type Proposal = RequestProposal | TicketProposal | ResolveProposal;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  proposal?: Proposal | null;
  createdRequestId?: number | null;
  createdCaseId?: number | null;
}

const DEFAULT_SUGGESTIONS = [
  '¿Qué hay en esta página?',
  '¿Cómo se crea un ticket?',
  '¿Cuántas solicitudes tengo?',
  'Créame un caso: ayuda para mi chatbot',
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readGlobalStoreUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('global-store');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { idUser?: string | number } };
    const id = parsed?.state?.idUser;
    return id != null && String(id).trim() ? String(id).trim() : null;
  } catch {
    return null;
  }
}

async function readStream(
  stream: ReadableStream<string> | AsyncIterable<string>,
  onChunk: (full: string) => void,
): Promise<string> {
  let full = '';
  if (typeof (stream as ReadableStream<string>).getReader === 'function') {
    const reader = (stream as ReadableStream<string>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length >= full.length && value.startsWith(full.slice(0, 32))) {
        full = value;
      } else {
        full += value;
      }
      onChunk(full);
    }
    return full;
  }
  for await (const chunk of stream as AsyncIterable<string>) {
    if (chunk.length >= full.length && chunk.startsWith(full.slice(0, 32))) {
      full = chunk;
    } else {
      full += chunk;
    }
    onChunk(full);
  }
  return full;
}

export default function AiAssistantChat() {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const pageCtx = useAiAssistantPageExtrasOptional();
  const livePageLabel =
    pageCtx?.pageExtras.pageLabel ||
    (pathname.startsWith('/dashboard')
      ? 'Dashboard Admin'
      : pathname === '/process'
        ? 'Procesos'
        : pathname);
  const livePageKind = pageCtx?.pageExtras.pageKind || '';
  const contextSuggestions = useMemo(() => {
    const fromPath = suggestionsForPath(
      pathname,
      searchParams?.toString() ? `?${searchParams.toString()}` : '',
    );
    return fromPath.length ? fromPath : DEFAULT_SUGGESTIONS;
  }, [pathname, searchParams]);

  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const accent = theme.primaryColor;
  const dark = colorScheme === 'dark';
  const borderColor = dark
    ? 'var(--mantine-color-dark-4)'
    : 'var(--mantine-color-gray-3)';
  const headerBg = dark
    ? `linear-gradient(135deg, var(--mantine-color-${accent}-9), var(--mantine-color-dark-6))`
    : `linear-gradient(135deg, var(--mantine-color-${accent}-0), var(--mantine-color-gray-0))`;
  const chipBg = dark
    ? 'var(--mantine-color-dark-6)'
    : 'var(--mantine-color-gray-0)';
  const chipBorder = dark
    ? 'var(--mantine-color-dark-4)'
    : 'var(--mantine-color-gray-3)';
  const panelBg = dark
    ? 'var(--mantine-color-dark-7)'
    : 'var(--mantine-color-body)';

  const [opened, setOpened] = useState(false);
  const [support, setSupport] = useState<Support>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [input, setInput] = useState('');
  const [requestCatalog, setRequestCatalog] = useState<AssistantCatalog | null>(
    null,
  );
  const [ticketCatalog, setTicketCatalog] = useState<HelpDeskCatalog | null>(
    null,
  );
  const [catalogError, setCatalogError] = useState('');
  const [requesterId, setRequesterId] = useState<number | string | null>(null);
  const [subcatsByMessage, setSubcatsByMessage] = useState<
    Record<string, HelpDeskOption[]>
  >({});
  const [actsByMessage, setActsByMessage] = useState<
    Record<string, HelpDeskOption[]>
  >({});
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hola — soy tu asistente SynerLink.\n\nPuedo **explicarte** procesos (con diagramas), **consultar** tus datos y **ejecutar** acciones:\n\n- *“¿cómo se crea un ticket?”*\n- *“¿cuántas solicitudes tengo?”*\n- *“créame un caso…”* / *“pon la #2079 en resuelto…”*',
    },
  ]);
  const [errorMsg, setErrorMsg] = useState('');
  const [workspaceSnap, setWorkspaceSnap] = useState<WorkspaceSnapshot | null>(
    null,
  );
  const [processIndex, setProcessIndex] = useState<ProcessIndexEntry[]>([]);

  const sessionRef = useRef<LanguageModelSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const requestCatalogRef = useRef<AssistantCatalog | null>(null);
  const ticketCatalogRef = useRef<HelpDeskCatalog | null>(null);
  const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
  const requesterIdRef = useRef<number | string | null>(null);
  const processIndexRef = useRef<ProcessIndexEntry[]>([]);
  const lastQueryRef = useRef('');

  useEffect(() => {
    requestCatalogRef.current = requestCatalog;
  }, [requestCatalog]);
  useEffect(() => {
    ticketCatalogRef.current = ticketCatalog;
  }, [ticketCatalog]);
  useEffect(() => {
    workspaceRef.current = workspaceSnap;
  }, [workspaceSnap]);
  useEffect(() => {
    requesterIdRef.current = requesterId;
  }, [requesterId]);
  useEffect(() => {
    processIndexRef.current = processIndex;
  }, [processIndex]);

  const companyOptions = useMemo(() => {
    const list =
      ticketCatalog?.companies ?? requestCatalog?.companies ?? [];
    return list.map((c) => ({ value: String(c.id), label: c.name }));
  }, [ticketCatalog, requestCatalog]);

  const processOptions = useMemo(
    () =>
      (requestCatalog?.processes ?? [])
        .filter((p) => p.active)
        .map((p) => ({
          value: String(p.id),
          label: `${p.category} › ${p.name}`,
        })),
    [requestCatalog],
  );

  const categoryOptions = useMemo(
    () =>
      (ticketCatalog?.categories ?? []).map((c) => ({
        value: String(c.id),
        label: c.name,
      })),
    [ticketCatalog],
  );

  const departmentOptions = useMemo(
    () =>
      (ticketCatalog?.departments ?? []).map((d) => ({
        value: String(d.id),
        label: d.name,
      })),
    [ticketCatalog],
  );

  const technicianOptions = useMemo(
    () =>
      (ticketCatalog?.technicians ?? []).map((t) => ({
        value: String(t.id),
        label: t.name,
      })),
    [ticketCatalog],
  );

  const pageSnapshot = useCallback(
    (forQuery?: string): PageContextSnapshot => {
      const search = searchParams?.toString();
      const reqCat = requestCatalogRef.current;
      const ticCat = ticketCatalogRef.current;
      const workspace = workspaceRef.current;
      const q = forQuery || lastQueryRef.current || '';
      const knowledge = retrieveKnowledge(q || 'synerlink mapa', {
        processIndex: processIndexRef.current,
        limit: 2,
      });
      const blocks = [
        reqCat ? `SOLICITUDES:\n${formatCatalogForPrompt(reqCat, forQuery)}` : '',
        ticCat ? `CASOS/TICKETS:\n${formatHelpDeskCatalogForPrompt(ticCat)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      return {
        pathname,
        search: search ? `?${search}` : '',
        requestId:
          pageCtx?.pageExtras.requestId ?? searchParams?.get('id') ?? null,
        requestSubject: pageCtx?.pageExtras.requestSubject ?? null,
        requestDescription: pageCtx?.pageExtras.requestDescription ?? null,
        requestCompany: pageCtx?.pageExtras.requestCompany ?? null,
        requestStatus: pageCtx?.pageExtras.requestStatus ?? null,
        extra: pageCtx?.pageExtras.extra ?? null,
        pageLabel: pageCtx?.pageExtras.pageLabel ?? null,
        pageKind: pageCtx?.pageExtras.pageKind ?? null,
        userName: session?.user?.name ?? null,
        workspaceBlock: workspace
          ? formatWorkspaceForPrompt(workspace)
          : '(datos del usuario aún no cargados)',
        knowledgeBlock: knowledge.markdown,
        catalogBlock: blocks || '(catálogo aún no cargado)',
      };
    },
    [pathname, searchParams, pageCtx?.pageExtras, session?.user?.name],
  );

  const refreshWorkspace = useCallback(async () => {
    const snap = await fetchWorkspaceSnapshot({
      userId: requesterIdRef.current ?? session?.user?.id ?? null,
      userName: session?.user?.name,
      pathname,
    });
    workspaceRef.current = snap;
    setWorkspaceSnap(snap);
    return snap;
  }, [pathname, session?.user?.id, session?.user?.name]);

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      if (typeof LanguageModel === 'undefined') {
        if (!cancelled) setSupport('unsupported');
        return;
      }
      try {
        const disp = await LanguageModel.availability({
          expectedInputs: [{ type: 'text', languages: ['es'] }],
          expectedOutputs: [{ type: 'text', languages: ['es'] }],
        });
        if (cancelled) return;
        setSupport(disp === 'unavailable' ? 'unsupported' : 'ready');
      } catch {
        if (!cancelled) setSupport('unsupported');
      }
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    async function load() {
      setCatalogError('');
      try {
        const [req, tic] = await Promise.all([
          fetchAssistantCatalog(),
          fetchHelpDeskCatalog(),
        ]);
        if (!cancelled) {
          setRequestCatalog(req);
          setTicketCatalog(tic);
        }
      } catch (err) {
        if (!cancelled) {
          setCatalogError(
            err instanceof Error
              ? err.message
              : 'No se pudo cargar el catálogo.',
          );
        }
      }

      // Barrido liviano: mapa de procesos del usuario (no se mete entero al modelo).
      try {
        const procRes = await fetch('/api/processes', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (procRes.ok) {
          const procData = await procRes.json();
          const idx = buildProcessIndexFromApi(procData);
          if (!cancelled) {
            processIndexRef.current = idx;
            setProcessIndex(idx);
          }
        }
      } catch {
        /* opcional */
      }

      const fromApi = await resolveRequesterUserId(
        session?.user?.name,
        session?.user?.email,
        session?.user?.id,
      );
      const fromStore = readGlobalStoreUserId();
      if (!cancelled) {
        const id = fromApi ?? fromStore;
        setRequesterId(id);
        requesterIdRef.current = id;
        const snap = await fetchWorkspaceSnapshot({
          userId: id ?? session?.user?.id ?? null,
          userName: session?.user?.name,
          pathname,
        });
        if (!cancelled) {
          workspaceRef.current = snap;
          setWorkspaceSnap(snap);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [opened, session?.user?.name, session?.user?.email, session?.user?.id, pathname]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!opened) return;
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, opened, phase]);

  // Al cambiar de pantalla, el chat se sincroniza con el contexto vivo.
  const lastContextKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${pathname}|${livePageKind}|${livePageLabel}`;
    if (lastContextKeyRef.current === null) {
      lastContextKeyRef.current = key;
      return;
    }
    if (lastContextKeyRef.current === key) return;
    lastContextKeyRef.current = key;

    // Nueva pantalla → nueva sesión del modelo (evita arrastrar contexto viejo).
    try {
      sessionRef.current?.destroy();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;

    const snippet =
      pageCtx?.pageExtras.extra
        ?.split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'))
        .slice(0, 2)
        .join(' ')
        .slice(0, 180) || null;

    setMessages((prev) => [
      ...prev.filter((m) => m.role !== 'system'),
      {
        id: `ctx-${uid()}`,
        role: 'system',
        content:
          `Contexto actualizado → **${livePageLabel}**` +
          (snippet ? `\n${snippet}` : '') +
          '\n_Pregúntame qué hay aquí o pide una acción en esta pantalla._',
      },
    ]);
    // Solo al cambiar de ruta/pantalla (no en cada refresh de KPIs).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extra se lee al momento del cambio
  }, [pathname, livePageLabel, livePageKind]);

  async function ensureSession(): Promise<LanguageModelSession> {
    if (typeof LanguageModel === 'undefined') {
      throw new Error('Prompt API no disponible.');
    }
    if (sessionRef.current) return sessionRef.current;
    const disp = await LanguageModel.availability({
      expectedInputs: [{ type: 'text', languages: ['es'] }],
      expectedOutputs: [{ type: 'text', languages: ['es'] }],
    });
    if (disp === 'unavailable') {
      throw new Error('Modelo on-device no disponible.');
    }
    if (disp === 'downloadable' || disp === 'downloading') {
      setPhase('downloading');
    }
    const lm = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: ASSISTANT_SYSTEM_PROMPT }],
      expectedInputs: [{ type: 'text', languages: ['es'] }],
      expectedOutputs: [{ type: 'text', languages: ['es'] }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          setProgress(Math.round(e.loaded * 100));
          if (e.loaded < 1) setPhase('downloading');
        });
      },
    });
    sessionRef.current = lm;
    return lm;
  }

  function pushAssistant(content: string, extra?: Partial<ChatMessage>) {
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: 'assistant', content, ...extra },
    ]);
  }

  function buildTicketProposal(
    text: string,
    source: TicketProposal['source'],
    action?: Extract<AssistantAction, { action: 'create_ticket' }>,
  ): TicketProposal {
    const intent = parseUserIntent(text);
    const cat = ticketCatalogRef.current;
    const company = cat
      ? resolveHelpDeskCompany(cat, intent.companyHint)
      : null;
    const tech = cat
      ? resolveTechnician(
          cat,
          action?.technicianName ?? intent.assigneeName,
        )
      : null;
    const category = cat
      ? resolveHelpDeskCategory(
          cat,
          action?.subject ?? intent.subject ?? text,
        )
      : null;

    const companyId =
      (action?.companyId && cat
        ? resolveCompany(
            {
              companies: cat.companies,
              processes: [],
              loadedAt: cat.loadedAt,
            },
            { id: action.companyId },
          )?.id
        : null) ??
      company?.id ??
      null;

    return {
      kind: 'ticket',
      companyId: companyId,
      categoryId: action?.categoryId ?? category?.id ?? null,
      subcategoryId: null,
      activityId: null,
      departmentId: action?.departmentId ?? cat?.departments[0]?.id ?? null,
      technicianId: action?.technicianId ?? tech?.id ?? null,
      requestType: action?.requestType || 'Solicitud',
      priority: action?.priority || 'Media',
      site: action?.site || 'Administrativa',
      subject: action?.subject || intent.subject,
      description: action?.description || intent.description,
      source,
    };
  }

  function buildRequestProposal(
    text: string,
    source: RequestProposal['source'],
    action?: Extract<AssistantAction, { action: 'create_request' }>,
  ): RequestProposal {
    const intent = parseUserIntent(text);
    const cat = requestCatalogRef.current;
    const company = cat
      ? resolveCompany(cat, {
          id: action?.companyId,
          name: action?.companyName ?? intent.companyHint ?? undefined,
        })
      : null;
    const process = cat
      ? resolveProcess(cat, {
          id: action?.processId,
          name: action?.processName ?? intent.subject ?? text,
        })
      : null;

    return {
      kind: 'request',
      companyId: company?.id ?? action?.companyId ?? null,
      processId: process?.id ?? action?.processId ?? null,
      subject: action?.subject || intent.subject,
      description: action?.description || intent.description,
      source,
    };
  }

  async function hydrateTicketCascade(
    messageId: string,
    proposal: TicketProposal,
  ) {
    if (!proposal.categoryId) return;
    const subs = await fetchSubcategories(proposal.categoryId);
    setSubcatsByMessage((prev) => ({ ...prev, [messageId]: subs }));
    if (subs.length === 1) {
      const acts = await fetchActivities(subs[0].id);
      setActsByMessage((prev) => ({ ...prev, [messageId]: acts }));
      updateProposal(messageId, {
        subcategoryId: subs[0].id,
        activityId: acts[0]?.id ?? null,
      });
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || phase === 'thinking' || phase === 'downloading') return;

    setErrorMsg('');
    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: 'user', content: trimmed },
    ]);

    const intent = parseUserIntent(trimmed);
    const resolveIntent = parseResolveIntent(trimmed);
    const workspaceFocus = parseWorkspaceQuery(trimmed);
    const howTo = parseHowToIntent(trimmed);
    lastQueryRef.current = trimmed;

    // Guías / “cómo se hace” (+ opción de ejecutar).
    if (howTo && !resolveIntent) {
      const knowledge = retrieveKnowledge(trimmed, {
        processIndex: processIndexRef.current,
        limit: 2,
      });
      const footer = howTo.alsoCreate
        ? '\n\n---\nAbajo tienes el formulario para confirmar la creación.'
        : '\n\n---\nSi quieres que lo **cree yo**, dime *“créamelo”* o *“crear un caso…”*.';

      const msgId = uid();
      let proposal: Proposal | null = null;
      if (howTo.alsoCreate && howTo.topic === 'ticket') {
        proposal = buildTicketProposal(
          trimmed.replace(
            /\b(como|cómo|ven\s+como|expl[ií]came)[^,]*/gi,
            'crear un caso',
          ),
          'heuristic',
        );
      } else if (howTo.alsoCreate && howTo.topic === 'request') {
        proposal = buildRequestProposal(trimmed, 'heuristic');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          role: 'assistant',
          content: knowledge.markdown + footer,
          proposal,
        },
      ]);
      if (proposal?.kind === 'ticket') {
        void hydrateTicketCascade(msgId, proposal);
      }
      return;
    }

    // Consultas informativas: hechos reales + respuesta redactada por el modelo (no plantilla fija).
    if (workspaceFocus && !resolveIntent) {
      setPhase('thinking');
      try {
        const snap = await refreshWorkspace();
        const pageMeta = {
          pageLabel: pageCtx?.pageExtras.pageLabel ?? null,
          pageKind: pageCtx?.pageExtras.pageKind ?? null,
          requestId: pageCtx?.pageExtras.requestId ?? null,
          requestSubject: pageCtx?.pageExtras.requestSubject ?? null,
          requestStatus: pageCtx?.pageExtras.requestStatus ?? null,
          extra: pageCtx?.pageExtras.extra ?? null,
        };
        const facts = formatWorkspaceAnswer(snap, workspaceFocus, pageMeta);

        if (support !== 'ready') {
          pushAssistant(facts);
          return;
        }

        const assistantId = uid();
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: 'assistant', content: '' },
        ]);
        const controller = new AbortController();
        abortRef.current = controller;

        const lm = await ensureSession();
        const promptText = buildGroundedAnswerTurn({
          userMessage: trimmed,
          factsMarkdown: facts,
          pageLabel: pageMeta.pageLabel,
          focusHint:
            workspaceFocus === 'page'
              ? 'describir lo visible en esta pantalla'
              : workspaceFocus === 'tickets'
                ? 'casos/tickets del usuario'
                : workspaceFocus === 'assigned' || workspaceFocus === 'dashboard'
                  ? 'lo asignado / dashboard personal'
                  : workspaceFocus === 'requests'
                    ? 'solicitudes creadas por el usuario'
                    : 'resumen del espacio del usuario',
        });

        let raw = '';
        if (typeof lm.promptStreaming === 'function') {
          const stream = lm.promptStreaming(promptText, {
            signal: controller.signal,
          });
          raw = await readStream(stream, (full) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: stripActionJson(full) || '…' }
                  : m,
              ),
            );
          });
        } else {
          raw = await lm.prompt(promptText, { signal: controller.signal });
        }

        const visible = stripActionJson(raw).trim();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    visible ||
                    facts /* si el modelo falla, al menos los hechos */,
                }
              : m,
          ),
        );
      } catch {
        pushAssistant(
          'No pude redactar la respuesta ahora. Reintenta en un momento.',
        );
      } finally {
        setPhase('idle');
        abortRef.current = null;
      }
      return;
    }

    const makeLocalProposal = () => {
      if (resolveIntent) {
        const proposal: ResolveProposal = {
          kind: 'resolve',
          requestId: resolveIntent.requestId,
          statusKind: resolveIntent.kind,
          resolution: resolveIntent.resolution,
          sendEmail: resolveIntent.sendEmail,
          source: 'heuristic',
        };
        const label =
          resolveIntent.kind === 'resolve'
            ? 'resuelta'
            : resolveIntent.kind === 'cancel'
              ? 'cancelada'
              : 'devuelta';
        pushAssistant(
          `Voy a marcar la solicitud #${resolveIntent.requestId} como ${label}` +
            (resolveIntent.sendEmail
              ? ' y enviar correo al solicitante.'
              : '.') +
            ' Confirma con un clic.',
          { proposal },
        );
        return;
      }
      if (intent.kind === 'ticket' || (intent.kind === 'unknown' && /\bcaso\b/i.test(trimmed))) {
        const proposal = buildTicketProposal(trimmed, 'heuristic');
        const id = uid();
        setMessages((prev) => [
          ...prev,
          {
            id,
            role: 'assistant',
            content:
              'Entendí que quieres un CASO (Help Desk / ticket), no una solicitud de procesos. Revisa los campos y confirma.',
            proposal,
          },
        ]);
        void hydrateTicketCascade(id, proposal);
        return;
      }
      if (intent.kind === 'request' || intent.wantsCreate) {
        const proposal = buildRequestProposal(trimmed, 'heuristic');
        pushAssistant(
          'Te preparé una SOLICITUD general. Elige el proceso si falta y confirma.',
          { proposal },
        );
        return;
      }
      pushAssistant(
        'Puedo ayudarte con:\n• “¿cuántas solicitudes tengo?” / “¿qué hay en mi dashboard personal?”\n• “crear un caso…” / “crear solicitud…”\n• “pon la #2079 en resuelto y diga solucionado”',
      );
    };

    if (support !== 'ready') {
      makeLocalProposal();
      return;
    }

    const assistantId = uid();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    setPhase('thinking');
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const lm = await ensureSession();
      setPhase('thinking');
      // Datos frescos para que el modelo responda conteos reales.
      await refreshWorkspace().catch(() => null);
      const promptText = buildUserTurn(trimmed, pageSnapshot(trimmed));
      let raw = '';
      if (typeof lm.promptStreaming === 'function') {
        const stream = lm.promptStreaming(promptText, {
          signal: controller.signal,
        });
        raw = await readStream(stream, (full) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: stripActionJson(full) || '…' }
                : m,
            ),
          );
        });
      } else {
        raw = await lm.prompt(promptText, { signal: controller.signal });
      }

      const action = extractAssistantAction(raw);
      let proposal: Proposal | null = null;

      if (resolveIntent || action?.action === 'resolve_request') {
        if (action?.action === 'resolve_request') {
          proposal = {
            kind: 'resolve',
            requestId: action.requestId,
            statusKind: action.kind,
            resolution: action.resolution || resolveIntent?.resolution || 'Solucionado',
            sendEmail: action.sendEmail !== false,
            source: 'ai',
          };
        } else if (resolveIntent) {
          proposal = {
            kind: 'resolve',
            requestId: resolveIntent.requestId,
            statusKind: resolveIntent.kind,
            resolution: resolveIntent.resolution,
            sendEmail: resolveIntent.sendEmail,
            source: 'heuristic',
          };
        }
      } else if (intent.kind === 'ticket') {
        if (action?.action === 'create_ticket') {
          proposal = buildTicketProposal(trimmed, 'ai', action);
        } else {
          proposal = buildTicketProposal(trimmed, 'heuristic');
        }
      } else if (action?.action === 'create_ticket') {
        proposal = buildTicketProposal(trimmed, 'ai', action);
      } else if (action?.action === 'create_request') {
        proposal = buildRequestProposal(trimmed, 'ai', action);
      } else if (intent.kind === 'request' || intent.wantsCreate) {
        proposal = buildRequestProposal(trimmed, 'heuristic');
      }

      const visible =
        stripActionJson(raw) ||
        (proposal?.kind === 'resolve'
          ? `Listo para ${proposal.statusKind === 'cancel' ? 'cancelar' : proposal.statusKind === 'return' ? 'devolver' : 'resolver'} la #${proposal.requestId}.`
          : proposal?.kind === 'ticket'
            ? 'Te preparé un caso Help Desk para confirmar.'
            : proposal
              ? 'Te preparé una solicitud para confirmar.'
              : '(Sin texto)');

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: visible, proposal } : m,
        ),
      );
      if (proposal?.kind === 'ticket') {
        void hydrateTicketCascade(assistantId, proposal);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setErrorMsg(
          err instanceof Error ? err.message : 'Error con la IA local.',
        );
      }
      // Fallback local
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      makeLocalProposal();
    } finally {
      abortRef.current = null;
      setPhase('idle');
      setProgress(0);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function resetChat() {
    abortRef.current?.abort();
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setPhase('idle');
    setProgress(0);
    setErrorMsg('');
    setSubcatsByMessage({});
    setActsByMessage({});
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content:
          'Chat reiniciado. Puedes crear un caso (ticket) o una solicitud de procesos.',
      },
    ]);
  }

  function openManual(kind: 'ticket' | 'request') {
    if (kind === 'ticket') {
      const proposal = buildTicketProposal(
        'crear caso de soporte',
        'manual',
      );
      const id = uid();
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: 'assistant',
          content: 'Completa el caso Help Desk y confirma.',
          proposal,
        },
      ]);
      void hydrateTicketCascade(id, proposal);
    } else {
      pushAssistant('Completa la solicitud general y confirma.', {
        proposal: buildRequestProposal('crear solicitud', 'manual'),
      });
    }
  }

  function updateProposal(messageId: string, patch: Partial<Proposal>) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.proposal) return m;
        return {
          ...m,
          proposal: { ...m.proposal, ...patch } as Proposal,
        };
      }),
    );
  }

  async function onTicketCategoryChange(messageId: string, categoryId: number | null) {
    updateProposal(messageId, {
      categoryId,
      subcategoryId: null,
      activityId: null,
    } as Partial<TicketProposal>);
    setActsByMessage((prev) => ({ ...prev, [messageId]: [] }));
    if (!categoryId) {
      setSubcatsByMessage((prev) => ({ ...prev, [messageId]: [] }));
      return;
    }
    const subs = await fetchSubcategories(categoryId);
    setSubcatsByMessage((prev) => ({ ...prev, [messageId]: subs }));
  }

  async function onTicketSubcategoryChange(
    messageId: string,
    subcategoryId: number | null,
  ) {
    updateProposal(messageId, {
      subcategoryId,
      activityId: null,
    } as Partial<TicketProposal>);
    if (!subcategoryId) {
      setActsByMessage((prev) => ({ ...prev, [messageId]: [] }));
      return;
    }
    const acts = await fetchActivities(subcategoryId);
    setActsByMessage((prev) => ({ ...prev, [messageId]: acts }));
  }

  async function confirmCreate(messageId: string, proposal: Proposal) {
    if (phase === 'creating') return;
    setErrorMsg('');

    // Ejecutor = dbo.[user].id (cuid string), igual que view-request.
    let activeRequester =
      (await resolveRequesterUserId(
        session?.user?.name,
        session?.user?.email,
        session?.user?.id,
      )) ?? readGlobalStoreUserId();
    if (activeRequester != null) setRequesterId(activeRequester);

    if (proposal.kind === 'resolve') {
      if (activeRequester == null || activeRequester === '') {
        setErrorMsg(
          'No se encontró tu usuario en SynerLink ([user] por email). Sin ese id no se puede resolver.',
        );
        return;
      }
      if (!proposal.resolution.trim() && proposal.statusKind !== 'return') {
        setErrorMsg('Escribe el texto de resolución.');
        return;
      }
      setPhase('creating');
      const result = await resolveGeneralRequest({
        requestId: proposal.requestId,
        kind: proposal.statusKind,
        resolution: proposal.resolution,
        executorId: activeRequester,
        sendEmail: proposal.sendEmail,
      });
      setPhase('idle');
      if (!result.ok) {
        setErrorMsg(result.message);
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, proposal: null } : m,
        ),
      );
      const statusWord =
        proposal.statusKind === 'resolve'
          ? 'resuelta'
          : proposal.statusKind === 'cancel'
            ? 'cancelada'
            : 'devuelta';
      let msg = `Listo — la solicitud #${result.requestId} quedó ${statusWord}.`;
      if (result.emailSent) {
        msg += ' Correo enviado al solicitante.';
      } else if (result.emailSkippedReason) {
        msg += ` ${result.emailSkippedReason}`;
      }
      pushAssistant(msg, { createdRequestId: result.requestId });
      return;
    }

    if (proposal.kind === 'request') {
      const missing: string[] = [];
      if (!proposal.companyId) missing.push('empresa');
      if (!proposal.processId) missing.push('proceso');
      if (!proposal.subject.trim()) missing.push('asunto');
      if (proposal.description.trim().length < 10) missing.push('descripción (≥10)');
      if (missing.length) {
        setErrorMsg(`Falta: ${missing.join(', ')}.`);
        return;
      }
      setPhase('creating');
      const process = requestCatalog
        ? resolveProcess(requestCatalog, { id: proposal.processId })
        : null;
      const result = await createGeneralRequest({
        companyId: proposal.companyId!,
        processId: proposal.processId!,
        categoryId: process?.categoryId ?? null,
        subject: proposal.subject,
        description: proposal.description,
        createdBy: activeRequester,
      });
      setPhase('idle');
      if (!result.ok) {
        setErrorMsg(result.message);
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, proposal: null, createdRequestId: result.id }
            : m,
        ),
      );
      pushAssistant(`Listo — creé la solicitud #${result.id}.`, {
        createdRequestId: result.id,
      });
      return;
    }

    // ticket
    const missing: string[] = [];
    if (!proposal.companyId) missing.push('empresa');
    if (!proposal.categoryId) missing.push('categoría');
    if (!proposal.subcategoryId) missing.push('subcategoría');
    if (!proposal.activityId) missing.push('actividad');
    if (!proposal.departmentId) missing.push('departamento');
    if (!proposal.site) missing.push('sitio');
    if (!proposal.requestType) missing.push('tipo');
    if (!proposal.priority) missing.push('prioridad');
    if (!proposal.subject.trim()) missing.push('asunto');
    if (proposal.description.trim().length < 10) missing.push('descripción (≥10)');
    if (activeRequester == null || activeRequester === '') {
      missing.push('usuario solicitante (sesión)');
    }
    if (missing.length) {
      setErrorMsg(
        missing.includes('usuario solicitante (sesión)')
          ? 'No se pudo identificar tu usuario en SynerLink (tabla user). Verifica que tu email de login exista en la base, o recarga tras entrar a Tickets una vez.'
          : `Falta completar: ${missing.join(', ')}.`,
      );
      return;
    }

    setPhase('creating');
    const result = await createHelpDeskTicket({
      requestType: proposal.requestType,
      priority: proposal.priority,
      companyId: proposal.companyId!,
      categoryId: proposal.categoryId!,
      subcategoryId: proposal.subcategoryId!,
      activityId: proposal.activityId!,
      departmentId: proposal.departmentId!,
      site: proposal.site,
      asunto: proposal.subject,
      description: proposal.description,
      technicianId: proposal.technicianId,
      requesterId: activeRequester,
    });
    setPhase('idle');
    if (!result.ok) {
      setErrorMsg(result.message);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, proposal: null, createdCaseId: result.id }
          : m,
      ),
    );
    pushAssistant(`Listo — creé el caso #${result.id}.`, {
      createdCaseId: result.id,
    });
  }

  const busy =
    phase === 'thinking' || phase === 'downloading' || phase === 'creating';
  const supportBadge =
    support === 'ready'
      ? { color: accent, label: 'IA local lista' }
      : support === 'checking'
        ? { color: 'gray', label: 'Detectando…' }
        : { color: 'orange', label: 'Sin Prompt API · crea igual' };

  return (
    <>
      <Affix position={{ bottom: 24, right: 24 }} zIndex={400}>
        <Transition mounted={!opened} transition='slide-up' duration={200}>
          {(styles) => (
            <Tooltip label='Asistente SynerLink' position='left'>
              <ActionIcon
                style={styles}
                size={56}
                radius='xl'
                variant='filled'
                color={accent}
                aria-label='Abrir asistente'
                onClick={() => setOpened(true)}
                className='shadow-lg'
              >
                <IconMessageChatbot size={26} />
              </ActionIcon>
            </Tooltip>
          )}
        </Transition>
      </Affix>

      <Affix position={{ bottom: 24, right: 24 }} zIndex={401}>
        <Transition mounted={opened} transition='pop-bottom-right' duration={200}>
          {(styles) => (
            <Paper
              style={{
                ...styles,
                width: 'min(440px, calc(100vw - 32px))',
                height: 'min(640px, calc(100vh - 80px))',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: panelBg,
              }}
              shadow='xl'
              radius='lg'
              withBorder
              role='dialog'
              aria-label='Asistente SynerLink'
            >
              <Group
                justify='space-between'
                p='sm'
                style={{
                  borderBottom: `1px solid ${borderColor}`,
                  background: headerBg,
                }}
              >
                <Group gap='xs'>
                  <ThemeIcon color={accent} variant='light' radius='md'>
                    <IconSparkles size={16} />
                  </ThemeIcon>
                  <Box>
                    <Text fw={600} size='sm'>
                      Asistente SynerLink
                    </Text>
                    <Group gap={4} mt={2}>
                      <Badge size='xs' color={supportBadge.color} variant='light'>
                        {supportBadge.label}
                      </Badge>
                      <Badge
                        size='xs'
                        color={accent}
                        variant='outline'
                        maw={180}
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={livePageLabel}
                      >
                        {livePageLabel}
                      </Badge>
                    </Group>
                  </Box>
                </Group>
                <Group gap={4}>
                  <Tooltip label='Nuevo caso (ticket)'>
                    <ActionIcon
                      variant='subtle'
                      color={accent}
                      onClick={() => openManual('ticket')}
                      disabled={busy || !ticketCatalog}
                    >
                      <IconTicket size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label='Nueva solicitud'>
                    <ActionIcon
                      variant='subtle'
                      color={accent}
                      onClick={() => openManual('request')}
                      disabled={busy || !requestCatalog}
                    >
                      <IconFilePlus size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={resetChat}
                    disabled={busy}
                    aria-label='Reiniciar'
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    onClick={() => setOpened(false)}
                    aria-label='Cerrar'
                  >
                    <IconX size={18} />
                  </ActionIcon>
                </Group>
              </Group>

              <ScrollArea
                flex={1}
                px='sm'
                py='xs'
                viewportRef={viewportRef}
                style={{ minHeight: 0 }}
              >
                <Stack gap='sm' pb='xs'>
                  {!requestCatalog && !ticketCatalog && !catalogError && (
                    <Group gap='xs'>
                      <Loader size='xs' color={accent} />
                      <Text size='xs' c='dimmed'>
                        Cargando catálogos…
                      </Text>
                    </Group>
                  )}
                  {catalogError && (
                    <Alert color='red' radius='md' py={6}>
                      <Text size='xs'>{catalogError}</Text>
                    </Alert>
                  )}

                  {messages.map((m) =>
                    m.role === 'system' ? (
                      <Alert
                        key={m.id}
                        color={accent}
                        variant='light'
                        radius='md'
                        py={6}
                        title='Pantalla conectada'
                      >
                        <AssistantMarkdown content={m.content} />
                      </Alert>
                    ) : (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        accent={accent}
                        dark={dark}
                        companyOptions={companyOptions}
                        processOptions={processOptions}
                        categoryOptions={categoryOptions}
                        departmentOptions={departmentOptions}
                        technicianOptions={technicianOptions}
                        subcategoryOptions={(subcatsByMessage[m.id] ?? []).map(
                          (s) => ({ value: String(s.id), label: s.name }),
                        )}
                        activityOptions={(actsByMessage[m.id] ?? []).map((a) => ({
                          value: String(a.id),
                          label: a.name,
                        }))}
                        busy={busy}
                        onUpdateProposal={(patch) =>
                          updateProposal(m.id, patch)
                        }
                        onCategoryChange={(id) =>
                          void onTicketCategoryChange(m.id, id)
                        }
                        onSubcategoryChange={(id) =>
                          void onTicketSubcategoryChange(m.id, id)
                        }
                        onConfirm={() =>
                          m.proposal && void confirmCreate(m.id, m.proposal)
                        }
                        onOpenRequest={(id) => {
                          setOpened(false);
                          router.push(
                            `/process/request-general/view-request?id=${id}&from=create-request`,
                          );
                        }}
                        onOpenCase={(id) => {
                          setOpened(false);
                          router.push(
                            `/process/help-desk/view-ticket?id=${id}`,
                          );
                        }}
                      />
                    ),
                  )}

                  {phase === 'downloading' && (
                    <Stack gap={4}>
                      <Text size='xs' c='dimmed'>
                        Descargando modelo… {progress}%
                      </Text>
                      <Progress value={progress} color={accent} animated size='sm' />
                    </Stack>
                  )}
                  {phase === 'thinking' && (
                    <Text size='xs' c='dimmed'>
                      Interpretando tu pedido…
                    </Text>
                  )}
                  {phase === 'creating' && (
                    <Group gap='xs'>
                      <Loader size='xs' color={accent} />
                      <Text size='xs' c='dimmed'>
                        Aplicando en SynerLink…
                      </Text>
                    </Group>
                  )}
                  {errorMsg && (
                    <Alert
                      icon={<IconAlertCircle size={14} />}
                      color='red'
                      radius='md'
                      py={6}
                    >
                      <Text size='xs'>{errorMsg}</Text>
                    </Alert>
                  )}
                </Stack>
              </ScrollArea>

              {messages.filter((m) => m.role !== 'system').length <= 2 && !busy && (
                <Box px='sm' pb='xs'>
                  <Text size='xs' c='dimmed' mb={6}>
                    En esta pantalla
                  </Text>
                  <Group gap={6}>
                    {contextSuggestions.map((s) => (
                      <UnstyledButton
                        key={s}
                        onClick={() => void send(s)}
                        style={{
                          fontSize: 11,
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: `1px solid ${chipBorder}`,
                          background: chipBg,
                          lineHeight: 1.3,
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        {s}
                      </UnstyledButton>
                    ))}
                  </Group>
                </Box>
              )}

              <Box p='sm' style={{ borderTop: `1px solid ${borderColor}` }}>
                <Group align='flex-end' gap='xs' wrap='nowrap'>
                  <Textarea
                    flex={1}
                    placeholder='Ej: ¿cuántas solicitudes tengo? · crear un caso… · pon la #2079 en resuelto'
                    autosize
                    minRows={1}
                    maxRows={4}
                    value={input}
                    disabled={busy}
                    onChange={(e) => setInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void send(input);
                      }
                    }}
                    styles={{ input: { fontSize: 13 } }}
                  />
                  {busy && phase !== 'creating' ? (
                    <ActionIcon
                      size={36}
                      radius='md'
                      color='red'
                      variant='light'
                      onClick={stop}
                    >
                      <IconPlayerStop size={16} />
                    </ActionIcon>
                  ) : (
                    <ActionIcon
                      size={36}
                      radius='md'
                      color={accent}
                      variant='filled'
                      disabled={!input.trim() || busy}
                      onClick={() => void send(input)}
                    >
                      <IconSend size={16} />
                    </ActionIcon>
                  )}
                </Group>
                <Text size='xs' c='dimmed' mt={6}>
                  Caso · Solicitud · Resolver #id por escrito
                </Text>
              </Box>
            </Paper>
          )}
        </Transition>
      </Affix>
    </>
  );
}

function MessageBubble({
  message,
  accent,
  dark,
  companyOptions,
  processOptions,
  categoryOptions,
  departmentOptions,
  technicianOptions,
  subcategoryOptions,
  activityOptions,
  busy,
  onUpdateProposal,
  onCategoryChange,
  onSubcategoryChange,
  onConfirm,
  onOpenRequest,
  onOpenCase,
}: {
  message: ChatMessage;
  accent: string;
  dark: boolean;
  companyOptions: { value: string; label: string }[];
  processOptions: { value: string; label: string }[];
  categoryOptions: { value: string; label: string }[];
  departmentOptions: { value: string; label: string }[];
  technicianOptions: { value: string; label: string }[];
  subcategoryOptions: { value: string; label: string }[];
  activityOptions: { value: string; label: string }[];
  busy: boolean;
  onUpdateProposal: (patch: Partial<Proposal>) => void;
  onCategoryChange: (id: number | null) => void;
  onSubcategoryChange: (id: number | null) => void;
  onConfirm: () => void;
  onOpenRequest: (id: number) => void;
  onOpenCase: (id: number) => void;
}) {
  const isUser = message.role === 'user';
  const bubbleBg = dark
    ? 'var(--mantine-color-dark-6)'
    : 'var(--mantine-color-gray-0)';
  const bubbleBorder = dark
    ? 'var(--mantine-color-dark-4)'
    : 'var(--mantine-color-gray-3)';
  const cardBg = dark
    ? `var(--mantine-color-${accent}-9)`
    : `var(--mantine-color-${accent}-0)`;
  const p = message.proposal;
  // El chat vive en Affix (z~401); el dropdown del Select debe portalarse por encima.
  const selectCombo = { withinPortal: true, zIndex: 10000 };

  return (
    <Group
      align='flex-start'
      gap='xs'
      justify={isUser ? 'flex-end' : 'flex-start'}
      wrap='nowrap'
    >
      {!isUser && (
        <ThemeIcon size={28} radius='xl' color={accent} variant='light'>
          <IconRobot size={14} />
        </ThemeIcon>
      )}
      <Stack gap={6} maw='92%'>
        <Paper
          p='xs'
          radius='md'
          bg={isUser ? `${accent}.6` : undefined}
          style={{
            background: isUser ? undefined : bubbleBg,
            border: isUser ? undefined : `1px solid ${bubbleBorder}`,
          }}
        >
          <AssistantMarkdown
            content={message.content || (isUser ? '' : '…')}
            color={isUser ? 'white' : undefined}
          />
        </Paper>

        {p?.kind === 'resolve' && (
          <Paper withBorder radius='md' p='sm' style={{ background: cardBg }}>
            <Group gap={6} mb={8}>
              <IconCircleCheck size={14} />
              <Text size='xs' fw={700}>
                {p.statusKind === 'cancel'
                  ? 'Cancelar solicitud'
                  : p.statusKind === 'return'
                    ? 'Devolver solicitud'
                    : 'Resolver solicitud'}
              </Text>
              <Badge size='xs' variant='light' color={accent}>
                #{p.requestId}
              </Badge>
            </Group>
            <Stack gap={8}>
              <Select
                comboboxProps={selectCombo}
                label='Acción'
                size='xs'
                data={[
                  { value: 'resolve', label: 'Resuelto' },
                  { value: 'cancel', label: 'Cancelado' },
                  { value: 'return', label: 'Devolver' },
                ]}
                value={p.statusKind}
                onChange={(v) =>
                  onUpdateProposal({
                    statusKind: (v as ResolveProposal['statusKind']) || 'resolve',
                  })
                }
              />
              <Textarea
                label='Texto de resolución'
                size='xs'
                autosize
                minRows={2}
                maxRows={4}
                value={p.resolution}
                onChange={(e) =>
                  onUpdateProposal({ resolution: e.currentTarget.value })
                }
              />
              <Select
                comboboxProps={selectCombo}
                label='Notificar por correo al solicitante'
                size='xs'
                data={[
                  { value: 'yes', label: 'Sí, enviar correo' },
                  { value: 'no', label: 'No enviar correo' },
                ]}
                value={p.sendEmail ? 'yes' : 'no'}
                onChange={(v) =>
                  onUpdateProposal({ sendEmail: v !== 'no' })
                }
              />
              <Button
                size='xs'
                color={accent}
                leftSection={<IconCheck size={14} />}
                loading={busy}
                onClick={onConfirm}
              >
                Confirmar y aplicar
              </Button>
            </Stack>
          </Paper>
        )}

        {p?.kind === 'ticket' && (
          <Paper withBorder radius='md' p='sm' style={{ background: cardBg }}>
            <Group gap={6} mb={8}>
              <IconTicket size={14} />
              <Text size='xs' fw={700}>
                Crear caso (Help Desk)
              </Text>
              <Badge size='xs' variant='light' color={accent}>
                ticket
              </Badge>
            </Group>
            <Stack gap={8}>
              <Group grow>
                <Select
                  comboboxProps={selectCombo}
                  label='Tipo'
                  size='xs'
                  data={[
                    { value: 'Incidente', label: 'Incidente' },
                    { value: 'Solicitud', label: 'Solicitud' },
                  ]}
                  value={p.requestType}
                  onChange={(v) =>
                    onUpdateProposal({ requestType: v || 'Solicitud' })
                  }
                />
                <Select
                  comboboxProps={selectCombo}
                  label='Prioridad'
                  size='xs'
                  data={[
                    { value: 'Baja', label: 'Baja' },
                    { value: 'Media', label: 'Media' },
                    { value: 'Alta', label: 'Alta' },
                  ]}
                  value={p.priority}
                  onChange={(v) =>
                    onUpdateProposal({ priority: v || 'Media' })
                  }
                />
              </Group>
              <Select
                comboboxProps={selectCombo}
                label='Empresa'
                size='xs'
                searchable
                data={companyOptions}
                value={p.companyId != null ? String(p.companyId) : null}
                onChange={(v) =>
                  onUpdateProposal({ companyId: v ? Number(v) : null })
                }
              />
              <Select
                comboboxProps={selectCombo}
                label='Sitio'
                size='xs'
                data={[
                  { value: 'Administrativa', label: 'Administrativa' },
                  { value: 'Planta', label: 'Planta' },
                  { value: 'Celta', label: 'Celta' },
                ]}
                value={p.site}
                onChange={(v) =>
                  onUpdateProposal({ site: v || 'Administrativa' })
                }
              />
              <Select
                comboboxProps={selectCombo}
                label='Categoría'
                size='xs'
                searchable
                data={categoryOptions}
                value={p.categoryId != null ? String(p.categoryId) : null}
                onChange={(v) => onCategoryChange(v ? Number(v) : null)}
              />
              <Select
                comboboxProps={selectCombo}
                label='Subcategoría'
                size='xs'
                searchable
                data={subcategoryOptions}
                value={
                  p.subcategoryId != null ? String(p.subcategoryId) : null
                }
                onChange={(v) => onSubcategoryChange(v ? Number(v) : null)}
                disabled={!p.categoryId}
              />
              <Select
                comboboxProps={selectCombo}
                label='Actividad'
                size='xs'
                searchable
                data={activityOptions}
                value={p.activityId != null ? String(p.activityId) : null}
                onChange={(v) =>
                  onUpdateProposal({ activityId: v ? Number(v) : null })
                }
                disabled={!p.subcategoryId}
              />
              <Select
                comboboxProps={selectCombo}
                label='Departamento'
                size='xs'
                searchable
                data={departmentOptions}
                value={p.departmentId != null ? String(p.departmentId) : null}
                onChange={(v) =>
                  onUpdateProposal({ departmentId: v ? Number(v) : null })
                }
              />
              <Select
                comboboxProps={selectCombo}
                label='Asignar a (técnico)'
                size='xs'
                searchable
                clearable
                data={technicianOptions}
                value={
                  p.technicianId != null ? String(p.technicianId) : null
                }
                onChange={(v) =>
                  onUpdateProposal({ technicianId: v ? Number(v) : null })
                }
              />
              <TextInput
                label='Asunto'
                size='xs'
                value={p.subject}
                onChange={(e) =>
                  onUpdateProposal({ subject: e.currentTarget.value })
                }
              />
              <Textarea
                label='Descripción'
                size='xs'
                autosize
                minRows={2}
                maxRows={5}
                value={p.description}
                onChange={(e) =>
                  onUpdateProposal({ description: e.currentTarget.value })
                }
              />
              <Button
                size='xs'
                color={accent}
                leftSection={<IconCheck size={14} />}
                loading={busy}
                onClick={onConfirm}
              >
                Crear caso
              </Button>
            </Stack>
          </Paper>
        )}

        {p?.kind === 'request' && (
          <Paper withBorder radius='md' p='sm' style={{ background: cardBg }}>
            <Group gap={6} mb={8}>
              <IconFilePlus size={14} />
              <Text size='xs' fw={700}>
                Crear solicitud (procesos)
              </Text>
            </Group>
            <Stack gap={8}>
              <Select
                comboboxProps={selectCombo}
                label='Empresa'
                size='xs'
                searchable
                data={companyOptions}
                value={p.companyId != null ? String(p.companyId) : null}
                onChange={(v) =>
                  onUpdateProposal({ companyId: v ? Number(v) : null })
                }
                error={!p.companyId ? 'Obligatoria' : undefined}
              />
              <Select
                comboboxProps={selectCombo}
                label='Proceso'
                size='xs'
                searchable
                data={processOptions}
                value={p.processId != null ? String(p.processId) : null}
                onChange={(v) =>
                  onUpdateProposal({ processId: v ? Number(v) : null })
                }
                error={!p.processId ? 'Obligatorio' : undefined}
              />
              <TextInput
                label='Asunto'
                size='xs'
                value={p.subject}
                onChange={(e) =>
                  onUpdateProposal({ subject: e.currentTarget.value })
                }
              />
              <Textarea
                label='Descripción'
                size='xs'
                autosize
                minRows={2}
                maxRows={5}
                value={p.description}
                onChange={(e) =>
                  onUpdateProposal({ description: e.currentTarget.value })
                }
              />
              <Button
                size='xs'
                color={accent}
                leftSection={<IconCheck size={14} />}
                loading={busy}
                onClick={onConfirm}
              >
                Crear solicitud
              </Button>
            </Stack>
          </Paper>
        )}

        {message.createdRequestId != null && (
          <Button
            size='xs'
            variant='light'
            color={accent}
            rightSection={<IconExternalLink size={14} />}
            onClick={() => onOpenRequest(message.createdRequestId!)}
          >
            Abrir solicitud #{message.createdRequestId}
          </Button>
        )}
        {message.createdCaseId != null && (
          <Button
            size='xs'
            variant='light'
            color={accent}
            rightSection={<IconExternalLink size={14} />}
            onClick={() => onOpenCase(message.createdCaseId!)}
          >
            Abrir caso #{message.createdCaseId}
          </Button>
        )}
      </Stack>
      {isUser && (
        <ThemeIcon size={28} radius='xl' color='gray' variant='light'>
          <IconUser size={14} />
        </ThemeIcon>
      )}
    </Group>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chatFetch,
  chatGetJson,
  isAbortError,
  notifyChatRefresh,
  type ChatConversationDto,
  type ChatMessageDto,
  type ChatAgentStatusDto,
  type ChatPollDto,
  type ChatStatusDto,
} from '../../lib/chat/client';
import { MESSAGES_PAGE_DEFAULT } from '../../lib/chat/constants';

/**
 * El hilo abierto —con UN agente o un GRUPO—: histórico, sondeo en vivo, envío
 * y "leído".
 *
 * Las dos clases de hilo comparten TODO lo de abajo (sondeo adaptativo, envío
 * optimista, carga de lo viejo, marca de leído) y solo se diferencian en cómo
 * se abren: con un agente hay que pedirle al servidor el hilo (que lo crea si
 * no existía) y un grupo ya existe, así que se abre por su id. De ahí el
 * `ChatTarget`.
 *
 * -------------------------------------------------------------------------
 * EL SONDEO LO MANDA EL SERVIDOR
 * -------------------------------------------------------------------------
 * /api/chat/conversations/[id]/poll devuelve `nextPollMs` en CADA respuesta:
 * 1 s con el agente trabajando, 2/5/15 s mientras se enfría, 30 s dormido o
 * con la pestaña oculta (ver lib/chat/polling.ts). Este hook NO inventa un
 * intervalo fijo: reprograma el siguiente `setTimeout` con el valor que le
 * ordenaron. Así el costo baja solo cuando no está pasando nada.
 *
 * Se usa `setTimeout` recursivo y no `setInterval` a propósito: con un
 * intervalo fijo, una vuelta lenta se encima con la siguiente.
 */

/** Respaldo si el servidor no mandara cadencia (no debería ocurrir). */
const FALLBACK_POLL_MS = 5_000;

/**
 * Qué hilo abrir.
 *   - `agent`: la conversación de esta persona con ese agente. Si no existe,
 *     el servidor la crea (POST /api/chat/conversations es idempotente).
 *   - `group`: un grupo que YA existe, identificado por su id de conversación.
 */
export type ChatTarget =
  | { kind: 'agent'; idAgent: number }
  | { kind: 'group'; idConversation: number };

export interface ChatThreadState {
  conversation: ChatConversationDto | null;
  messages: ChatMessageDto[];
  status: ChatStatusDto | null;
  /** Un estado por agente. En un grupo es lo que se pinta; en directo trae uno. */
  statuses: ChatAgentStatusDto[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  send: (body: string, files?: File[]) => Promise<boolean>;
  loadOlder: () => Promise<void>;
  markRead: () => Promise<void>;
}

export function useChatConversation(
  target: ChatTarget | null,
  active: boolean
): ChatThreadState {
  const [conversation, setConversation] = useState<ChatConversationDto | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [status, setStatus] = useState<ChatStatusDto | null>(null);
  const [statuses, setStatuses] = useState<ChatAgentStatusDto[]>([]);

  // El objetivo se aplana a una cadena para poder usarlo como dependencia de
  // los efectos: un objeto nuevo en cada render reabriría el hilo sin parar.
  const targetKey =
    target === null
      ? null
      : target.kind === 'agent'
        ? `agent:${target.idAgent}`
        : `group:${target.idConversation}`;
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Cursor del sondeo: id del último mensaje REAL que ya tenemos.
  const cursorRef = useRef(0);
  const olderCursorRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Inserta mensajes nuevos sin duplicar y sin perder el orden por id. */
  const mergeMessages = useCallback((incoming: ChatMessageDto[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const known = new Set(prev.filter((m) => !m.pending).map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return prev;

      // Un mensaje propio que vuelve del servidor reemplaza a su optimista.
      const pendingBodies = new Set(
        fresh.filter((m) => m.role === 'user').map((m) => m.body)
      );
      const base = prev.filter(
        (m) => !(m.pending && m.role === 'user' && pendingBodies.has(m.body))
      );

      return [...base, ...fresh].sort((a, b) => {
        if (a.pending && !b.pending) return 1;
        if (!a.pending && b.pending) return -1;
        return a.id - b.id;
      });
    });
  }, []);

  /* ─────────────────────── Abrir / cargar el hilo ─────────────────────── */

  useEffect(() => {
    clearTimer();
    abortRef.current?.abort();
    conversationIdRef.current = null;
    cursorRef.current = 0;
    olderCursorRef.current = null;
    setConversation(null);
    setMessages([]);
    setStatus(null);
    setStatuses([]);
    setError(null);
    setHasOlder(false);

    if (target === null) return;

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        let conversacion: ChatConversationDto | null = null;

        if (target.kind === 'agent') {
          // Idempotente: si ya existe el hilo con este agente, lo devuelve.
          const res = await chatFetch('/api/chat/conversations', {
            method: 'POST',
            body: JSON.stringify({ idAgent: target.idAgent }),
          });

          if (!res.ok) {
            if (cancelled) return;
            setError(
              res.status === 403
                ? 'No tiene permiso para hablar con este asistente.'
                : 'No se pudo abrir la conversación.'
            );
            setLoading(false);
            return;
          }

          const data = (await res.json()) as { conversation: ChatConversationDto };
          conversacion = data.conversation ?? null;
        } else {
          // Un grupo ya existe: se lee su ficha. 404 = no es suyo o no está en
          // él (el servidor no distingue las dos cosas a propósito).
          const res = await chatFetch(`/api/chat/conversations/${target.idConversation}`);
          if (!res.ok) {
            if (cancelled) return;
            setError(
              res.status === 404
                ? 'Este grupo no existe o usted no forma parte de él.'
                : 'No se pudo abrir el grupo.'
            );
            setLoading(false);
            return;
          }
          const data = (await res.json()) as { conversation: ChatConversationDto };
          conversacion = data.conversation ?? null;
        }

        if (cancelled || !conversacion) return;
        const data = { conversation: conversacion };

        conversationIdRef.current = data.conversation.id;
        setConversation(data.conversation);
        setStatus(data.conversation.agentStatus);
        setStatuses(data.conversation.agentStatuses ?? []);

        const history = await chatGetJson<{
          messages: ChatMessageDto[];
          hasMore: boolean;
          nextCursor: number | null;
        }>(`/api/chat/conversations/${data.conversation.id}/messages?limit=${MESSAGES_PAGE_DEFAULT}`);

        if (cancelled) return;

        // El endpoint devuelve del más nuevo al más viejo; la vista los quiere
        // en orden cronológico.
        const ordered = [...(history?.messages ?? [])].sort((a, b) => a.id - b.id);
        setMessages(ordered);
        setHasOlder(Boolean(history?.hasMore));
        olderCursorRef.current = history?.nextCursor ?? null;
        cursorRef.current = ordered.length > 0 ? ordered[ordered.length - 1].id : 0;
      } catch (err) {
        if (!cancelled && !isAbortError(err)) {
          setError('No se pudo abrir la conversación.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimer();
      abortRef.current?.abort();
    };
    // ⚠️ SOLO `targetKey`, NUNCA `target`: el objeto se construye nuevo en cada
    // render, así que ponerlo aquí reabriría el hilo en cada render —
    // recargando el histórico y perdiendo el desplazamiento— sin que nada haya
    // cambiado. La cadena captura lo único que importa: cuál hilo es.
  }, [targetKey, clearTimer]);

  /* ──────────────────────────── Sondeo en vivo ────────────────────────── */

  const scheduleNext = useCallback((ms: number) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => void pollRef.current?.(), Math.max(500, ms));
  }, [clearTimer]);

  // Ref al ciclo de sondeo para poder reprogramarlo desde dentro sin
  // recrear el efecto en cada vuelta.
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  const poll = useCallback(async () => {
    const conversationId = conversationIdRef.current;
    if (conversationId === null) return;

    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await chatGetJson<ChatPollDto>(
        `/api/chat/conversations/${conversationId}/poll?after=${cursorRef.current}&hidden=${hidden ? 1 : 0}`,
        controller.signal
      );

      if (controller.signal.aborted) return;

      if (!data) {
        // Un fallo puntual no debe matar el sondeo: se reintenta despacio.
        scheduleNext(FALLBACK_POLL_MS);
        return;
      }

      if (data.messages.length > 0) {
        mergeMessages(data.messages);
        cursorRef.current = data.cursor;
        // La barra de la cabecera debe enterarse del mensaje nuevo.
        notifyChatRefresh();
      }
      setStatus(data.status);
      // Un sondeo viejo (o un front por delante de la API) no trae el
      // desglose: se deja lo que había en vez de vaciar el encabezado.
      if (data.statuses) setStatuses(data.statuses);

      // ⬅️ La cadencia la ordena el servidor.
      scheduleNext(data.nextPollMs);
    } catch (err) {
      if (isAbortError(err)) return;
      scheduleNext(FALLBACK_POLL_MS);
    }
  }, [mergeMessages, scheduleNext]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (targetKey === null || conversation === null) return;

    void poll();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimer();
      abortRef.current?.abort();
    };
    // `poll` es estable (useCallback con dependencias estables).
  }, [targetKey, conversation, poll, clearTimer]);

  /* ─────────────────────────────── Acciones ───────────────────────────── */

  const send = useCallback(
    async (body: string, files: File[] = []): Promise<boolean> => {
      const conversationId = conversationIdRef.current;
      const text = body.trim();
      // Con adjuntos el texto puede ir vacío; sin nada de nada, no se envía.
      if (conversationId === null || (text.length === 0 && files.length === 0)) return false;

      const optimisticId = -Date.now();
      setSending(true);
      setError(null);
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          role: 'user',
          body: text,
          createdAt: new Date().toISOString(),
          deliveredAt: null,
          readAt: null,
          // Los adjuntos optimistas se muestran con id negativo: todavía no
          // existen en la base y su enlace de descarga aún no sirve. La
          // respuesta del servidor los reemplaza por los reales.
          attachments: files.map((file, index) => ({
            id: optimisticId - index - 1,
            fileName: file.name,
            contentType: file.type || null,
            sizeBytes: file.size,
            downloadUrl: '',
          })),
          pending: true,
        },
      ]);

      try {
        // Con adjuntos hay que ir en multipart; sin adjuntos se conserva el
        // JSON de siempre (mismo nombre de campo `body` en ambos casos).
        let res: Response;
        if (files.length > 0) {
          const form = new FormData();
          form.append('body', text);
          for (const file of files) form.append('files', file);
          // Sin `Content-Type` a mano: el navegador tiene que ponerlo con su
          // propio `boundary`, si no el servidor no puede leer el formulario.
          res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
            method: 'POST',
            body: form,
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          });
        } else {
          res = await chatFetch(`/api/chat/conversations/${conversationId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ body: text }),
          });
        }

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(payload?.error ?? 'No se pudo enviar el mensaje.');
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m))
          );
          return false;
        }

        const data = (await res.json()) as { message: ChatMessageDto };
        setMessages((prev) => {
          const withoutOptimistic = prev.filter((m) => m.id !== optimisticId);
          return [...withoutOptimistic, data.message].sort((a, b) => a.id - b.id);
        });
        cursorRef.current = Math.max(cursorRef.current, data.message.id);

        // Tras enviar queremos ver la respuesta cuanto antes: se fuerza una
        // vuelta inmediata y el servidor decide la cadencia desde ahí.
        void poll();
        notifyChatRefresh();
        return true;
      } catch (err) {
        if (!isAbortError(err)) setError('No se pudo enviar el mensaje.');
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m))
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [poll]
  );

  const loadOlder = useCallback(async () => {
    const conversationId = conversationIdRef.current;
    const before = olderCursorRef.current;
    if (conversationId === null || before === null) return;

    setLoadingOlder(true);
    try {
      const data = await chatGetJson<{
        messages: ChatMessageDto[];
        hasMore: boolean;
        nextCursor: number | null;
      }>(
        `/api/chat/conversations/${conversationId}/messages?limit=${MESSAGES_PAGE_DEFAULT}&before=${before}`
      );
      if (!data) return;

      const ordered = [...data.messages].sort((a, b) => a.id - b.id);
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...ordered.filter((m) => !known.has(m.id)), ...prev];
      });
      setHasOlder(data.hasMore);
      olderCursorRef.current = data.nextCursor;
    } finally {
      setLoadingOlder(false);
    }
  }, []);

  const markRead = useCallback(async () => {
    const conversationId = conversationIdRef.current;
    if (conversationId === null) return;
    if (!messages.some((m) => m.role === 'agent' && !m.readAt)) return;

    try {
      const res = await chatFetch(`/api/chat/conversations/${conversationId}/read`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const now = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) => (m.role === 'agent' && !m.readAt ? { ...m, readAt: now } : m))
      );
      notifyChatRefresh();
    } catch {
      /* leer es cosmético: si falla, se reintenta en el próximo cambio */
    }
  }, [messages]);

  // Con el hilo a la vista, lo que llegue se marca leído solo.
  useEffect(() => {
    if (!active) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void markRead();
  }, [active, markRead]);

  return {
    conversation,
    messages,
    status,
    statuses,
    loading,
    sending,
    error,
    hasOlder,
    loadingOlder,
    send,
    loadOlder,
    markRead,
  };
}

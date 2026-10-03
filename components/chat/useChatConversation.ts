'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAT_THREAD_POKE_EVENT,
  chatFetch,
  chatGetJson,
  isAbortError,
  notifyChatRefresh,
  notificarActividad,
  type ChatConversationDto,
  type ChatMessageDto,
  type ChatAgentStatusDto,
  type ChatPollDto,
  type ChatReplyToDto,
  type ChatStatusDto,
} from '../../lib/chat/client';
import { MESSAGES_PAGE_DEFAULT } from '../../lib/chat/constants';
import { avisarMensajeEntrante, mensajeFresco } from '../../lib/chat/message-sound';

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
 * Caché en memoria del último estado visto de cada hilo (por `targetKey`).
 * Al reabrir un hilo ya visitado se pinta de una vez lo que había —sin
 * esqueleto, sin el "refresco" que Nicolás veía al abrir el chat— y la carga
 * fresca corre por detrás. Vive lo que vive la pestaña; no es persistente.
 */
interface HiloEnCache {
  conversation: ChatConversationDto;
  messages: ChatMessageDto[];
  hasOlder: boolean;
  olderCursor: number | null;
}
const cacheHilos = new Map<string, HiloEnCache>();

/** Precargas en curso, para no repetir la misma petición por cada toque. */
const precargasEnCurso = new Set<string>();

/**
 * Precarga el histórico de un hilo DIRECTO que ya existe, antes de abrirlo.
 *
 * Se llama al pasar el cursor o al empezar a tocar la tarjeta del asistente:
 * entre el `pointerdown` y el `click` pasan ~100-200 ms que antes se perdían.
 * Solo hace un GET del histórico de una conversación que ya existe (la bandeja
 * trae su ficha), así que no crea nada en el servidor. Si el hilo ya está en
 * caché no hace nada: la recarga fresca la hace el propio hook al abrir.
 */
export function precargarHiloDeAgente(
  idAgent: number,
  conversation: ChatConversationDto | null
): void {
  if (!conversation) return;
  const clave = `agent:${idAgent}`;
  if (cacheHilos.has(clave) || precargasEnCurso.has(clave)) return;
  precargasEnCurso.add(clave);
  chatGetJson<{ messages: ChatMessageDto[]; hasMore: boolean; nextCursor: number | null }>(
    `/api/chat/conversations/${conversation.id}/messages?limit=${MESSAGES_PAGE_DEFAULT}`
  )
    .then((history) => {
      if (!history || cacheHilos.has(clave)) return;
      cacheHilos.set(clave, {
        conversation,
        messages: [...(history.messages ?? [])].sort((a, b) => a.id - b.id),
        hasOlder: Boolean(history.hasMore),
        olderCursor: history.nextCursor ?? null,
      });
    })
    .catch(() => null)
    .finally(() => precargasEnCurso.delete(clave));
}

/**
 * Qué hilo abrir.
 *   - `agent`: la conversación de esta persona con ese agente. Si no existe,
 *     el servidor la crea (POST /api/chat/conversations es idempotente).
 *   - `group`: un grupo que YA existe, identificado por su id de conversación.
 */
export type ChatTarget =
  | {
      kind: 'agent';
      idAgent: number;
      /**
       * Id del hilo si la bandeja ya lo conoce. Con él, el histórico se pide EN
       * PARALELO con el POST que abre el hilo y se pinta en cuanto llega, en
       * vez de esperar los dos viajes en fila. NO entra en `targetKey`: que la
       * bandeja lo descubra después no debe reabrir el hilo.
       */
      idConversation?: number | null;
    }
  | { kind: 'group'; idConversation: number }
  /** Hilo privado entre dos personas: ya existe y se abre por su id. */
  | { kind: 'people'; idConversation: number };

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
  /** `cita` = mensaje al que responde, o null. */
  send: (body: string, files?: File[], cita?: ChatReplyToDto | null) => Promise<boolean>;
  loadOlder: () => Promise<void>;
  markRead: () => Promise<void>;
}

export function useChatConversation(
  target: ChatTarget | null,
  active: boolean,
  opciones?: {
    /**
     * Quién soy. Con varias personas en el hilo, un mensaje de OTRA persona
     * con el mismo texto que mi optimista no debe reemplazarlo (ver
     * mergeMessages). Sin esto se usa solo el `role`, como en el hilo directo.
     */
    miId?: string;
    /**
     * Llega un ZUMBIDO de otra persona por el sondeo. Va en una referencia, no
     * como dependencia: cambiarla no debe reabrir el hilo ni reprogramar el
     * sondeo, y el efecto (la sacudida) no pasa por el estado de React.
     */
    onZumbido?: (mensaje: ChatMessageDto) => void;
  }
): ChatThreadState {
  const miIdRef = useRef(opciones?.miId);
  miIdRef.current = opciones?.miId;
  const onZumbidoRef = useRef(opciones?.onZumbido);
  onZumbidoRef.current = opciones?.onZumbido;

  // El objetivo se aplana a una cadena para poder usarlo como dependencia de
  // los efectos: un objeto nuevo en cada render reabriría el hilo sin parar.
  const targetKey =
    target === null
      ? null
      : target.kind === 'agent'
        ? `agent:${target.idAgent}`
        : `${target.kind}:${target.idConversation}`;

  // EL PRIMER RENDER YA SALE DE LA CACHÉ. Antes el estado arrancaba vacío y
  // con `loading = false`, y la caché se aplicaba en un efecto —después del
  // primer pintado—: al abrir el chat se alcanzaba a ver un cuadro con
  // "Todavía no han hablado", luego el esqueleto y luego los mensajes. Ese
  // parpadeo era el "golpe" que Nicolás veía al abrir el chat.
  const [inicial] = useState(() => (targetKey !== null ? cacheHilos.get(targetKey) : undefined));
  const [conversation, setConversation] = useState<ChatConversationDto | null>(
    inicial?.conversation ?? null
  );
  const [messages, setMessages] = useState<ChatMessageDto[]>(() =>
    (inicial?.messages ?? []).filter((m) => !m.pending && !m.failed)
  );
  const [status, setStatus] = useState<ChatStatusDto | null>(
    inicial?.conversation.agentStatus ?? null
  );
  const [statuses, setStatuses] = useState<ChatAgentStatusDto[]>(
    inicial?.conversation.agentStatuses ?? []
  );
  const [loading, setLoading] = useState(target !== null && !inicial);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(inicial?.hasOlder ?? false);
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
      // "Propio" lo dice el AUTOR cuando se conoce: en un hilo con otra
      // persona, que ella escriba "ok" justo cuando yo mando "ok" no puede
      // borrarme el mío de la pantalla. Sin autor (respuesta vieja) o sin saber
      // quién soy, se conserva el criterio de siempre.
      const yo = miIdRef.current;
      const pendingBodies = new Set(
        fresh
          .filter(
            (m) =>
              m.role === 'user' &&
              (!yo || !m.author || m.author.kind !== 'user' || String(m.author.id) === yo)
          )
          .map((m) => m.body)
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
    const enCache = targetKey !== null ? cacheHilos.get(targetKey) : undefined;
    if (enCache) {
      // Hilo ya visitado: se muestra lo que había mientras llega lo fresco.
      const reales = enCache.messages.filter((m) => !m.pending && !m.failed);
      conversationIdRef.current = enCache.conversation.id;
      cursorRef.current = reales.length > 0 ? reales[reales.length - 1].id : 0;
      olderCursorRef.current = enCache.olderCursor;
      setConversation(enCache.conversation);
      setMessages(reales);
      setStatus(enCache.conversation.agentStatus);
      setStatuses(enCache.conversation.agentStatuses ?? []);
      setHasOlder(enCache.hasOlder);
    } else {
      conversationIdRef.current = null;
      cursorRef.current = 0;
      olderCursorRef.current = null;
      setConversation(null);
      setMessages([]);
      setStatus(null);
      setStatuses([]);
      setHasOlder(false);
    }
    setError(null);

    if (target === null) return;

    let cancelled = false;
    // Con caché no se vuelve a "cargar": nada de esqueleto ni compositor
    // deshabilitado. La recarga es silenciosa.
    setLoading(!enCache);

    type Historial = {
      messages: ChatMessageDto[];
      hasMore: boolean;
      nextCursor: number | null;
    };
    const pedirHistorial = (idConversation: number) =>
      chatGetJson<Historial>(
        `/api/chat/conversations/${idConversation}/messages?limit=${MESSAGES_PAGE_DEFAULT}`
      );

    const aplicarHistorial = (history: Historial | null) => {
      // El endpoint devuelve del más nuevo al más viejo; la vista los quiere
      // en orden cronológico.
      const ordered = [...(history?.messages ?? [])].sort((a, b) => a.id - b.id);
      // Se conservan los optimistas que el usuario haya enviado mientras
      // tanto (con caché el compositor ya estaba habilitado).
      setMessages((prev) => [...ordered, ...prev.filter((m) => m.pending || m.failed)]);
      setHasOlder(Boolean(history?.hasMore));
      olderCursorRef.current = history?.nextCursor ?? null;
      cursorRef.current = ordered.length > 0 ? ordered[ordered.length - 1].id : 0;
    };

    void (async () => {
      try {
        let conversacion: ChatConversationDto | null = null;
        // Si ya se conoce el id del hilo, el histórico se pide EN PARALELO con
        // la ficha, en vez de esperar a que vuelva el POST (dos viajes en fila
        // eran la mayor parte de la espera al abrir).
        //
        // Sin caché también se adelanta si la bandeja ya trae el id del hilo
        // (2026-09-29): antes, la primera apertura de un hilo esperaba el POST
        // y DESPUÉS pedía el histórico, y el área de mensajes quedaba en
        // blanco los dos viajes. Ahora el histórico se pinta en cuanto llega,
        // aunque el POST no haya vuelto (el compositor sí espera al POST).
        //
        // Grupos y hilos entre personas (2026-10-03): su id SIEMPRE se conoce
        // de entrada, así que el histórico sale en paralelo con la ficha en vez
        // de esperarla. No abre ningún permiso: el endpoint del histórico
        // valida el acceso por su cuenta (404 → null, y no se pinta nada).
        const idConocido =
          enCache?.conversation.id ??
          (target.kind === 'agent' ? (target.idConversation ?? null) : target.idConversation);
        const historialAnticipado = idConocido !== null ? pedirHistorial(idConocido) : null;
        // Si el anticipado falla, no debe quedar como promesa rechazada suelta.
        historialAnticipado?.catch(() => null);
        if (historialAnticipado && !enCache) {
          void historialAnticipado
            .then((history) => {
              // Solo si el POST todavía no volvió: si ya volvió, él aplica el
              // histórico (y confirma que el id era el correcto).
              if (!cancelled && history && conversationIdRef.current === null) {
                aplicarHistorial(history);
              }
            })
            .catch(() => null);
        }

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
          // Un grupo (o un hilo entre personas) ya existe: se lee su ficha.
          // 404 = no es suyo o no está en él (el servidor no distingue las dos
          // cosas a propósito).
          const res = await chatFetch(`/api/chat/conversations/${target.idConversation}`);
          if (!res.ok) {
            if (cancelled) return;
            const esPersonas = target.kind === 'people';
            setError(
              res.status === 404
                ? esPersonas
                  ? 'Esta conversación no existe o ya no tiene acceso a ella.'
                  : 'Este grupo no existe o usted no forma parte de él.'
                : esPersonas
                  ? 'No se pudo abrir la conversación.'
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

        const history =
          historialAnticipado && idConocido === data.conversation.id
            ? await historialAnticipado
            : await pedirHistorial(data.conversation.id);

        if (cancelled) return;

        aplicarHistorial(history);
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

  // Mantiene la caché del hilo al día con lo último que se ve.
  useEffect(() => {
    if (targetKey === null || conversation === null) return;
    if (conversationIdRef.current !== conversation.id) return;
    cacheHilos.set(targetKey, {
      conversation,
      messages,
      hasOlder,
      olderCursor: olderCursorRef.current,
    });
  }, [targetKey, conversation, messages, hasOlder]);

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
        // Zumbidos de OTRA persona que llegan en esta vuelta (los del
        // historial al abrir no pasan por aquí: no se sacude por lo viejo).
        const yo = miIdRef.current;
        for (const m of data.messages) {
          if (m.eventType === 'nudge' && m.author && String(m.author.id) !== yo) {
            onZumbidoRef.current?.(m);
          }
        }
        // Sonido de mensaje nuevo si llegó algo de otra persona o de un agente
        // y no lo está viendo (pestaña oculta o sin foco). Lo propio y los
        // eventos de sistema (zumbido) no suenan aquí.
        if (
          data.messages.some(
            (m) =>
              !m.eventType &&
              mensajeFresco(m.createdAt) &&
              (m.role === 'agent' ||
                (m.role === 'user' && Boolean(m.author) && Boolean(yo) && String(m.author?.id) !== yo))
          )
        ) {
          avisarMensajeEntrante(conversationId);
        }
        // La conversación sube de primera en las listas ya mismo.
        const ultimo = data.messages[data.messages.length - 1];
        if (ultimo) notificarActividad(conversationId, ultimo.createdAt);
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

  // Por el ID del hilo y no por el objeto: el POST de apertura devuelve una
  // ficha nueva (mismo hilo) y, con el objeto como dependencia, el sondeo se
  // cancelaba y arrancaba de nuevo sin motivo.
  const idConversacionAbierta = conversation?.id ?? null;
  useEffect(() => {
    if (targetKey === null || idConversacionAbierta === null) return;

    void poll();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // "Pregunta ya": lo manda el pulso global o el botón del zumbido cuando
    // sabe que hay algo nuevo en ESTE hilo (ver pedirSondeoDelHilo).
    const onPoke = (event: Event) => {
      const id = (event as CustomEvent<{ idConversation?: number }>).detail?.idConversation;
      if (id === idConversacionAbierta) void poll();
    };
    window.addEventListener(CHAT_THREAD_POKE_EVENT, onPoke);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(CHAT_THREAD_POKE_EVENT, onPoke);
      clearTimer();
      abortRef.current?.abort();
    };
    // `poll` es estable (useCallback con dependencias estables).
  }, [targetKey, idConversacionAbierta, poll, clearTimer]);

  /* ─────────────────────────────── Acciones ───────────────────────────── */

  const send = useCallback(
    async (
      body: string,
      files: File[] = [],
      cita: ChatReplyToDto | null = null
    ): Promise<boolean> => {
      const conversationId = conversationIdRef.current;
      const text = body.trim();
      // Con adjuntos el texto puede ir vacío; sin nada de nada, no se envía.
      if (conversationId === null || (text.length === 0 && files.length === 0)) return false;

      const optimisticId = -Date.now();
      // Optimista: la conversación sube de primera en las listas al enviar.
      notificarActividad(conversationId, new Date().toISOString());
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
          // La cita se pinta de una en el mensaje optimista: el usuario tiene
          // que ver a qué respondió sin esperar la vuelta del servidor.
          replyTo: cita,
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
          if (cita) form.append('replyTo', String(cita.idMessage));
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
            body: JSON.stringify({ body: text, ...(cita ? { replyTo: cita.idMessage } : {}) }),
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

  // Hasta qué mensaje ya se marcó leído un hilo entre personas (ver abajo).
  const marcadoHastaRef = useRef(0);
  useEffect(() => {
    marcadoHastaRef.current = 0;
  }, [targetKey]);

  const esEntrePersonas = target?.kind === 'people';

  const markRead = useCallback(async () => {
    const conversationId = conversationIdRef.current;
    if (conversationId === null) return;

    // ENTRE PERSONAS no hay mensajes de agente: lo que hay que leer es lo que
    // escribió la otra persona, y el "leído" es la marca de agua de cada quien
    // (chat_participant.last_read_message_id). Se manda hasta el último
    // mensaje real que se ve, y una sola vez por mensaje nuevo.
    if (esEntrePersonas) {
      let ultimo = 0;
      for (const m of messages) if (!m.pending && !m.failed && m.id > ultimo) ultimo = m.id;
      if (ultimo === 0 || ultimo <= marcadoHastaRef.current) return;
      marcadoHastaRef.current = ultimo;
      try {
        const res = await chatFetch(`/api/chat/conversations/${conversationId}/read`, {
          method: 'POST',
          body: JSON.stringify({ upToMessageId: ultimo }),
        });
        if (res.ok) notifyChatRefresh();
      } catch {
        // Se reintenta con el próximo mensaje: leer es cosmético.
        marcadoHastaRef.current = 0;
      }
      return;
    }

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
  }, [messages, esEntrePersonas]);

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

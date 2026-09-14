'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  CHAT_REFRESH_EVENT,
  chatGetJson,
  isAbortError,
  type ChatAccessDto,
  type ChatAgentDto,
  type ChatConversationDto,
  type ChatStatusDto,
} from '../../lib/chat/client';

/**
 * Estado compartido de "qué agentes tengo y cómo están": alimenta tanto los
 * avatares de la barra superior como la página /process/chat.
 *
 * Dos fuentes, a propósito:
 *   - /api/chat/access      → catálogo de agentes permitidos (cambia poco: se
 *                             pide al montar y cuando algo lo invalida).
 *   - /api/chat/conversations → no leídos y estado en vivo por hilo (es lo que
 *                             entra en el sondeo recurrente).
 *
 * Separarlas evita resolver los permisos dos veces en cada vuelta del sondeo:
 * las dos rutas llaman a getChatAccess() por dentro.
 *
 * Cadencia: 30 s, igual que NotificationBell, y PAUSADA con la pestaña oculta
 * (mismo criterio del sondeo del hilo, ver lib/chat/polling.ts). Esta barra no
 * necesita ser instantánea: el hilo abierto tiene su propio sondeo adaptativo.
 */

const OVERVIEW_POLL_MS = 30_000;

/*
 * CACHÉ EN MEMORIA, COMPARTIDA ENTRE MONTAJES.
 *
 * Pedido de Nicolás (2026-09-09): "quiero también añadir caching". El síntoma
 * era este: el hook arrancaba con `access = null` y cero conversaciones EN CADA
 * MONTAJE, así que cada vez que se entraba al chat o se cambiaba de asistente,
 * la pantalla volvía a empezar de cero y aparecía el giratorio, aunque los
 * datos hubieran llegado hace tres segundos.
 *
 * Ahora el primer render sale de lo último que se supo, y la petición corre
 * detrás y actualiza en silencio: quien vuelve al chat lo ve poblado de
 * inmediato. Lo viejo se ve un instante — es preferible a un vacío.
 *
 * ⚠️ SEPARADA POR USUARIO. Es memoria del proceso del navegador y sobrevive a
 * los cambios de página; si dos personas usan la misma pestaña, la segunda
 * NO puede alcanzar a ver las conversaciones de la primera. Por eso la caché
 * guarda de quién es y se descarta entera si el correo no coincide.
 *
 * No se persiste en `localStorage` a propósito: son conversaciones de trabajo
 * y no tienen por qué quedar escritas en el disco de nadie.
 */
type CacheChat = {
  email: string;
  access: ChatAccessDto | null;
  conversations: ChatConversationDto[];
};

let cache: CacheChat | null = null;

function leerCache(email: string | null | undefined): CacheChat | null {
  if (!email || !cache || cache.email !== email) return null;
  return cache;
}

function escribirCache(email: string | null | undefined, parcial: Partial<CacheChat>): void {
  if (!email) return;
  if (!cache || cache.email !== email) {
    cache = { email, access: null, conversations: [] };
  }
  Object.assign(cache, parcial);
}

export interface ChatOverview {
  ready: boolean;
  loading: boolean;
  canUseChat: boolean;
  /** Si el usuario puede usar el mensaje masivo (administradores). */
  canBroadcast: boolean;
  /** Si el usuario puede crear grupos (administradores). */
  canCreateGroups: boolean;
  agents: ChatAgentDto[];
  /** TODAS las conversaciones: hilos directos y grupos. */
  conversations: ChatConversationDto[];
  /** Solo los grupos, ya separados y ordenados por actividad. */
  groups: ChatConversationDto[];
  unreadByAgent: Map<number, number>;
  statusByAgent: Map<number, ChatStatusDto | null>;
  conversationByAgent: Map<number, ChatConversationDto>;
  /** No leídos de los HILOS DIRECTOS (lo que suman los avatares de la barra). */
  totalUnread: number;
  /** No leídos de los GRUPOS, aparte. */
  groupUnread: number;
  refresh: () => void;
}

export function useChatOverview(): ChatOverview {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated' && Boolean(session?.user?.email);

  const email = session?.user?.email ?? null;
  // El primer render sale de la caché, no de un vacío. Si no hay nada guardado
  // para este usuario, se cae al estado de siempre y se ve el esqueleto.
  const inicial = leerCache(email);

  const [access, setAccess] = useState<ChatAccessDto | null>(inicial?.access ?? null);
  const [conversations, setConversations] = useState<ChatConversationDto[]>(
    inicial?.conversations ?? []
  );
  const [loading, setLoading] = useState(false);

  const accessAbort = useRef<AbortController | null>(null);
  const listAbort = useRef<AbortController | null>(null);
  const inFlight = useRef(false);

  const fetchAccess = useCallback(async () => {
    if (!isAuthenticated) return;
    accessAbort.current?.abort();
    const controller = new AbortController();
    accessAbort.current = controller;
    try {
      const data = await chatGetJson<ChatAccessDto>('/api/chat/access', controller.signal);
      if (controller.signal.aborted || !data) return;
      setAccess(data);
      escribirCache(email, { access: data });
    } catch (err) {
      if (!isAbortError(err)) {
        // Silencioso a propósito: es una barra secundaria, no debe romper la
        // cabecera si la API falla un momento.
      }
    }
  }, [isAuthenticated, email]);

  const fetchConversations = useCallback(async () => {
    if (!isAuthenticated || typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') return;
    if (inFlight.current) return;

    listAbort.current?.abort();
    const controller = new AbortController();
    listAbort.current = controller;
    inFlight.current = true;
    setLoading(true);

    try {
      const data = await chatGetJson<{ conversations: ChatConversationDto[] }>(
        '/api/chat/conversations',
        controller.signal
      );
      if (controller.signal.aborted || !data) return;
      const lista = data.conversations ?? [];
      setConversations(lista);
      escribirCache(email, { conversations: lista });
    } catch (err) {
      if (!isAbortError(err)) {
        /* ver arriba */
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [isAuthenticated, email]);

  const refresh = useCallback(() => {
    void fetchAccess();
    void fetchConversations();
  }, [fetchAccess, fetchConversations]);

  useEffect(() => {
    if (!isAuthenticated) {
      // Se cierra la sesión: fuera el estado Y la caché. Lo que se guardó es de
      // alguien que ya no está en esta pestaña.
      cache = null;
      setAccess(null);
      setConversations([]);
      return;
    }

    void fetchAccess();

    // Pequeño retraso inicial: la cabecera se pinta primero (mismo truco que
    // NotificationBell para no competir con la carga de la página).
    const first = window.setTimeout(() => void fetchConversations(), 800);
    const interval = window.setInterval(() => void fetchConversations(), OVERVIEW_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchConversations();
    };
    const onRefresh = () => refresh();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(CHAT_REFRESH_EVENT, onRefresh);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(CHAT_REFRESH_EVENT, onRefresh);
      accessAbort.current?.abort();
      listAbort.current?.abort();
    };
  }, [isAuthenticated, fetchAccess, fetchConversations, refresh]);

  const derived = useMemo(() => {
    const unreadByAgent = new Map<number, number>();
    const statusByAgent = new Map<number, ChatStatusDto | null>();
    const conversationByAgent = new Map<number, ChatConversationDto>();

    // ⚠️ SOLO LOS HILOS DIRECTOS. En un grupo, `conversation.agent` es el
    // agente ANFITRIÓN y no significa que el hilo sea de él: si los grupos
    // entraran aquí, sus no leídos se le sumarían al contador del avatar de
    // ese agente en la barra superior y abrir su chat directo no los bajaría
    // —quedaría un número pegado que nadie puede quitar—.
    const directas = conversations.filter((c) => c.kind !== 'group');
    const groups = conversations.filter((c) => c.kind === 'group');

    for (const conversation of directas) {
      const id = conversation.agent.idAgent;
      unreadByAgent.set(id, (unreadByAgent.get(id) ?? 0) + conversation.unreadCount);
      if (!conversationByAgent.has(id)) {
        conversationByAgent.set(id, conversation);
        statusByAgent.set(id, conversation.agentStatus);
      }
    }

    let totalUnread = 0;
    for (const value of unreadByAgent.values()) totalUnread += value;

    let groupUnread = 0;
    for (const g of groups) groupUnread += g.unreadCount;

    return { unreadByAgent, statusByAgent, conversationByAgent, totalUnread, groups, groupUnread };
  }, [conversations]);

  return {
    ready: access !== null,
    loading,
    canUseChat: access?.canUseChat ?? false,
    canBroadcast: access?.canBroadcast ?? false,
    canCreateGroups: access?.canCreateGroups ?? false,
    agents: access?.agents ?? [],
    conversations,
    ...derived,
    refresh,
  };
}

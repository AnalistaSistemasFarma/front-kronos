'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  CHAT_ACTIVITY_EVENT,
  CHAT_REFRESH_EVENT,
  chatGetJson,
  type ChatActivityDetail,
  isAbortError,
  type ChatAccessDto,
  type ChatAgentDto,
  type ChatConversationDto,
  type ChatStatusDto,
} from '../../lib/chat/client';
import { olvidarNoLeidos, revisarNoLeidos } from '../../lib/chat/message-sound';
import { bumpConversationActivity } from '../../lib/chat/rail';

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
  /** Ya llegó al menos una respuesta de /api/chat/conversations. */
  conversationsLoaded?: boolean;
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

/*
 * PETICIONES COMPARTIDAS ENTRE LAS DOS INSTANCIAS DEL HOOK (2026-10-03).
 *
 * En la página del chat el hook vive DOS veces: en la barra de la cabecera
 * (ChatRail) y en la propia página (ChatWorkspace). Cada una sondeaba por su
 * cuenta y las dos escuchan `notifyChatRefresh()`, que se dispara con cada
 * mensaje que llega, cada envío y cada "leído". Resultado: cada evento pedía
 * DOS veces /api/chat/access y DOS veces /api/chat/conversations (la consulta
 * más pesada del chat), justo en el momento en que la persona espera ver su
 * mensaje.
 *
 * Ahora hay UNA sola petición en vuelo por usuario y su respuesta se reparte a
 * todas las instancias. Si llega otro pedido mientras tanto, se hace UNA
 * vuelta más al terminar (para no perder lo que cambió en el medio), no una
 * por pedido. El sondeo de 30 s se salta si otra instancia acaba de traer la
 * bandeja.
 *
 * La petición compartida tiene su PROPIO AbortController: que una instancia se
 * desmonte no le corta la respuesta a la otra.
 */
type ResultadoBandeja = { ok: true; lista: ChatConversationDto[] } | { ok: false };

const bandejaCompartida: {
  email: string | null;
  enVuelo: Promise<void> | null;
  /** Cuándo salió la petición en vuelo. */
  enVueloDesde: number;
  otraVuelta: boolean;
  ultimaRespuestaEn: number;
  oyentes: Set<(r: ResultadoBandeja) => void>;
} = {
  email: null,
  enVuelo: null,
  enVueloDesde: 0,
  otraVuelta: false,
  ultimaRespuestaEn: 0,
  oyentes: new Set(),
};

/**
 * Dos pedidos explícitos separados por menos de esto son el MISMO aviso
 * (`notifyChatRefresh()` lo oyen las dos instancias en el mismo instante): la
 * petición que acaba de salir ya ve lo que lo motivó.
 */
const MISMO_AVISO_MS = 300;

/**
 * Pide la bandeja una sola vez para todas las instancias.
 *
 * `recienteMs`: si se pasa, el pedido es "de mantenimiento" (sondeo, volver a
 * la pestaña, primera carga de la barra) y se salta si ya hay una petición en
 * camino o si la última respuesta tiene menos de esos milisegundos. Sin él es
 * un pedido EXPLÍCITO (algo cambió): si hay una en vuelo que salió antes del
 * aviso, se agenda UNA vuelta más al terminar.
 *
 * Devuelve `true` si hay (o queda) una petición en camino que va a responder.
 */
function pedirBandejaCompartida(email: string, opciones: { recienteMs?: number } = {}): boolean {
  if (bandejaCompartida.email !== email) {
    // Otro usuario en la pestaña: nada de lo anterior le sirve.
    bandejaCompartida.email = email;
    bandejaCompartida.enVuelo = null;
    bandejaCompartida.otraVuelta = false;
    bandejaCompartida.ultimaRespuestaEn = 0;
  }
  const deMantenimiento = opciones.recienteMs !== undefined;
  if (bandejaCompartida.enVuelo) {
    if (!deMantenimiento && Date.now() - bandejaCompartida.enVueloDesde > MISMO_AVISO_MS) {
      bandejaCompartida.otraVuelta = true;
    }
    return true;
  }
  if (
    deMantenimiento &&
    Date.now() - bandejaCompartida.ultimaRespuestaEn < (opciones.recienteMs ?? 0)
  ) {
    return false;
  }

  const vuelta = (async () => {
    let resultado: ResultadoBandeja = { ok: false };
    try {
      const data = await chatGetJson<{ conversations: ChatConversationDto[] }>(
        '/api/chat/conversations'
      );
      if (data) {
        resultado = { ok: true, lista: data.conversations ?? [] };
        // Sonido de mensaje nuevo: un no leído que sube (ver message-sound.ts).
        // Una vez por respuesta, no una por instancia.
        revisarNoLeidos(email, resultado.lista);
      }
    } catch {
      /* silencioso: es una barra secundaria, ver fetchAccess */
    }
    if (bandejaCompartida.email !== email) return;
    if (resultado.ok) bandejaCompartida.ultimaRespuestaEn = Date.now();
    for (const oyente of bandejaCompartida.oyentes) oyente(resultado);
  })();

  bandejaCompartida.enVuelo = vuelta;
  bandejaCompartida.enVueloDesde = Date.now();
  void vuelta.finally(() => {
    if (bandejaCompartida.enVuelo !== vuelta) return;
    bandejaCompartida.enVuelo = null;
    if (bandejaCompartida.otraVuelta) {
      bandejaCompartida.otraVuelta = false;
      pedirBandejaCompartida(email);
    }
  });
  return true;
}

/** Lo mismo para el catálogo: una sola petición en vuelo por usuario. */
const accesoEnVuelo = new Map<string, Promise<ChatAccessDto | null>>();

function pedirAccesoCompartido(email: string): Promise<ChatAccessDto | null> {
  const enCurso = accesoEnVuelo.get(email);
  if (enCurso) return enCurso;
  const peticion = chatGetJson<ChatAccessDto>('/api/chat/access').finally(() => {
    accesoEnVuelo.delete(email);
  });
  accesoEnVuelo.set(email, peticion);
  return peticion;
}

export interface ChatOverview {
  ready: boolean;
  loading: boolean;
  canUseChat: boolean;
  /** Si el usuario puede usar el mensaje masivo (administradores). */
  canBroadcast: boolean;
  /** Si el usuario puede crear grupos (administradores). */
  canCreateGroups: boolean;
  /** Piloto "Personas": puede INICIAR conversaciones con otras personas. */
  canMessagePeople: boolean;
  agents: ChatAgentDto[];
  /** TODAS las conversaciones: hilos directos y grupos. */
  conversations: ChatConversationDto[];
  /** Solo los grupos, ya separados y ordenados por actividad. */
  groups: ChatConversationDto[];
  /** Solo los hilos entre personas, ordenados por actividad. */
  people: ChatConversationDto[];
  unreadByAgent: Map<number, number>;
  statusByAgent: Map<number, ChatStatusDto | null>;
  conversationByAgent: Map<number, ChatConversationDto>;
  /** No leídos de los HILOS DIRECTOS (lo que suman los avatares de la barra). */
  totalUnread: number;
  /** No leídos de los GRUPOS, aparte. */
  groupUnread: number;
  /** No leídos de los hilos entre PERSONAS, aparte. */
  peopleUnread: number;
  /**
   * Ya se sabe cuál es el último mensaje de cada hilo. Mientras sea `false`,
   * la lista no debe pintar la descripción del agente en el lugar de la vista
   * previa: se vería la descripción y un instante después el último mensaje
   * encima (el "salto" que Nicolás vio en el iPhone, 2026-09-29).
   */
  conversationsReady: boolean;
  refresh: () => void;
}

export function useChatOverview(opciones?: {
  /**
   * Pedir la bandeja de una vez al montar, sin el retraso de 800 ms que usa la
   * barra superior. Lo usa la página del chat, donde la bandeja ES la pantalla.
   */
  primeraCargaInmediata?: boolean;
}): ChatOverview {
  const primeraCargaInmediata = opciones?.primeraCargaInmediata ?? false;
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
  const [conversationsReady, setConversationsReady] = useState(
    inicial?.conversationsLoaded ?? false
  );

  const accessAbort = useRef<AbortController | null>(null);
  // Última respuesta serializada: el sondeo de 30s trae casi siempre lo mismo
  // (nada nuevo que leer), y sin esto cada vuelta reemplazaba `conversations`
  // por un arreglo nuevo con el mismo contenido, disparando un re-render de
  // TODA la página de chat (barra de avatares, lista, no leídos) cada 30s
  // aunque no hubiera cambiado nada.
  const lastConversationsJson = useRef<string>(JSON.stringify(inicial?.conversations ?? []));
  // Lo mismo con el catálogo de agentes (2026-09-29). /api/chat/access se pide
  // otra vez con CADA `notifyChatRefresh()` —cada mensaje nuevo, cada envío,
  // cada "leído"— y casi siempre trae lo mismo; reemplazarlo daba agentes
  // nuevos (mismo contenido) a la página, y el hilo abierto re-renderizaba
  // todas sus burbujas porque su `agent` "cambiaba".
  const lastAccessJson = useRef<string>(JSON.stringify(inicial?.access ?? null));

  const fetchAccess = useCallback(async () => {
    if (!isAuthenticated || !email) return;
    accessAbort.current?.abort();
    const controller = new AbortController();
    accessAbort.current = controller;
    try {
      // Compartida con la otra instancia del hook (ver pedirAccesoCompartido).
      // El `controller` ya no corta la petición: solo descarta la respuesta si
      // esta instancia se desmontó o pidió otra.
      const data = await pedirAccesoCompartido(email);
      if (controller.signal.aborted || !data) return;
      const accessJson = JSON.stringify(data);
      if (accessJson === lastAccessJson.current) return;
      lastAccessJson.current = accessJson;
      setAccess(data);
      escribirCache(email, { access: data });
    } catch (err) {
      if (!isAbortError(err)) {
        // Silencioso a propósito: es una barra secundaria, no debe romper la
        // cabecera si la API falla un momento.
      }
    }
  }, [isAuthenticated, email]);

  // Aplica la respuesta de la bandeja compartida en ESTA instancia.
  const aplicarBandeja = useCallback(
    (resultado: ResultadoBandeja) => {
      if (resultado.ok) {
        const lista = resultado.lista;
        const listaJson = JSON.stringify(lista);
        if (listaJson === lastConversationsJson.current) {
          escribirCache(email, { conversationsLoaded: true });
        } else {
          lastConversationsJson.current = listaJson;
          setConversations(lista);
          escribirCache(email, { conversations: lista, conversationsLoaded: true });
        }
      }
      setLoading(false);
      // También si falló: con la API caída, mejor la descripción que un
      // renglón en blanco para siempre.
      setConversationsReady(true);
    },
    [email]
  );

  /** Ver `pedirBandejaCompartida` para el sentido de `recienteMs`. */
  const fetchConversations = useCallback(
    (opciones?: { recienteMs?: number }) => {
      if (!isAuthenticated || !email || typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') return;
      if (pedirBandejaCompartida(email, opciones)) setLoading(true);
    },
    [isAuthenticated, email]
  );

  const refresh = useCallback(() => {
    void fetchAccess();
    fetchConversations();
  }, [fetchAccess, fetchConversations]);

  useEffect(() => {
    if (!isAuthenticated) {
      // Se cierra la sesión: fuera el estado Y la caché. Lo que se guardó es de
      // alguien que ya no está en esta pestaña.
      cache = null;
      olvidarNoLeidos();
      setAccess(null);
      setConversations([]);
      setConversationsReady(false);
      lastConversationsJson.current = JSON.stringify([]);
      lastAccessJson.current = JSON.stringify(null);
      return;
    }

    bandejaCompartida.oyentes.add(aplicarBandeja);
    void fetchAccess();

    // Pequeño retraso inicial: la cabecera se pinta primero (mismo truco que
    // NotificationBell para no competir con la carga de la página).
    // La página del chat pide fresco; la barra se conforma con lo que la
    // página (u otra vuelta) haya traído hace un momento.
    const first = window.setTimeout(
      () => fetchConversations(primeraCargaInmediata ? undefined : { recienteMs: 5_000 }),
      primeraCargaInmediata ? 0 : 800
    );
    const interval = window.setInterval(
      // Si otra instancia trajo la bandeja hace poco, su respuesta ya llegó
      // aquí por el oyente: esta vuelta sobra.
      () => fetchConversations({ recienteMs: OVERVIEW_POLL_MS - 5_000 }),
      OVERVIEW_POLL_MS
    );

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchConversations({ recienteMs: 5_000 });
    };
    const onRefresh = () => refresh();
    // Envié o recibí en un hilo: sube de una en las listas, sin esperar a la
    // bandeja. La próxima respuesta del servidor manda (por eso se actualiza
    // también la última serialización: lo que llegue, se aplica).
    const onActividad = (event: Event) => {
      const detalle = (event as CustomEvent<ChatActivityDetail>).detail;
      if (!detalle) return;
      setConversations((prev) => {
        const next = bumpConversationActivity(prev, detalle.idConversation, detalle.at);
        if (next !== prev) {
          lastConversationsJson.current = JSON.stringify(next);
          escribirCache(email, { conversations: next });
        }
        return next;
      });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(CHAT_REFRESH_EVENT, onRefresh);
    window.addEventListener(CHAT_ACTIVITY_EVENT, onActividad);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(CHAT_REFRESH_EVENT, onRefresh);
      window.removeEventListener(CHAT_ACTIVITY_EVENT, onActividad);
      bandejaCompartida.oyentes.delete(aplicarBandeja);
      accessAbort.current?.abort();
    };
  }, [
    isAuthenticated,
    email,
    fetchAccess,
    fetchConversations,
    aplicarBandeja,
    refresh,
    primeraCargaInmediata,
  ]);

  const derived = useMemo(() => {
    const unreadByAgent = new Map<number, number>();
    const statusByAgent = new Map<number, ChatStatusDto | null>();
    const conversationByAgent = new Map<number, ChatConversationDto>();

    // ⚠️ SOLO LOS HILOS DIRECTOS. En un grupo, `conversation.agent` es el
    // agente ANFITRIÓN y no significa que el hilo sea de él: si los grupos
    // entraran aquí, sus no leídos se le sumarían al contador del avatar de
    // ese agente en la barra superior y abrir su chat directo no los bajaría
    // —quedaría un número pegado que nadie puede quitar—.
    // Un hilo sin `kind` es de antes de los grupos, o sea directo. Se pregunta
    // por 'direct' y no por "no es grupo": una clase nueva de conversación no
    // debe sumarse al contador de un agente por descarte.
    const directas = conversations.filter((c) => (c.kind ?? 'direct') === 'direct');
    const groups = conversations.filter((c) => c.kind === 'group');
    const people = conversations.filter((c) => c.kind === 'people');

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

    let peopleUnread = 0;
    for (const p of people) peopleUnread += p.unreadCount;

    return {
      unreadByAgent,
      statusByAgent,
      conversationByAgent,
      totalUnread,
      groups,
      groupUnread,
      people,
      peopleUnread,
    };
  }, [conversations]);

  return {
    ready: access !== null,
    loading,
    canUseChat: access?.canUseChat ?? false,
    canBroadcast: access?.canBroadcast ?? false,
    canCreateGroups: access?.canCreateGroups ?? false,
    canMessagePeople: access?.canMessagePeople ?? false,
    agents: access?.agents ?? [],
    conversations,
    ...derived,
    conversationsReady,
    refresh,
  };
}

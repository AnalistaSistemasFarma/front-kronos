/**
 * Realtime voice call session (Duo pilot), owned by the app — not by a chat
 * component.
 *
 * Until 2026-11-25 the call lived inside <ChatVoice>, so leaving the chat
 * (another SynerLink section, another conversation, closing the floating
 * panel) unmounted it and hung up. Nicolás (msg 39354): "si cambio de pestaña
 * se cuelga la llamada; eso debe quedar en segundo plano para yo ir
 * trabajando". This controller keeps the call alive for the whole page
 * lifetime; any component can observe it (`subscribe`/`getSnapshot`) and the
 * call only ends on hang up, on the 10-minute cap, when the page closes or
 * when the connection is really lost.
 *
 * Browser APIs are injected (`VoiceCallDeps`) so the rules are unit-tested in
 * Node; `voice-call-browser.ts` wires the real ones.
 */

export type VoiceCallStatus = 'idle' | 'connecting' | 'connected';

export interface VoiceCallSnapshot {
  status: VoiceCallStatus;
  conversationId: number | null;
  muted: boolean;
  /** Spanish, user-facing. Kept after the call ends until dismissed or a new call. */
  error: string;
  /** Epoch ms when the WebRTC connection was established. */
  connectedAt: number | null;
  /** Where the call was started (path + query), for «Volver al chat». */
  returnHref: string | null;
  /** The call's own conversation is on screen with its mic controls (the floating bar steps aside). */
  inlineVisible: boolean;
}

export interface VoiceCallDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPeerConnection: () => RTCPeerConnection;
  createAudio: () => HTMLAudioElement;
  /**
   * Repeating timer that keeps firing while the tab is hidden. Browsers
   * throttle page timers in background tabs (Chrome: down to once a minute),
   * which used to let the server-side call expire; the browser wiring uses a
   * Worker timer. Returns a cancel function.
   */
  createTicker: (ms: number, tick: () => void) => () => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
  isSupported: () => boolean;
}

export const VOICE_HEARTBEAT_MS = 15_000;
export const VOICE_CONNECT_TIMEOUT_MS = 35_000;
export const VOICE_MAX_CALL_MS = 10 * 60_000;
/** WebRTC «disconnected» is often transient (network blip, Wi‑Fi roam): wait before hanging up. */
export const VOICE_DISCONNECT_GRACE_MS = 15_000;
/** Consecutive failed heartbeats tolerated (network errors / 5xx) before giving up. */
export const VOICE_MAX_HEARTBEAT_FAILURES = 3;

const IDLE: VoiceCallSnapshot = { status: 'idle', conversationId: null, muted: false, error: '', connectedAt: null, returnHref: null, inlineVisible: false };

/** Error with a definitive server answer (4xx or explicit error): the call cannot continue. */
class FatalVoiceError extends Error {}

interface Resources {
  pc?: RTCPeerConnection;
  stream?: MediaStream;
  audio?: HTMLAudioElement;
  abort?: AbortController;
  timer?: unknown;
  graceTimer?: unknown;
  stopHeartbeat?: () => void;
  callId?: string;
  conversation?: number;
}

export function createVoiceCallSession(deps: VoiceCallDeps) {
  let snapshot: VoiceCallSnapshot = IDLE;
  let resources: Resources = {};
  let generation = 0;
  let heartbeatFailures = 0;
  let heartbeatInFlight = false;
  const listeners = new Set<() => void>();
  /** Mounted inline controls per conversation (mic buttons of open chats). */
  const inline = new Map<number, number>();

  const set = (patch: Partial<VoiceCallSnapshot>) => {
    const next = { ...snapshot, ...patch };
    next.inlineVisible = next.conversationId !== null && (inline.get(next.conversationId) ?? 0) > 0;
    snapshot = next;
    listeners.forEach((l) => l());
  };

  const url = (conversation: number) => `/api/chat/conversations/${conversation}/voice`;
  const post = (conversation: number, body: object, init: RequestInit = {}) =>
    deps.fetch(url(conversation), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...init });

  function release(error = '') {
    generation++;
    const r = resources;
    resources = {};
    r.abort?.abort();
    deps.clearTimeout(r.timer);
    deps.clearTimeout(r.graceTimer);
    r.stopHeartbeat?.();
    if (r.callId && r.conversation) void post(r.conversation, { action: 'close', callId: r.callId }, { keepalive: true }).catch(() => {});
    r.pc?.close();
    r.stream?.getTracks().forEach((t) => t.stop());
    if (r.audio) {
      r.audio.pause();
      r.audio.srcObject = null;
    }
    heartbeatFailures = 0;
    heartbeatInFlight = false;
    set({ ...IDLE, error, conversationId: error ? snapshot.conversationId : null, returnHref: error ? snapshot.returnHref : null });
  }

  async function poll(callId: string, conversation: number, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await post(conversation, { action: 'poll', callId }, { signal });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new Error('El puente de voz no está disponible.');
    }
    const data = (await response.json().catch(() => ({}))) as { sdp?: string | null; error?: string | null };
    if (response.status >= 400 && response.status < 500) throw new FatalVoiceError(data.error || 'La llamada expiró.');
    if (!response.ok) throw new Error(data.error || 'El puente de voz no está disponible.');
    if (data.error) throw new FatalVoiceError(data.error);
    return data;
  }

  /** Keeps the server-side call alive (the bridge drops calls the server reports inactive). */
  async function heartbeat(attempt: number) {
    const { callId, conversation, abort } = resources;
    if (attempt !== generation || !callId || !conversation || heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      await poll(callId, conversation, abort?.signal);
      if (attempt === generation) heartbeatFailures = 0;
    } catch (e) {
      if (attempt !== generation || (e as Error)?.name === 'AbortError') return;
      if (e instanceof FatalVoiceError) return release(e.message === 'La llamada expiró.' ? 'La llamada terminó: se perdió el contacto con el servidor.' : e.message);
      heartbeatFailures++;
      if (heartbeatFailures >= VOICE_MAX_HEARTBEAT_FAILURES) release('La conexión con OpenClaw terminó.');
    } finally {
      if (attempt === generation) heartbeatInFlight = false;
    }
  }

  async function start(conversationId: number, returnHref: string | null = null) {
    if (snapshot.status !== 'idle' || resources.abort) return;
    if (!deps.isSupported()) {
      set({ ...IDLE, conversationId, error: 'La voz requiere HTTPS y un navegador compatible con micrófono.' });
      return;
    }
    const attempt = ++generation;
    const current = () => generation === attempt;
    const abort = new AbortController();
    resources = { abort, conversation: conversationId };
    set({ ...IDLE, status: 'connecting', conversationId, returnHref });
    resources.timer = deps.setTimeout(() => {
      if (current()) release('La conexión de voz tardó demasiado.');
    }, VOICE_CONNECT_TIMEOUT_MS);
    try {
      const stream = await deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!current()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      resources.stream = stream;
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (current()) release('El micrófono se desconectó.');
        };
      });
      const pc = deps.createPeerConnection();
      const audio = deps.createAudio();
      audio.autoplay = true;
      Object.assign(resources, { pc, audio });
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void audio.play().catch(() => {
          if (current()) release('El navegador bloqueó el audio. Permita reproducir sonido y vuelva a conectar.');
        });
      };
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      // gateway-control-v1: audio only. OpenClaw owns the provider sideband.
      pc.onconnectionstatechange = () => {
        if (!current()) return;
        const state = pc.connectionState;
        if (state === 'connected') {
          deps.clearTimeout(resources.graceTimer);
          resources.graceTimer = undefined;
          if (snapshot.status !== 'connected') {
            deps.clearTimeout(resources.timer);
            resources.timer = deps.setTimeout(() => {
              if (current()) release('La llamada llegó al máximo de 10 minutos.');
            }, VOICE_MAX_CALL_MS);
            set({ status: 'connected', connectedAt: deps.now() });
          }
        } else if (state === 'disconnected') {
          if (resources.graceTimer === undefined) {
            resources.graceTimer = deps.setTimeout(() => {
              if (current() && pc.connectionState !== 'connected') release('La llamada terminó o perdió la conexión.');
            }, VOICE_DISCONNECT_GRACE_MS);
          }
        } else if (state === 'failed' || state === 'closed') {
          release('La llamada terminó o perdió la conexión.');
        }
      };
      const offer = await pc.createOffer();
      if (!current()) return;
      await pc.setLocalDescription(offer);
      const response = await post(conversationId, { action: 'offer', sdp: offer.sdp }, { signal: abort.signal });
      if (!current()) return;
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || 'No se pudo iniciar la voz.');
      }
      const { callId } = (await response.json()) as { callId: string };
      if (!current()) return;
      resources.callId = callId;
      while (current()) {
        const data = await poll(callId, conversationId, abort.signal);
        if (!current()) return;
        if (data.sdp) {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          if (!current()) return;
          resources.stopHeartbeat = deps.createTicker(VOICE_HEARTBEAT_MS, () => void heartbeat(attempt));
          break;
        }
        await new Promise((resolve) => deps.setTimeout(() => resolve(undefined), 1000));
      }
    } catch (e) {
      if (!current()) return;
      release(e instanceof Error && e.message ? e.message : 'No se pudo acceder al micrófono.');
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    start,
    /** Ends the call on purpose (button, page closing). Never shows an error. */
    hangUp: () => {
      if (snapshot.status !== 'idle') release();
    },
    isActive: () => snapshot.status !== 'idle',
    /** A chat showing `conversationId` mounted its mic controls; returns the detach function. */
    attachInline(conversationId: number) {
      inline.set(conversationId, (inline.get(conversationId) ?? 0) + 1);
      set({});
      return () => {
        const n = (inline.get(conversationId) ?? 1) - 1;
        if (n > 0) inline.set(conversationId, n);
        else inline.delete(conversationId);
        set({});
      };
    },
    toggleMute() {
      if (snapshot.status !== 'connected') return;
      const muted = !snapshot.muted;
      resources.stream?.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
      set({ muted });
    },
    dismissError() {
      if (snapshot.status === 'idle' && snapshot.error) set(IDLE);
    },
    /**
     * The tab became visible again: refresh the server-side call right away
     * (timers may have been delayed in the background) and resume audio if
     * the browser paused it. Never ends a healthy call.
     */
    onVisible() {
      if (snapshot.status !== 'connected') return;
      void heartbeat(generation);
      const audio = resources.audio;
      if (audio && audio.paused && audio.srcObject) void audio.play().catch(() => {});
    },
  };
}

export type VoiceCallSession = ReturnType<typeof createVoiceCallSession>;

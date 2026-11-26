/**
 * Browser wiring of the app-level voice call (see voice-call-session.ts).
 *
 * One session per page, created lazily on the client. It lives in module
 * scope, so client-side navigation (another SynerLink section, another
 * conversation) never ends the call; only a full page load does, and while a
 * call is active the page asks for confirmation before unloading.
 */
import { createVoiceCallSession, type VoiceCallSession } from './voice-call-session';

/**
 * Interval driven by a dedicated Worker: background tabs throttle page timers
 * (Chrome «intensive throttling» fires them once a minute), worker timers keep
 * their pace. Falls back to a normal interval if workers are unavailable.
 */
export function createWorkerTicker(ms: number, tick: () => void): () => void {
  try {
    const source = 'let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data);};';
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);
    worker.onmessage = () => tick();
    worker.postMessage(ms);
    return () => worker.terminate();
  } catch {
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }
}

let session: VoiceCallSession | null = null;

export function getVoiceCallSession(): VoiceCallSession | null {
  if (typeof window === 'undefined') return null;
  if (session) return session;
  const s = createVoiceCallSession({
    fetch: (input, init) => window.fetch(input, init),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createPeerConnection: () => new RTCPeerConnection(),
    createAudio: () => new Audio(),
    createTicker: createWorkerTicker,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number | undefined),
    now: () => Date.now(),
    isSupported: () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && !!window.RTCPeerConnection,
  });
  // Visibility never ends a call: coming back only refreshes it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') s.onVisible();
  });
  // Closing or reloading the page is the only implicit way to end a call:
  // ask first, and release the server-side call if the person confirms.
  window.addEventListener('beforeunload', (event) => {
    if (!s.isActive()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('pagehide', () => s.hangUp());
  session = s;
  return s;
}

/** True while a voice call is connecting or connected in this page. */
export function isVoiceCallActive(): boolean {
  return session?.isActive() ?? false;
}

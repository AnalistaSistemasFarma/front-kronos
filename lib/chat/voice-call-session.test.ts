import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVoiceCallSession,
  VOICE_DISCONNECT_GRACE_MS,
  VOICE_HEARTBEAT_MS,
  VOICE_MAX_CALL_MS,
} from './voice-call-session';

type Reply = { status?: number; body?: unknown } | Error;

function harness(pollReplies: Reply[] = [{ body: { sdp: 'v=0 answer' } }]) {
  const calls: { action: string; init: RequestInit }[] = [];
  const queue = [...pollReplies];
  const fetch = vi.fn(async (_url: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push({ action: body.action, init });
    const reply: Reply = body.action === 'offer' ? { body: { callId: 'call-1' } } : body.action === 'close' ? { body: { ok: true } } : (queue.shift() ?? { body: { sdp: 'v=0 answer' } });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  const track = { enabled: true, stop: vi.fn(), onended: null as null | (() => void) };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const pc = {
    connectionState: 'new' as RTCPeerConnectionState,
    onconnectionstatechange: null as null | (() => void),
    ontrack: null,
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'v=0 offer' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const audio = { autoplay: false, paused: true, srcObject: null as unknown, play: vi.fn(async () => {}), pause: vi.fn() };
  const tickers: { ms: number; tick: () => void; stopped: boolean }[] = [];
  const session = createVoiceCallSession({
    fetch,
    getUserMedia: async () => stream,
    createPeerConnection: () => pc as unknown as RTCPeerConnection,
    createAudio: () => audio as unknown as HTMLAudioElement,
    createTicker: (ms, tick) => {
      const t = { ms, tick, stopped: false };
      tickers.push(t);
      return () => { t.stopped = true; };
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    isSupported: () => true,
  });
  const setPc = (state: RTCPeerConnectionState) => {
    pc.connectionState = state;
    pc.onconnectionstatechange?.();
  };
  const connect = async () => {
    await session.start(47, '/process/chat?agent=duo');
    setPc('connected');
  };
  const polls = () => calls.filter((c) => c.action === 'poll').length;
  const beat = async () => {
    tickers.at(-1)!.tick();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { session, calls, track, pc, audio, tickers, setPc, connect, polls, beat };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('app-level voice call session', () => {
  it('connects and keeps the call alive with a background-safe heartbeat', async () => {
    const h = harness();
    await h.connect();
    const s = h.session.getSnapshot();
    expect(s).toMatchObject({ status: 'connected', conversationId: 47, returnHref: '/process/chat?agent=duo', error: '' });
    expect(h.tickers).toHaveLength(1);
    expect(h.tickers[0].ms).toBe(VOICE_HEARTBEAT_MS);
    await h.beat();
    await h.beat();
    expect(h.polls()).toBe(3);
    expect(h.session.isActive()).toBe(true);
  });

  it('does not let observers end the call: only hangUp does, and it releases everything', async () => {
    const h = harness();
    const listener = vi.fn();
    const unsubscribe = h.session.subscribe(listener);
    await h.connect();
    unsubscribe(); // a chat component unmounting (route change)
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.session.getSnapshot().status).toBe('connected');
    expect(h.calls.some((c) => c.action === 'close')).toBe(false);

    h.session.hangUp();
    const close = h.calls.find((c) => c.action === 'close');
    expect(close?.init.keepalive).toBe(true);
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.pc.close).toHaveBeenCalled();
    expect(h.tickers[0].stopped).toBe(true);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'idle', error: '', conversationId: null });
  });

  it('coming back to the tab refreshes the call and resumes paused audio, never hangs up', async () => {
    const h = harness();
    await h.connect();
    h.audio.srcObject = {};
    h.audio.paused = true;
    h.session.onVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.polls()).toBe(2);
    expect(h.audio.play).toHaveBeenCalled();
    expect(h.session.getSnapshot().status).toBe('connected');
  });

  it('tolerates transient heartbeat failures and gives up after three in a row', async () => {
    const h = harness([{ body: { sdp: 'v=0 answer' } }, new TypeError('offline'), { status: 502 }, { body: {} }, new TypeError('offline'), { status: 503 }, new TypeError('offline')]);
    await h.connect();
    await h.beat(); // fail 1
    await h.beat(); // fail 2
    await h.beat(); // ok → resets
    await h.beat(); // fail 1
    await h.beat(); // fail 2
    expect(h.session.getSnapshot().status).toBe('connected');
    await h.beat(); // fail 3
    expect(h.session.getSnapshot()).toMatchObject({ status: 'idle', error: 'La conexión con OpenClaw terminó.', conversationId: 47 });
  });

  it('ends at once when the server says the call expired', async () => {
    const h = harness([{ body: { sdp: 'v=0 answer' } }, { status: 410, body: { error: 'La llamada expiró.' } }]);
    await h.connect();
    await h.beat();
    expect(h.session.getSnapshot().status).toBe('idle');
    expect(h.session.getSnapshot().error).toMatch(/terminó/);
  });

  it('waits a grace period on «disconnected» and survives if WebRTC recovers', async () => {
    const h = harness();
    await h.connect();
    h.setPc('disconnected');
    await vi.advanceTimersByTimeAsync(VOICE_DISCONNECT_GRACE_MS - 1000);
    h.setPc('connected');
    await vi.advanceTimersByTimeAsync(VOICE_DISCONNECT_GRACE_MS);
    expect(h.session.getSnapshot().status).toBe('connected');

    h.setPc('disconnected');
    await vi.advanceTimersByTimeAsync(VOICE_DISCONNECT_GRACE_MS);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'idle', error: 'La llamada terminó o perdió la conexión.' });
  });

  it('ends immediately when WebRTC fails', async () => {
    const h = harness();
    await h.connect();
    h.setPc('failed');
    expect(h.session.getSnapshot().status).toBe('idle');
  });

  it('keeps the 10-minute cap', async () => {
    const h = harness();
    await h.connect();
    const beats = setInterval(() => h.tickers.at(-1)?.tick(), VOICE_HEARTBEAT_MS);
    await vi.advanceTimersByTimeAsync(VOICE_MAX_CALL_MS - 1000);
    expect(h.session.getSnapshot().status).toBe('connected');
    await vi.advanceTimersByTimeAsync(2000);
    clearInterval(beats);
    expect(h.session.getSnapshot()).toMatchObject({ status: 'idle', error: 'La llamada llegó al máximo de 10 minutos.' });
  });

  it('ignores a second start while a call is active and mutes the microphone', async () => {
    const h = harness();
    await h.connect();
    await h.session.start(99);
    expect(h.session.getSnapshot().conversationId).toBe(47);
    h.session.toggleMute();
    expect(h.track.enabled).toBe(false);
    expect(h.session.getSnapshot().muted).toBe(true);
    h.session.toggleMute();
    expect(h.track.enabled).toBe(true);
  });

  it('keeps the error visible after a drop until dismissed', async () => {
    const h = harness();
    await h.connect();
    h.setPc('failed');
    expect(h.session.getSnapshot().returnHref).toBe('/process/chat?agent=duo');
    h.session.dismissError();
    expect(h.session.getSnapshot()).toMatchObject({ status: 'idle', error: '', conversationId: null, returnHref: null });
  });

  it('tells the floating bar when the call\'s conversation shows its own controls', async () => {
    const h = harness();
    await h.connect();
    expect(h.session.getSnapshot().inlineVisible).toBe(false);
    const detachOther = h.session.attachInline(99);
    expect(h.session.getSnapshot().inlineVisible).toBe(false);
    const detach = h.session.attachInline(47);
    expect(h.session.getSnapshot().inlineVisible).toBe(true);
    detach(); // leaving the chat: the bar comes back, the call goes on
    expect(h.session.getSnapshot()).toMatchObject({ inlineVisible: false, status: 'connected' });
    detachOther();
  });
});

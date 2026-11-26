'use client';

import { useSyncExternalStore } from 'react';
import { getVoiceCallSession } from '../../lib/chat/voice-call-browser';
import type { VoiceCallSnapshot } from '../../lib/chat/voice-call-session';

const SERVER_SNAPSHOT: VoiceCallSnapshot = { status: 'idle', conversationId: null, muted: false, error: '', connectedAt: null, returnHref: null, inlineVisible: false };
const noop = () => () => {};

/** App-level voice call: survives navigation; components only observe and control it. */
export function useVoiceCall() {
  const session = getVoiceCallSession();
  const snapshot = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? (() => SERVER_SNAPSHOT),
    () => SERVER_SNAPSHOT
  );
  return { ...snapshot, session };
}

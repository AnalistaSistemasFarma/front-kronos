import 'server-only';
import { cleanTranscript, type AudioContainer, AUDIO_CONTAINERS } from './voice-note';

/**
 * SERVER-SIDE TRANSCRIPTION of chat voice notes (2026-11-26) — SERVER ONLY.
 *
 * Agents cannot listen, so a voice note is transcribed when it is SENT and the
 * text goes into the message body (lib/chat/voice-note.ts). It runs in the same
 * request, in parallel with the OneDrive upload: the agent inbox picks the
 * message up within a second, so a transcript added later would arrive after
 * the agent already answered.
 *
 * Provider: Deepgram pre-recorded STT (nova-3, Spanish), the provider already
 * used by the fleet. Plain `fetch`, no SDK. The audio is sent with
 * `mip_opt_out=true` (Deepgram Model Improvement Program opt-out).
 *
 * NO KEY = OFF. Without configuration nothing leaves the server: the note is
 * saved with the audio only and the body says there is no transcript. A
 * provider failure or timeout NEVER blocks the message: it is saved the same
 * way.
 *
 *   CHAT_VOICE_STT_PROVIDER   'deepgram' to enable; anything else = off
 *   CHAT_VOICE_DEEPGRAM_KEY   Deepgram API key (server only, never logged)
 *   CHAT_VOICE_STT_LANGUAGE   'es' by default (Deepgram language code)
 *   CHAT_VOICE_STT_TIMEOUT_MS 20000 by default (1000-60000)
 */

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

/** Product and company names the model would otherwise misspell. */
const KEYTERMS = ['SynerLink', 'SAP', 'SAPSEND', 'Kronos', 'OneLATAM', 'Farmalogica', 'Abamia', 'Meditrack', 'Kelab'];

export interface VoiceTranscriptionConfig {
  enabled: boolean;
  provider: 'deepgram' | 'off';
  apiKey: string;
  language: string;
  timeoutMs: number;
}

/** Read on every call, so an .env change applies with the normal restart. */
export function voiceTranscriptionConfig(env: NodeJS.ProcessEnv = process.env): VoiceTranscriptionConfig {
  const provider = String(env.CHAT_VOICE_STT_PROVIDER ?? '').trim().toLowerCase() === 'deepgram' ? 'deepgram' : 'off';
  const apiKey = String(env.CHAT_VOICE_DEEPGRAM_KEY ?? '').trim();
  const rawLanguage = String(env.CHAT_VOICE_STT_LANGUAGE ?? '').trim();
  const language = rawLanguage.length <= 8 && /^[A-Za-z-]+$/.test(rawLanguage) ? rawLanguage : 'es';
  const rawTimeout = Number(env.CHAT_VOICE_STT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(60_000, Math.max(1_000, Math.round(rawTimeout))) : 20_000;
  return { enabled: provider === 'deepgram' && apiKey.length > 0, provider, apiKey, language, timeoutMs };
}

export type VoiceTranscriptionResult =
  | { status: 'ok'; text: string }
  | { status: 'empty' }
  | { status: 'disabled' }
  | { status: 'failed'; reason: string };

/** Builds the Deepgram request URL (exported for the tests). */
export function deepgramUrl(language: string): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language,
    smart_format: 'true',
    punctuate: 'true',
    mip_opt_out: 'true',
  });
  for (const term of KEYTERMS) params.append('keyterm', term);
  return `${DEEPGRAM_URL}?${params.toString()}`;
}

/** Transcript out of a Deepgram response, or '' when there is none. */
export function transcriptFromDeepgram(payload: unknown): string {
  const results = (payload as { results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] } } | null)?.results;
  const text = results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return cleanTranscript(text);
}

/**
 * Transcribes one voice note. Never throws: every failure is a result, and
 * the caller saves the message anyway.
 */
export async function transcribeVoiceNote(
  audio: Blob,
  container: AudioContainer,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<VoiceTranscriptionResult> {
  const config = voiceTranscriptionConfig(options.env);
  if (!config.enabled) return { status: 'disabled' };
  const doFetch = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await doFetch(deepgramUrl(config.language), {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.apiKey}`,
        'Content-Type': AUDIO_CONTAINERS[container].mime,
      },
      body: audio,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      // Status only: the response body could echo request details.
      return { status: 'failed', reason: `http-${res.status}` };
    }
    const text = transcriptFromDeepgram(await res.json().catch(() => null));
    return text ? { status: 'ok', text } : { status: 'empty' };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return { status: 'failed', reason: aborted ? 'timeout' : error instanceof Error ? error.name : 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * VOICE NOTES in the chat (2026-11-26, Nicolás Rivera, SynerLink conv 1 msg 41101).
 *
 * A voice note is an ordinary chat message with exactly ONE audio attachment
 * and a DESCRIPTIVE body, the same idea as stickers and GIFs
 * (lib/chat/message-extras.ts):
 *
 *   [Nota de voz · 0:42]
 *   Transcripción automática: hola, le comento que…
 *
 * The body is what agents, bridges, the inbox, search, push notifications and
 * reply previews read, so none of them has to change, and agents (which cannot
 * listen) get the text. The interface recognises the pattern and draws an
 * audio player instead, with the transcript in a collapsible block.
 *
 * No new table or column: the transcript lives in `chat_message.body`.
 *
 * Isomorphic on purpose (no server imports): the composer and the API share the
 * limits, the body format and the validation.
 */

/** Longest recording: 5 minutes. The recorder stops by itself at this point. */
export const MAX_VOICE_NOTE_MS = 5 * 60 * 1000;

/** Shorter than this is a slip of the finger, not a message. */
export const MIN_VOICE_NOTE_MS = 700;

/**
 * Size cap of a voice note. 5 minutes of AAC at 128 kbit/s is about 4.8 MB and
 * Opus at 32 kbit/s about 1.2 MB; 12 MB leaves room for higher bitrates
 * without letting the voice path carry arbitrary big files.
 */
export const MAX_VOICE_NOTE_BYTES = 12 * 1024 * 1024;

/** Every stored voice note file name starts like this (set by the server). */
export const VOICE_NOTE_FILE_PREFIX = 'nota-de-voz-';

/** Longest transcript kept in the body (the body limit is 8.000 characters). */
export const MAX_VOICE_TRANSCRIPT_CHARS = 7000;

const BODY_HEADER = /^\[Nota de voz · (\d{1,2}):(\d{2})\]/;
const TRANSCRIPT_LABEL = 'Transcripción automática:';
const NO_TRANSCRIPT_TEXT = 'Sin transcripción automática; el audio va adjunto.';

/* ─────────────────────────── Duration ─────────────────────────── */

/** 0:42, 4:05. Negative or non-finite values become 0:00. */
export function formatVoiceDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Duration sent by the browser (milliseconds as text). It only labels the
 * message, so it is clamped instead of trusted: null when it is not a number.
 */
export function parseVoiceDurationMs(raw: unknown): number | null {
  const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  if (!/^\d{1,9}$/.test(text)) return null;
  const value = Number(text);
  // A few seconds of slack over the cap: the recorder stops on a timer.
  return Math.min(value, MAX_VOICE_NOTE_MS + 5000);
}

/* ─────────────────────────── Body format ─────────────────────────── */

/** Removes control characters and squeezes the whitespace of a transcript. */
export function cleanTranscript(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_VOICE_TRANSCRIPT_CHARS) return text;
  return `${text.slice(0, MAX_VOICE_TRANSCRIPT_CHARS - 1).trimEnd()}…`;
}

/** The stored body of a voice note. */
export function buildVoiceNoteBody(durationMs: number, transcript: string | null): string {
  const header = `[Nota de voz · ${formatVoiceDuration(durationMs)}]`;
  const text = cleanTranscript(transcript);
  return text ? `${header}\n${TRANSCRIPT_LABEL} ${text}` : `${header}\n${NO_TRANSCRIPT_TEXT}`;
}

export interface ParsedVoiceNoteBody {
  durationMs: number;
  /** null = no automatic transcript (not configured, failed or silence). */
  transcript: string | null;
}

/** Reads a body written by buildVoiceNoteBody, or null when it is not one. */
export function parseVoiceNoteBody(body: string | null | undefined): ParsedVoiceNoteBody | null {
  const text = (body ?? '').trim();
  const match = BODY_HEADER.exec(text);
  if (!match) return null;
  const durationMs = (Number(match[1]) * 60 + Number(match[2])) * 1000;
  const rest = text.slice(match[0].length).trim();
  const transcript = rest.startsWith(TRANSCRIPT_LABEL) ? rest.slice(TRANSCRIPT_LABEL.length).trim() : '';
  return { durationMs, transcript: transcript || null };
}

/* ─────────────────────────── Audio files ─────────────────────────── */

const AUDIO_EXTENSIONS = new Set(['webm', 'weba', 'ogg', 'oga', 'opus', 'm4a', 'mp4', 'aac', 'mp3', 'wav']);

function extensionOf(fileName: string | null | undefined): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName ?? '');
  return match ? match[1].toLowerCase() : '';
}

/** Is this attachment the audio of a voice note (by its stored name)? */
export function isVoiceNoteAttachment(attachment: { fileName?: string | null }): boolean {
  const name = (attachment.fileName ?? '').toLowerCase();
  return name.startsWith(VOICE_NOTE_FILE_PREFIX) && AUDIO_EXTENSIONS.has(extensionOf(name));
}

/** Should the interface draw this message as a voice note? */
export function isVoiceNoteMessage(message: {
  body: string;
  attachments: { fileName?: string | null }[];
}): boolean {
  return (
    message.attachments.length === 1 &&
    isVoiceNoteAttachment(message.attachments[0]) &&
    parseVoiceNoteBody(message.body) !== null
  );
}

export type AudioContainer = 'webm' | 'mp4' | 'ogg' | 'wav' | 'mp3';

/** Extension and MIME type the server stores for each container. */
export const AUDIO_CONTAINERS: Readonly<Record<AudioContainer, { ext: string; mime: string }>> = {
  webm: { ext: 'webm', mime: 'audio/webm' },
  mp4: { ext: 'm4a', mime: 'audio/mp4' },
  ogg: { ext: 'ogg', mime: 'audio/ogg' },
  wav: { ext: 'wav', mime: 'audio/wav' },
  mp3: { ext: 'mp3', mime: 'audio/mpeg' },
};

/**
 * Container of an audio file by its first bytes (magic numbers). The server
 * never trusts the name nor the `type` the browser declares: whatever does not
 * look like one of these containers is not accepted as a voice note.
 */
export function sniffAudioContainer(head: Uint8Array): AudioContainer | null {
  const b = head;
  const ascii = (from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (b.length >= 12 && ascii(4, 4) === 'ftyp') return 'mp4';
  if (b.length >= 4 && ascii(0, 4) === 'OggS') return 'ogg';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (b.length >= 3 && ascii(0, 3) === 'ID3') return 'mp3';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** nota-de-voz-20261126-181502.m4a (local time of the server). */
export function voiceNoteFileName(container: AudioContainer, at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(
    at.getSeconds()
  )}`;
  return `${VOICE_NOTE_FILE_PREFIX}${stamp}.${AUDIO_CONTAINERS[container].ext}`;
}

/* ─────────────────────────── Browser recorder ─────────────────────────── */

/**
 * Recording formats in order of preference. MP4/AAC first: every browser,
 * iPhone included, can PLAY it, so a note recorded on a computer also plays on
 * an iPhone. Chrome and Edge record MP4 where the system has an AAC encoder;
 * otherwise (Firefox, Chrome on Linux) WebM/Opus. Safari on iOS 14.3+ only
 * offers MP4.
 */
export const RECORDER_MIME_CANDIDATES: readonly string[] = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

/** First supported format, or '' to let the browser choose its default. */
export function pickRecorderMimeType(isTypeSupported: ((type: string) => boolean) | undefined): string {
  if (!isTypeSupported) return '';
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // Some old engines throw on unknown codecs strings.
    }
  }
  return '';
}

/** File extension for the blob the recorder produced. */
export function extensionForRecorderMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4' || base === 'video/mp4' || base === 'audio/aac' || base === 'audio/x-m4a') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  return 'webm';
}

/** Spanish message for a failure to start recording. */
export function recorderErrorMessage(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'SynerLink no tiene permiso para usar el micrófono. Habilítelo en la configuración del navegador (ícono del candado junto a la dirección) y vuelva a intentarlo.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró un micrófono en este equipo.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'El micrófono está ocupado por otra aplicación o llamada. Ciérrela y vuelva a intentarlo.';
    case 'NotSupportedError':
      return 'Este navegador no permite grabar notas de voz. Actualícelo o use Chrome, Edge o Safari.';
    default:
      return 'No se pudo iniciar la grabación. Vuelva a intentarlo.';
  }
}

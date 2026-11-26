import 'server-only';
import type { ChatAttachmentCandidate } from './attachments';
import {
  AUDIO_CONTAINERS,
  MAX_VOICE_NOTE_BYTES,
  MIN_VOICE_NOTE_MS,
  parseVoiceDurationMs,
  sniffAudioContainer,
  voiceNoteFileName,
  type AudioContainer,
} from './voice-note';

/**
 * Server checks of a voice note before it is uploaded (2026-11-26).
 *
 * The browser marks the form with `voiceNote=1` and `voiceDurationMs`. Here:
 *   - exactly one file;
 *   - at most MAX_VOICE_NOTE_BYTES;
 *   - its first bytes must be a real audio container (WebM, MP4, Ogg, WAV,
 *     MP3): neither the name nor the declared type are trusted;
 *   - the stored name and type are set HERE (nota-de-voz-<fecha>.<ext>), which
 *     is what the interface uses to draw the player.
 */
export type VoiceNoteCheck =
  | { ok: true; file: ChatAttachmentCandidate; container: AudioContainer; durationMs: number }
  | { ok: false; error: string };

export async function prepareVoiceNote(
  files: ChatAttachmentCandidate[],
  rawDurationMs: unknown,
  now: Date
): Promise<VoiceNoteCheck> {
  if (files.length !== 1) return { ok: false, error: 'La nota de voz debe llevar exactamente un audio.' };
  const [file] = files;
  if (file.size > MAX_VOICE_NOTE_BYTES) {
    return { ok: false, error: 'La nota de voz es demasiado pesada. Grabe una más corta (máximo 5 minutos).' };
  }
  const durationMs = parseVoiceDurationMs(rawDurationMs);
  if (durationMs === null || durationMs < MIN_VOICE_NOTE_MS) {
    return { ok: false, error: 'La nota de voz es demasiado corta.' };
  }
  const head = new Uint8Array(await file.blob.slice(0, 16).arrayBuffer());
  const container = sniffAudioContainer(head);
  if (!container) return { ok: false, error: 'El archivo de la nota de voz no es un audio válido.' };

  return {
    ok: true,
    container,
    durationMs,
    file: {
      fileName: voiceNoteFileName(container, now),
      contentType: AUDIO_CONTAINERS[container].mime,
      size: file.size,
      blob: file.blob,
    },
  };
}

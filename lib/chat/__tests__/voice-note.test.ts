import { describe, expect, it, vi } from 'vitest';
import {
  MAX_VOICE_NOTE_MS,
  MAX_VOICE_TRANSCRIPT_CHARS,
  buildVoiceNoteBody,
  extensionForRecorderMime,
  formatVoiceDuration,
  isVoiceNoteAttachment,
  isVoiceNoteMessage,
  parseVoiceDurationMs,
  parseVoiceNoteBody,
  pickRecorderMimeType,
  recorderErrorMessage,
  sniffAudioContainer,
  voiceNoteFileName,
} from '../voice-note';
import { prepareVoiceNote } from '../voice-note-server';
import { deepgramUrl, transcribeVoiceNote, transcriptFromDeepgram, voiceTranscriptionConfig } from '../voice-transcription';
import { safeDownloadContentType } from '../attachments';

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])));

const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0);
const MP4 = bytes(0, 0, 0, 0x20, 'ftypM4A ', 0, 0);

describe('voice note body', () => {
  it('formats durations', () => {
    expect(formatVoiceDuration(0)).toBe('0:00');
    expect(formatVoiceDuration(42_400)).toBe('0:42');
    expect(formatVoiceDuration(245_000)).toBe('4:05');
    expect(formatVoiceDuration(Number.NaN)).toBe('0:00');
  });

  it('round-trips a transcript and the duration', () => {
    const body = buildVoiceNoteBody(42_000, '  hola,\n le comento   que ya quedó ');
    expect(body).toBe('[Nota de voz · 0:42]\nTranscripción automática: hola, le comento que ya quedó');
    expect(parseVoiceNoteBody(body)).toEqual({ durationMs: 42_000, transcript: 'hola, le comento que ya quedó' });
  });

  it('says when there is no transcript', () => {
    const body = buildVoiceNoteBody(5_000, null);
    expect(body).toContain('Sin transcripción automática');
    expect(parseVoiceNoteBody(body)).toEqual({ durationMs: 5_000, transcript: null });
  });

  it('caps very long transcripts under the body limit', () => {
    const body = buildVoiceNoteBody(60_000, 'palabra '.repeat(3000));
    expect(parseVoiceNoteBody(body)!.transcript!.length).toBeLessThanOrEqual(MAX_VOICE_TRANSCRIPT_CHARS);
    expect(body.length).toBeLessThan(8_000);
  });

  it('does not take ordinary messages for voice notes', () => {
    expect(parseVoiceNoteBody('hola')).toBeNull();
    expect(parseVoiceNoteBody('[Sticker: Pulgar arriba]')).toBeNull();
    const body = buildVoiceNoteBody(3_000, 'hola');
    expect(isVoiceNoteMessage({ body, attachments: [{ fileName: 'nota-de-voz-20261126-101010.m4a' }] })).toBe(true);
    expect(isVoiceNoteMessage({ body, attachments: [{ fileName: 'informe.pdf' }] })).toBe(false);
    expect(isVoiceNoteMessage({ body: 'hola', attachments: [{ fileName: 'nota-de-voz-1.webm' }] })).toBe(false);
    expect(isVoiceNoteMessage({ body, attachments: [] })).toBe(false);
    expect(isVoiceNoteAttachment({ fileName: 'nota-de-voz-1.exe' })).toBe(false);
  });
});

describe('duration from the browser', () => {
  it('accepts digits only and clamps to the cap', () => {
    expect(parseVoiceDurationMs('4200')).toBe(4200);
    expect(parseVoiceDurationMs('999999999')).toBe(MAX_VOICE_NOTE_MS + 5000);
    expect(parseVoiceDurationMs('-1')).toBeNull();
    expect(parseVoiceDurationMs('1e9')).toBeNull();
    expect(parseVoiceDurationMs(undefined)).toBeNull();
  });
});

describe('audio containers', () => {
  it('detects real containers by their first bytes', () => {
    expect(sniffAudioContainer(WEBM)).toBe('webm');
    expect(sniffAudioContainer(MP4)).toBe('mp4');
    expect(sniffAudioContainer(bytes('OggS', 0, 0, 0, 0))).toBe('ogg');
    expect(sniffAudioContainer(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBe('wav');
    expect(sniffAudioContainer(bytes('ID3', 3, 0))).toBe('mp3');
    expect(sniffAudioContainer(bytes('<html>'))).toBeNull();
    expect(sniffAudioContainer(bytes('MZ', 0x90, 0))).toBeNull();
    expect(sniffAudioContainer(new Uint8Array())).toBeNull();
  });

  it('names the stored file by the detected container', () => {
    const at = new Date(2026, 10, 26, 18, 5, 9);
    expect(voiceNoteFileName('mp4', at)).toBe('nota-de-voz-20261126-180509.m4a');
    expect(voiceNoteFileName('webm', at)).toBe('nota-de-voz-20261126-180509.webm');
  });

  it('serves voice note audio with its real type', () => {
    expect(safeDownloadContentType('audio/webm', 'nota-de-voz-1.webm')).toBe('audio/webm');
    expect(safeDownloadContentType('audio/mp4', 'nota-de-voz-1.m4a')).toBe('audio/mp4');
  });
});

describe('recorder format', () => {
  it('prefers MP4/AAC, then WebM/Opus', () => {
    expect(pickRecorderMimeType((t) => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickRecorderMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickRecorderMimeType(() => false)).toBe('');
    expect(pickRecorderMimeType(undefined)).toBe('');
    expect(
      pickRecorderMimeType(() => {
        throw new Error('x');
      })
    ).toBe('');
  });

  it('maps the blob type to an extension', () => {
    expect(extensionForRecorderMime('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
    expect(extensionForRecorderMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForRecorderMime('audio/ogg')).toBe('ogg');
  });

  it('explains permission errors in Spanish', () => {
    expect(recorderErrorMessage({ name: 'NotAllowedError' })).toMatch(/permiso para usar el micrófono/);
    expect(recorderErrorMessage({ name: 'NotFoundError' })).toMatch(/No se encontró un micrófono/);
    expect(recorderErrorMessage(new Error('x'))).toMatch(/No se pudo iniciar/);
  });
});

describe('prepareVoiceNote (server)', () => {
  const candidate = (data: Uint8Array, name = 'nota.webm', type = 'audio/webm') => ({
    fileName: name,
    contentType: type,
    size: data.byteLength,
    blob: new Blob([data as BlobPart], { type }),
  });
  const now = new Date(2026, 10, 26, 9, 0, 0);

  it('accepts a real audio and renames it', async () => {
    const r = await prepareVoiceNote([candidate(MP4, 'x.webm', 'text/html')], '4200', now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.container).toBe('mp4');
    expect(r.durationMs).toBe(4200);
    expect(r.file.fileName).toBe('nota-de-voz-20261126-090000.m4a');
    expect(r.file.contentType).toBe('audio/mp4');
  });

  it('rejects anything that is not audio, too short or not exactly one file', async () => {
    expect((await prepareVoiceNote([candidate(bytes('<html><script>'))], '4200', now)).ok).toBe(false);
    expect((await prepareVoiceNote([candidate(WEBM)], '200', now)).ok).toBe(false);
    expect((await prepareVoiceNote([candidate(WEBM)], 'abc', now)).ok).toBe(false);
    expect((await prepareVoiceNote([], '4200', now)).ok).toBe(false);
    expect((await prepareVoiceNote([candidate(WEBM), candidate(WEBM)], '4200', now)).ok).toBe(false);
  });

  it('rejects oversized notes', async () => {
    const big = { ...candidate(WEBM), size: 13 * 1024 * 1024 };
    const r = await prepareVoiceNote([big], '4200', now);
    expect(r.ok).toBe(false);
  });
});

describe('transcription (server)', () => {
  const env = { CHAT_VOICE_STT_PROVIDER: 'deepgram', CHAT_VOICE_DEEPGRAM_KEY: 'k-test' } as unknown as NodeJS.ProcessEnv;

  it('is off without provider or key', async () => {
    expect(voiceTranscriptionConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(voiceTranscriptionConfig({ CHAT_VOICE_STT_PROVIDER: 'deepgram' } as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
    const fetchImpl = vi.fn();
    const r = await transcribeVoiceNote(new Blob([WEBM as BlobPart]), 'webm', { env: {} as NodeJS.ProcessEnv, fetchImpl });
    expect(r).toEqual({ status: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the audio to Deepgram in Spanish with the improvement program opt-out', async () => {
    const url = deepgramUrl('es');
    expect(url).toContain('model=nova-3');
    expect(url).toContain('language=es');
    expect(url).toContain('mip_opt_out=true');
    expect(url).toContain('keyterm=SynerLink');

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'Hola, revise la solicitud.' }] }] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const r = await transcribeVoiceNote(new Blob([MP4 as BlobPart]), 'mp4', { env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ status: 'ok', text: 'Hola, revise la solicitud.' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Token k-test');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('audio/mp4');
  });

  it('never throws: HTTP errors, network errors and silence are results', async () => {
    const http = vi.fn(async () => new Response('nope', { status: 401 }));
    expect(await transcribeVoiceNote(new Blob([WEBM as BlobPart]), 'webm', { env, fetchImpl: http as unknown as typeof fetch })).toEqual({
      status: 'failed',
      reason: 'http-401',
    });
    const net = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await transcribeVoiceNote(new Blob([WEBM as BlobPart]), 'webm', { env, fetchImpl: net as unknown as typeof fetch })).toEqual({
      status: 'failed',
      reason: 'TypeError',
    });
    const empty = vi.fn(async () => new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: '' }] }] } })));
    expect(await transcribeVoiceNote(new Blob([WEBM as BlobPart]), 'webm', { env, fetchImpl: empty as unknown as typeof fetch })).toEqual({
      status: 'empty',
    });
  });

  it('reads the transcript defensively', () => {
    expect(transcriptFromDeepgram(null)).toBe('');
    expect(transcriptFromDeepgram({ results: {} })).toBe('');
  });
});

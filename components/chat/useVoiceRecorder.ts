'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_VOICE_NOTE_MS,
  MIN_VOICE_NOTE_MS,
  extensionForRecorderMime,
  pickRecorderMimeType,
  recorderErrorMessage,
} from '../../lib/chat/voice-note';

/**
 * Voice note recorder (2026-11-26): MediaRecorder + a level meter.
 *
 * - Format: lib/chat/voice-note.ts (MP4/AAC where available, else WebM/Opus;
 *   Safari on iPhone records MP4).
 * - Must be started from a tap/click: iOS only opens the microphone and the
 *   AudioContext inside a user gesture.
 * - Stops by itself at MAX_VOICE_NOTE_MS and hands the note to `onLimit`.
 * - The microphone is released on stop, cancel and unmount (the red dot of
 *   the browser goes away).
 */

export type RecorderState = 'idle' | 'starting' | 'recording';

export interface RecordedVoiceNote {
  file: File;
  durationMs: number;
}

/** Bars of the live waveform. */
const LEVEL_BARS = 32;
const LEVEL_SAMPLE_MS = 90;

type AudioContextCtor = typeof AudioContext;

export function useVoiceRecorder(onLimit: (note: RecordedVoiceNote) => void) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BARS).fill(0));
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mimeRef = useRef('');
  const onLimitRef = useRef(onLimit);
  onLimitRef.current = onLimit;
  // Set while a stop is in flight, so the limit and a tap never both finish it.
  const finishingRef = useRef<Promise<RecordedVoiceNote | null> | null>(null);

  const release = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    recorderRef.current = null;
  }, []);

  useEffect(() => () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.ondataavailable = null;
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    release();
  }, [release]);

  const finish = useCallback(
    (keep: boolean): Promise<RecordedVoiceNote | null> => {
      if (finishingRef.current) return finishingRef.current;
      const rec = recorderRef.current;
      const durationMs = Math.min(Date.now() - startedAtRef.current, MAX_VOICE_NOTE_MS);
      const done = new Promise<RecordedVoiceNote | null>((resolve) => {
        if (!rec || rec.state === 'inactive') {
          resolve(null);
          return;
        }
        rec.onstop = () => {
          const type = rec.mimeType || mimeRef.current || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type });
          chunksRef.current = [];
          if (!keep || blob.size === 0 || durationMs < MIN_VOICE_NOTE_MS) {
            resolve(null);
            return;
          }
          const file = new File([blob], `nota-de-voz-grabacion.${extensionForRecorderMime(type)}`, { type });
          resolve({ file, durationMs });
        };
        try {
          rec.stop();
        } catch {
          resolve(null);
        }
      }).finally(() => {
        release();
        finishingRef.current = null;
        setState('idle');
        setElapsedMs(0);
        setLevels(Array(LEVEL_BARS).fill(0));
      });
      finishingRef.current = done;
      return done;
    },
    [release]
  );

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    setError(null);
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(
        typeof window !== 'undefined' && window.isSecureContext === false
          ? 'Las notas de voz solo funcionan con conexión segura (https).'
          : recorderErrorMessage({ name: 'NotSupportedError' })
      );
      return;
    }
    setState('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      setState('idle');
      setError(recorderErrorMessage(err));
      return;
    }
    streamRef.current = stream;

    const mime = pickRecorderMimeType(MediaRecorder.isTypeSupported?.bind(MediaRecorder));
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 }) : new MediaRecorder(stream);
    } catch {
      try {
        rec = new MediaRecorder(stream);
      } catch (err) {
        release();
        setState('idle');
        setError(recorderErrorMessage(err));
        return;
      }
    }
    mimeRef.current = rec.mimeType || mime;
    chunksRef.current = [];
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorderRef.current = rec;

    // Level meter. Optional: without Web Audio the note still records.
    try {
      const Ctor: AudioContextCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      }
    } catch {
      analyserRef.current = null;
    }

    try {
      rec.start(1000);
    } catch (err) {
      release();
      setState('idle');
      setError(recorderErrorMessage(err));
      return;
    }
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setState('recording');

    const buffer = new Uint8Array(512);
    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      const analyser = analyserRef.current;
      let level = 0;
      if (analyser) {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < analyser.fftSize; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        level = Math.min(1, Math.sqrt(sum / analyser.fftSize) * 4);
      }
      setLevels((prev) => [...prev.slice(1), level]);
      if (elapsed >= MAX_VOICE_NOTE_MS) {
        void finish(true).then((note) => {
          if (note) onLimitRef.current(note);
        });
      }
    }, LEVEL_SAMPLE_MS);
  }, [finish, release, state]);

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => void finish(false), [finish]);
  const clearError = useCallback(() => setError(null), []);

  return { state, elapsedMs, levels, error, start, stop, cancel, clearError };
}

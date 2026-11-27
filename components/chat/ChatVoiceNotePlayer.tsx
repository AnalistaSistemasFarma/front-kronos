'use client';

import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Collapse, Loader, Text, Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconMicrophone,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from '@tabler/icons-react';
import type { ChatMessageDto } from '../../lib/chat/client';
import { formatVoiceDuration, parseVoiceNoteBody } from '../../lib/chat/voice-note';

const SPEEDS = [1, 1.5, 2] as const;

/**
 * Voice note inside a bubble (2026-11-26): play/pause, progress you can drag,
 * time, speed 1x/1.5x/2x, download, and the automatic transcript collapsed
 * underneath.
 *
 * The audio is fetched ON THE FIRST PLAY through the same permission-checked
 * route as any attachment (/api/chat/attachments/<id>) and played from a blob
 * URL: Safari on iPhone does not play media from a response without byte
 * ranges, and a blob plays everywhere. Nothing is downloaded until someone
 * presses play.
 *
 * The duration comes from the message (MediaRecorder WebM files do not carry
 * one, the element reports Infinity).
 */
export default function ChatVoiceNotePlayer({ message }: { message: ChatMessageDto }) {
  const parsed = parseVoiceNoteBody(message.body);
  const attachment = message.attachments[0];
  const pending = Boolean(message.pending) || !attachment?.downloadUrl;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const durationS = mediaDuration ?? (parsed ? parsed.durationMs / 1000 : 0);

  const ensureAudio = async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current;
    if (!attachment?.downloadUrl) return null;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(attachment.downloadUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = url;
      audio.playbackRate = speed;
      audio.addEventListener('timeupdate', () => setCurrent(audio.currentTime));
      audio.addEventListener('ended', () => {
        setPlaying(false);
        setCurrent(0);
      });
      audio.addEventListener('pause', () => setPlaying(false));
      audio.addEventListener('play', () => setPlaying(true));
      audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) setMediaDuration(audio.duration);
      });
      audio.addEventListener('error', () => {
        setPlaying(false);
        setError('Este navegador no puede reproducir el audio. Descárguelo para escucharlo.');
      });
      audioRef.current = audio;
      setReady(true);
      return audio;
    } catch {
      setError('No se pudo cargar el audio. Vuelva a intentarlo.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    if (pending || loading) return;
    const audio = await ensureAudio();
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setError('Este navegador no puede reproducir el audio. Descárguelo para escucharlo.');
      }
    } else {
      audio.pause();
    }
  };

  const seek = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !durationS) return;
    const target = Math.max(0, Math.min(durationS, fraction * durationS));
    try {
      audio.currentTime = target;
      setCurrent(target);
    } catch {
      /* not seekable yet */
    }
  };

  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const progress = durationS > 0 ? Math.min(1, current / durationS) : 0;
  const transcript = parsed?.transcript ?? null;

  return (
    <div className='chat-nota-voz' data-testid='chat-nota-voz'>
      <div className='chat-nota-voz__fila'>
        <ActionIcon
          size={36}
          radius='xl'
          variant='filled'
          color='blue'
          className='chat-nota-voz__play'
          onClick={() => void toggle()}
          disabled={pending}
          aria-label={playing ? 'Pausar la nota de voz' : 'Reproducir la nota de voz'}
          data-testid='chat-nota-voz-play'
        >
          {loading ? (
            <Loader size={16} color='white' />
          ) : playing ? (
            <IconPlayerPauseFilled size={18} />
          ) : (
            <IconPlayerPlayFilled size={18} />
          )}
        </ActionIcon>
        <div className='chat-nota-voz__centro'>
          <input
            type='range'
            className='chat-nota-voz__barra'
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            disabled={pending || !ready}
            onChange={(event) => seek(Number(event.currentTarget.value) / 1000)}
            aria-label='Posición de la nota de voz'
            style={{ ['--progreso' as string]: `${progress * 100}%` }}
          />
          <div className='chat-nota-voz__tiempos'>
            <span>
              <IconMicrophone size={12} aria-hidden /> {playing || current > 0 ? formatVoiceDuration(current * 1000) : formatVoiceDuration(durationS * 1000)}
            </span>
          </div>
        </div>
        <Tooltip label='Velocidad de reproducción' withArrow>
          <UnstyledButton
            className='chat-nota-voz__velocidad'
            onClick={nextSpeed}
            aria-label={`Velocidad ${speed}x. Cambiar velocidad`}
            data-testid='chat-nota-voz-velocidad'
          >
            {speed}x
          </UnstyledButton>
        </Tooltip>
        {!pending && attachment?.downloadUrl && (
          <Tooltip label='Descargar el audio' withArrow>
            <ActionIcon
              component='a'
              href={attachment.downloadUrl}
              download={attachment.fileName}
              size={28}
              radius='xl'
              variant='subtle'
              color='gray'
              aria-label='Descargar el audio'
            >
              <IconDownload size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </div>

      {error && (
        <Text size='xs' c='red' mt={4}>
          {error}
        </Text>
      )}

      {pending ? (
        <Text size='xs' className='chat-text-muted' mt={4}>
          {message.failed ? 'No se pudo enviar la nota de voz.' : 'Enviando y transcribiendo…'}
        </Text>
      ) : transcript ? (
        <>
          <UnstyledButton
            className='chat-nota-voz__toggle'
            onClick={() => setShowTranscript((v) => !v)}
            aria-expanded={showTranscript}
            data-testid='chat-nota-voz-transcripcion'
          >
            {showTranscript ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            Transcripción
          </UnstyledButton>
          <Collapse in={showTranscript}>
            <Text size='sm' className='chat-nota-voz__texto'>
              {transcript}
            </Text>
          </Collapse>
        </>
      ) : (
        <Text size='xs' className='chat-text-muted' mt={4}>
          Sin transcripción automática.
        </Text>
      )}
    </div>
  );
}

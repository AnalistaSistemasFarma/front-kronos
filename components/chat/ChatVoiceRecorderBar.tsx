'use client';

import { ActionIcon, Text, Tooltip } from '@mantine/core';
import { IconArrowUp, IconTrash } from '@tabler/icons-react';
import { MAX_VOICE_NOTE_MS, formatVoiceDuration } from '../../lib/chat/voice-note';

/**
 * The composer while a voice note is being recorded (2026-11-26): it takes the
 * place of the pill, with the same shape. Discard on the left, red dot + timer
 * + live waveform in the middle, send on the right (WhatsApp/Teams).
 */
export default function ChatVoiceRecorderBar({
  elapsedMs,
  levels,
  starting,
  onCancel,
  onSend,
}: {
  elapsedMs: number;
  levels: number[];
  starting: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const remainingMs = MAX_VOICE_NOTE_MS - elapsedMs;
  const nearLimit = remainingMs <= 30_000;
  return (
    <div className='chat-composer__pill chat-composer__pill--grabando' data-testid='chat-nota-voz-grabando'>
      <Tooltip label='Descartar la nota de voz' withArrow>
        <ActionIcon
          className='chat-composer__plus'
          variant='subtle'
          color='red'
          size={40}
          radius='xl'
          onClick={onCancel}
          aria-label='Descartar la nota de voz'
        >
          <IconTrash size={20} />
        </ActionIcon>
      </Tooltip>
      <div className='chat-nota-voz-grabando' role='status' aria-live='polite'>
        <span className='chat-nota-voz-grabando__punto' aria-hidden />
        <Text size='sm' fw={600} className='chat-nota-voz-grabando__tiempo'>
          {starting ? 'Preparando el micrófono…' : formatVoiceDuration(elapsedMs)}
        </Text>
        <div className='chat-nota-voz-onda' aria-hidden>
          {levels.map((level, i) => (
            <span key={i} style={{ transform: `scaleY(${Math.max(0.12, level)})` }} />
          ))}
        </div>
        {nearLimit && !starting && (
          <Text size='xs' c='red' className='chat-nota-voz-grabando__aviso'>
            Quedan {formatVoiceDuration(Math.max(0, remainingMs))}
          </Text>
        )}
      </div>
      <Tooltip label='Enviar la nota de voz' withArrow>
        <ActionIcon
          className='chat-composer__send'
          size={40}
          radius='xl'
          variant='filled'
          color='blue'
          disabled={starting}
          onClick={onSend}
          aria-label='Enviar la nota de voz'
          data-testid='chat-nota-voz-enviar'
        >
          <IconArrowUp size={26} stroke={2.2} />
        </ActionIcon>
      </Tooltip>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ActionIcon, Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconMessageCircle, IconMicrophone, IconMicrophoneOff, IconPhoneOff, IconX } from '@tabler/icons-react';
import { useVoiceCall } from './useVoiceCall';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Floating mini bar of the app-level voice call (2026-11-25, Nicolás msg
 * 39354): visible in every SynerLink section while the call is active, so the
 * person can keep working and still mute, hang up or go back to the chat.
 * If the call drops while the person is elsewhere, it stays with the reason
 * until dismissed.
 */
export default function VoiceCallBar() {
  const call = useVoiceCall();
  const pathname = usePathname();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (call.status !== 'connected') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [call.status]);

  if (call.status === 'idle' && !call.error) return null;
  // On the call's own conversation the composer mic already holds the controls.
  if (call.inlineVisible) return null;
  const returnPath = call.returnHref?.split('?')[0] ?? null;
  const showReturn = !!call.returnHref && returnPath !== pathname;
  const title = call.status === 'connected' ? 'Llamada con Duo' : call.status === 'connecting' ? 'Conectando llamada…' : 'La llamada terminó';
  return (
    <Paper
      data-testid='voice-call-bar'
      role='region'
      aria-label='Llamada de voz en curso'
      shadow='md'
      radius='xl'
      withBorder
      px='sm'
      py={6}
      style={{ position: 'fixed', right: 16, bottom: 'calc(96px + env(safe-area-inset-bottom))', zIndex: 400, maxWidth: 'calc(100vw - 32px)' }}
    >
      <Group gap='xs' wrap='nowrap'>
        <span
          aria-hidden
          style={{
            width: 10, height: 10, borderRadius: '50%', flex: 'none',
            background: call.status === 'connected' ? 'var(--mantine-color-green-6)' : call.status === 'connecting' ? 'var(--mantine-color-yellow-6)' : 'var(--mantine-color-orange-6)',
          }}
        />
        <div style={{ minWidth: 0 }}>
          <Text size='sm' fw={600} role='status' truncate>
            {title}
            {call.status === 'connected' && call.connectedAt && <Text span size='sm' c='dimmed' fw={400}> · {mmss(now - call.connectedAt)}</Text>}
          </Text>
          {call.error && <Text size='xs' c='orange' role='alert' lineClamp={2}>{call.error}</Text>}
        </div>
        {call.status === 'connected' && (
          <Tooltip label={call.muted ? 'Activar micrófono' : 'Silenciar'} withArrow>
            <ActionIcon variant='light' radius='xl' color={call.muted ? 'orange' : 'blue'} aria-pressed={call.muted}
              aria-label={call.muted ? 'Activar micrófono' : 'Silenciar'} onClick={() => call.session?.toggleMute()}>
              {call.muted ? <IconMicrophoneOff size={18} /> : <IconMicrophone size={18} />}
            </ActionIcon>
          </Tooltip>
        )}
        {showReturn && (
          <Tooltip label='Volver al chat' withArrow>
            <ActionIcon variant='light' radius='xl' aria-label='Volver al chat' onClick={() => router.push(call.returnHref!)}>
              <IconMessageCircle size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        {call.status !== 'idle' ? (
          <Tooltip label='Colgar' withArrow>
            <ActionIcon variant='filled' radius='xl' color='red' aria-label='Colgar' onClick={() => call.session?.hangUp()}>
              <IconPhoneOff size={18} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <ActionIcon variant='subtle' radius='xl' color='gray' aria-label='Cerrar aviso' onClick={() => call.session?.dismissError()}>
            <IconX size={18} />
          </ActionIcon>
        )}
      </Group>
    </Paper>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Group, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { IconMicrophone, IconPhoneOff } from '@tabler/icons-react';

export default function ChatVoice({ conversationId }: { conversationId: number }) {
  const [state, setState] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const resources = useRef<{ pc?: RTCPeerConnection; stream?: MediaStream; audio?: HTMLAudioElement; abort?: AbortController; timer?: ReturnType<typeof setTimeout>; heartbeat?: ReturnType<typeof setInterval>; callId?: string; conversation?: number }>({});
  const generation = useRef(0);
  useEffect(() => { if (error) setOpened(true); }, [error]);
  const stop = useCallback(() => {
    generation.current++;
    const r = resources.current;
    resources.current = {};
    r.abort?.abort();
    clearTimeout(r.timer);
    clearInterval(r.heartbeat);
    if (r.callId) void fetch(`/api/chat/conversations/${r.conversation}/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close', callId: r.callId }), keepalive: true }).catch(() => {});
    r.pc?.close();
    r.stream?.getTracks().forEach(t => t.stop());
    if (r.audio) { r.audio.pause(); r.audio.srcObject = null; }
    setState('idle');
    setMuted(false);
  }, []);
  useEffect(() => stop, [stop, conversationId]);

  async function start() {
    if (resources.current.abort) return;
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setError('La voz requiere HTTPS y un navegador compatible con micrófono.'); return;
    }
    const attempt = ++generation.current;
    const current = () => generation.current === attempt;
    const abort = new AbortController();
    resources.current.abort = abort;
    setState('connecting');
    resources.current.timer = setTimeout(() => { if (current()) { stop(); setError('La conexión de voz tardó demasiado.'); } }, 35_000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!current()) { stream.getTracks().forEach(t => t.stop()); return; }
      resources.current.stream = stream;
      stream.getAudioTracks().forEach(track => { track.onended = () => { if (current()) { stop(); setError('El micrófono se desconectó.'); } }; });
      const pc = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      Object.assign(resources.current, { pc, audio });
      pc.ontrack = event => {
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void audio.play().catch(() => { if (current()) { stop(); setError('El navegador bloqueó el audio. Permita reproducir sonido y vuelva a conectar.'); } });
      };
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      // gateway-control-v1: audio only. OpenClaw owns the provider sideband.
      pc.onconnectionstatechange = () => {
        if (current() && pc.connectionState === 'connected') {
          clearTimeout(resources.current.timer);
          resources.current.timer = setTimeout(stop, 10 * 60_000);
          setState('connected');
        }
        if (current() && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) { stop(); setError('La llamada terminó o perdió la conexión.'); }
      };
      const offer = await pc.createOffer();
      if (!current()) return;
      await pc.setLocalDescription(offer);
      const response = await fetch(`/api/chat/conversations/${conversationId}/voice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'offer', sdp: offer.sdp }), signal: abort.signal,
      });
      if (!current()) return;
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'No se pudo iniciar la voz.');
      }
      const { callId } = await response.json();
      if (!current()) return;
      Object.assign(resources.current, { callId, conversation: conversationId });
      const poll = async () => {
        const r = await fetch(`/api/chat/conversations/${conversationId}/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'poll', callId }), signal: abort.signal });
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || 'El puente de voz no está disponible.');
        return data;
      };
      while (current()) {
        const data = await poll();
        if (!current()) return;
        if (data.sdp) {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          if (!current()) return;
          resources.current.heartbeat = setInterval(() => { void poll().catch(() => { if (current()) { stop(); setError('La conexión con OpenClaw terminó.'); } }); }, 15_000);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) {
      if (!current()) return;
      stop();
      setError(e instanceof Error ? e.message : 'No se pudo acceder al micrófono.');
    }
  }
  const label = state === 'connecting' ? 'Conectando…' : state === 'connected' ? 'Controles de llamada' : 'Hablar en tiempo real';
  return <Popover opened={opened} onChange={setOpened} position='top-end' width={280} withArrow withinPortal>
    <Popover.Target>
      <Tooltip label={label} disabled={opened} withArrow>
        <ActionIcon size={34} radius='xl' variant={state === 'idle' ? 'subtle' : 'light'} color='blue'
          aria-label={label} aria-expanded={opened} onClick={() => {
            setOpened(!opened);
            if (state === 'idle') void start();
          }}>
          <IconMicrophone size={20} />
        </ActionIcon>
      </Tooltip>
    </Popover.Target>
    <Popover.Dropdown>
      <Stack gap='xs'>
        <Text size='sm' fw={600} role='status'>{state === 'connecting' ? 'Conectando…' : state === 'connected' ? 'Voz conectada' : 'Hablar en tiempo real'}</Text>
        <Group gap='xs'>
          {state === 'idle' && <Button size='xs' variant='light' onClick={() => void start()}>Iniciar llamada</Button>}
          {state !== 'idle' && <Button size='xs' color='red' variant='light' leftSection={<IconPhoneOff size={16} />} onClick={stop}>Colgar</Button>}
          {state === 'connected' && <Button size='xs' variant='subtle' aria-pressed={muted} onClick={() => {
            resources.current.stream?.getAudioTracks().forEach(t => { t.enabled = muted; }); setMuted(!muted);
          }}>{muted ? 'Activar micrófono' : 'Silenciar'}</Button>}
        </Group>
        <Text size='xs' c='dimmed'>Voz IA · Máximo 10 minutos.</Text>
        {error && <Alert color='orange' role='alert'>{error}</Alert>}
      </Stack>
    </Popover.Dropdown>
  </Popover>;
}

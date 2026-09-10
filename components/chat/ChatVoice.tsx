'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { IconMicrophone, IconPhoneOff } from '@tabler/icons-react';

export default function ChatVoice({ conversationId }: { conversationId: number }) {
  const [state, setState] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const resources = useRef<{ pc?: RTCPeerConnection; stream?: MediaStream; audio?: HTMLAudioElement; abort?: AbortController; timer?: ReturnType<typeof setTimeout> }>({});
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    const r = resources.current;
    resources.current = {};
    r.abort?.abort();
    clearTimeout(r.timer);
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
      const pc = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      Object.assign(resources.current, { pc, audio });
      pc.ontrack = event => {
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void audio.play().catch(() => { if (current()) { stop(); setError('El navegador bloqueó el audio. Permita reproducir sonido y vuelva a conectar.'); } });
      };
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const channel = pc.createDataChannel('oai-events');
      channel.onopen = () => {
        if (!current()) return;
        clearTimeout(resources.current.timer);
        resources.current.timer = setTimeout(stop, 10 * 60_000);
        setState('connected');
      };
      channel.onmessage = event => {
        try {
          if (JSON.parse(event.data).type === 'error' && current()) { stop(); setError('OpenAI interrumpió la sesión de voz. Intente de nuevo.'); }
        } catch { /* Ignore non-JSON transport messages. */ }
      };
      pc.onconnectionstatechange = () => {
        if (current() && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) { stop(); setError('La llamada terminó o perdió la conexión.'); }
      };
      const offer = await pc.createOffer();
      if (!current()) return;
      await pc.setLocalDescription(offer);
      const response = await fetch(`/api/chat/conversations/${conversationId}/voice`, {
        method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp, signal: abort.signal,
      });
      if (!current()) return;
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'No se pudo iniciar la voz.');
      }
      const sdp = await response.text();
      if (current()) await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (e) {
      if (!current()) return;
      stop();
      setError(e instanceof Error ? e.message : 'No se pudo acceder al micrófono.');
    }
  }
  return <Stack gap={4} p='xs'>
    <Group gap='xs'>
      <Button size='xs' variant='light' leftSection={<IconMicrophone size={16} />} onClick={() => void start()} disabled={state !== 'idle'}>
        {state === 'connecting' ? 'Conectando…' : state === 'connected' ? 'Voz conectada' : 'Hablar en tiempo real'}
      </Button>
      {state !== 'idle' && <Button size='xs' color='red' variant='light' leftSection={<IconPhoneOff size={16} />} onClick={stop}>Colgar</Button>}
      {state === 'connected' && <Button size='xs' variant='subtle' aria-pressed={muted} onClick={() => {
        resources.current.stream?.getAudioTracks().forEach(t => { t.enabled = muted; }); setMuted(!muted);
      }}>{muted ? 'Activar micrófono' : 'Silenciar'}</Button>}
    </Group>
    <Text size='xs' c='dimmed'>Voz IA · OpenAI Realtime · usa el contexto reciente del chat, sin herramientas SAP. El audio se envía a OpenAI; no se guarda en este chat. Máximo 10 minutos.</Text>
    {error && <Alert color='orange' role='alert'>{error}</Alert>}
  </Stack>;
}

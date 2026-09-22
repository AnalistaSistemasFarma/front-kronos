'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
  Loader,
  Center,
} from '@mantine/core';
import { useParams } from 'next/navigation';

type InviteInfo = {
  requestId: number;
  fileId: string;
  email: string;
  name: string | null;
  fileName: string | null;
  subject: string | null;
  status: string | null;
  alreadySigned: boolean;
  isMyTurn: boolean;
  signUrl: string | null;
  requireFingerprint: boolean;
};

export default function FirmaExternaPage() {
  const params = useParams();
  const token = String(params?.token || '');
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/firma/externa/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo abrir el enlace');
        if (!cancelled) {
          setInfo(data as InviteInfo);
          if (data.alreadySigned) setDone(true);
          // Redirigir al enlace público Orion (/sign/...), no quedarse en SynerLink.
          const orionUrl = String(data.signUrl || '').trim();
          if (orionUrl && /\/sign\//i.test(orionUrl) && !data.alreadySigned) {
            window.location.replace(orionUrl);
            return;
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const clearPad = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
  }, []);

  useEffect(() => {
    clearPad();
  }, [clearPad, info]);

  const pointer = (e: React.PointerEvent<HTMLCanvasElement>, type: 'down' | 'move' | 'up') => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * c.width;
    const y = ((e.clientY - rect.top) / rect.height) * c.height;
    if (type === 'down') {
      drawing.current = true;
      ctx.beginPath();
      ctx.moveTo(x, y);
      c.setPointerCapture(e.pointerId);
    } else if (type === 'move' && drawing.current) {
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#111';
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (type === 'up') {
      drawing.current = false;
    }
  };

  const submit = async () => {
    if (!info) return;
    if (info.signUrl) {
      window.location.href = info.signUrl;
      return;
    }
    const c = canvasRef.current;
    if (!c) return;
    const signatureDataUrl = c.toDataURL('image/png');
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/firma/externa/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo firmar');
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al firmar');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Center mih='70vh'>
        <Loader />
      </Center>
    );
  }

  return (
    <Container size='sm' py='xl'>
      <Stack gap='md'>
        <Title order={2}>Firma de documento</Title>
        {error ? (
          <Alert color='red' variant='light'>
            {error}
          </Alert>
        ) : null}
        {info ? (
          <Paper withBorder p='md' radius='md'>
            <Stack gap={6}>
              <Text size='sm' c='dimmed'>
                Firmante
              </Text>
              <Text fw={700}>{info.name || info.email}</Text>
              <Text size='sm'>{info.email}</Text>
              {info.fileName ? (
                <Text size='sm' mt='xs'>
                  Documento: <strong>{info.fileName}</strong>
                </Text>
              ) : null}
              {info.subject ? (
                <Text size='sm'>
                  Solicitud: <strong>{info.subject}</strong>
                </Text>
              ) : null}
            </Stack>
          </Paper>
        ) : null}

        {done ? (
          <Alert color='teal' variant='light'>
            Documento firmado correctamente. Ya puede cerrar esta ventana.
          </Alert>
        ) : info?.signUrl ? (
          <Stack>
            <Text size='sm'>
              Será redirigido al portal de firma de GSS Firma (Orion) para completar su firma.
            </Text>
            <Button onClick={() => { window.location.href = info.signUrl!; }} size='md'>
              Continuar a firmar
            </Button>
          </Stack>
        ) : info && !info.isMyTurn ? (
          <Alert color='yellow' variant='light'>
            Aún no es su turno. Cuando le corresponda, vuelva a abrir este enlace.
          </Alert>
        ) : info ? (
          <Stack>
            <Text size='sm' fw={600}>
              Dibuje su firma
            </Text>
            <canvas
              ref={canvasRef}
              width={560}
              height={180}
              style={{
                width: '100%',
                maxWidth: 560,
                height: 180,
                border: '1px solid #ccc',
                borderRadius: 8,
                touchAction: 'none',
                background: '#fff',
              }}
              onPointerDown={(e) => pointer(e, 'down')}
              onPointerMove={(e) => pointer(e, 'move')}
              onPointerUp={(e) => pointer(e, 'up')}
              onPointerLeave={(e) => pointer(e, 'up')}
            />
            <Group>
              <Button variant='default' onClick={clearPad}>
                Limpiar
              </Button>
              <Button loading={submitting} onClick={() => void submit()}>
                Firmar documento
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Stack>
    </Container>
  );
}

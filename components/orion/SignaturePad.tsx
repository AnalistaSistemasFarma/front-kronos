'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, FileButton, Group, Stack, Text } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { SignatureFileError, signatureFileToCanvas } from './signatureFile';

const UPLOAD_PADDING_PX = 10;

type Props = {
  initialImage?: string | null;
  onSave: (dataUrl: string) => void;
  saving?: boolean;
  /** Texto de ayuda bajo el panel (por defecto, el de las solicitudes). */
  hint?: string;
  /** Texto del botón de guardar (por defecto «Guardar firma»). */
  saveLabel?: string;
};

export default function SignaturePad({
  initialImage,
  onSave,
  saving = false,
  hint = 'Dibuje su firma con el mouse o el dedo, o súbala desde un archivo (imagen, foto o PDF). Se usará al firmar documentos en esta solicitud.',
  saveLabel = 'Guardar firma',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const getCtx = useCallback(() => canvasRef.current?.getContext('2d', { willReadFrequently: true }), []);

  const paintBackground = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    },
    []
  );

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * window.devicePixelRatio);
    canvas.height = Math.floor(rect.height * window.devicePixelRatio);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    paintBackground(ctx, rect.width, rect.height);

    if (initialImage) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        setIsEmpty(false);
      };
      img.src = initialImage;
    }
  }, [getCtx, initialImage, paintBackground]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = getCtx();
    if (!ctx) return;
    drawing.current = true;
    canvasRef.current?.setPointerCapture(e.pointerId);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0f172a';
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setIsEmpty(false);
  };

  const endDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    paintBackground(ctx, rect.width, rect.height);
    setIsEmpty(true);
    setUploadError(null);
  };

  const loadFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const signature = await signatureFileToCanvas(file);
      const canvas = canvasRef.current;
      const ctx = getCtx();
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      paintBackground(ctx, rect.width, rect.height);
      const maxW = Math.max(1, rect.width - UPLOAD_PADDING_PX * 2);
      const maxH = Math.max(1, rect.height - UPLOAD_PADDING_PX * 2);
      const scale = Math.min(maxW / signature.width, maxH / signature.height);
      const w = signature.width * scale;
      const h = signature.height * scale;
      ctx.drawImage(signature, (rect.width - w) / 2, (rect.height - h) / 2, w, h);
      setIsEmpty(false);
    } catch (err) {
      setUploadError(
        err instanceof SignatureFileError ? err.message : 'No se pudo cargar la firma desde el archivo.'
      );
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || isEmpty) return;
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <Stack gap='sm'>
      <div
        style={{
          borderRadius: 12,
          border: '2px dashed var(--app-border)',
          background: 'var(--app-surface-raised)',
          padding: 4,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 160, touchAction: 'none', cursor: 'crosshair', display: 'block' }}
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
        />
      </div>
      <Text size='xs' c='dimmed'>
        {hint}
      </Text>
      {uploadError && (
        <Text size='xs' c='red'>
          {uploadError}
        </Text>
      )}
      <Group>
        <Button variant='default' onClick={clear} disabled={saving || uploading}>
          Limpiar
        </Button>
        <FileButton accept='image/*,application/pdf,.pdf' onChange={(file) => void loadFile(file)}>
          {(props) => (
            <Button
              {...props}
              variant='light'
              leftSection={<IconUpload size={14} />}
              loading={uploading}
              disabled={saving}
            >
              Subir archivo
            </Button>
          )}
        </FileButton>
        <Button onClick={save} disabled={isEmpty || saving || uploading} loading={saving}>
          {saveLabel}
        </Button>
      </Group>
    </Stack>
  );
}
